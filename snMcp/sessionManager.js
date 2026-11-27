// Gerenciador da sessão SSO do Service Now (substitui o processo do mfa-servicenow-mcp).
//
// Estados: stopped → connecting → (awaiting_login) → connected | error
//   connecting     → validando a sessão salva ou tentando o login silencioso (Edge sem janela)
//   awaiting_login → janela do Edge aberta, esperando o usuário concluir SSO/MFA
//
// ensureSession é single-flight: chamadas concorrentes durante o login esperam o mesmo resultado.
// Ordem: sessão salva válida (1 chamada REST, sem navegador) → login sem janela → janela visível.
// Casos portados do original estão marcados com "Origem:"; mapa em docs/sn-sso-upstream.md.

const { EventEmitter } = require('events');
const fs       = require('fs');
const nodePath = require('path');
const { SN_MCP_DIR } = require('../utils/paths');
const edgeLogin = require('./edgeLogin');
const { findEdge } = require('./cdpPipe');
const { normalizeHost } = require('./loginRules');
const { sessionStore: defaultSessionStore } = require('./sessionStore');

// Origem: auth/_keepalive.py · _DEFAULT_INTERVAL_S / _DEFAULT_MAX_IDLE_S
const KEEPALIVE_MS = 5 * 60 * 1000;
const MAX_IDLE_MS  = 6 * 60 * 60 * 1000;
// Origem: auth_manager.py · _MIN_LOGIN_INTERVAL_SECONDS (detecção de abuso no servidor)
const MIN_LOGIN_INTERVAL_MS = 60 * 1000;
// Origem: auth_manager.py · _SELF_HEAL_CIRCUIT_THRESHOLD + backoff 30/60/120 s
const CIRCUIT_THRESHOLD   = 3;
const CIRCUIT_BACKOFF_MS  = [30000, 60000, 120000];
// Origem: auth/_url_predicates.py · janela fechada pelo usuário = espera curta, sem backoff
const CANCEL_COOLDOWN_MS  = 5000;

const PROBE_PATH  = 'table/sys_user_preference?sysparm_limit=1&sysparm_fields=sys_id';   // Origem: auth_manager.py · sondagem
const WHOAMI_PATH = 'table/sys_user?sysparm_query=sys_id%3Djavascript%3Ags.getUserID()&sysparm_fields=user_name%2Cname&sysparm_limit=1';

function _reasonOf(e) {
  switch (e && e.code) {
    case 'SN_LOGIN_CANCELLED':  return 'cancelled';
    case 'SN_LOGIN_COOLDOWN':   return 'cooldown';
    case 'SN_EDGE_NOT_FOUND':   return 'edge_missing';
    case 'SN_LOGIN_NETWORK':    return 'network';
    case 'SN_LOGIN_TIMEOUT':    return 'timeout';
    case 'SN_LOGIN_BORN_DEAD':
    case 'SN_AUTH':             return 'auth';
    default:                    return 'other';
  }
}

function createSessionManager({
  root          = SN_MCP_DIR,
  login         = edgeLogin.runLogin,
  restGet       = (...a) => require('../servicenowClient').restGet(...a),
  sessionStore  = defaultSessionStore,
  findEdgeImpl  = findEdge,
  fsImpl        = fs,
  now           = () => Date.now(),
  setIntervalImpl   = setInterval,
  clearIntervalImpl = clearInterval,
  keepAliveMs   = KEEPALIVE_MS,
  maxIdleMs     = MAX_IDLE_MS,
  minLoginIntervalMs = MIN_LOGIN_INTERVAL_MS,
} = {}) {
  const events = new EventEmitter();
  let status = { state: 'stopped', user: '', message: '', reason: '', instance: '', since: now() };
  let sessionValid   = false;
  let key            = '';
  let currentCfg     = null;
  let sessionPromise = null;
  let keepAliveTimer = null;
  let lastActivityAt = now();
  let lastLoginAt    = 0;
  let failures       = 0;
  let cooldownUntil  = 0;
  let abort          = null;   // { aborted } do login em andamento

  function setState(state, extra = {}) {
    status = { ...status, state, message: '', reason: '', ...extra, since: now() };
    events.emit('status', getStatus());
  }

  function getStatus() {
    return { ...status };
  }

  // Marcos de tempo e passos do login em sn-mcp/logs/backlog-health.log (ver docs/sn-sso.md)
  function trace(msg) {
    try {
      const dir = nodePath.join(root, 'logs');
      fsImpl.mkdirSync(dir, { recursive: true });
      fsImpl.appendFileSync(nodePath.join(dir, 'backlog-health.log'), `${new Date(now()).toISOString()} ${msg}\n`, 'utf8');
    } catch (_) {}
  }

  function _cfgParts(snCfg) {
    const m = (snCfg && snCfg.mcp) || {};
    return {
      host:     normalizeHost(snCfg && snCfg.instance),
      username: String(m.username || '').trim(),
      loginUrl: String(m.loginUrl || '').trim(),
    };
  }

  function _keyOf(snCfg) {
    const p = _cfgParts(snCfg);
    return [p.host, p.username.toLowerCase(), p.loginUrl].join('|');
  }

  function getSessionFile(snCfg) {
    const p = _cfgParts(snCfg);
    return edgeLogin.sessionPaths(root, p.host, p.username).file;
  }

  async function _probe(snCfg, file) {
    let headers;
    try {
      headers = sessionStore.readSessionHeaders(file);
    } catch (e) {
      const err = new Error(`Saved session unreadable: ${e.message}`);
      err.code = 'SN_AUTH';   // arquivo corrompido/sem cookies = sem sessão: faz login de novo
      throw err;
    }
    await restGet(snCfg, PROBE_PATH, { headers });
    let user = '';
    try {
      const data = await restGet(snCfg, WHOAMI_PATH, { headers });
      const row = (data && data.result && data.result[0]) || {};
      user = row.name || row.user_name || '';
    } catch (_) {}
    return user;
  }

  // Sessão salva ainda vale? true/false; erros que não são de autenticação sobem.
  async function _savedSessionUser(snCfg) {
    const file = getSessionFile(snCfg);
    if (!fsImpl.existsSync(file)) return null;
    try {
      return { user: await _probe(snCfg, file) };
    } catch (e) {
      if (e.code === 'SN_AUTH') return null;
      throw e;
    }
  }

  function _checkCooldown(force) {
    const t = now();
    if (!force && t < cooldownUntil) {
      const e = new Error(`Please wait ${Math.ceil((cooldownUntil - t) / 1000)}s before trying to sign in again.`);
      e.code = 'SN_LOGIN_COOLDOWN';
      throw e;
    }
    if (!force && lastLoginAt && t - lastLoginAt < minLoginIntervalMs) {
      const e = new Error(`Please wait ${Math.ceil((minLoginIntervalMs - (t - lastLoginAt)) / 1000)}s before trying to sign in again.`);
      e.code = 'SN_LOGIN_COOLDOWN';
      throw e;
    }
  }

  async function _login(snCfg, file) {
    const p = _cfgParts(snCfg);
    const paths = edgeLogin.sessionPaths(root, p.host, p.username);
    fsImpl.mkdirSync(paths.profile, { recursive: true });
    lastLoginAt = now();
    abort = { aborted: false };
    const common = {
      instance: p.host, username: p.username, loginUrl: p.loginUrl,
      userDataDir: paths.profile, signal: abort, log: m => trace(`login: ${m}`),
    };
    let result;
    try {
      if (p.username || p.loginUrl) {
        try {
          result = await login({ ...common, headless: true });
          trace(`silent login ok in ${result.elapsedMs}ms`);
        } catch (e) {
          if (e.code !== 'SN_LOGIN_NEEDS_INTERACTION') throw e;
          trace(`silent login needs interaction: ${e.message}`);
        }
      }
      if (!result) {
        setState('awaiting_login', { instance: p.host, user: '' });
        result = await login({ ...common, headless: false });
        trace(`window login ok in ${result.elapsedMs}ms`);
      }
    } finally {
      abort = null;
    }
    edgeLogin.writeSessionFile(file, result, { fsImpl, now });
    return result;
  }

  function ensureSession(snCfg, { force = false } = {}) {
    if (!snCfg || !snCfg.instance) return Promise.reject(new Error('Service Now instance not configured.'));
    const k = _keyOf(snCfg);
    if (sessionValid && key === k) return Promise.resolve(getStatus());
    if (sessionPromise) return sessionPromise;

    sessionPromise = (async () => {
      const p = _cfgParts(snCfg);
      if (key !== k) { _stopKeepAlive(); sessionValid = false; }
      key = k;
      currentCfg = snCfg;
      if (force) { failures = 0; cooldownUntil = 0; }
      setState('connecting', { instance: p.host, user: status.instance === p.host ? status.user : '' });
      const t0 = now();
      try {
        const file = getSessionFile(snCfg);
        const saved = await _savedSessionUser(snCfg);
        if (saved) {
          trace(`saved session ok in ${now() - t0}ms`);
          return _connected(saved.user);
        }
        if (!findEdgeImpl()) {
          const e = new Error('Microsoft Edge was not found on this computer.');
          e.code = 'SN_EDGE_NOT_FOUND';
          throw e;
        }
        _checkCooldown(force);
        await _login(snCfg, file);
        // Origem: auth_manager.py · sessão "nascida morta" (login ok, mas a REST não aceita)
        let user;
        try {
          user = await _probe(snCfg, file);
        } catch (e) {
          if (e.code !== 'SN_AUTH') throw e;
          const dead = new Error('Signed in, but Service Now did not accept the session. Try again.');
          dead.code = 'SN_LOGIN_BORN_DEAD';
          throw dead;
        }
        failures = 0;
        cooldownUntil = 0;
        trace(`session ready in ${now() - t0}ms`);
        return _connected(user);
      } catch (e) {
        sessionValid = false;
        trace(`session failed (${e.code || 'error'}): ${e.message}`);
        if (e.code === 'SN_LOGIN_ABORTED') throw e;
        if (e.code === 'SN_LOGIN_CANCELLED') {
          cooldownUntil = now() + CANCEL_COOLDOWN_MS;
          lastLoginAt = 0;   // fechar a janela não conta como tentativa de login
        } else if (e.code !== 'SN_LOGIN_COOLDOWN' && e.code !== 'SN_EDGE_NOT_FOUND') {
          failures++;
          if (failures >= CIRCUIT_THRESHOLD) {
            cooldownUntil = now() + CIRCUIT_BACKOFF_MS[Math.min(failures - CIRCUIT_THRESHOLD, CIRCUIT_BACKOFF_MS.length - 1)];
          }
        }
        setState('error', { message: e.message, reason: _reasonOf(e), instance: p.host });
        throw e;
      }
    })().finally(() => { sessionPromise = null; });
    return sessionPromise;
  }

  function _connected(user) {
    sessionValid = true;
    lastActivityAt = now();
    setState('connected', { user: user || '', instance: _cfgParts(currentCfg).host, transport: 'direct' });
    _startKeepAlive();
    return getStatus();
  }

  // Origem: auth/_keepalive.py — estende a sessão a cada 5 min; para após 6 h sem uso real.
  // Não abre janela: se a sessão caiu, o próximo uso faz o login (silencioso quando possível).
  function _startKeepAlive() {
    _stopKeepAlive();
    keepAliveTimer = setIntervalImpl(_keepAliveTick, keepAliveMs);
    if (keepAliveTimer && keepAliveTimer.unref) keepAliveTimer.unref();
  }

  function _stopKeepAlive() {
    if (keepAliveTimer) clearIntervalImpl(keepAliveTimer);
    keepAliveTimer = null;
  }

  async function _keepAliveTick() {
    if (!sessionValid || !currentCfg || sessionPromise) return;
    if (now() - lastActivityAt > maxIdleMs) { trace('keep-alive idle, skipped'); return; }
    try {
      await restGet(currentCfg, PROBE_PATH, { headers: sessionStore.readSessionHeaders(getSessionFile(currentCfg)) });
      trace('keep-alive ok');
    } catch (e) {
      if (e.code !== 'SN_AUTH') { trace(`keep-alive failed: ${e.message}`); return; }
      trace('keep-alive: session expired');
      sessionValid = false;
      _stopKeepAlive();
      setState('stopped', { reason: 'expired', instance: status.instance });
    }
  }

  // Uso real (consulta de dados) — conta para o limite de ociosidade do keep-alive.
  function touch() {
    lastActivityAt = now();
  }

  // A REST respondeu 401 / redirecionou para o login: força revalidar no próximo ensureSession.
  function invalidateSession() {
    sessionValid = false;
    if (status.state === 'connected') setState('connecting', { user: status.user, instance: status.instance });
  }

  // Abertura do app: valida a sessão salva sem abrir navegador (nunca faz login).
  async function warmup(snCfg) {
    if (!snCfg || !snCfg.instance || sessionValid || sessionPromise) return false;
    try {
      const saved = await _savedSessionUser(snCfg);
      if (!saved || sessionPromise) return false;
      key = _keyOf(snCfg);
      currentCfg = snCfg;
      _connected(saved.user);
      return true;
    } catch (_) {
      return false;
    }
  }

  function stop({ silent = false } = {}) {
    if (abort) abort.aborted = true;
    _stopKeepAlive();
    sessionValid = false;
    if (!silent) setState('stopped', { user: '' });
  }

  // "Sair / trocar conta".
  // Com snCfg: apaga só o perfil do Edge e o arquivo de sessão daquela instância/usuário
  // (várias instâncias convivem em session-edge/). Sem snCfg: apaga todas as sessões e perfis
  // (e a pasta antiga do Chromium do MCP), como antes.
  function logout({ snCfg = null } = {}) {
    stop({ silent: true });
    key = '';
    if (snCfg && snCfg.instance) {
      const p = _cfgParts(snCfg);
      const paths = edgeLogin.sessionPaths(root, p.host, p.username);
      try { fsImpl.rmSync(paths.profile, { recursive: true, force: true }); } catch (_) {}
      try { fsImpl.rmSync(paths.file, { force: true }); } catch (_) {}
    } else {
      ['session-edge', 'session'].forEach(d => {
        try { fsImpl.rmSync(nodePath.join(root, d), { recursive: true, force: true }); } catch (_) {}
      });
    }
    failures = 0;
    cooldownUntil = 0;
    lastLoginAt = 0;
    setState('stopped', { user: '' });
  }

  return {
    ensureSession, invalidateSession, warmup, touch, stop, logout, getStatus, getSessionFile, events,
    edgeAvailable: () => !!findEdgeImpl(),
    _setStateForTest: setState,
  };
}

module.exports = { createSessionManager, KEEPALIVE_MS, MAX_IDLE_MS, MIN_LOGIN_INTERVAL_MS, CIRCUIT_THRESHOLD, CIRCUIT_BACKOFF_MS, CANCEL_COOLDOWN_MS, PROBE_PATH };

// Fachada do modo SSO do Service Now (config: servicenow.mode = 'mcp', nome mantido por
// compatibilidade com configs existentes).
//   get(snCfg, path)  → mesmo contrato de snGet no modo API: resolve com { result }
//   connect / logout / getStatus / warmup → usados por handlers/snMcp.js e server.js
//
// Login: snMcp/sessionManager.js (Edge via CDP, sem Python). Dados: Table API direto do Node com
// a sessão salva — mesmas chamadas, paralelismo e parâmetros do modo API.

const { createSessionManager } = require('./sessionManager');
const { sessionStore: defaultSessionStore } = require('./sessionStore');

const DIRECT_MAX_CONCURRENT = 8;     // instância testada aceita ~12 por sessão; folga p/ keep-alive e outras telas
const BUSY_RETRIES          = 5;
const BUSY_BASE_DELAY_MS    = 400;

function createSnMcpFacade({
  manager,
  sessionStore  = defaultSessionStore,
  restGet       = (...a) => require('../servicenowClient').restGet(...a),
  log           = (...a) => console.warn('[sn-sso]', ...a),
  sleep         = ms => new Promise(r => setTimeout(r, ms)),
  maxConcurrent = DIRECT_MAX_CONCURRENT,
  busyRetries   = BUSY_RETRIES,
  busyDelayMs   = BUSY_BASE_DELAY_MS,
} = {}) {
  // A sessão SSO é uma sessão de usuário única: o ServiceNow recusa (HTTP 202) transações
  // simultâneas acima de ~12 na mesma sessão. Limitamos o paralelismo.
  let active = 0;
  const queue = [];
  function _acquire() {
    if (active < maxConcurrent) { active++; return Promise.resolve(); }
    return new Promise(resolve => queue.push(resolve));
  }
  function _release() {
    const next = queue.shift();
    if (next) next(); else active = Math.max(0, active - 1);
  }

  async function _direct(snCfg, path) {
    const file = manager.getSessionFile(snCfg);
    let headers;
    try {
      headers = sessionStore.readSessionHeaders(file);
    } catch (_) {
      const err = new Error('session file not found');
      err.code = 'SN_NO_SESSION_FILE';
      throw err;
    }
    let setCookie = null;
    const onResponseHeaders = h => {
      const token = sessionStore.rotatedTokenFrom(h);
      if (token) sessionStore.persistRotatedToken(file, token);
      if (h && h['set-cookie']) setCookie = h['set-cookie'];
    };
    // Excesso de concorrência na sessão (202/429): espera crescente e tenta de novo
    let retryAfterMs = 0;
    for (let attempt = 0; ; attempt++) {
      await _acquire();
      try {
        return await restGet(snCfg, path, { headers, onResponseHeaders });
      } catch (e) {
        if (e.code === 'SN_AUTH') e.setCookie = setCookie;
        if (e.code !== 'SN_BUSY' || attempt >= busyRetries) {
          if (e.code === 'SN_BUSY') log(`gave up after ${attempt + 1} attempts (session busy): ${path.split('?')[0]}`);
          throw e;
        }
        retryAfterMs = e.retryAfterMs || 0;
      } finally {
        _release();
      }
      const wait = Math.max(retryAfterMs, busyDelayMs * 2 ** attempt + Math.floor(Math.random() * busyDelayMs));
      await sleep(wait);
    }
  }

  async function get(snCfg, path) {
    await manager.ensureSession(snCfg);
    manager.touch();
    try {
      return await _direct(snCfg, path);
    } catch (e) {
      if (e.code !== 'SN_AUTH' && e.code !== 'SN_NO_SESSION_FILE') throw e;
      // O balanceador indicou outro backend para esta sessão: grava e repete uma vez, sem novo login
      if (e.code === 'SN_AUTH' && sessionStore.absorbBigipRotation(manager.getSessionFile(snCfg), e.setCookie)) {
        log('BIG-IP routing cookie rotated, retrying');
        try {
          return await _direct(snCfg, path);
        } catch (e2) {
          if (e2.code !== 'SN_AUTH') throw e2;
        }
      }
    }

    // Sessão recusada: revalida (login silencioso ou janela, se preciso) e tenta 1 vez de novo
    manager.invalidateSession();
    await manager.ensureSession(snCfg);
    return _direct(snCfg, path);
  }

  // Clique em "Entrar": ignora o cooldown automático e zera o contador de falhas.
  function connect(snCfg) {
    return manager.ensureSession(snCfg, { force: true });
  }

  // Conexão disparada pelo app (ex.: abrir o dashboard SN): respeita cooldown e circuit breaker,
  // para uma página recarregando em loop não abrir janelas de login seguidas.
  function ensure(snCfg) {
    return manager.ensureSession(snCfg);
  }

  return { get, connect, ensure, warmup: snCfg => manager.warmup(snCfg) };
}

// ── Várias instâncias ─────────────────────────────────────────────────────────
// Cada instância (host + usuário + URL de login) tem o seu gerenciador de sessão e a sua fachada:
// sessão, janela de login, keep-alive, cooldown e limite de chamadas próprios. Uma instância não
// invalida a sessão da outra. Os arquivos em session-edge/ já são separados por host e usuário.
function _host(instance) {
  return String(instance || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '').toLowerCase();
}
function keyOf(snCfg) {
  const m = (snCfg && snCfg.mcp) || {};
  return [_host(snCfg && snCfg.instance), String(m.username || '').trim().toLowerCase(), String(m.loginUrl || '').trim()].join('|');
}

function createSnMcpRegistry({
  createManager = () => createSessionManager(),
  createFacade  = manager => createSnMcpFacade({ manager }),
  findEdge      = () => require('./cdpPipe').findEdge(),
} = {}) {
  const { EventEmitter } = require('events');
  const entries = new Map();          // chave → { manager, facade, snCfg }
  const events  = new EventEmitter();

  function entryFor(snCfg) {
    const k = keyOf(snCfg);
    let e = entries.get(k);
    if (!e) {
      const manager = createManager();
      e = { manager, facade: createFacade(manager), snCfg };
      manager.events.on('status', s => events.emit('status', { ...s, key: k, instance: s.instance || _host(snCfg && snCfg.instance) }));
      entries.set(k, e);
    }
    if (snCfg) e.snCfg = snCfg;
    return e;
  }

  // Sem snCfg: a única instância em uso (compatibilidade com quem chama sem argumento)
  function _single() {
    return entries.size === 1 ? entries.values().next().value : null;
  }
  function _statusOf(e, snCfg) {
    // Nenhuma instância em uso ainda (ex.: setup novo, antes de digitar a instância): procura o Edge
    // do mesmo jeito, senão o painel diria "Edge não encontrado" e bloquearia o botão de entrar
    if (!e) return { state: 'stopped', user: '', message: '', reason: '', instance: _host(snCfg && snCfg.instance), edgeAvailable: !!findEdge() };
    return { ...e.manager.getStatus(), edgeAvailable: e.manager.edgeAvailable() };
  }

  return {
    keyOf,
    get:     (snCfg, path) => entryFor(snCfg).facade.get(snCfg, path),
    connect: snCfg => entryFor(snCfg).facade.connect(snCfg),
    ensure:  snCfg => entryFor(snCfg).facade.ensure(snCfg),
    warmup:  snCfg => entryFor(snCfg).facade.warmup(snCfg),
    getStatus(snCfg) {
      if (snCfg && snCfg.instance) return _statusOf(entryFor(snCfg), snCfg);
      return _statusOf(_single(), snCfg);
    },
    isConnected(snCfg) {
      const e = snCfg && snCfg.instance ? entries.get(keyOf(snCfg)) : _single();
      return !!e && e.manager.getStatus().state === 'connected';
    },
    // Com snCfg: sai só daquela instância. Sem: sai de todas e apaga todas as sessões.
    logout(snCfg) {
      if (snCfg && snCfg.instance) { entryFor(snCfg).manager.logout({ snCfg }); return; }
      const all = [...entries.values()];
      if (all.length) all.forEach((e, i) => e.manager.logout(i === 0 ? {} : { snCfg: e.snCfg }));
      else createManager().logout();
    },
    stop(snCfg) {
      if (snCfg && snCfg.instance) { const e = entries.get(keyOf(snCfg)); if (e) e.manager.stop(); return; }
      entries.forEach(e => e.manager.stop());
    },
    shutdown() { entries.forEach(e => e.manager.stop({ silent: true })); },
    listStatuses() {
      return [...entries.entries()].map(([key, e]) => ({ key, ..._statusOf(e, e.snCfg), instance: _host(e.snCfg && e.snCfg.instance) }));
    },
    events,
  };
}

const registry = createSnMcpRegistry();

module.exports = {
  createSnMcpFacade,
  createSnMcpRegistry,
  keyOf,
  get:          registry.get,
  connect:      registry.connect,
  ensure:       registry.ensure,
  warmup:       registry.warmup,
  getStatus:    registry.getStatus,
  isConnected:  registry.isConnected,
  logout:       registry.logout,
  stop:         registry.stop,
  shutdown:     registry.shutdown,
  listStatuses: registry.listStatuses,
  events:       registry.events,
};

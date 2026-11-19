// Ciclo de vida do processo mfa-servicenow-mcp (singleton por instância/usuário).
//
// Estados expostos ao front:
//   not_installed → componentes ainda não instalados
//   stopped       → instalado, processo parado
//   updating      → atualizando componentes para a versão de mcp-version.json
//   starting      → subindo o processo Python
//   connecting    → validando sessão (o MCP pode abrir a janela de login aqui)
//   awaiting_login→ janela de login aberta, aguardando o usuário concluir SSO/MFA
//   connected     → sessão válida
//   error         → última tentativa falhou (mensagem em `message`)
//
// `ensureSession` é single-flight: o login do MCP é lazy e chamadas concorrentes durante o
// login recebem "login in progress". Todo o tráfego espera a sessão ficar válida antes de seguir.

const fs           = require('fs');
const nodePath     = require('path');
const { EventEmitter } = require('events');
const { McpClient }    = require('./mcpClient');
const { rowsOf }       = require('./tableAdapter');
const { installer: defaultInstaller, buildToolEnv } = require('./installer');

const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;
const RETRY_DELAY_MS   = 3000;
const TOOL_PACKAGE     = 'dashboard_readonly';
const YAML_SOURCE      = nodePath.join(__dirname, 'readonly-tools.yaml');
const HOOK_SOURCE      = nodePath.join(__dirname, 'pyhooks', 'sitecustomize.py');
const EDGE_CHANNEL     = 'msedge';

const WHOAMI_ARGS   = { table: 'sys_user', query: 'sys_id=javascript:gs.getUserID()', fields: 'user_name,name', limit: 1 };
const FALLBACK_ARGS = { table: 'sys_user', fields: 'sys_id', limit: 1 };

const AWAITING_LOGIN_RE = /opening visible browser|interactive MFA\/SSO|complete MFA\/SSO there|login window will open/i;

function normalizeHost(instance) {
  return String(instance || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}

// Classifica mensagens de erro do MCP relacionadas a login.
function classifyError(message) {
  const m = String(message || '').toLowerCase();
  if (/still in progress|login is currently in progress|still be completing/.test(m)) return 'in_progress';
  if (/cancel|closed the (login )?window|target (page, context or browser )?closed/.test(m)) return 'cancelled';
  if (/login_cooldown|retry this tool call in/.test(m)) return 'cooldown';
  if (/browser session expired|re-authentication|mfa_required|auth_session_expired|browser login/.test(m)) return 'auth';
  return 'other';
}

// Navegador da janela de login: Edge instalado no Windows (padrão) ou Chromium do Playwright.
function getLoginBrowser(snCfg) {
  return snCfg && snCfg.mcp && snCfg.mcp.browser === 'chromium' ? 'chromium' : 'edge';
}

// Pasta de sessão por navegador — perfis do Edge e do Chromium não são intercambiáveis.
function sessionDirFor(paths, browser) {
  return browser === 'edge' ? `${paths.session}-edge` : paths.session;
}

function buildServerEnv(snCfg, paths, yamlPath, hooksDir) {
  const mcp     = snCfg.mcp || {};
  const browser = getLoginBrowser(snCfg);
  const env = {
    ...buildToolEnv(paths, { caBundle: mcp.caBundle }),
    SERVICENOW_INSTANCE_URL:          `https://${normalizeHost(snCfg.instance)}`,
    // 'sso': abre direto a página de SSO (login_locate_sso.do), sem formulário de senha do
    // Service Now; com o usuário definido, o MCP preenche o ID e segue para o provedor (Microsoft)
    SERVICENOW_AUTH_TYPE:             'sso',
    SERVICENOW_BROWSER_HEADLESS:      'false',
    SERVICENOW_BROWSER_USER_DATA_DIR: sessionDirFor(paths, browser),
    SERVICENOW_AUTO_INSTALL_CHROMIUM: 'false',
    SERVICENOW_MCP_TRANSPORT:         'stdio',
    SERVICENOW_RESPONSE_BUDGET_CHARS: '5000000',
    MCP_TOOL_PACKAGE:                 TOOL_PACKAGE,
    TOOL_PACKAGE_CONFIG_PATH:         yamlPath,
    PYTHONIOENCODING:                 'utf-8',
    // Log do MCP com horário (um arquivo por processo, rotação e limpeza automáticas)
    LOG_FILE:                         nodePath.join(paths.root, 'logs') + nodePath.sep,
  };
  if (mcp.username) env.SERVICENOW_BROWSER_USERNAME = String(mcp.username).trim();
  if (mcp.loginUrl) env.SERVICENOW_BROWSER_LOGIN_URL = String(mcp.loginUrl).trim();
  if (hooksDir) {
    // pyhooks/sitecustomize.py: checagem rápida de instalação do navegador (evita abrir/fechar
    // um navegador a cada startup do MCP) e, no Edge, injeta channel="msedge"
    env.PYTHONPATH = hooksDir;
    env.BH_SN_FAST_PROBE = '1';
    if (browser === 'edge') env.BH_SN_BROWSER_CHANNEL = EDGE_CHANNEL;
  }
  return env;
}

function _toolError(resp) {
  const err = new Error(`Service Now (MCP): ${resp?.message || resp?.error || 'tool error'}`);
  if (resp?.error_type === 'auth_session_expired' || classifyError(resp?.error || resp?.message) !== 'other') err.code = 'SN_AUTH';
  return err;
}

function createProcessManager({
  installer = defaultInstaller,
  ClientClass = McpClient,
  sleep = ms => new Promise(r => setTimeout(r, ms)),
  now = () => Date.now(),
  loginTimeoutMs = LOGIN_TIMEOUT_MS,
  retryDelayMs = RETRY_DELAY_MS,
  fsImpl = fs,
} = {}) {
  const events = new EventEmitter();
  let client   = null;
  let key      = '';
  let sessionValid   = false;
  let sessionPromise = null;
  let starting       = null;   // { key, promise } — spawn + handshake em andamento
  let status = { state: installer.isInstalled() ? 'stopped' : 'not_installed', user: '', message: '', instance: '', since: now() };

  function setState(state, extra = {}) {
    status = { ...status, state, message: '', ...extra, since: now() };
    events.emit('status', getStatus());
  }

  function getStatus() {
    const s = { ...status };
    const installed = installer.isInstalled();
    if (!installed && !['updating', 'starting'].includes(s.state)) s.state = 'not_installed';
    else if (installed && s.state === 'not_installed') s.state = 'stopped';   // instalado depois que o gerenciador subiu
    return s;
  }

  // Marcos de tempo do lado do app (spawn, handshake, login) em sn-mcp/logs/backlog-health.log
  function _trace(msg) {
    try {
      const dir = nodePath.join(installer.paths.root, 'logs');
      fsImpl.mkdirSync(dir, { recursive: true });
      fsImpl.appendFileSync(nodePath.join(dir, 'backlog-health.log'), `${new Date(now()).toISOString()} ${msg}\n`, 'utf8');
    } catch (_) {}
  }

  function _keyOf(snCfg) {
    const m = snCfg.mcp || {};
    return [
      normalizeHost(snCfg.instance),
      String(m.username || '').trim().toLowerCase(),
      String(m.loginUrl || '').trim(),
      getLoginBrowser(snCfg),
    ].join('|');
  }

  // Copia yaml de ferramentas e hook do Edge para fora do app.asar — o Python não lê
  // arquivos empacotados pelo Electron.
  function _prepareFiles() {
    const root     = installer.paths.root;
    const yamlPath = nodePath.join(root, 'readonly-tools.yaml');
    const hooksDir = nodePath.join(root, 'pyhooks');
    fsImpl.mkdirSync(hooksDir, { recursive: true });
    fsImpl.writeFileSync(yamlPath, fsImpl.readFileSync(YAML_SOURCE, 'utf8'), 'utf8');
    fsImpl.writeFileSync(nodePath.join(hooksDir, 'sitecustomize.py'), fsImpl.readFileSync(HOOK_SOURCE, 'utf8'), 'utf8');
    return { yamlPath, hooksDir };
  }

  // Single-flight: pré-aquecimento e login concorrentes compartilham o mesmo spawn/handshake.
  function _startClient(snCfg) {
    const k = _keyOf(snCfg);
    if (starting && starting.key === k) return starting.promise;
    if (client && client.ready && client.running && key === k) return Promise.resolve(client);
    const promise = _doStartClient(snCfg, k).finally(() => { if (starting && starting.promise === promise) starting = null; });
    starting = { key: k, promise };
    return promise;
  }

  async function _doStartClient(snCfg, k) {
    if (client) stop({ silent: true });

    if (!installer.isInstalled()) {
      setState('not_installed');
      const err = new Error('Service Now MCP components are not installed.');
      err.code = 'SN_MCP_NOT_INSTALLED';
      throw err;
    }
    if (installer.needsUpdate()) {
      setState('updating');
      await installer.install({ caBundle: snCfg.mcp?.caBundle, browser: getLoginBrowser(snCfg) });
    }
    // Modo Chromium escolhido em Avançado: baixa o navegador sob demanda (o Edge não precisa)
    if (getLoginBrowser(snCfg) === 'chromium' && installer.hasChromium && !installer.hasChromium()) {
      setState('updating');
      await installer.installBrowser({ caBundle: snCfg.mcp?.caBundle });
    }

    setState('starting', { instance: normalizeHost(snCfg.instance), user: '' });
    const { yamlPath, hooksDir } = _prepareFiles();
    const c = new ClientClass({
      command: installer.getPythonExe(),   // runtime embutido extraído ou venv da instalação online
      args:    ['-m', 'servicenow_mcp'],
      env:     buildServerEnv(snCfg, installer.paths, yamlPath, hooksDir),
      cwd:     installer.paths.root,
      callTimeoutMs: loginTimeoutMs,
    });
    c.on('stderr', line => {
      if (AWAITING_LOGIN_RE.test(line) && status.state !== 'awaiting_login') setState('awaiting_login', { user: '' });
    });
    c.on('exit', () => {
      if (client !== c) return;
      client = null;
      sessionValid = false;
      if (status.state !== 'stopped') setState('stopped', { message: 'MCP process exited' });
    });
    client = c;
    key    = k;
    const t0 = now();
    _trace(`spawn mcp (instance=${normalizeHost(snCfg.instance)} browser=${getLoginBrowser(snCfg)})`);
    try {
      await c.start();
    } catch (e) {
      _trace(`handshake failed after ${now() - t0}ms: ${e.message}`);
      if (client === c) { client = null; key = ''; }
      try { c.stop(); } catch (_) {}
      throw e;
    }
    _trace(`handshake ok in ${now() - t0}ms`);
    if (status.state === 'starting') setState('stopped', { instance: normalizeHost(snCfg.instance), user: '' });
    return c;
  }

  async function _whoAmI(c) {
    let resp = await c.callTool('sn_query', WHOAMI_ARGS, { timeoutMs: loginTimeoutMs });
    if (resp && resp.success === false && classifyError(resp.error || resp.message) === 'other' && resp.error_type !== 'auth_session_expired') {
      // Algumas instâncias recusam javascript: em queries — basta provar que a sessão lê dados
      resp = await c.callTool('sn_query', FALLBACK_ARGS, { timeoutMs: loginTimeoutMs });
    }
    if (!resp || resp.success === false) throw _toolError(resp);
    const row = rowsOf(resp)[0] || {};
    return row.name || row.user_name || '';
  }

  function ensureSession(snCfg) {
    if (!snCfg || !snCfg.instance) return Promise.reject(new Error('Service Now instance not configured.'));
    if (sessionValid && client && client.running && key === _keyOf(snCfg)) return Promise.resolve(getStatus());
    if (sessionPromise) return sessionPromise;

    sessionPromise = (async () => {
      const deadline = now() + loginTimeoutMs;
      try {
        const c = await _startClient(snCfg);
        if (status.state !== 'awaiting_login') setState('connecting');
        const t0 = now();
        _trace('session check start');
        for (;;) {
          try {
            const user = await _whoAmI(c);
            sessionValid = true;
            _trace(`session ok in ${now() - t0}ms`);
            setState('connected', { user });
            return getStatus();
          } catch (e) {
            const kind = classifyError(e.message);
            if (kind === 'in_progress' && now() < deadline) {
              if (status.state !== 'awaiting_login') setState('awaiting_login');
              await sleep(retryDelayMs);
              continue;
            }
            throw e;
          }
        }
      } catch (e) {
        sessionValid = false;
        _trace(`session failed: ${e.message}`);
        if (e.code !== 'SN_MCP_NOT_INSTALLED') {
          const kind = classifyError(e.message);
          setState('error', { message: e.message, reason: kind });
        }
        throw e;
      }
    })().finally(() => { sessionPromise = null; });
    return sessionPromise;
  }

  // Chamada de ferramenta com portão de sessão e uma nova tentativa após reautenticação.
  async function callTool(snCfg, name, args) {
    await ensureSession(snCfg);
    const attempt = async () => {
      const resp = await client.callTool(name, args);
      if (resp && resp.success === false && (resp.error_type === 'auth_session_expired' || classifyError(resp.error || resp.message) !== 'other')) {
        throw _toolError(resp);
      }
      return resp;
    };
    try {
      return await attempt();
    } catch (e) {
      if (e.code !== 'SN_AUTH' && !/exited|not running|stopped/i.test(e.message)) throw e;
      sessionValid = false;
      if (status.state === 'connected') setState('connecting');
      await ensureSession(snCfg);
      return attempt();
    }
  }

  function stop({ silent = false } = {}) {
    const c = client;
    client = null;
    key = '';
    sessionValid = false;
    if (c) {
      try { c.stop(); } catch (_) {}   // McpClient.stop encerra a árvore de processos
    }
    if (!silent) setState(installer.isInstalled() ? 'stopped' : 'not_installed', { user: '' });
  }

  // "Sair / trocar conta": encerra o processo e apaga cookies/perfil do navegador.
  function logout() {
    stop();
    ['chromium', 'edge'].forEach(b => {
      try { fsImpl.rmSync(sessionDirFor(installer.paths, b), { recursive: true, force: true }); } catch (_) {}
    });
    setState(installer.isInstalled() ? 'stopped' : 'not_installed', { user: '' });
  }

  // Pré-aquecimento: sobe o processo e faz o handshake (12-15s) antes de o usuário clicar em
  // "Entrar". Não valida a sessão — isso dispararia o login.
  async function warmup(snCfg) {
    if (!snCfg || !snCfg.instance || !installer.isInstalled() || installer.needsUpdate()) return false;
    try {
      await _startClient(snCfg);
      return true;
    } catch (_) {
      return false;
    }
  }

  // Força o próximo ensureSession a revalidar a sessão pelo MCP (que faz novo login se preciso).
  // Usado quando a REST direta com a sessão do MCP responde 401 / redireciona para o login.
  function invalidateSession() {
    sessionValid = false;
    if (status.state === 'connected') setState('connecting', { user: status.user });
  }

  // Meio usado para os dados: 'direct' (REST com a sessão do MCP) ou 'mcp-tools' (sn_query).
  function setTransport(transport, reason = '') {
    if (status.transport === transport && status.transportReason === reason) return;
    status = { ...status, transport, transportReason: reason };
    events.emit('status', getStatus());
  }

  return { ensureSession, callTool, stop, logout, getStatus, invalidateSession, setTransport, warmup, events, _setStateForTest: setState };
}

module.exports = { createProcessManager, classifyError, buildServerEnv, normalizeHost, getLoginBrowser, sessionDirFor, WHOAMI_ARGS, TOOL_PACKAGE };

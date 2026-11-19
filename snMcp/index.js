// Fachada do modo MCP do Service Now.
//   get(snCfg, path)  → mesmo contrato de snGet no modo API: resolve com { result }
//   connect / logout / getStatus / install → usados por handlers/snMcp.js
//
// Dados: o MCP executa uma ferramenta por vez (síncrono no event loop), então consultar pela
// ferramenta sn_query é lento. Por isso o MCP cuida só do login (SSO/MFA, keep-alive, relogin)
// e os dados vêm direto da Table API com a sessão que ele grava em disco — mesmas chamadas,
// mesmo paralelismo e mesmos parâmetros do modo API. Se a REST direta não aceitar a sessão,
// cai automaticamente para o adaptador sn_query (tableAdapter).

const { snMcpGet }             = require('./tableAdapter');
const { createProcessManager, sessionDirFor, getLoginBrowser } = require('./mcpProcess');
const { installer: defaultInstaller } = require('./installer');
const { sessionStore: defaultSessionStore } = require('./sessionStore');

const DIRECT_MAX_CONCURRENT = 8;     // instância testada aceita ~12 por sessão; folga p/ keep-alive e outras telas
const BUSY_RETRIES          = 5;
const BUSY_BASE_DELAY_MS    = 400;

function createSnMcpFacade({
  manager,
  installer     = defaultInstaller,
  sessionStore  = defaultSessionStore,
  restGet       = (...a) => require('../servicenowClient').restGet(...a),
  log           = (...a) => console.warn('[sn-mcp]', ...a),
  sleep         = ms => new Promise(r => setTimeout(r, ms)),
  maxConcurrent = DIRECT_MAX_CONCURRENT,
  busyRetries   = BUSY_RETRIES,
  busyDelayMs   = BUSY_BASE_DELAY_MS,
} = {}) {
  let directDisabled = '';   // motivo do fallback para sn_query ('' = caminho direto ativo)

  // A sessão SSO é uma sessão de usuário única: o ServiceNow recusa (HTTP 202) transações
  // simultâneas acima de ~12 na mesma sessão. Limitamos o paralelismo do caminho direto.
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

  function _viaTools(snCfg, path) {
    return snMcpGet(path, (name, args) => manager.callTool(snCfg, name, args));
  }

  function _disableDirect(reason) {
    if (!directDisabled) log(`direct REST disabled, using MCP tools: ${reason}`);
    directDisabled = reason;
    manager.setTransport?.('mcp-tools', reason);
  }

  async function _direct(snCfg, path) {
    const dir  = sessionDirFor(installer.paths, getLoginBrowser(snCfg));
    const file = sessionStore.findSessionFile(dir, snCfg.instance);
    if (!file) {
      const err = new Error('session file not found');
      err.code = 'SN_NO_SESSION_FILE';
      throw err;
    }
    const headers = sessionStore.readSessionHeaders(file);
    const onResponseHeaders = h => {
      const token = sessionStore.rotatedTokenFrom(h);
      if (token) sessionStore.persistRotatedToken(file, token);
    };
    // Excesso de concorrência na sessão (202/429): espera crescente e tenta de novo
    let retryAfterMs = 0;
    for (let attempt = 0; ; attempt++) {
      await _acquire();
      try {
        const data = await restGet(snCfg, path, { headers, onResponseHeaders });
        manager.setTransport?.('direct');
        return data;
      } catch (e) {
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
    if (directDisabled) return _viaTools(snCfg, path);

    try {
      return await _direct(snCfg, path);
    } catch (e) {
      if (e.code === 'SN_NO_SESSION_FILE') {
        _disableDirect('no session file');
        return _viaTools(snCfg, path);
      }
      if (e.code !== 'SN_AUTH') throw e;
    }

    // Sessão recusada: o MCP revalida (e abre a janela de login se precisar), depois 1 nova tentativa
    manager.invalidateSession();
    await manager.ensureSession(snCfg);
    try {
      return await _direct(snCfg, path);
    } catch (e) {
      if (e.code !== 'SN_AUTH' && e.code !== 'SN_NO_SESSION_FILE') throw e;
      // O MCP considera a sessão válida, mas a REST direta não aceita: usa as ferramentas do MCP
      _disableDirect(e.message);
      return _viaTools(snCfg, path);
    }
  }

  function connect(snCfg) {
    directDisabled = '';   // nova conexão: tenta o caminho direto de novo
    return manager.ensureSession(snCfg);
  }

  return { get, connect, warmup: snCfg => manager.warmup(snCfg), isDirectDisabled: () => directDisabled };
}

const manager = createProcessManager({ installer: defaultInstaller });
const facade  = createSnMcpFacade({ manager });

module.exports = {
  createSnMcpFacade,
  get:     facade.get,
  connect: facade.connect,
  warmup:  facade.warmup,
  getStatus: () => ({ ...manager.getStatus(), components: defaultInstaller.getInfo() }),
  install:   opts => defaultInstaller.install(opts),
  shutdown:  () => manager.stop({ silent: true }),
  logout:    () => manager.logout(),
  stop:      () => manager.stop(),
  isConnected: () => manager.getStatus().state === 'connected',
  events: manager.events,
};

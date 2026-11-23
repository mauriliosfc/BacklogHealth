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

const manager = createSessionManager();
const facade  = createSnMcpFacade({ manager });

module.exports = {
  createSnMcpFacade,
  get:     facade.get,
  connect: facade.connect,
  ensure:  facade.ensure,
  warmup:  facade.warmup,
  getStatus: () => ({ ...manager.getStatus(), edgeAvailable: manager.edgeAvailable() }),
  shutdown:  () => manager.stop({ silent: true }),
  logout:    () => manager.logout(),
  stop:      () => manager.stop(),
  isConnected: () => manager.getStatus().state === 'connected',
  events: manager.events,
};

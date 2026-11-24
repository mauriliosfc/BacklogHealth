// Singleton for shared server state.
// cachedHTML is the last-rendered dashboard HTML, updated by buildAndCache()
// and read by GET /. Both dashboard and project handlers write to it.

let _html = '';

// Resultado da última montagem do dashboard por organização:
// orgId → 'auth' (token recusado) | 'ok' (ao menos um projeto carregou)
let _orgStatus = {};

module.exports = {
  get html() { return _html; },
  set html(v) { _html = v; },
  get orgStatus() { return _orgStatus; },
  set orgStatus(v) { _orgStatus = v && typeof v === 'object' ? v : {}; },
  // Status de uma organização para a tela de Configurações
  statusOf(orgId) { return _orgStatus[orgId] || 'unknown'; },
};

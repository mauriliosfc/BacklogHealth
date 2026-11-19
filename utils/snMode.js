// Modo de conexão com o Service Now: 'api' (usuário/senha, Basic auth) ou 'mcp' (SSO/MFA via MCP).
// Funções puras — compartilhadas por config, handlers e services.

function getSnMode(sn) {
  return sn && sn.mode === 'mcp' ? 'mcp' : 'api';
}

// Configurado = tem o mínimo para consultar: API exige usuário e senha; MCP só a instância
// (a autenticação acontece na janela de login do MCP).
function isSnConfigured(sn) {
  if (!sn || !sn.instance) return false;
  return getSnMode(sn) === 'mcp' ? true : !!(sn.user && sn.pass);
}

module.exports = { getSnMode, isSnConfigured };

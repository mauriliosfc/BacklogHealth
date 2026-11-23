// Handlers do modo SSO do Service Now (login SSO/MFA pelo Edge). Funções puras, sem req/res.
// O login roda em background — o front acompanha via getMcpStatus (polling).

const { getSnConfig } = require('../config');
const { httpError }   = require('./utils');
const snMcp           = require('../snMcp');

const _host = v => String(v || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');

function _cfgFrom(p = {}) {
  const saved    = getSnConfig() || {};
  const instance = _host(p.instance !== undefined ? p.instance : saved.instance);
  if (!instance) httpError(400, 'instance is required.');
  return {
    ...saved,
    mode: 'mcp',
    instance,
    mcp: {
      ...(saved.mcp || {}),
      ...(p.mcpUsername !== undefined ? { username: String(p.mcpUsername || '').trim() } : {}),
      ...(p.mcpLoginUrl !== undefined ? { loginUrl: String(p.mcpLoginUrl || '').trim() } : {}),
    },
  };
}

function getMcpStatus() {
  const sn = getSnConfig() || {};
  return { ...snMcp.getStatus(), mode: sn.mode === 'mcp' ? 'mcp' : 'api' };
}

// Valida a sessão salva ou faz o login (sem janela quando possível; senão abre o Edge).
function connectMcp(p = {}) {
  const cfg = _cfgFrom(p);
  snMcp.connect(cfg).catch(e => console.error('[sn-sso] connect failed:', e.message));
  return { ok: true, started: true };
}

// Abertura de tela: confere a sessão salva em background (nunca abre o navegador).
function warmupMcp(p = {}) {
  const sn = getSnConfig() || {};
  const instance = _host(p.instance !== undefined ? p.instance : sn.instance);
  if (!instance) return { ok: false };
  snMcp.warmup(_cfgFrom({ ...p, instance })).catch(() => {});
  return { ok: true, started: true };
}

// "Sair / trocar conta": apaga a sessão e o perfil do Edge.
function disconnectMcp() {
  snMcp.logout();
  return { ok: true };
}

module.exports = { getMcpStatus, connectMcp, warmupMcp, disconnectMcp };

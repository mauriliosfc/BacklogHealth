// Handlers do modo MCP do Service Now (login SSO/MFA). Funções puras, sem req/res.
// Instalação e login rodam em background — o front acompanha via getMcpStatus (polling).

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
      ...(p.mcpCaBundle !== undefined ? { caBundle: String(p.mcpCaBundle || '').trim() } : {}),
      ...(p.mcpLoginUrl !== undefined ? { loginUrl: String(p.mcpLoginUrl || '').trim() } : {}),
      ...(p.mcpBrowser  !== undefined ? { browser: p.mcpBrowser === 'chromium' ? 'chromium' : 'edge' } : {}),
    },
  };
}

function getMcpStatus() {
  const sn = getSnConfig() || {};
  return { ...snMcp.getStatus(), mode: sn.mode === 'mcp' ? 'mcp' : 'api' };
}

function installMcp(p = {}) {
  const saved    = getSnConfig()?.mcp || {};
  const caBundle = p.mcpCaBundle !== undefined ? String(p.mcpCaBundle || '').trim() : (saved.caBundle || '');
  const browser  = (p.mcpBrowser !== undefined ? p.mcpBrowser : saved.browser) === 'chromium' ? 'chromium' : 'edge';
  snMcp.install({ caBundle, browser }).catch(e => console.error('[sn-mcp] install failed:', e.message));
  return { ok: true, started: true };
}

// Sobe o MCP e valida a sessão. Se não houver sessão salva, o MCP abre a janela de login.
function connectMcp(p = {}) {
  const cfg = _cfgFrom(p);
  snMcp.connect(cfg).catch(e => console.error('[sn-mcp] connect failed:', e.message));
  return { ok: true, started: true };
}

// Pré-aquece o processo do MCP (sem login) para o clique em "Entrar" responder rápido.
function warmupMcp(p = {}) {
  const sn = getSnConfig() || {};
  const instance = _host(p.instance !== undefined ? p.instance : sn.instance);
  if (!instance) return { ok: false };
  snMcp.warmup(_cfgFrom({ ...p, instance })).catch(() => {});
  return { ok: true, started: true };
}

// "Sair / trocar conta": encerra o processo e apaga a sessão salva.
function disconnectMcp() {
  snMcp.logout();
  return { ok: true };
}

module.exports = { getMcpStatus, installMcp, connectMcp, warmupMcp, disconnectMcp };

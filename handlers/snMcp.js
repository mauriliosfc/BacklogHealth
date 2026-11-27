// Handlers do modo SSO do Service Now (login SSO/MFA pelo Edge). Funções puras, sem req/res.
// O login roda em background — o front acompanha via getMcpStatus (polling).
// Várias instâncias: cada chamada indica a instância por `instanceId` (salva) ou por `instance`
// (digitada, ainda não salva). Sem nenhum dos dois, vale a instância principal.

const { getSnInstance, getSnInstances, snLabel } = require('../config');
const { httpError }   = require('./utils');
const snMcp           = require('../snMcp');

const _host = v => String(v || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');

function _cfgFrom(p = {}) {
  const saved    = getSnInstance(p.instanceId) || {};
  const instance = _host(p.instance !== undefined ? p.instance : saved.instance);
  if (!instance) httpError(400, 'instance is required.');
  // Instância digitada diferente da salva: não herda usuário/URL de login da salva
  const base = _host(saved.instance).toLowerCase() === instance.toLowerCase() ? saved : {};
  return {
    ...base,
    mode: 'mcp',
    instance,
    mcp: {
      ...(base.mcp || {}),
      ...(p.mcpUsername !== undefined ? { username: String(p.mcpUsername || '').trim() } : {}),
      ...(p.mcpLoginUrl !== undefined ? { loginUrl: String(p.mcpLoginUrl || '').trim() } : {}),
    },
  };
}

// Status de uma instância. Com `all`, lista as instâncias SSO salvas (aviso do dashboard).
function getMcpStatus(p = {}) {
  if (p.all) {
    const all = getSnInstances();
    const statuses = all
      .filter(s => s.mode === 'mcp' && s.instance)
      // dashboard: a instância aparece no dashboard do SN (principal ou com grupos)
      .map(s => ({
        instanceId: s.id, label: snLabel(s), isPrimary: all[0] === s,
        dashboard: all[0] === s || (Array.isArray(s.assignmentGroups) && s.assignmentGroups.length > 0),
        ...snMcp.getStatus(s),
      }));
    return { statuses };
  }
  const saved = getSnInstance(p.instanceId) || {};
  const hasTarget = p.instance !== undefined || saved.instance;
  if (!hasTarget) return { ...snMcp.getStatus(), mode: saved.mode === 'mcp' ? 'mcp' : 'api' };
  const cfg = _cfgFrom(p);
  return { ...snMcp.getStatus(cfg), mode: saved.mode === 'mcp' ? 'mcp' : 'api', instanceId: saved.id || null };
}

// Valida a sessão salva ou faz o login (sem janela quando possível; senão abre o Edge).
function connectMcp(p = {}) {
  const cfg = _cfgFrom(p);
  snMcp.connect(cfg).catch(e => console.error('[sn-sso] connect failed:', e.message));
  return { ok: true, started: true };
}

// Abertura de tela: confere a sessão salva em background (nunca abre o navegador).
function warmupMcp(p = {}) {
  const saved = getSnInstance(p.instanceId) || {};
  const instance = _host(p.instance !== undefined ? p.instance : saved.instance);
  if (!instance) return { ok: false };
  snMcp.warmup(_cfgFrom({ ...p, instance })).catch(() => {});
  return { ok: true, started: true };
}

// "Sair / trocar conta": com instância, apaga só a sessão e o perfil do Edge dela; sem, de todas.
function disconnectMcp(p = {}) {
  if (p.instanceId || p.instance) snMcp.logout(_cfgFrom(p));
  else snMcp.logout();
  return { ok: true };
}

module.exports = { getMcpStatus, connectMcp, warmupMcp, disconnectMcp };

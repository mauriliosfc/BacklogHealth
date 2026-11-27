const { saveSnConfig, saveConfig, getProjectSnGroup, getCfg, getSnInstance, getSnInstances, getProjectSnContext, getDisplayName, snPublic, snLabel } = require('../config');
const { snGet } = require('../servicenowClient');
const { httpError } = require('./utils');
const { getSnMode, isSnConfigured } = require('../utils/snMode');

const _host = v => String(v || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');

// Monta o snCfg usado pelo snGet a partir de parâmetros crus (onboarding/teste antes de salvar).
function _buildSnCfg({ instance, user, pass, mode, mcpUsername, mcpLoginUrl, instanceId } = {}) {
  const savedSn = getSnInstance(instanceId) || {};
  if (getSnMode({ mode }) === 'mcp') {
    if (!instance) httpError(400, 'instance is required.');
    const saved = savedSn.mcp || {};
    return {
      mode: 'mcp',
      instance: _host(instance),
      mcp: {
        username: mcpUsername !== undefined ? String(mcpUsername || '').trim() : (saved.username || ''),
        loginUrl: mcpLoginUrl !== undefined ? String(mcpLoginUrl || '').trim() : (saved.loginUrl || ''),
      },
    };
  }
  // Instância já salva: senha em branco usa a senha salva (a tela não recebe a senha)
  const samePass = !pass && instanceId && savedSn.pass && _host(savedSn.instance).toLowerCase() === _host(instance).toLowerCase();
  const effPass = pass || (samePass ? savedSn.pass : '');
  if (!instance || !user || !effPass) httpError(400, 'instance, user and pass are required.');
  return { mode: 'api', instance: instance.trim(), user: user.trim(), pass: effPass };
}

function getSnCfg({ project = '', instanceId = '' } = {}) {
  const all  = getSnInstances();
  const sn   = project ? getProjectSnContext(project).snCfg : getSnInstance(instanceId);
  const resp = {
    instanceId:  sn?.id || '',
    label:       sn?.label || '',
    isPrimary:   !!(sn && all[0] && sn.id === all[0].id),
    instance:    sn?.instance || '',
    user:        sn?.user || '',
    hasPass:     !!(sn?.pass),
    mode:        getSnMode(sn),
    mcpUsername: sn?.mcp?.username || '',
    mcpLoginUrl: sn?.mcp?.loginUrl || '',
  };
  if (project) {
    const grp = getProjectSnGroup(project);
    resp.assignmentGroup     = grp?.assignmentGroup     || '';
    resp.assignmentGroupName = grp?.assignmentGroupName || '';
    resp.slaEnabled          = grp?.slaEnabled          === true;
    resp.slaThresholds       = grp?.slaThresholds       || null;
  } else {
    resp.assignmentGroups = Array.isArray(sn?.assignmentGroups) ? sn.assignmentGroups : [];
  }
  return resp;
}

function saveSnCfg(p = {}) {
  const snGlobal = {
    ...(p.instanceId                      ? { instanceId: p.instanceId }    : {}),
    ...(p.label             !== undefined ? { label: String(p.label || '') } : {}),
    ...(p.instance          !== undefined ? { instance: String(p.instance).trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '') } : {}),
    ...(p.user              !== undefined ? { user: String(p.user).trim() } : {}),
    ...(p.pass                            ? { pass: p.pass }                : {}),
    ...(p.assignmentGroups  !== undefined ? { assignmentGroups: Array.isArray(p.assignmentGroups) ? p.assignmentGroups : [] } : {}),
    ...(p.mode              !== undefined ? { mode: getSnMode({ mode: p.mode }) } : {}),
    ...(['mcpUsername', 'mcpLoginUrl'].some(k => p[k] !== undefined) ? { mcp: {
      ...(p.mcpUsername !== undefined ? { username: String(p.mcpUsername || '').trim() } : {}),
      ...(p.mcpLoginUrl !== undefined ? { loginUrl: String(p.mcpLoginUrl || '').trim() } : {}),
    } } : {}),
  };
  const projectGroup = p.project ? {
    projectName:         p.project,
    assignmentGroup:     p.assignmentGroup     !== undefined ? (p.assignmentGroup     || '') : undefined,
    assignmentGroupName: p.assignmentGroupName !== undefined ? (p.assignmentGroupName || '') : undefined,
    slaEnabled:          p.slaEnabled          !== undefined ? p.slaEnabled            : undefined,
    slaThresholds:       p.slaThresholds       || null,
    ...(p.instanceId !== undefined ? { instanceId: p.instanceId === 'new' ? undefined : (p.instanceId || '') } : {}),
  } : null;
  // Só a instância do projeto mudou (sem credenciais): não mexe nas instâncias
  const credKeys = ['label', 'instance', 'user', 'pass', 'assignmentGroups', 'mode', 'mcp'];
  const global = credKeys.some(k => snGlobal[k] !== undefined) ? snGlobal : {};
  // Instância que não existe mais (removida em outra janela): não grava por cima da principal
  if (global.instanceId && global.instanceId !== 'new' && !getSnInstances().some(s => s.id === global.instanceId)) {
    httpError(404, 'Service Now instance not found.');
  }
  const savedId = saveSnConfig(global, projectGroup);
  return { ok: true, ...(savedId ? { instanceId: savedId } : {}) };
}

async function testSn(p = {}) {
  const snCfg = _buildSnCfg(p);
  try {
    await snGet(snCfg, 'table/incident?sysparm_limit=1&sysparm_fields=sys_id');
    return { ok: true };
  } catch (e) {
    // HTTP 200 with error in body — front-end reads error message
    return { error: e.message };
  }
}

// Returns all active assignment groups from the sys_user_group table.
// Accepts raw credentials so it can be called before config is saved (onboarding).
// Instâncias grandes têm dezenas de milhares de grupos (40+ páginas): as páginas são
// buscadas em lotes paralelos, parando no primeiro lote com página incompleta.
const GROUPS_PAGE_SIZE   = 2000;
const GROUPS_CONCURRENCY = 6;

async function _fetchAllGroupRows(snCfg) {
  const fetchPage = async offset => {
    const qs = [
      'sysparm_fields=name,sys_id',
      `sysparm_limit=${GROUPS_PAGE_SIZE}`,
      `sysparm_offset=${offset}`,
    ].join('&');
    const data = await snGet(snCfg, `table/sys_user_group?${qs}`);
    return data.result || [];
  };
  const all = [];
  const first = await fetchPage(0);
  all.push(...first);
  if (first.length < GROUPS_PAGE_SIZE) return all;
  let next = 1;
  while (true) {
    const offsets = Array.from({ length: GROUPS_CONCURRENCY }, (_, i) => (next + i) * GROUPS_PAGE_SIZE);
    next += GROUPS_CONCURRENCY;
    const pages = await Promise.all(offsets.map(fetchPage));
    let done = false;
    for (const page of pages) {
      all.push(...page);
      if (page.length < GROUPS_PAGE_SIZE) { done = true; break; }
    }
    if (done) return all;
  }
}

async function fetchGroups(p = {}) {
  const snCfg = _buildSnCfg(p);
  try {
    const all = await _fetchAllGroupRows(snCfg);
    const groups = [...new Map(
      all
        .filter(r => r.name)
        .map(r => [r.name, { name: r.name, sys_id: r.sys_id || '' }])
    ).values()].sort((a, b) => a.name.localeCompare(b.name));
    return { groups };
  } catch (e) {
    return { error: e.message, groups: [] };
  }
}

// A lista de grupos muda pouco e é cara de baixar — cache em memória por instância/modo/usuário.
const GROUPS_CACHE_TTL_MS = 60 * 60 * 1000;
const _groupsCache    = new Map();   // chave → { at, value }
const _groupsInFlight = new Map();   // chave → promise

function _clearGroupsCache() { _groupsCache.clear(); _groupsInFlight.clear(); }

// Grupos da instância indicada (ou da principal), com as credenciais salvas.
async function fetchGroupsFromConfig({ instanceId = '' } = {}) {
  const sn = getSnInstance(instanceId);
  if (!isSnConfigured(sn)) httpError(400, 'ServiceNow not configured.');
  const mode = getSnMode(sn);
  const key  = [mode, sn.instance, mode === 'api' ? sn.user : (sn.mcp && sn.mcp.username) || ''].join('|');
  const hit = _groupsCache.get(key);
  if (hit && Date.now() - hit.at < GROUPS_CACHE_TTL_MS) return hit.value;
  // SSO sem sessão: não busca (a busca abriria a janela de login só por abrir a tela)
  if (mode === 'mcp' && !require('../snMcp').isConnected(sn)) {
    return { groups: [], error: 'Service Now session not connected.', needsLogin: true };
  }
  if (_groupsInFlight.has(key)) return _groupsInFlight.get(key);
  const promise = fetchGroups({ instance: sn.instance, user: sn.user, pass: sn.pass, mode, instanceId: sn.id })
    .then(value => {
      if (!value.error && value.groups.length) _groupsCache.set(key, { at: Date.now(), value });
      return value;
    })
    .finally(() => { if (_groupsInFlight.get(key) === promise) _groupsInFlight.delete(key); });
  _groupsInFlight.set(key, promise);
  return promise;
}

function getAllProjectsSnCfg() {
  const projects = getCfg().projects || [];
  return {
    projects: projects.map(p => ({
      name:                p.name,
      displayName:         getDisplayName(p),
      instanceId:          p.servicenow?.instanceId          || '',
      assignmentGroup:     p.servicenow?.assignmentGroup     || '',
      assignmentGroupName: p.servicenow?.assignmentGroupName || '',
    })),
  };
}

// Card de grupo removido no dashboard do SN: sai da lista da instância que o tem (qualquer uma)
function removeSnGroup({ group } = {}) {
  if (!group) return { ok: false };
  const cfg = getCfg();
  if (cfg.servicenow?.assignmentGroups) {
    cfg.servicenow.assignmentGroups = cfg.servicenow.assignmentGroups.filter(g => g !== group);
  }
  (Array.isArray(cfg.snInstances) ? cfg.snInstances : []).forEach(s => {
    if (Array.isArray(s.assignmentGroups)) s.assignmentGroups = s.assignmentGroups.filter(g => g !== group);
  });
  if (cfg.snGroupConfigs) delete cfg.snGroupConfigs[group];
  saveConfig(cfg);
  return { ok: true };
}

// Returns available columns for the problem table via sys_dictionary.
// Uses saved credentials — no need to pass them again.
async function fetchPrbFields({ project = '', instanceId = '' } = {}) {
  const sn = project ? getProjectSnContext(project).snCfg : getSnInstance(instanceId);
  if (!isSnConfigured(sn)) httpError(400, 'ServiceNow not configured.');
  try {
    const qs = [
      'sysparm_query=name=problem^active=true^internal_type!=collection^internal_type!=glide_list',
      'sysparm_fields=element,column_label',
      'sysparm_limit=500',
    ].join('&');
    const data = await snGet(sn, `table/sys_dictionary?${qs}`);
    const fields = (data.result || [])
      .filter(r => r.element && r.column_label)
      .map(r => ({ key: r.element, label: r.column_label }))
      .sort((a, b) => a.label.localeCompare(b.label));
    return { fields };
  } catch (e) {
    return { error: e.message, fields: [] };
  }
}

// Instâncias para a tela de Configurações — nunca devolve senha
function listSnInstances() {
  const all = getSnInstances();
  const projects = getCfg().projects || [];
  const snMcp = require('../snMcp');
  return {
    instances: all.map((sn, i) => {
      // Projeto sem instanceId usa a principal
      const projectCount = projects.filter(p => (p.servicenow?.instanceId || all[0]?.id) === sn.id).length;
      const status = getSnMode(sn) === 'mcp' ? (snMcp.isConnected(sn) ? 'ok' : 'unknown') : 'unknown';
      const assignmentGroups = Array.isArray(sn.assignmentGroups) ? sn.assignmentGroups : [];
      return snPublic(sn, { isPrimary: i === 0, status, projectCount, assignmentGroups });
    }),
  };
}

// Remove uma instância. Projetos que a usavam voltam para a principal, sem grupo.
// Removida a principal, a próxima assume (inclusive no dashboard do Service Now).
function removeSnInstance({ instanceId } = {}) {
  if (!instanceId) httpError(400, 'instanceId required');
  const cfg = getCfg();
  const all = getSnInstances();
  const idx = all.findIndex(s => s.id === instanceId);
  if (idx < 0) httpError(404, 'Service Now instance not found.');
  const removed = all[idx];
  let affected = 0;
  (cfg.projects || []).forEach(p => {
    const usesIt = (p.servicenow?.instanceId || all[0].id) === instanceId;
    if (!usesIt || !p.servicenow) return;
    if (p.servicenow.instanceId === instanceId || idx === 0) {
      delete p.servicenow.instanceId;
      delete p.servicenow.assignmentGroup;
      delete p.servicenow.assignmentGroupName;
      affected++;
    }
  });
  cfg.snInstances = all.filter(s => s.id !== instanceId);
  if (idx === 0) delete cfg.servicenow;          // recriado a partir da nova principal
  if (!cfg.snInstances.length) delete cfg.servicenow;
  saveConfig(cfg);
  if (getSnMode(removed) === 'mcp') { try { require('../snMcp').logout(removed); } catch (_) {} }
  return { ok: true, affectedProjects: affected };
}

module.exports = { getSnCfg, saveSnCfg, testSn, fetchGroups, fetchGroupsFromConfig, getAllProjectsSnCfg, removeSnGroup, fetchPrbFields, listSnInstances, removeSnInstance, _clearGroupsCache };

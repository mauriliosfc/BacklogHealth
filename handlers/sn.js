const { getSnConfig, saveSnConfig, saveConfig, getProjectSnGroup, getCfg } = require('../config');
const { snGet } = require('../servicenowClient');
const { httpError } = require('./utils');
const { getSnMode, isSnConfigured } = require('../utils/snMode');

const _browser = v => (v === 'chromium' ? 'chromium' : 'edge');
const _host = v => String(v || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');

// Monta o snCfg usado pelo snGet a partir de parâmetros crus (onboarding/teste antes de salvar).
function _buildSnCfg({ instance, user, pass, mode, mcpUsername, mcpCaBundle, mcpLoginUrl, mcpBrowser } = {}) {
  if (getSnMode({ mode }) === 'mcp') {
    if (!instance) httpError(400, 'instance is required.');
    const saved = getSnConfig()?.mcp || {};
    return {
      mode: 'mcp',
      instance: _host(instance),
      mcp: {
        username: mcpUsername !== undefined ? String(mcpUsername || '').trim() : (saved.username || ''),
        caBundle: mcpCaBundle !== undefined ? String(mcpCaBundle || '').trim() : (saved.caBundle || ''),
        loginUrl: mcpLoginUrl !== undefined ? String(mcpLoginUrl || '').trim() : (saved.loginUrl || ''),
        browser:  _browser(mcpBrowser !== undefined ? mcpBrowser : saved.browser),
      },
    };
  }
  if (!instance || !user || !pass) httpError(400, 'instance, user and pass are required.');
  return { mode: 'api', instance: instance.trim(), user: user.trim(), pass };
}

function getSnCfg({ project = '' } = {}) {
  const sn   = getSnConfig();
  const resp = {
    instance:    sn?.instance || '',
    user:        sn?.user || '',
    hasPass:     !!(sn?.pass),
    mode:        getSnMode(sn),
    mcpUsername: sn?.mcp?.username || '',
    mcpCaBundle: sn?.mcp?.caBundle || '',
    mcpLoginUrl: sn?.mcp?.loginUrl || '',
    mcpBrowser:  _browser(sn?.mcp?.browser),
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
    ...(p.instance          !== undefined ? { instance: String(p.instance).trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '') } : {}),
    ...(p.user              !== undefined ? { user: String(p.user).trim() } : {}),
    ...(p.pass                            ? { pass: p.pass }                : {}),
    ...(p.assignmentGroups  !== undefined ? { assignmentGroups: Array.isArray(p.assignmentGroups) ? p.assignmentGroups : [] } : {}),
    ...(p.mode              !== undefined ? { mode: getSnMode({ mode: p.mode }) } : {}),
    ...(['mcpUsername', 'mcpCaBundle', 'mcpLoginUrl', 'mcpBrowser'].some(k => p[k] !== undefined) ? { mcp: {
      ...(p.mcpUsername !== undefined ? { username: String(p.mcpUsername || '').trim() } : {}),
      ...(p.mcpCaBundle !== undefined ? { caBundle: String(p.mcpCaBundle || '').trim() } : {}),
      ...(p.mcpLoginUrl !== undefined ? { loginUrl: String(p.mcpLoginUrl || '').trim() } : {}),
      ...(p.mcpBrowser  !== undefined ? { browser:  _browser(p.mcpBrowser) }            : {}),
    } } : {}),
  };
  const projectGroup = p.project ? {
    projectName:         p.project,
    assignmentGroup:     p.assignmentGroup     !== undefined ? (p.assignmentGroup     || '') : undefined,
    assignmentGroupName: p.assignmentGroupName !== undefined ? (p.assignmentGroupName || '') : undefined,
    slaEnabled:          p.slaEnabled          !== undefined ? p.slaEnabled            : undefined,
    slaThresholds:       p.slaThresholds       || null,
  } : null;
  saveSnConfig(snGlobal, projectGroup);
  return { ok: true };
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
let _groupsCache = null;   // { key, at, value }
let _groupsInFlight = null; // { key, promise }

function _clearGroupsCache() { _groupsCache = null; _groupsInFlight = null; }

// Fetches groups using credentials already saved in config (no need to pass them again).
async function fetchGroupsFromConfig() {
  const sn = getSnConfig();
  if (!isSnConfigured(sn)) httpError(400, 'ServiceNow not configured.');
  const mode = getSnMode(sn);
  const key  = [mode, sn.instance, mode === 'api' ? sn.user : ''].join('|');
  if (_groupsCache && _groupsCache.key === key && Date.now() - _groupsCache.at < GROUPS_CACHE_TTL_MS) {
    return _groupsCache.value;
  }
  if (_groupsInFlight && _groupsInFlight.key === key) return _groupsInFlight.promise;
  const promise = fetchGroups({ instance: sn.instance, user: sn.user, pass: sn.pass, mode })
    .then(value => {
      if (!value.error && value.groups.length) _groupsCache = { key, at: Date.now(), value };
      return value;
    })
    .finally(() => { if (_groupsInFlight && _groupsInFlight.promise === promise) _groupsInFlight = null; });
  _groupsInFlight = { key, promise };
  return promise;
}

function getAllProjectsSnCfg() {
  const projects = getCfg().projects || [];
  return {
    projects: projects.map(p => ({
      name:                p.name,
      assignmentGroup:     p.servicenow?.assignmentGroup     || '',
      assignmentGroupName: p.servicenow?.assignmentGroupName || '',
    })),
  };
}

function removeSnGroup({ group } = {}) {
  if (!group) return { ok: false };
  const cfg = getCfg();
  if (cfg.servicenow?.assignmentGroups) {
    cfg.servicenow.assignmentGroups = cfg.servicenow.assignmentGroups.filter(g => g !== group);
  }
  if (cfg.snGroupConfigs) delete cfg.snGroupConfigs[group];
  saveConfig(cfg);
  return { ok: true };
}

// Returns available columns for the problem table via sys_dictionary.
// Uses saved credentials — no need to pass them again.
async function fetchPrbFields() {
  const sn = getSnConfig();
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

module.exports = { getSnCfg, saveSnCfg, testSn, fetchGroups, fetchGroupsFromConfig, getAllProjectsSnCfg, removeSnGroup, fetchPrbFields, _clearGroupsCache };

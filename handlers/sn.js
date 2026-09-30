const { getSnConfig, saveSnConfig, saveConfig, getProjectSnGroup, getCfg } = require('../config');
const { snGet } = require('../servicenowClient');
const { httpError } = require('./utils');

function getSnCfg({ project = '' } = {}) {
  const sn   = getSnConfig();
  const resp = { instance: sn?.instance || '', user: sn?.user || '', hasPass: !!(sn?.pass) };
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

async function testSn({ instance, user, pass } = {}) {
  if (!instance || !user || !pass)
    httpError(400, 'instance, user and pass are required.');
  try {
    await snGet(
      { instance: instance.trim(), user: user.trim(), pass },
      'table/incident?sysparm_limit=1&sysparm_fields=sys_id'
    );
    return { ok: true };
  } catch (e) {
    // HTTP 200 with error in body — front-end reads error message
    return { error: e.message };
  }
}

// Returns all active assignment groups from the sys_user_group table.
// Accepts raw credentials so it can be called before config is saved (onboarding).
async function fetchGroups({ instance, user, pass } = {}) {
  if (!instance || !user || !pass)
    httpError(400, 'instance, user and pass are required.');
  try {
    const snCfg = { instance: instance.trim(), user: user.trim(), pass };
    const PAGE_SIZE = 2000;
    const all = [];
    let offset = 0;
    while (true) {
      const qs = [
        'sysparm_fields=name,sys_id',
        `sysparm_limit=${PAGE_SIZE}`,
        `sysparm_offset=${offset}`,
      ].join('&');
      const data = await snGet(snCfg, `table/sys_user_group?${qs}`);
      const page = data.result || [];
      all.push(...page);
      if (page.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
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

// Fetches groups using credentials already saved in config (no need to pass them again).
async function fetchGroupsFromConfig() {
  const sn = getSnConfig();
  if (!sn?.instance || !sn?.user || !sn?.pass) httpError(400, 'ServiceNow not configured.');
  return fetchGroups({ instance: sn.instance, user: sn.user, pass: sn.pass });
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
  if (!sn?.instance || !sn?.user || !sn?.pass) httpError(400, 'ServiceNow not configured.');
  try {
    const qs = [
      'sysparm_query=name=problem^active=true^internal_type!=collection^internal_type!=glide_list',
      'sysparm_fields=element,column_label',
      'sysparm_limit=500',
    ].join('&');
    const data = await snGet({ instance: sn.instance, user: sn.user, pass: sn.pass }, `table/sys_dictionary?${qs}`);
    const fields = (data.result || [])
      .filter(r => r.element && r.column_label)
      .map(r => ({ key: r.element, label: r.column_label }))
      .sort((a, b) => a.label.localeCompare(b.label));
    return { fields };
  } catch (e) {
    return { error: e.message, fields: [] };
  }
}

module.exports = { getSnCfg, saveSnCfg, testSn, fetchGroups, fetchGroupsFromConfig, getAllProjectsSnCfg, removeSnGroup, fetchPrbFields };

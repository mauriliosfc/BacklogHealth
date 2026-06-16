const { getSnConfig, saveSnConfig, getProjectSnGroup, getCfg } = require('../config');
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

// Returns the distinct assignment group names found in active incidents.
// Accepts raw credentials so it can be called before config is saved (onboarding).
async function fetchGroups({ instance, user, pass } = {}) {
  if (!instance || !user || !pass)
    httpError(400, 'instance, user and pass are required.');
  try {
    const snCfg = { instance: instance.trim(), user: user.trim(), pass };
    const qs = [
      'sysparm_query=active=true',
      'sysparm_display_value=true',
      'sysparm_fields=assignment_group',
      'sysparm_limit=1000',
    ].join('&');
    const data = await snGet(snCfg, `table/incident?${qs}`);
    const seen = new Map();
    (data.result || []).forEach(r => {
      const v = r.assignment_group;
      if (!v) return;
      const sys_id = typeof v === 'object' ? (v.value || '') : '';
      const name   = typeof v === 'object' ? (v.display_value || v.value || '') : (v || '');
      if (!name) return;
      const key = sys_id || name;
      if (!seen.has(key)) seen.set(key, { name, sys_id });
    });
    const groups = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
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

module.exports = { getSnCfg, saveSnCfg, testSn, fetchGroups, fetchGroupsFromConfig, getAllProjectsSnCfg };

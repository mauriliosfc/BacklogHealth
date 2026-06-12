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
    const names = [...new Set(
      (data.result || [])
        .map(r => {
          const v = r.assignment_group;
          if (!v) return '';
          return (typeof v === 'object' ? (v.display_value || v.value) : v) || '';
        })
        .filter(Boolean)
    )].sort();
    return { groups: names };
  } catch (e) {
    return { error: e.message, groups: [] };
  }
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

module.exports = { getSnCfg, saveSnCfg, testSn, fetchGroups, getAllProjectsSnCfg };

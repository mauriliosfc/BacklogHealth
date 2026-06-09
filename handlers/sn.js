const { getSnConfig, saveSnConfig, getProjectSnGroup } = require('../config');
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
    ...(p.instance !== undefined ? { instance: String(p.instance).trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '') } : {}),
    ...(p.user     !== undefined ? { user: String(p.user).trim() } : {}),
    ...(p.pass                   ? { pass: p.pass }                : {}),
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

module.exports = { getSnCfg, saveSnCfg, testSn };

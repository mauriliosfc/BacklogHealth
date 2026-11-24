const { getCfg, saveConfig, getDisplayName } = require('../config');
const { httpError } = require('./utils');
const { resolveIndicatorConfig } = require('../utils/healthIndicators');
const { getWorkItemProfile } = require('../utils/workItemProfile');

function getIndicatorConfig({ project } = {}) {
  if (!project) httpError(400, 'project required');
  const proj = (getCfg().projects || []).find(p => getDisplayName(p) === project);
  if (!proj) httpError(404, 'Projeto não encontrado');
  const completionStates = getWorkItemProfile(proj).states?.done;
  return resolveIndicatorConfig(proj.healthIndicators || {}, { completionStates });
}

function saveIndicatorConfig({ project, completion, uat, bugRate, estimateCoverage, effortSaved } = {}) {
  if (!project) httpError(400, 'project required');
  const cfg = getCfg();
  const proj = (cfg.projects || []).find(p => getDisplayName(p) === project);
  if (!proj) httpError(404, 'Projeto não encontrado');
  const existing = proj.healthIndicators || {};
  proj.healthIndicators = {
    ...existing,
    ...(completion       !== undefined ? { completion:       { ...existing.completion,       ...completion } }       : {}),
    ...(uat              !== undefined ? { uat:              { ...existing.uat,              ...uat } }              : {}),
    ...(bugRate          !== undefined ? { bugRate:          { ...existing.bugRate,          ...bugRate } }          : {}),
    ...(estimateCoverage !== undefined ? { estimateCoverage: { ...existing.estimateCoverage, ...estimateCoverage } } : {}),
    ...(effortSaved      !== undefined ? { effortSaved:      { ...existing.effortSaved,      ...effortSaved } }      : {}),
  };
  saveConfig(cfg);
  return { ok: true };
}

module.exports = { getIndicatorConfig, saveIndicatorConfig };

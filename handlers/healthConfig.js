const { getCfg, saveConfig } = require('../config');
const { httpError }          = require('./utils');
const { DEFAULT_THRESHOLDS } = require('../utils/health');

async function getHealthConfig() {
  const saved = getCfg().health || {};
  return {
    semEst:  { ...DEFAULT_THRESHOLDS.semEst,  ...(saved.semEst  || {}) },
    semResp: { ...DEFAULT_THRESHOLDS.semResp, ...(saved.semResp || {}) },
    bugs:    { ...DEFAULT_THRESHOLDS.bugs,    ...(saved.bugs    || {}) },
  };
}

async function saveHealthConfig(body) {
  const { semEst, semResp, bugs } = body || {};
  const estWarn  = Number(semEst?.warn);
  const estCrit  = Number(semEst?.crit);
  const respWarn = Number(semResp?.warn);
  const bugsWarn = Number(bugs?.warn);
  const bugsCrit = Number(bugs?.crit);

  const allValues = [estWarn, estCrit, respWarn, bugsWarn, bugsCrit];
  if (!allValues.every(n => Number.isFinite(n) && n >= 0))
    httpError(400, 'Valores inválidos');
  if (estWarn >= estCrit)  httpError(400, 'semEst.crit deve ser maior que semEst.warn');
  if (bugsWarn >= bugsCrit) httpError(400, 'bugs.crit deve ser maior que bugs.warn');

  saveConfig({
    ...getCfg(),
    health: {
      semEst:  { warn: estWarn,  crit: estCrit  },
      semResp: { warn: respWarn },
      bugs:    { warn: bugsWarn, crit: bugsCrit },
    },
  });
  return { ok: true };
}

module.exports = { getHealthConfig, saveHealthConfig };

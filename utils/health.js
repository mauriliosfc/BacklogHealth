const DEFAULT_THRESHOLDS = {
  semEst:  { warn: 30, crit: 50 },
  semResp: { warn: 20 },
  bugs:    { warn: 5,  crit: 10 },
};

function calcHealth(openTotal, semEst, semResp, bugs, thresholds) {
  const th = {
    semEst:  { ...DEFAULT_THRESHOLDS.semEst,  ...(thresholds?.semEst  || {}) },
    semResp: { ...DEFAULT_THRESHOLDS.semResp, ...(thresholds?.semResp || {}) },
    bugs:    { ...DEFAULT_THRESHOLDS.bugs,    ...(thresholds?.bugs    || {}) },
  };
  const reasons = [];
  if (bugs > th.bugs.crit)
    reasons.push(`${bugs} bugs abertos (crítico: >${th.bugs.crit})`);
  else if (bugs > th.bugs.warn)
    reasons.push(`${bugs} bugs abertos (alerta: >${th.bugs.warn})`);
  if (openTotal > 0 && semEst > openTotal * th.semEst.crit / 100)
    reasons.push(`${Math.round(semEst / openTotal * 100)}% das US sem estimativa (crítico: >${th.semEst.crit}%)`);
  else if (openTotal > 0 && semEst > openTotal * th.semEst.warn / 100)
    reasons.push(`${Math.round(semEst / openTotal * 100)}% das US sem estimativa (alerta: >${th.semEst.warn}%)`);
  if (openTotal > 0 && semResp > openTotal * th.semResp.warn / 100)
    reasons.push(`${Math.round(semResp / openTotal * 100)}% das US sem responsável (alerta: >${th.semResp.warn}%)`);
  const tooltip = reasons.length ? reasons.join(' · ') : 'Backlog bem estruturado';
  if (bugs > th.bugs.crit || (openTotal > 0 && semEst > openTotal * th.semEst.crit / 100))
    return ['🔴 Crítico', 'red', tooltip];
  if ((openTotal > 0 && (semEst > openTotal * th.semEst.warn / 100 || semResp > openTotal * th.semResp.warn / 100)) || bugs > th.bugs.warn)
    return ['🟡 Atenção', 'yellow', tooltip];
  return ['🟢 Saudável', 'green', tooltip];
}

module.exports = { calcHealth, DEFAULT_THRESHOLDS };

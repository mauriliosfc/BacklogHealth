import { t } from './i18n.js';

export const DEFAULT_THRESHOLDS = {
  semEst:  { warn: 30, crit: 50 },
  semResp: { warn: 20 },
  bugs:    { warn: 5,  crit: 10 },
};

let _thresholds = { ...DEFAULT_THRESHOLDS };

export function setThresholds(cfg) {
  if (!cfg) return;
  _thresholds = {
    semEst:  { ...DEFAULT_THRESHOLDS.semEst,  ...(cfg.semEst  || {}) },
    semResp: { ...DEFAULT_THRESHOLDS.semResp, ...(cfg.semResp || {}) },
    bugs:    { ...DEFAULT_THRESHOLDS.bugs,    ...(cfg.bugs    || {}) },
  };
}

export function calcHealth(openTotal, semEst, semResp, bugs) {
  const th = _thresholds;
  const reasons = [];
  if (bugs > th.bugs.crit)
    reasons.push(t('health_bugs_crit', { count: bugs, crit: th.bugs.crit }));
  else if (bugs > th.bugs.warn)
    reasons.push(t('health_bugs_warn', { count: bugs, warn: th.bugs.warn }));
  if (openTotal > 0 && semEst > openTotal * th.semEst.crit / 100)
    reasons.push(t('health_noest_crit', { pct: Math.round(semEst / openTotal * 100), crit: th.semEst.crit }));
  else if (openTotal > 0 && semEst > openTotal * th.semEst.warn / 100)
    reasons.push(t('health_noest_warn', { pct: Math.round(semEst / openTotal * 100), warn: th.semEst.warn }));
  if (openTotal > 0 && semResp > openTotal * th.semResp.warn / 100)
    reasons.push(t('health_noresp_warn', { pct: Math.round(semResp / openTotal * 100), warn: th.semResp.warn }));
  const tooltip = reasons.length ? reasons.join(' · ') : t('health_tooltip_ok');
  if (bugs > th.bugs.crit || (openTotal > 0 && semEst > openTotal * th.semEst.crit / 100))
    return [t('health_crit'), 'red', tooltip];
  if ((openTotal > 0 && (semEst > openTotal * th.semEst.warn / 100 || semResp > openTotal * th.semResp.warn / 100)) || bugs > th.bugs.warn)
    return [t('health_warn'), 'yellow', tooltip];
  return [t('health_ok'), 'green', tooltip];
}

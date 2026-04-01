import { t } from './i18n.js';

export function calcHealth(total, semEst, semResp, bugs) {
  const reasons = [];
  if (bugs > 10) reasons.push(t('health_bugs_crit', { count: bugs }));
  else if (bugs > 5) reasons.push(t('health_bugs_warn', { count: bugs }));
  if (total > 0 && semEst > total * 0.5) reasons.push(t('health_noest_crit', { pct: Math.round(semEst / total * 100) }));
  else if (total > 0 && semEst > total * 0.3) reasons.push(t('health_noest_warn', { pct: Math.round(semEst / total * 100) }));
  if (total > 0 && semResp > total * 0.2) reasons.push(t('health_noresp_warn', { pct: Math.round(semResp / total * 100) }));
  const tooltip = reasons.length ? reasons.join(' · ') : t('health_tooltip_ok');
  if (bugs > 10 || semEst > total * 0.5) return [t('health_crit'), 'red', tooltip];
  if (semEst > total * 0.3 || semResp > total * 0.2 || bugs > 5) return [t('health_warn'), 'yellow', tooltip];
  return [t('health_ok'), 'green', tooltip];
}

import { US_TYPES, CLOSED_STATES } from './constants.js';
import { getDateLocale, t } from './i18n.js';

export function fmtD(s) {
  if (!s) return '';
  return new Date(s).toLocaleDateString(getDateLocale(), { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function buildSprintData(items, iterMap) {
  const bySprint = {};
  items.forEach(i => {
    const k = i.iteration || 'Sem Sprint';
    if (!bySprint[k]) bySprint[k] = { total: 0, pts: 0, closed: 0, us: 0, usClosed: 0 };
    bySprint[k].total++;
    bySprint[k].pts += i.pts || 0;
    if (CLOSED_STATES.includes(i.state)) bySprint[k].closed++;
    if (US_TYPES.includes(i.type)) {
      bySprint[k].us++;
      if (CLOSED_STATES.includes(i.state)) bySprint[k].usClosed++;
    }
  });

  const sorted = Object.entries(bySprint).sort((a, b) => {
    const aS = iterMap[a[0]] && iterMap[a[0]].start;
    const bS = iterMap[b[0]] && iterMap[b[0]].start;
    if (aS && bS) return new Date(aS) - new Date(bS);
    return a[0].localeCompare(b[0]);
  });

  const sprintMeta = sorted.map(([key, d]) => {
    const iter = iterMap[key] || {};
    const rawLabel = key.includes('\\') ? key.split('\\').pop() : key;
    return {
      key,
      label: key === 'Sem Sprint' ? t('no_sprint') : rawLabel,
      us: d.us, usClosed: d.usClosed, pts: d.pts,
      isCurrent: !!iter.isCurrent,
      start: iter.start || null,
      end: iter.end || null
    };
  });

  return { bySprint, sorted, sprintMeta };
}

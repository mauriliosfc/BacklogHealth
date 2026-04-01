import { fmtD, buildSprintData } from './utils.js';
import { US_TYPES, CLOSED_STATES } from './constants.js';
import { t, getDateLocale } from './i18n.js';

export function _showBurndownModal(allSprints, key) {
  const sprint = allSprints.find(s => s.key === key);
  if (!sprint) return;
  document.getElementById('burndown-title').textContent = sprint.label;
  document.getElementById('burndown-sub').textContent   = sprint.start && sprint.end
    ? fmtD(sprint.start) + ' \u2013 ' + fmtD(sprint.end)
    : '';
  document.getElementById('burndown-body').innerHTML = buildBurndownChart(allSprints, key);
  document.getElementById('burndown-modal').classList.add('open');
  document.body.style.overflow = 'hidden';
}

export function openBurndown(btn) {
  const key = btn.closest('tr').dataset.sprintKey;
  const allSprints = JSON.parse(btn.closest('table').dataset.sprints);
  _showBurndownModal(allSprints, key);
}

export function closeBurndown() {
  const modalEl = document.getElementById('burndown-modal');
  modalEl.classList.remove('open', 'maximized');
  document.getElementById('btnBurndownMax').textContent = '\u2922';
  document.body.style.overflow = '';
}

export function closeBurndownOverlay(e) {
  if (e.target === document.getElementById('burndown-modal')) closeBurndown();
}

export function toggleBurndownMaximize() {
  const overlay = document.getElementById('burndown-modal');
  const btn = document.getElementById('btnBurndownMax');
  const isMax = overlay.classList.toggle('maximized');
  btn.textContent = isMax ? '\u2921' : '\u2922';
  btn.title = isMax ? t('burndown_restore') : t('burndown_maximize');
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.getElementById('burndown-modal').classList.contains('open')) {
    closeBurndown();
  }
});

export async function openBurndownFromDaily(project, currentIter) {
  const modalEl = document.getElementById('burndown-modal');
  const bodyEl  = document.getElementById('burndown-body');

  document.getElementById('burndown-title').textContent = project;
  document.getElementById('burndown-sub').textContent   = t('burndown_loading');
  bodyEl.innerHTML = '<div class="modal-loading">' + t('burndown_fetching') + '</div>';
  modalEl.classList.add('open');
  document.body.style.overflow = 'hidden';

  try {
    const resp = await fetch('/detail?' + new URLSearchParams({ project }));
    const data = await resp.json();
    if (data.error) throw new Error(data.error);

    const iterMap = data.iterMap || {};
    const { sprintMeta: allSprints } = buildSprintData(data.items, iterMap);

    const sprint = allSprints.find(s => s.key === currentIter)
                || allSprints.find(s => s.isCurrent)
                || allSprints[allSprints.length - 1];

    if (!sprint) throw new Error(t('burndown_no_sprint'));
    _showBurndownModal(allSprints, sprint.key);
  } catch(e) {
    bodyEl.innerHTML = '<p style="color:#f87171;padding:20px">Erro: ' + e.message + '</p>';
  }
}

function buildBurndownChart(allSprints, highlightKey) {
  const sprint = allSprints.find(s => s.key === highlightKey);
  if (!sprint || !sprint.start || !sprint.end) {
    return '<p style="color:#64748b;padding:20px;text-align:center">' + t('burndown_no_period') + '</p>';
  }

  const start   = new Date(sprint.start);
  const end     = new Date(sprint.end);
  const today   = new Date();
  const totalUs = sprint.us;
  const donePts = sprint.usClosed;

  if (totalUs === 0) {
    return '<p style="color:#64748b;padding:20px;text-align:center">' + t('burndown_no_us') + '</p>';
  }

  const days = [];
  const d = new Date(start);
  while (d <= end) {
    days.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  const totalDays = days.length - 1 || 1;

  const todayClamp = today < start ? start : today > end ? end : today;
  const elapsed    = (todayClamp - start) / (1000 * 60 * 60 * 24);
  const elapsedDays = Math.min(Math.round(elapsed), totalDays);

  const W = 760, H = 320, PL = 50, PR = 20, PT = 20, PB = 40;
  const cW = W - PL - PR, cH = H - PT - PB;

  function xOf(dayIdx) { return PL + (dayIdx / totalDays) * cW; }
  function yOf(val)    { return PT + cH - (val / totalUs) * cH; }

  const idealPts = days.map((_, i) => xOf(i) + ',' + yOf(totalUs - (totalUs * i / totalDays))).join(' ');

  const realPts = [];
  for (let i = 0; i <= elapsedDays; i++) {
    const remaining = totalUs - Math.round(donePts * i / (elapsedDays || 1));
    realPts.push(xOf(i) + ',' + yOf(remaining));
  }

  const todayX  = xOf(elapsedDays);
  const isActive = today >= start && today <= end;
  const dateLocale = getDateLocale();

  const yLabels = [0, 0.25, 0.5, 0.75, 1].map(f => {
    const v = Math.round(totalUs * f);
    const y = yOf(v);
    return '<text x="' + (PL - 6) + '" y="' + (y + 4) + '" text-anchor="end" font-size="11" fill="#64748b">' + v + '</text>' +
           '<line x1="' + PL + '" y1="' + y + '" x2="' + (W - PR) + '" y2="' + y + '" stroke="#1e293b" stroke-width="1"/>';
  }).join('');

  const step = Math.max(1, Math.ceil(totalDays / 8));
  const xLabels = days.filter((_, i) => i % step === 0 || i === totalDays).map(day => {
    const i = days.indexOf(day);
    const x = xOf(i);
    const label = day.toLocaleDateString(dateLocale, { day: '2-digit', month: 'short' });
    return '<text x="' + x + '" y="' + (H - PB + 18) + '" text-anchor="middle" font-size="11" fill="#64748b">' + label + '</text>';
  }).join('');

  const todayLine = isActive
    ? '<line x1="' + todayX + '" y1="' + PT + '" x2="' + todayX + '" y2="' + (H - PB) + '" stroke="#f87171" stroke-width="1.5" stroke-dasharray="4,3"/>' +
      '<text x="' + (todayX + 4) + '" y="' + (PT + 12) + '" font-size="10" fill="#f87171">' + t('burndown_today') + '</text>'
    : '';

  const svg =
    '<svg viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-height:320px">' +
      yLabels +
      '<polyline points="' + idealPts + '" fill="none" stroke="#475569" stroke-width="1.5" stroke-dasharray="6,4"/>' +
      (realPts.length > 1 ? '<polyline points="' + realPts.join(' ') + '" fill="none" stroke="#22c55e" stroke-width="2.5" stroke-linejoin="round"/>' : '') +
      todayLine +
      xLabels +
      '<line x1="' + PL + '" y1="' + PT + '" x2="' + PL + '" y2="' + (H - PB) + '" stroke="#334155" stroke-width="1"/>' +
      '<line x1="' + PL + '" y1="' + (H - PB) + '" x2="' + (W - PR) + '" y2="' + (H - PB) + '" stroke="#334155" stroke-width="1"/>' +
    '</svg>';

  const remaining = totalUs - donePts;
  const pct = Math.round(donePts / totalUs * 100);

  const summary =
    '<div style="display:flex;gap:24px;flex-wrap:wrap;padding:16px 4px 0">' +
      '<div class="d-card"><div class="d-label">' + t('burndown_total_us') + '</div><div class="d-val blue">' + totalUs + '</div></div>' +
      '<div class="d-card"><div class="d-label">' + t('burndown_completed') + '</div><div class="d-val green">' + donePts + '</div></div>' +
      '<div class="d-card"><div class="d-label">' + t('burndown_remaining') + '</div><div class="d-val ' + (remaining > 0 ? 'yellow' : 'green') + '">' + remaining + '</div></div>' +
      '<div class="d-card"><div class="d-label">' + t('burndown_progress') + '</div><div class="d-val ' + (pct >= 80 ? 'green' : pct >= 50 ? 'yellow' : 'red') + '">' + pct + '%</div></div>' +
    '</div>';

  const legend =
    '<div style="display:flex;gap:16px;padding:8px 4px;font-size:12px;color:#64748b">' +
      '<span><svg width="24" height="8"><line x1="0" y1="4" x2="24" y2="4" stroke="#475569" stroke-width="1.5" stroke-dasharray="6,4"/></svg> ' + t('burndown_ideal') + '</span>' +
      '<span><svg width="24" height="8"><line x1="0" y1="4" x2="24" y2="4" stroke="#22c55e" stroke-width="2.5"/></svg> ' + t('burndown_real') + '</span>' +
    '</div>';

  return '<div style="padding:20px">' + summary + '<div style="margin-top:20px">' + svg + '</div>' + legend + '</div>';
}

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

export function bdTip(event, el) {
  const tip  = document.getElementById('bd-tooltip');
  const wrap = document.querySelector('.bd-chart-wrap');
  if (!tip || !wrap) return;
  const wRect = wrap.getBoundingClientRect();
  const lx    = event.clientX - wRect.left + 12;
  const ly    = event.clientY - wRect.top  - 76;
  tip.innerHTML =
    '<div class="bd-tip-date">' + (el.dataset.bdDate || '') + '</div>' +
    '<div class="bd-tip-row"><span class="bd-tip-lbl">Restando</span><span class="bd-tip-v">' + (el.dataset.bdPts || '0') + '</span></div>' +
    '<div class="bd-tip-row"><span class="bd-tip-lbl">Ideal</span><span class="bd-tip-v bd-tip-ideal">' + (el.dataset.bdIdeal || '0') + '</span></div>';
  tip.style.left    = Math.min(Math.max(8, lx), wRect.width - 160) + 'px';
  tip.style.top     = Math.max(4, ly) + 'px';
  tip.style.display = 'block';
}

export function bdTipHide() {
  const tip = document.getElementById('bd-tooltip');
  if (tip) tip.style.display = 'none';
}

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

  const todayClamp  = today < start ? start : today > end ? end : today;
  const elapsed     = (todayClamp - start) / (1000 * 60 * 60 * 24);
  const elapsedDays = Math.min(Math.round(elapsed), totalDays);

  const W = 760, H = 320, PL = 52, PR = 20, PT = 18, PB = 40;
  const cW = W - PL - PR, cH = H - PT - PB;

  function xOf(dayIdx) { return PL + (dayIdx / totalDays) * cW; }
  function yOf(val)    { return PT + cH - (val / totalUs) * cH; }

  const dateLocale = getDateLocale();
  const idealPts   = days.map((_, i) => xOf(i) + ',' + yOf(totalUs - (totalUs * i / totalDays))).join(' ');

  const realPtsData = [];
  for (let i = 0; i <= elapsedDays; i++) {
    const rem     = totalUs - Math.round(donePts * i / (elapsedDays || 1));
    const idealAt = Math.round(totalUs - totalUs * i / totalDays);
    realPtsData.push({
      x: xOf(i), y: yOf(rem), rem, idealAt,
      dateStr: days[i].toLocaleDateString(dateLocale, { day: '2-digit', month: 'short' }),
    });
  }

  const todayX   = xOf(elapsedDays);
  const isActive = today >= start && today <= end;

  // Grid lines (dashed) + Y labels
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(f => Math.round(totalUs * f));
  const yLabels = yTicks.map(v => {
    const y = yOf(v);
    return '<line x1="' + PL + '" y1="' + y + '" x2="' + (W - PR) + '" y2="' + y +
           '" stroke="rgba(255,255,255,.06)" stroke-width="1" stroke-dasharray="3,4"/>' +
           '<text x="' + (PL - 7) + '" y="' + (y + 4) + '" text-anchor="end" font-size="11" fill="#94a3b8">' + v + '</text>';
  }).join('');

  const step = Math.max(1, Math.ceil(totalDays / 8));
  const xLabels = days.filter((_, i) => i % step === 0 || i === totalDays).map(day => {
    const i = days.indexOf(day);
    const x = xOf(i);
    const label = day.toLocaleDateString(dateLocale, { day: '2-digit', month: 'short' });
    return '<text x="' + x + '" y="' + (H - PB + 18) + '" text-anchor="middle" font-size="10" fill="#94a3b8">' + label + '</text>';
  }).join('');

  const todayLine = isActive
    ? '<line x1="' + todayX + '" y1="' + PT + '" x2="' + todayX + '" y2="' + (H - PB) +
      '" stroke="#ef4444" stroke-width="1.5" stroke-dasharray="4,4" opacity=".8"/>' +
      '<text x="' + (todayX + 4) + '" y="' + (PT + 11) + '" font-size="10" fill="#ef4444" font-weight="700">' + t('burndown_today') + '</text>'
    : '';

  // Gradient fill area under real line
  const areaPoints = realPtsData.length > 1
    ? realPtsData.map(p => p.x + ',' + p.y).join(' ') +
      ' ' + realPtsData[realPtsData.length - 1].x + ',' + (H - PB) +
      ' ' + realPtsData[0].x + ',' + (H - PB)
    : '';

  // Visible dots + invisible hit areas
  const dotsAndHits = realPtsData.map((p, i) => {
    const isToday = i === elapsedDays && isActive;
    let out = '';
    if (isToday) {
      out += '<circle cx="' + p.x + '" cy="' + p.y + '" r="10" fill="#ef4444" opacity=".12" class="bd-pulse-ring"/>';
      out += '<circle cx="' + p.x + '" cy="' + p.y + '" r="8" fill="none" stroke="#ef4444" stroke-width="1.5" opacity=".7"/>';
      out += '<circle cx="' + p.x + '" cy="' + p.y + '" r="5" fill="#22c55e" stroke="#0f172a" stroke-width="2"/>';
    } else {
      out += '<circle cx="' + p.x + '" cy="' + p.y + '" r="4" fill="#22c55e" stroke="#0f172a" stroke-width="1.5"/>';
    }
    out += '<circle cx="' + p.x + '" cy="' + p.y + '" r="14" fill="transparent" class="bd-hit"' +
      ' data-bd-date="' + p.dateStr + '" data-bd-pts="' + p.rem + '" data-bd-ideal="' + p.idealAt + '"' +
      ' onmouseenter="bdTip(event,this)" onmouseleave="bdTipHide()"/>';
    return out;
  }).join('');

  const svgEl =
    '<svg viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg" style="width:100%;display:block">' +
      '<defs>' +
      '<linearGradient id="bd-fill" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="#22c55e" stop-opacity=".22"/>' +
      '<stop offset="100%" stop-color="#22c55e" stop-opacity="0"/>' +
      '</linearGradient>' +
      '<filter id="bd-glow"><feGaussianBlur stdDeviation="2.5" result="blur"/>' +
      '<feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>' +
      '</defs>' +
      yLabels +
      '<line x1="' + PL + '" y1="' + PT + '" x2="' + PL + '" y2="' + (H - PB) + '" stroke="#1e293b" stroke-width="1"/>' +
      '<line x1="' + PL + '" y1="' + (H - PB) + '" x2="' + (W - PR) + '" y2="' + (H - PB) + '" stroke="#1e293b" stroke-width="1"/>' +
      '<polyline points="' + idealPts + '" fill="none" stroke="#475569" stroke-width="1.5" stroke-dasharray="5,5"/>' +
      (areaPoints ? '<polygon points="' + areaPoints + '" fill="url(#bd-fill)"/>' : '') +
      (realPtsData.length > 1
        ? '<polyline points="' + realPtsData.map(p => p.x + ',' + p.y).join(' ') +
          '" fill="none" stroke="#22c55e" stroke-width="2.5" stroke-linejoin="round" filter="url(#bd-glow)"/>'
        : '') +
      todayLine +
      xLabels +
      dotsAndHits +
    '</svg>';

  const chartWrap = '<div class="bd-chart-wrap"><div class="bd-tooltip" id="bd-tooltip"></div>' + svgEl + '</div>';

  // Stats below chart (4-card grid)
  const remaining = totalUs - donePts;
  const idealNow  = Math.round(totalUs - totalUs * elapsedDays / totalDays);
  const delta     = remaining - idealNow;
  const daysLeft  = today > end ? 0 : Math.ceil((end - today) / 86400000);
  const deltaText = delta === 0 ? ''
    : delta > 0 ? ('+' + delta + ' pts acima do ideal')
    : (Math.abs(delta) + ' pts abaixo do ideal');
  const deltaClass = delta > 0 ? 'delta-red' : delta < 0 ? 'delta-green' : '';

  const statsRow =
    '<div class="bd-stats-row">' +
    '<div class="bd-stat"><div class="bd-stat-label">Restante</div><div class="bd-stat-val">' + remaining + ' <span>pts</span></div></div>' +
    '<div class="bd-stat"><div class="bd-stat-label">Entregue</div><div class="bd-stat-val">' + donePts + ' <span>pts</span></div></div>' +
    '<div class="bd-stat"><div class="bd-stat-label">Dias restantes</div><div class="bd-stat-val">' + daysLeft + ' <span>dias</span></div></div>' +
    '<div class="bd-stat"><div class="bd-stat-label">Ideal restante</div><div class="bd-stat-val">' + idealNow + ' <span>pts</span></div>' +
      (deltaText ? '<div class="bd-stat-delta ' + deltaClass + '">' + deltaText + '</div>' : '') +
    '</div>' +
    '</div>';

  const legend =
    '<div class="bd-legend">' +
    '<div class="bd-legend-item"><div class="bd-legend-line bd-legend-ideal"></div><span>' + t('burndown_ideal') + '</span></div>' +
    '<div class="bd-legend-item"><div class="bd-legend-line bd-legend-real"></div><span>' + t('burndown_real') + '</span></div>' +
    (isActive ? '<div class="bd-legend-item"><div class="bd-legend-hoje"></div><span>' + t('burndown_today') + '</span></div>' : '') +
    '</div>';

  return '<div class="bd-body">' + chartWrap + legend + statsRow + '</div>';
}

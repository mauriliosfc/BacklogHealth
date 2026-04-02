import { t, getDateLocale } from './i18n.js';
import { fmtD } from './utils.js';

const LABEL_W = 160; // px — largura da coluna de label
const MIN_PX_PER_MONTH = 90; // px mínimos por mês no eixo

export function openDeliveryPlan() {
  const cards = Array.from(document.querySelectorAll('#content .card[data-project]'));
  if (!cards.length) return;

  const projects = cards.map(card => {
    const name = card.dataset.project;
    const iterMap = (() => { try { return JSON.parse(card.dataset.itermap || '{}'); } catch(_) { return {}; } })();
    const saved = localStorage.getItem('filter_' + name);
    const selectedSprints = saved ? JSON.parse(saved) : [];
    return { name, iterMap, selectedSprints };
  }).filter(p => Object.values(p.iterMap).some(v => v.start && v.end));

  document.getElementById('delivery-body').innerHTML = buildDeliveryPlan(projects);
  document.getElementById('delivery-modal').classList.add('open');
  document.body.style.overflow = 'hidden';
}

export function closeDeliveryPlan() {
  document.getElementById('delivery-modal').classList.remove('open', 'maximized');
  document.getElementById('btnDeliveryMax').textContent = '\u2922';
  document.body.style.overflow = '';
}

export function closeDeliveryPlanOverlay(e) {
  if (e.target === document.getElementById('delivery-modal')) closeDeliveryPlan();
}

export function toggleDeliveryPlanMaximize() {
  const modal = document.getElementById('delivery-modal');
  const btn   = document.getElementById('btnDeliveryMax');
  const isMax = modal.classList.toggle('maximized');
  btn.textContent = isMax ? '\u2921' : '\u2922';
  btn.title = isMax ? t('dp_restore') : t('dp_maximize');
}

export function toggleDeliveryFilter() {
  const panel = document.getElementById('dp-filter-panel');
  if (panel) panel.classList.toggle('open');
}

export function applyDeliveryFilter() {
  document.querySelectorAll('#dp-filter-panel input[type="checkbox"]').forEach(cb => {
    const row = document.querySelector('.dp-row[data-project="' + CSS.escape(cb.value) + '"]');
    if (row) row.hidden = !cb.checked;
  });
}

document.addEventListener('keydown', e => {
  const modal = document.getElementById('delivery-modal');
  if (e.key === 'Escape' && modal && modal.classList.contains('open')) closeDeliveryPlan();
});

document.addEventListener('click', e => {
  if (!e.target.closest('.dp-filter-bar'))
    document.getElementById('dp-filter-panel')?.classList.remove('open');
});

// ── Builder ───────────────────────────────────────────────────────────────────

function buildDeliveryPlan(projects) {
  const now        = new Date();
  const dateLocale = getDateLocale();

  if (!projects.length) {
    return '<p style="color:#64748b;padding:32px;text-align:center">' + t('dp_no_data') + '</p>';
  }

  // Montar sprints por projeto e calcular range global de datas
  let globalMin = null, globalMax = null;

  const rows = projects.map(p => {
    const sprints = Object.entries(p.iterMap)
      .filter(([key, v]) => v.start && v.end && (p.selectedSprints.length === 0 || p.selectedSprints.includes(key)))
      .map(([key, v]) => ({
        label:     key.includes('\\') ? key.split('\\').pop() : key,
        start:     new Date(v.start),
        end:       new Date(v.end),
        isCurrent: !!v.isCurrent,
        isPast:    new Date(v.end) < now,
      }))
      .sort((a, b) => a.start - b.start);

    sprints.forEach(s => {
      if (!globalMin || s.start < globalMin) globalMin = new Date(s.start);
      if (!globalMax || s.end   > globalMax) globalMax = new Date(s.end);
    });
    return { name: p.name, sprints };
  }).filter(r => r.sprints.length);

  if (!rows.length || !globalMin || !globalMax) {
    return '<p style="color:#64748b;padding:32px;text-align:center">' + t('dp_no_data') + '</p>';
  }

  // Pequena margem nas bordas
  const pad    = (globalMax - globalMin) * 0.015 || 86400000;
  globalMin    = new Date(+globalMin - pad);
  globalMax    = new Date(+globalMax + pad);
  const totalMs = globalMax - globalMin;

  function pct(d) { return ((+new Date(d) - +globalMin) / totalMs * 100); }

  // Meses para o eixo
  const months = [];
  const mc = new Date(globalMin.getFullYear(), globalMin.getMonth(), 1);
  while (mc <= globalMax) { months.push(new Date(mc)); mc.setMonth(mc.getMonth() + 1); }
  const minTrackPx = Math.max(500, months.length * MIN_PX_PER_MONTH);

  // Hoje
  const todayPct  = Math.min(100, Math.max(0, pct(now)));
  const showToday = now > globalMin && now < globalMax;

  // ── Filter panel ─────────────────────────────────────────────────────────
  const filterHTML =
    '<div class="dp-filter-bar">' +
      '<button class="dp-filter-btn" type="button" onclick="toggleDeliveryFilter()">▾ ' + t('dp_filter_btn') + '</button>' +
      '<div class="dp-filter-panel" id="dp-filter-panel">' +
        '<div class="dp-filter-actions">' +
          '<button type="button" onclick="document.querySelectorAll(\'#dp-filter-panel input\').forEach(c=>c.checked=true);applyDeliveryFilter()" data-i18n="dp_select_all">' + t('dp_select_all') + '</button>' +
          '<button type="button" onclick="document.querySelectorAll(\'#dp-filter-panel input\').forEach(c=>c.checked=false);applyDeliveryFilter()" data-i18n="dp_clear_filter">' + t('dp_clear_filter') + '</button>' +
        '</div>' +
        rows.map(r =>
          '<label class="dp-filter-item">' +
            '<input type="checkbox" value="' + r.name.replace(/"/g, '&quot;') + '" checked onchange="applyDeliveryFilter()">' +
            '<span>' + r.name + '</span>' +
          '</label>'
        ).join('') +
      '</div>' +
    '</div>';

  // ── Eixo de meses ─────────────────────────────────────────────────────────
  const monthsHTML = months.map(m => {
    const l = pct(m);
    if (l < -1 || l > 101) return '';
    return '<div class="dp-month" style="left:' + l.toFixed(2) + '%">' +
      m.toLocaleDateString(dateLocale, { month: 'short', year: '2-digit' }) +
    '</div>';
  }).join('');

  const todayAxisHTML = showToday
    ? '<div class="dp-today-axis" style="left:' + todayPct.toFixed(2) + '%"><span>' + t('tl_today') + '</span></div>'
    : '';

  // ── Linhas dos projetos ───────────────────────────────────────────────────
  const rowsHTML = rows.map(r => {
    const blocks = r.sprints.map(s => {
      const l = Math.max(0,   pct(s.start));
      const w = Math.max(0.3, Math.min(100 - l, pct(s.end) - pct(s.start)));
      const state = s.isCurrent ? 'current' : s.isPast ? 'past' : 'future';
      const title = s.label + ' · ' + fmtD(s.start.toISOString()) + ' – ' + fmtD(s.end.toISOString());
      const fmtShort = d => d.toLocaleDateString(dateLocale, { day: '2-digit', month: '2-digit' });
      const dateRange = fmtShort(s.start) + ' – ' + fmtShort(s.end);
      return '<div class="dp-block dp-block--' + state + '" style="left:' + l.toFixed(2) + '%;width:' + w.toFixed(2) + '%" title="' + title + '">' +
        '<span class="dp-block-name">' + s.label + '</span>' +
        '<span class="dp-block-dates">' + dateRange + '</span>' +
      '</div>';
    }).join('');

    const todayLine = showToday
      ? '<div class="dp-today-line" style="left:' + todayPct.toFixed(2) + '%"></div>'
      : '';

    return '<div class="dp-row" data-project="' + r.name.replace(/"/g, '&quot;') + '">' +
      '<div class="dp-row-label" title="' + r.name.replace(/"/g, '&quot;') + '">' + r.name + '</div>' +
      '<div class="dp-row-track">' + blocks + todayLine + '</div>' +
    '</div>';
  }).join('');

  // ── Legenda ───────────────────────────────────────────────────────────────
  const legendHTML =
    '<div class="dp-legend">' +
      '<span class="dp-leg-past">◼ ' + t('tl_past') + '</span>' +
      '<span class="dp-leg-future">◼ ' + t('tl_future') + '</span>' +
      '<span class="dp-leg-current">◼ ' + t('tl_current_sprint') + '</span>' +
      (showToday ? '<span class="dp-leg-today">┃ ' + t('tl_today_label') + '</span>' : '') +
    '</div>';

  return filterHTML +
    '<div class="dp-scroll">' +
      '<div class="dp-inner" style="--dp-label-w:' + LABEL_W + 'px;--dp-track-min:' + minTrackPx + 'px">' +
        '<div class="dp-axis">' +
          '<div class="dp-axis-spacer"></div>' +
          '<div class="dp-axis-track">' + monthsHTML + todayAxisHTML + '</div>' +
        '</div>' +
        '<div class="dp-rows">' + rowsHTML + '</div>' +
      '</div>' +
    '</div>' +
    legendHTML;
}

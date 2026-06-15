import { buildSprintData, fmtD } from './utils.js';
import { t, getDateLocale } from './i18n.js';
import { getItemTypes, CLOSED_STATES } from './constants.js';
import { getAlias } from './alias.js';
import { openItemsModal } from './itemsModal.js';

export const _detailState = { project: null, sprints: [] };
let _ctx = { filtered: [], workItemType: 'User Story' };

const SPRINT_COL_DEFS = [
  { id: 'period',    key: 'th_period' },
  { id: 'items',     key: null },
  { id: 'pts',       key: 'th_pts' },
  { id: 'completed', key: 'th_completed' },
  { id: 'uat',       key: 'th_uat_pct' },
  { id: 'actions',   key: 'th_actions' },
];
const LS_COL_KEY = 'sprintColVisibility';
const LS_ORIG_EST = 'origEstOverride::';

function getSavedColVisibility() {
  try { return JSON.parse(localStorage.getItem(LS_COL_KEY) || '{}'); } catch { return {}; }
}

function applyColVisibility(table, selector, state) {
  SPRINT_COL_DEFS.forEach(col => {
    const visible = state[col.id] !== false;
    table.querySelectorAll('[data-col="' + col.id + '"]').forEach(el => { el.style.display = visible ? '' : 'none'; });
    const cb = selector.querySelector('input[data-col-toggle="' + col.id + '"]');
    if (cb) cb.checked = visible;
  });
}

let _colSelectorController = null;

function initSprintColSelector() {
  if (_colSelectorController) _colSelectorController.abort();
  _colSelectorController = new AbortController();
  const signal = _colSelectorController.signal;

  const wrap = document.querySelector('.sprint-col-btn-wrap');
  const btn = wrap && wrap.querySelector('.sprint-col-btn');
  const dropdown = wrap && wrap.querySelector('.sprint-col-dropdown');
  const table = document.querySelector('.d-table');
  if (!btn || !dropdown || !table) return;

  const state = getSavedColVisibility();
  applyColVisibility(table, dropdown, state);

  btn.addEventListener('click', e => {
    e.stopPropagation();
    const isOpen = dropdown.classList.toggle('open');
    btn.classList.toggle('active', isOpen);
  }, { signal });

  document.addEventListener('click', e => {
    if (wrap && !wrap.contains(e.target)) {
      dropdown.classList.remove('open');
      btn.classList.remove('active');
    }
  }, { signal });

  dropdown.addEventListener('change', e => {
    const cb = e.target.closest('input[data-col-toggle]');
    if (!cb) return;
    const cur = getSavedColVisibility();
    cur[cb.dataset.colToggle] = cb.checked;
    localStorage.setItem(LS_COL_KEY, JSON.stringify(cur));
    applyColVisibility(table, dropdown, cur);
  }, { signal });
}

export async function loadDetailData(project, selectedSprints = _detailState.sprints) {
  const btnRefreshDetail = document.getElementById('btnRefreshDetail');
  if (btnRefreshDetail) { btnRefreshDetail.disabled = true; btnRefreshDetail.textContent = '\u23f3'; }
  document.getElementById('modal-sub').textContent = t('detail_loading');
  document.getElementById('modal-body').innerHTML = '<div class="modal-loading">' + t('detail_fetching') + '</div>';
  try {
    const resp = await fetch('/detail?' + new URLSearchParams({ project }));
    const data = await resp.json();
    if (data.error) throw new Error(data.error);

    const filtered = selectedSprints.length > 0
      ? data.items.filter(i => selectedSprints.includes(i.iteration))
      : data.items;

    const filterLabel = selectedSprints.length === 0
      ? t('detail_all', { count: data.items.length })
      : t('detail_filtered', { sprints: selectedSprints.length, filtered: filtered.length, total: data.items.length });

    document.getElementById('modal-sub').textContent = filterLabel;
    const sprintFilter = s => !selectedSprints.length || selectedSprints.includes(s.iteration);
    const taskItems = (data.taskItems || []).filter(sprintFilter);
    const bugItems  = (data.bugItems  || []).filter(sprintFilter);
    const taskCompletedWork = taskItems.reduce((s, t) => s + t.completedWork, 0);
    const rawOrigEst        = taskItems.reduce((s, t) => s + t.originalEstimate, 0);
    const savedOverride     = parseFloat(localStorage.getItem(LS_ORIG_EST + project));
    const isOrigEstOverride = !isNaN(savedOverride) && savedOverride > 0;
    const taskOriginalEstimate = isOrigEstOverride ? savedOverride : rawOrigEst;
    const bugCompletedWork  = bugItems.reduce((s, t) => s + t.completedWork, 0);
    const totalBugs         = bugItems.length;
    _ctx = { filtered, workItemType: data.workItemType || 'User Story' };
    document.getElementById('modal-body').innerHTML = buildDetailHTML(filtered, data.iterMap, selectedSprints, taskCompletedWork, totalBugs, bugCompletedWork, data.workItemType || 'User Story', project, taskOriginalEstimate, isOrigEstOverride);
    initSprintColSelector();
  } catch(e) {
    document.getElementById('modal-body').innerHTML = '<p style="color:#f87171;padding:20px">Erro: ' + e.message + '</p>';
  } finally {
    if (btnRefreshDetail) { btnRefreshDetail.disabled = false; btnRefreshDetail.textContent = '\u21bb'; }
  }
}

export async function openDetails(btn) {
  const card = btn.closest('.card');
  _detailState.project = card.dataset.project;
  _detailState.sprints = Array.from(
    card.querySelectorAll('.custom-select input[type="checkbox"]:checked')
  ).map(c => c.value);

  const modal = document.getElementById('detail-modal');
  document.getElementById('modal-title').textContent = getAlias(_detailState.project);
  modal.classList.add('open', 'maximized');
  document.getElementById('btnMaximize').textContent = '⤡';
  document.body.style.overflow = 'hidden';
  await loadDetailData(_detailState.project, _detailState.sprints);
}

export function closeDetails(e) {
  if (e && e.target !== document.getElementById('detail-modal')) return;
  document.getElementById('detail-modal').classList.remove('open');
  document.body.style.overflow = '';
}

export function closeDetailsBtn() {
  const modal = document.getElementById('detail-modal');
  modal.classList.remove('open', 'maximized');
  document.body.style.overflow = '';
  document.getElementById('btnMaximize').textContent = '\u2922';
}

export function toggleMaximize() {
  const modal = document.getElementById('detail-modal');
  const btn = document.getElementById('btnMaximize');
  const isMax = modal.classList.toggle('maximized');
  btn.textContent = isMax ? '\u2921' : '\u2922';
  btn.title = isMax ? t('detail_restore') : t('detail_maximize');
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (document.getElementById('items-modal').classList.contains('open')) return;
    closeDetailsBtn();
  }
});

function statusColor(s) {
  if (['Active','In Progress','Doing','Committed'].includes(s)) return '#60a5fa';
  if (['Closed','Done'].includes(s)) return '#22c55e';
  if (['Resolved'].includes(s)) return '#a78bfa';
  if (['Removed'].includes(s)) return '#ef4444';
  if (['Blocked','Impediment'].includes(s)) return '#f87171';
  return '#64748b';
}

function barList(entries, total) {
  const max = Math.max(...entries.map(e => e[1]), 1);
  return entries.map(([label, val, color]) => {
    const pct = Math.round(val / max * 100);
    const ofTotal = total ? Math.round(val / total * 100) : 0;
    const short = label.includes('\\') ? label.split('\\').pop() : label;
    return '<div class="bar-row">' +
      '<div class="bar-label" title="' + label + '">' + short + '</div>' +
      '<div class="bar-track"><div class="bar-fill" style="width:' + pct + '%;background:' + (color||'#60a5fa') + '"></div></div>' +
      '<div class="bar-num">' + val + '</div>' +
      '<div class="bar-pct">' + ofTotal + '%</div>' +
      '</div>';
  }).join('');
}

function ring(pct, color) {
  const r = 34, circ = 2 * Math.PI * r;
  const dash = circ * pct / 100;
  return '<div class="ring-wrap"><svg width="80" height="80" viewBox="0 0 80 80">' +
    '<circle cx="40" cy="40" r="' + r + '" fill="none" stroke="#1e293b" stroke-width="8"/>' +
    '<circle cx="40" cy="40" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="8" stroke-dasharray="' + dash + ' ' + circ + '" stroke-linecap="round"/>' +
    '</svg><div class="ring-pct" style="color:' + color + '">' + pct + '%</div></div>';
}

function buildDetailHTML(items, iterMap, selectedSprints, taskCompletedWork, totalBugs, bugCompletedWork, workItemType = 'User Story', projectName = '', taskOriginalEstimate = 0, isOrigEstOverride = false) {
  const total = items.length;
  if (!total) return '<p style="color:#64748b;padding:20px">' + t('detail_no_items') + '</p>';

  const isTaskMode = workItemType === 'Task';
  const ITEM_TYPES = getItemTypes(workItemType);

  const filterBanner = selectedSprints && selectedSprints.length > 0
    ? '<div style="background:#1e3a5f;border:1px solid #2d5a8e;border-radius:8px;padding:10px 14px;margin-bottom:20px;font-size:12px;color:#93c5fd">' +
      t('detail_filter_banner', { count: selectedSprints.length }) + ' ' +
      selectedSprints.map(function(s) { var p = s.split('\u005c'); return '<strong>' + (p.length > 1 ? p[p.length - 1] : s) + '</strong>'; }).join(', ') +
      '</div>'
    : '';

  const mainItems = items.filter(i => ITEM_TYPES.includes(i.type));
  const mainTotal = mainItems.length;
  const totalPts = items.reduce((s, i) => s + (i.pts || 0), 0);
  const closed   = items.filter(i => ['Closed','Done'].includes(i.state)).length;
  const active   = items.filter(i => ['Active','In Progress','Doing','Committed'].includes(i.state)).length;
  const newItems = items.filter(i => i.state === 'New').length;
  const bugs     = totalBugs || items.filter(i => i.type === 'Bug').length;
  const us            = mainTotal;
  const openMainItems = mainItems.filter(i => !CLOSED_STATES.includes(i.state));
  const noEst         = openMainItems.filter(i => i.pts == null || i.pts === 0).length;  // open only — matches dashboard
  const mainNoEst     = mainItems.filter(i => i.pts == null || i.pts === 0).length;      // all US — used in coverage ring
  const donePts      = items.filter(i => ['Closed','Done','Resolved'].includes(i.state)).reduce((s,i)=>s+(i.pts||0),0);
  const mainClosed   = mainItems.filter(i => ['Closed','Done','Resolved'].includes(i.state)).length;
  const mainUAT      = mainItems.filter(i => i.state === 'UAT').length;
  const uatPct       = mainTotal ? Math.round(mainUAT / mainTotal * 100) : 0;
  const completedHrs = taskCompletedWork || 0;
  const completedHrsFmt = completedHrs % 1 === 0 ? completedHrs : completedHrs.toFixed(1);
  const bugHrs = bugCompletedWork || 0;
  const bugHrsFmt = bugHrs % 1 === 0 ? bugHrs : bugHrs.toFixed(1);
  const closedPct    = mainTotal ? Math.round(mainClosed / mainTotal * 100) : 0;
  const totalHrs     = completedHrs + bugHrs;
  const bugRate      = totalHrs ? Math.round(bugHrs / totalHrs * 100) : 0;
  const estPct       = mainTotal ? Math.round((mainTotal - mainNoEst) / mainTotal * 100) : 0;
  const origEst      = taskOriginalEstimate || 0;
  const origEstFmt   = origEst % 1 === 0 ? origEst : origEst.toFixed(1);
  const savingsPct   = origEst > 0 ? Math.round((origEst - completedHrs) / origEst * 100) : null;
  const perfRingPct  = savingsPct !== null ? Math.min(Math.abs(savingsPct), 100) : 0;
  const perfColor    = savingsPct === null ? '#475569' : savingsPct >= 0 ? '#22c55e' : '#ef4444';
  const perfClass    = savingsPct === null ? '' : savingsPct >= 0 ? 'green' : 'red';
  const perfDisplay  = savingsPct === null ? '\u2014' : (savingsPct > 0 ? '+' : '') + savingsPct + '%';

  const byStatus = {};
  items.filter(i => ITEM_TYPES.includes(i.type)).forEach(i => { byStatus[i.state] = (byStatus[i.state]||0) + 1; });
  const statusEntries = Object.entries(byStatus).sort((a,b)=>b[1]-a[1]).map(([k,v])=>[k,v,statusColor(k)]);

  const byAsgn = {};
  items.filter(i => ITEM_TYPES.includes(i.type)).forEach(i => { const n = i.assigned || t('no_assignee'); byAsgn[n]=(byAsgn[n]||0)+1; });
  const asgnEntries = Object.entries(byAsgn).sort((a,b)=>b[1]-a[1]).slice(0,12).map(([k,v])=>[k,v,'#60a5fa']);

  const { bySprint, sorted: sortedSprintEntries, sprintMeta } = buildSprintData(items, iterMap);
  const allSprintData = JSON.stringify(sprintMeta).replace(/</g, '\\u003c').replace(/'/g, '&#39;');

  // Labels dinâmicos
  const itemLabel = isTaskMode ? t('label_tasks') : t('label_user_stories');
  const estimateLabel = isTaskMode ? t('label_hours') : t('label_story_points');

  const sprintRows = sortedSprintEntries.map(([key, d]) => {
    const iter = iterMap[key]||{};
    const label = key.includes('\\') ? key.split('\\').pop() : key;
    const dateR = (iter.start && iter.end) ? fmtD(iter.start) + ' \u2013 ' + fmtD(iter.end) : '\u2014';
    const pct = d.us ? Math.round(d.usClosed/d.us*100) : 0;
    const uatCount = d.usUAT || 0;
    const uatPct = d.us ? Math.round(uatCount/d.us*100) : 0;
    const isCurr = iter.isCurrent;
    const safeKey = key.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    return '<tr' + (isCurr?' class="is-current"':'') + ' data-sprint-key="' + safeKey + '">' +
      '<td>' + label + (isCurr?' <span class="badge green" style="font-size:10px;padding:1px 6px">' + t('badge_current') + '</span>':'') + '</td>' +
      '<td data-col="period">' + dateR + '</td>' +
      '<td data-col="items">' + d.us + '</td>' +
      '<td data-col="pts">' + d.pts + '</td>' +
      '<td data-col="completed">' + d.usClosed + ' <span style="color:#475569">(' + pct + '%)</span></td>' +
      '<td data-col="uat">' + uatCount + (uatCount > 0 ? ' <span style="color:#475569">(' + uatPct + '%)</span>' : '') + '</td>' +
      '<td data-col="actions">' +
      '<button class="btn-burndown" type="button" onclick="openBurndown(this)" title="Ver burndown">\uD83D\uDCCA</button>' +
      '<button class="btn-burndown" type="button" data-project="' + projectName.replace(/"/g,'&quot;') + '" data-sprint="' + safeKey + '" onclick="openDailyForSprint(this.dataset.project, this.dataset.sprint)" title="' + t('btn_view_sprint') + '">\u2630</button>' +
      '</td>' +
      '</tr>';
  }).join('');

  const tlSection = buildTimeline(bySprint, iterMap);

  return filterBanner + '<div class="d-section"><div class="d-section-title">' + t('section_summary') + '</div>' +
    '<div class="d-grid">' +
      '<div class="d-card"><div class="d-label">' + t('d_total_items') + '</div><div class="d-val blue">' + total + '</div></div>' +
      '<div class="d-card d-card-clickable" onclick="openDetailStat(\'us\')" title="View items"><div class="d-label">' + itemLabel + '</div><div class="d-val blue">' + us + '</div></div>' +
      '<div class="d-card"><div class="d-label">' + estimateLabel + '</div><div class="d-val purple">' + totalPts + '</div></div>' +
      '<div class="d-card"><div class="d-label">' + t('d_pts_delivered') + '</div><div class="d-val green">' + donePts + '</div></div>' +
      '<div class="d-card"><div class="d-label">' + t('d_in_progress') + '</div><div class="d-val blue">' + active + '</div></div>' +
      '<div class="d-card d-card-clickable" onclick="openDetailStat(\'new\')" title="View new items"><div class="d-label">' + t('d_new') + '</div><div class="d-val">' + newItems + '</div></div>' +
      '<div class="d-card d-card-clickable" onclick="openDetailStat(\'noEst\')" title="View no estimate items"><div class="d-label">' + t('d_no_estimate') + '</div><div class="d-val ' + (noEst>mainTotal*0.3?'yellow':'') + '">' + noEst + '</div></div>' +
      '<div class="d-card"><div class="d-label">' + t('d_hrs_tasks') + '</div><div class="d-val purple">' + completedHrsFmt + 'h</div></div>' +
      '<div class="d-card"><div class="d-label">' + t('d_hrs_bugs') + '</div><div class="d-val ' + (bugHrs>0?'red':'') + '">' + bugHrsFmt + 'h</div></div>' +
    '</div></div>' +

    '<div class="d-section"><div class="d-section-title">' + t('section_health_ind') + '</div>' +
      '<div style="display:flex;gap:32px;flex-wrap:wrap">' +
        '<div class="progress-ring">' + ring(closedPct,'#22c55e') + '<div><div class="d-label">' + t('health_completion') + '</div><div class="d-val green" style="font-size:22px">' + closedPct + '%</div><div class="d-sub">' + t('health_us_closed', { closed: mainClosed, total: mainTotal }) + '</div></div></div>' +
        '<div class="progress-ring">' + ring(uatPct,'#f59e0b') + '<div><div class="d-label">' + t('health_uat') + '</div><div class="d-val ' + (uatPct>30?'red':uatPct>15?'yellow':'') + '" style="font-size:22px;color:#f59e0b">' + uatPct + '%</div><div class="d-sub">' + t('health_us_uat', { count: mainUAT, total: mainTotal }) + '</div></div></div>' +
        '<div class="progress-ring">' + ring(bugRate,'#ef4444') + '<div><div class="d-label">' + t('health_bug_rate') + '</div><div class="d-val ' + (bugRate>20?'red':bugRate>10?'yellow':'') + '" style="font-size:22px">' + bugRate + '%</div><div class="d-sub">' + t('health_bugs_total', { count: bugs }) + '</div></div></div>' +
        '<div class="progress-ring">' + ring(estPct,'#60a5fa') + '<div><div class="d-label">' + t('health_coverage') + '</div><div class="d-val blue" style="font-size:22px">' + estPct + '%</div><div class="d-sub">' + t('health_us_estimated', { estimated: mainTotal - mainNoEst, total: mainTotal }) + '</div></div></div>' +
        '<div class="progress-ring">' + ring(perfRingPct, perfColor) + '<div><div class="d-label">' + t('health_performance') + '</div><div class="d-val ' + perfClass + '" style="font-size:22px' + (savingsPct === null ? ';color:#475569' : '') + '">' + perfDisplay + '</div><div class="d-sub"><span class="orig-est-wrap" onclick="editOrigEst(\'' + projectName.replace(/'/g, "\\'") + '\')" title="' + t('orig_est_edit_title') + '">' + origEstFmt + 'h est. <span class="orig-est-icon' + (isOrigEstOverride ? ' orig-est-icon--active' : '') + '">\u270F</span></span> \u00B7 ' + completedHrsFmt + 'h log.</div></div></div>' +
      '</div>' +
    '</div>' +

    '<div class="d-cols">' +
      '<div class="d-section" style="margin:0"><div class="d-section-title">' + t('section_by_status') + '</div><div class="bar-list">' + barList(statusEntries, mainTotal) + '</div></div>' +
      '<div class="d-section" style="margin:0"><div class="d-section-title">' + t('section_by_assignee') + '</div><div class="bar-list">' + barList(asgnEntries, mainTotal) + '</div></div>' +
    '</div>' +

    '<div class="d-section">' +
      '<div class="sprint-section-header">' +
        '<div class="d-section-title">' + t('section_by_sprint') + '</div>' +
        '<div class="sprint-col-btn-wrap">' +
          '<button class="sprint-col-btn" title="' + t('sprint_cols_label') + '">\u229E</button>' +
          '<div class="sprint-col-dropdown">' +
            SPRINT_COL_DEFS.map(function(col) {
              var lbl = col.key ? t(col.key) : itemLabel;
              return '<label class="sprint-col-toggle"><input type="checkbox" data-col-toggle="' + col.id + '"> ' + lbl + '</label>';
            }).join('') +
          '</div>' +
        '</div>' +
      '</div>' +
      '<table class="d-table" data-sprints=\'' + allSprintData + '\'><thead><tr>' +
      '<th>' + t('th_sprint') + '</th>' +
      '<th data-col="period">' + t('th_period') + '</th>' +
      '<th data-col="items">' + itemLabel + '</th>' +
      '<th data-col="pts">' + t('th_pts') + '</th>' +
      '<th data-col="completed">' + t('th_completed') + '</th>' +
      '<th data-col="uat">' + t('th_uat_pct') + '</th>' +
      '<th data-col="actions">' + t('th_actions') + '</th>' +
      '</tr></thead><tbody>' + sprintRows + '</tbody></table>' +
    '</div>' +
    tlSection;
}

export function openDetailStat(stat) {
  const { filtered, workItemType } = _ctx;
  if (!filtered.length) return;
  const ITEM_TYPES = getItemTypes(workItemType);
  const mainItems = filtered.filter(i => ITEM_TYPES.includes(i.type));
  switch (stat) {
    case 'us':
      openItemsModal({ title: t('label_user_stories'), items: mainItems, showPts: true });
      break;
    case 'new':
      openItemsModal({ title: t('d_new'), items: filtered.filter(i => i.state === 'New'), showPts: true });
      break;
    case 'noEst': {
      const openMain = filtered.filter(i => ITEM_TYPES.includes(i.type) && !CLOSED_STATES.includes(i.state));
      openItemsModal({ title: t('d_no_estimate'), items: openMain.filter(i => i.pts == null || i.pts === 0), showPts: true });
      break;
    }
  }
}

export function editOrigEst(project) {
  const lsKey = LS_ORIG_EST + project;
  const wrap = document.querySelector('.orig-est-wrap');
  if (!wrap) return;

  const current = localStorage.getItem(lsKey) || '';
  wrap.outerHTML =
    '<span class="orig-est-wrap orig-est-editing">' +
      '<input type="number" class="orig-est-input" min="0" step="0.5" value="' + current + '" placeholder="horas">' +
      '<button class="orig-est-btn" id="_oeSave">\u2713</button>' +
      '<button class="orig-est-btn orig-est-btn--clear" id="_oeClear" title="' + 'Usar valor calculado' + '">\u2715</button>' +
    '</span>';

  const inp = document.querySelector('.orig-est-input');
  if (inp) { inp.focus(); inp.select(); }

  function save() {
    const v = parseFloat(document.querySelector('.orig-est-input')?.value);
    if (!isNaN(v) && v > 0) localStorage.setItem(lsKey, String(v));
    else localStorage.removeItem(lsKey);
    loadDetailData(_detailState.project, _detailState.sprints);
  }
  function cancel() { loadDetailData(_detailState.project, _detailState.sprints); }

  const saveBtn = document.getElementById('_oeSave');
  const clearBtn = document.getElementById('_oeClear');
  if (saveBtn) saveBtn.onclick = save;
  if (clearBtn) clearBtn.onclick = () => { localStorage.removeItem(lsKey); loadDetailData(_detailState.project, _detailState.sprints); };
  if (inp) inp.onkeydown = e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cancel(); };
}

function buildTimeline(bySprint, iterMap) {
  const now = new Date();
  const items = Object.entries(bySprint)
    .filter(([key]) => iterMap[key] && iterMap[key].start && iterMap[key].end)
    .map(([key, d]) => {
      const it = iterMap[key];
      const start = new Date(it.start), end = new Date(it.end);
      const label = key.split('\u005c').pop();
      return { key, label, start, end, us: d.us, total: d.total, pts: d.pts, closed: d.closed, isCurrent: !!it.isCurrent, isPast: end < now };
    })
    .sort((a, b) => a.start - b.start);

  if (items.length < 2) return '';

  const minDate = items[0].start;
  const maxDate = items[items.length - 1].end;
  const totalMs  = maxDate - minDate || 1;
  const maxUS    = Math.max(...items.map(t => t.us), 1);
  const dateLocale = getDateLocale();

  function pct(d) { return ((d - minDate) / totalMs * 100).toFixed(2); }

  const months = [];
  const mc = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
  while (mc <= maxDate) {
    const lp = Math.max(0, parseFloat(pct(mc)));
    if (lp <= 100) months.push('<div class="tl-month" style="left:' + lp + '%">' + mc.toLocaleDateString(dateLocale, {month:'short', year:'2-digit'}) + '</div>');
    mc.setMonth(mc.getMonth() + 1);
  }

  const blocks = items.map(item => {
    const l = pct(item.start), w = ((item.end - item.start) / totalMs * 100).toFixed(2);
    const barH = Math.max(8, Math.round(item.us / maxUS * 100));
    const state = item.isCurrent ? 'current' : item.isPast ? 'past' : 'future';
    const fmtShort = d => d.toLocaleDateString(dateLocale, { day: '2-digit', month: '2-digit' });
    const dateRange = fmtShort(item.start) + ' \u2013 ' + fmtShort(item.end);
    return '<div class="tl-block tl-block--' + state + '" style="left:' + l + '%;width:' + w + '%" title="' + item.label + ' | ' + fmtD(item.start.toISOString()) + ' \u2013 ' + fmtD(item.end.toISOString()) + ' | ' + item.us + ' US">' +
      '<div class="tl-bar-inner"></div>' +
      '<div class="tl-block-foot">' +
        '<div class="tl-block-name">' + item.label + (item.isCurrent ? ' \uD83D\uDCC5' : '') + '</div>' +
        '<div class="tl-block-dates">' + dateRange + '</div>' +
      '</div>' +
    '</div>';
  }).join('');

  const todayPct = Math.min(100, Math.max(0, parseFloat(pct(now))));
  const todayMarker = now >= minDate && now <= maxDate
    ? '<div class="tl-today" style="left:' + todayPct + '%"><div class="tl-today-line"></div><div class="tl-today-label">' + t('tl_today') + '</div></div>'
    : '';

  return '<div class="d-section"><div class="d-section-title">' + t('section_timeline') + '</div>' +
    '<div class="tl-wrap">' +
      '<div class="tl-months">' + months.join('') + '</div>' +
      '<div class="tl-track">' + blocks + todayMarker + '</div>' +
    '</div>' +
    '<div class="tl-legend">' +
      '<span class="tl-leg tl-leg--past">\u25CF ' + t('tl_past') + '</span>' +
      '<span class="tl-leg tl-leg--future">\u25CF ' + t('tl_future') + '</span>' +
      '<span class="tl-leg tl-leg--current">\u25CF ' + t('tl_current_sprint') + '</span>' +
      '<span class="tl-leg tl-leg--today">\u2503 ' + t('tl_today_label') + '</span>' +
    '</div>' +
  '</div>';
}

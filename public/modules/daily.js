import { CLOSED_STATES, ACTIVE_BUG_STATES, getItemTypes } from './constants.js';
import { calcHealth } from './health.js';
import { t } from './i18n.js';
import { fmtD } from './utils.js';
import { getAlias } from './alias.js';
import { openItemsModal, closeItemsModal } from './itemsModal.js';
import { doRefresh } from './timer.js';

let _dailyIndex = 0;
let _dailySlides = [];
let _slidesData = [];
let _dailyMode = 'all'; // 'all' | 'sprint'
let _dailyForcedProject = null;
let _dailyForcedSprint = null;

export function buildDailySlide(card, forcedSprintKey = null) {
  const project = card.dataset.project;
  const items = JSON.parse(card.dataset.items);
  const workItemType = card.dataset.workitemtype || 'User Story';
  const ITEM_TYPES = getItemTypes(workItemType);
  const isTaskMode = workItemType === 'Task';

  let currentIter, sprintName, sprintDate;

  if (forcedSprintKey) {
    currentIter = forcedSprintKey;
    sprintName = forcedSprintKey.includes('\\') ? forcedSprintKey.split('\\').pop() : forcedSprintKey;
    const iterMap = (() => { try { return JSON.parse(card.dataset.itermap || '{}'); } catch(_) { return {}; } })();
    const iter = iterMap[forcedSprintKey] || {};
    sprintDate = iter.start && iter.end ? fmtD(iter.start) + ' \u2013 ' + fmtD(iter.end) : '';
  } else {
    const currentOption = card.querySelector('.option-row.is-current input');
    currentIter = currentOption ? currentOption.value : null;
    const sprintEl = card.querySelector('.sprint');
    sprintName = sprintEl ? sprintEl.textContent.trim() : t('daily_no_sprint');
    const currentRow = card.querySelector('.option-row.is-current');
    sprintDate = currentRow ? (currentRow.querySelector('.option-date') || {}).textContent || '' : '';
  }

  const sprintLabel = sprintDate ? sprintName + '\u2002\u00b7\u2002' + sprintDate : sprintName;

  const filteredForStats = currentIter ? items.filter(i => i.iteration === currentIter) : items;

  const mainItems = filteredForStats.filter(i => ITEM_TYPES.includes(i.type));
  const total = mainItems.length;
  const openItems = mainItems.filter(i => !CLOSED_STATES.includes(i.state));
  const semEstItems = openItems.filter(i => i.pts == null || i.pts === 0);
  const semRespItems = openItems.filter(i => !i.assigned);
  const semEst = semEstItems.length;
  const semResp = semRespItems.length;
  const allBugs    = filteredForStats.filter(i => i.type === 'Bug');
  const activeBugs = allBugs.filter(i => ACTIVE_BUG_STATES.includes(i.state));
  const bugs = activeBugs.length;

  _slidesData.push({ sprintName, mainItems, semEstItems, semRespItems, activeBugs, allBugs });

  const health = calcHealth(total, semEst, semResp, bugs);

  const itemLabel = isTaskMode ? t('stat_tasks') : t('stat_us');

  const rows = Array.from(card.querySelectorAll('tbody tr[data-iteration]'))
    .filter(row => !currentIter || row.dataset.iteration === currentIter)
    .sort((a, b) => (parseFloat(a.dataset.order) || 999999) - (parseFloat(b.dataset.order) || 999999));
  const tableRows = rows.map(r => {
    const id = r.dataset.id || '';
    const url = r.dataset.url || '';
    const idCell = '<td class="daily-id-cell">' + (url ? '<a href="' + url.replace(/"/g, '&quot;') + '" target="_blank" rel="noopener">#' + id + '</a>' : '#' + id) + '</td>';
    return r.outerHTML.replace(/<td/, idCell + '<td');
  }).join('');

  const usSection = tableRows
    ? '<input type="search" class="daily-filter-input" placeholder="Filter..." oninput="filterDailyItems(this.value)">' +
      '<div class="daily-table-wrap"><table><thead><tr>' +
      '<th>ID</th><th>' + t('th_title') + '</th><th>' + t('th_status') + '</th>' +
      '<th>' + t('th_estimate') + '</th><th>' + t('th_assignee') + '</th>' +
      '</tr></thead><tbody>' + tableRows + '</tbody></table></div>'
    : '<div class="daily-empty">' + t('daily_no_us') + '</div>';

  return '<div class="daily-slide">' +
    '<div class="daily-fixed">' +
      '<div class="daily-slide-header">' +
        '<div class="daily-project-name">' + getAlias(project) + '</div>' +
        '<span class="badge ' + health[1] + ' big" title="' + health[2] + '">' + health[0] + '</span>' +
      '</div>' +
      '<div class="daily-sprint-row">' +
        '<div class="daily-sprint-label">' + sprintLabel + '</div>' +
        '<button class="btn-burndown-daily" type="button" data-project="' + project.replace(/"/g,'&quot;') + '" data-iter="' + (currentIter||'').replace(/"/g,'&quot;') + '" onclick="openBurndownFromDaily(this.dataset.project, this.dataset.iter)">\uD83D\uDCCA Burndown</button>' +
      '</div>' +
      '<div class="stats daily-stats">' +
        '<div class="stat stat-clickable" onclick="openDailyStat(\'us\')" title="View items"><div class="stat-label">' + itemLabel + '</div><div class="stat-val">' + total + '</div></div>' +
        '<div class="stat stat-clickable" onclick="openDailyStat(\'noEst\')" title="View no estimate items"><div class="stat-label">' + t('stat_no_est') + '</div><div class="stat-val ' + (semEst > 2 ? 'warn' : '') + '">' + semEst + '</div></div>' +
        '<div class="stat stat-clickable" onclick="openDailyStat(\'noResp\')" title="View no assignee items"><div class="stat-label">' + t('stat_no_resp') + '</div><div class="stat-val ' + (semResp > 2 ? 'warn' : '') + '">' + semResp + '</div></div>' +
        '<div class="stat stat-clickable" onclick="openDailyStat(\'bugs\')" title="View bugs"><div class="stat-label">' + t('stat_bugs') + '</div><div class="stat-val ' + (bugs > 3 ? 'crit' : '') + '">' + bugs + '</div></div>' +
      '</div>' +
    '</div>' +
    usSection +
    '</div>';
}

export function openDailyStat(stat) {
  const data = _slidesData[_dailyIndex];
  if (!data) return;
  switch (stat) {
    case 'us':
      openItemsModal({ title: data.sprintName + ' — ' + t('stat_us'), items: data.mainItems, showPts: true });
      break;
    case 'noEst':
      openItemsModal({ title: data.sprintName + ' — ' + t('stat_no_est'), items: data.semEstItems, showPts: true });
      break;
    case 'noResp':
      openItemsModal({ title: data.sprintName + ' — ' + t('stat_no_resp'), items: data.semRespItems, showPts: true });
      break;
    case 'bugs':
      openItemsModal({ title: data.sprintName + ' — ' + t('stat_bugs'), items: data.allBugs, defaultFilters: [...ACTIVE_BUG_STATES] });
      break;
  }
}

function _buildDailyTrack() {
  _slidesData = [];
  const track = document.getElementById('daily-track');
  if (_dailyMode === 'sprint') {
    const card = Array.from(document.querySelectorAll('#content .card[data-project]'))
      .find(c => c.dataset.project === _dailyForcedProject);
    _dailySlides = card ? [card] : [];
    track.innerHTML = card ? buildDailySlide(card, _dailyForcedSprint) : '';
  } else {
    _dailySlides = Array.from(document.querySelectorAll('#content .card[data-project]'));
    track.innerHTML = _dailySlides.map(c => buildDailySlide(c)).join('');
  }
  track.style.transform = 'translateX(-' + (_dailyIndex * 100) + '%)';
}

export function openDaily() {
  _dailyMode = 'all';
  _dailyForcedProject = null;
  _dailyForcedSprint = null;
  _dailyIndex = 0;

  _buildDailyTrack();
  if (!_dailySlides.length) return;

  updateDailyNav();

  const dailyModal = document.getElementById('daily-modal');
  dailyModal.classList.add('open', 'maximized');
  document.getElementById('btnDailyMax').textContent = '\u2921';
  document.getElementById('btnDailyMax').title = t('daily_restore');
  document.body.style.overflow = 'hidden';
  dailyModal.focus();
}

export function openDailyForProject(projectName) {
  _dailyMode = 'all';
  _dailyForcedProject = null;
  _dailyForcedSprint = null;

  _buildDailyTrack();
  if (!_dailySlides.length) return;

  const idx = _dailySlides.findIndex(c => c.dataset.project === projectName);
  _dailyIndex = idx >= 0 ? idx : 0;

  const track = document.getElementById('daily-track');
  track.style.transform = 'translateX(-' + (_dailyIndex * 100) + '%)';
  updateDailyNav();

  const dailyModal = document.getElementById('daily-modal');
  dailyModal.classList.add('open', 'maximized');
  document.getElementById('btnDailyMax').textContent = '\u2921';
  document.getElementById('btnDailyMax').title = t('daily_restore');
  document.body.style.overflow = 'hidden';
  dailyModal.focus();
}

export function openDailyForSprint(projectName, sprintKey) {
  _dailyMode = 'sprint';
  _dailyForcedProject = projectName;
  _dailyForcedSprint = sprintKey;
  _dailyIndex = 0;

  _buildDailyTrack();
  if (!_dailySlides.length) return;

  updateDailyNav();
  const dailyModal2 = document.getElementById('daily-modal');
  dailyModal2.classList.add('open', 'maximized');
  document.getElementById('btnDailyMax').textContent = '\u2921';
  document.getElementById('btnDailyMax').title = t('daily_restore');
  document.body.style.overflow = 'hidden';
  dailyModal2.focus();
}

export async function refreshDaily() {
  const btn = document.getElementById('btnDailyRefresh');
  if (btn) btn.disabled = true;
  await doRefresh();
  _dailyIndex = Math.min(_dailyIndex, Math.max(0, _dailySlides.length - 1));
  _buildDailyTrack();
  updateDailyNav();
  if (btn) btn.disabled = false;
}

export function closeDaily() {
  closeItemsModal();
  document.getElementById('daily-modal').classList.remove('open', 'maximized');
  document.getElementById('btnDailyMax').textContent = '\u2922';
  document.body.style.overflow = '';
}

export function toggleDailyMaximize() {
  const overlay = document.getElementById('daily-modal');
  const btn = document.getElementById('btnDailyMax');
  const isMax = overlay.classList.toggle('maximized');
  btn.textContent = isMax ? '\u2921' : '\u2922';
  btn.title = isMax ? t('daily_restore') : t('daily_expand');
}

export function dailyPrev() {
  if (_dailyIndex > 0) {
    _dailyIndex--;
    updateDailyNav();
  }
}

export function dailyNext() {
  if (_dailyIndex < _dailySlides.length - 1) {
    _dailyIndex++;
    updateDailyNav();
  }
}

function updateDailyNav() {
  const track = document.getElementById('daily-track');
  track.style.transform = 'translateX(-' + (_dailyIndex * 100) + '%)';

  document.getElementById('daily-counter').textContent = (_dailyIndex + 1) + ' / ' + _dailySlides.length;
  document.getElementById('btnDailyPrev').disabled = _dailyIndex === 0;
  document.getElementById('btnDailyNext').disabled = _dailyIndex === _dailySlides.length - 1;

  const filterEl = document.querySelector('#daily-track .daily-slide:nth-child(' + (_dailyIndex + 1) + ') .daily-filter-input');
  if (filterEl) { filterEl.value = ''; filterDailyItems(''); }
}

export function filterDailyItems(term) {
  const slides = document.querySelectorAll('#daily-track .daily-slide');
  const slide = slides[_dailyIndex];
  if (!slide) return;
  const q = term.trim().toLowerCase();
  slide.querySelectorAll('tbody tr').forEach(row => {
    row.style.display = !q || row.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
}

export function handleDailyKey(e) {
  if (document.getElementById('items-modal').classList.contains('open')) return;
  if (e.key === 'ArrowRight') dailyNext();
  else if (e.key === 'ArrowLeft') dailyPrev();
  else if (e.key === 'Escape') closeDaily();
}

document.addEventListener('keydown', e => {
  if (!document.getElementById('daily-modal').classList.contains('open')) return;
  handleDailyKey(e);
});

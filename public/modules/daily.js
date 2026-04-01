import { US_TYPES, CLOSED_STATES, ACTIVE_BUG_STATES } from './constants.js';
import { calcHealth } from './health.js';
import { t } from './i18n.js';

let _dailyIndex = 0;
let _dailySlides = [];

export function buildDailySlide(card) {
  const project = card.dataset.project;
  const items = JSON.parse(card.dataset.items);

  const currentOption = card.querySelector('.option-row.is-current input');
  const currentIter = currentOption ? currentOption.value : null;

  const sprintEl = card.querySelector('.sprint');
  const sprintName = sprintEl ? sprintEl.textContent.trim() : t('daily_no_sprint');
  const currentRow = card.querySelector('.option-row.is-current');
  const sprintDate = currentRow ? (currentRow.querySelector('.option-date') || {}).textContent || '' : '';
  const sprintLabel = sprintDate ? sprintName + '\u2002\u00b7\u2002' + sprintDate : sprintName;

  const filteredForStats = currentIter ? items.filter(i => i.iteration === currentIter) : items;

  const usItems = filteredForStats.filter(i => US_TYPES.includes(i.type));
  const total = usItems.length;
  const openUS = usItems.filter(i => !CLOSED_STATES.includes(i.state));
  const semEst = openUS.filter(i => i.pts == null).length;
  const semResp = openUS.filter(i => !i.assigned).length;
  const bugs = filteredForStats.filter(i => i.type === 'Bug' && ACTIVE_BUG_STATES.includes(i.state)).length;

  const health = calcHealth(total, semEst, semResp, bugs);

  let tableRows = '';
  card.querySelectorAll('tbody tr[data-iteration]').forEach(row => {
    if (!currentIter || row.dataset.iteration === currentIter) {
      tableRows += row.outerHTML;
    }
  });

  const usSection = tableRows
    ? '<div class="daily-us-title">' + t('daily_us_title') + '</div>' +
      '<div class="daily-table-wrap"><table><thead><tr>' +
      '<th>' + t('th_title') + '</th><th>' + t('th_status') + '</th>' +
      '<th>' + t('th_estimate') + '</th><th>' + t('th_assignee') + '</th>' +
      '</tr></thead><tbody>' + tableRows + '</tbody></table></div>'
    : '<div class="daily-empty">' + t('daily_no_us') + '</div>';

  return '<div class="daily-slide">' +
    '<div class="daily-fixed">' +
      '<div class="daily-slide-header">' +
        '<div class="daily-project-name">' + project + '</div>' +
        '<span class="badge ' + health[1] + ' big" title="' + health[2] + '">' + health[0] + '</span>' +
      '</div>' +
      '<div class="daily-sprint-row">' +
        '<div class="daily-sprint-label">' + sprintLabel + '</div>' +
        '<button class="btn-burndown-daily" type="button" data-project="' + project.replace(/"/g,'&quot;') + '" data-iter="' + (currentIter||'').replace(/"/g,'&quot;') + '" onclick="openBurndownFromDaily(this.dataset.project, this.dataset.iter)">\uD83D\uDCCA Burndown</button>' +
      '</div>' +
      '<div class="stats daily-stats">' +
        '<div class="stat"><div class="stat-label">' + t('stat_us') + '</div><div class="stat-val">' + total + '</div></div>' +
        '<div class="stat"><div class="stat-label">' + t('stat_no_est') + '</div><div class="stat-val ' + (semEst > 2 ? 'warn' : '') + '">' + semEst + '</div></div>' +
        '<div class="stat"><div class="stat-label">' + t('stat_no_resp') + '</div><div class="stat-val ' + (semResp > 2 ? 'warn' : '') + '">' + semResp + '</div></div>' +
        '<div class="stat"><div class="stat-label">' + t('stat_bugs') + '</div><div class="stat-val ' + (bugs > 3 ? 'crit' : '') + '">' + bugs + '</div></div>' +
      '</div>' +
    '</div>' +
    usSection +
    '</div>';
}

export function openDaily() {
  const cards = Array.from(document.querySelectorAll('#content .card[data-project]'));
  if (!cards.length) return;

  _dailySlides = cards;
  _dailyIndex = 0;

  const track = document.getElementById('daily-track');
  track.innerHTML = _dailySlides.map(c => buildDailySlide(c)).join('');
  track.style.transform = 'translateX(0)';

  updateDailyNav();

  document.getElementById('daily-modal').classList.add('open');
  document.body.style.overflow = 'hidden';
  document.getElementById('daily-modal').focus();
}

export function closeDaily() {
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
}

export function handleDailyKey(e) {
  if (e.key === 'ArrowRight') dailyNext();
  else if (e.key === 'ArrowLeft') dailyPrev();
  else if (e.key === 'Escape') closeDaily();
}

document.addEventListener('keydown', e => {
  if (!document.getElementById('daily-modal').classList.contains('open')) return;
  handleDailyKey(e);
});

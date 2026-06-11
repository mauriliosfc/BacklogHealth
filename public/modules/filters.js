import { US_TYPES, CLOSED_STATES, ACTIVE_BUG_STATES, getItemTypes } from './constants.js';
import { calcHealth } from './health.js';
import { t } from './i18n.js';
import { openItemsModal } from './itemsModal.js';

export function toggleDropdown(trigger) {
  const panel = trigger.nextElementSibling;
  const isOpen = panel.classList.contains('open');
  document.querySelectorAll('.select-panel.open').forEach(p => {
    p.classList.remove('open', 'drop-up');
    p.previousElementSibling.classList.remove('open', 'drop-up');
  });
  if (!isOpen) {
    // Detect if there's enough space below; if not, open upward
    const triggerRect = trigger.getBoundingClientRect();
    const spaceBelow = window.innerHeight - triggerRect.bottom;
    const spaceAbove = triggerRect.top;
    const dropUp = spaceBelow < 340 && spaceAbove > spaceBelow;
    panel.classList.add('open');
    trigger.classList.add('open');
    if (dropUp) {
      panel.classList.add('drop-up');
      trigger.classList.add('drop-up');
    }
  }
}

document.addEventListener('click', e => {
  if (!e.target.closest('.custom-select') && !e.target.closest('.items-filter-select')) {
    document.querySelectorAll('.select-panel.open').forEach(p => {
      p.classList.remove('open');
      p.previousElementSibling.classList.remove('open');
    });
  }
});

export function onCheckChange(checkbox) {
  const customSelect = checkbox.closest('.custom-select');
  const card = checkbox.closest('.card');
  const checked = Array.from(customSelect.querySelectorAll('input[type="checkbox"]:checked'));
  const selected = checked.map(c => c.value);
  const valueEl = customSelect.querySelector('.select-value');
  if (selected.length === 0) valueEl.textContent = t('all_sprints');
  else if (selected.length === 1) valueEl.textContent = checked[0].closest('.option-row').querySelector('span').textContent;
  else valueEl.textContent = t('sprints_selected', { count: selected.length });
  applyFilter(card, selected);
  saveFilter(card, selected);
}

export function clearFilter(btn) {
  const customSelect = btn.closest('.custom-select');
  customSelect.querySelectorAll('input[type="checkbox"]').forEach(c => c.checked = false);
  customSelect.querySelector('.select-value').textContent = t('all_sprints');
  const card = btn.closest('.card');
  applyFilter(card, []);
  saveFilter(card, []);
}

export function saveFilter(card, selected) {
  const project = card.dataset.project;
  if (selected.length === 0) localStorage.removeItem('filter_' + project);
  else localStorage.setItem('filter_' + project, JSON.stringify(selected));
}

export function applyFilter(card, selected) {
  const allItems = JSON.parse(card.dataset.items);
  const workItemType = card.dataset.workitemtype || 'User Story';
  const ITEM_TYPES = getItemTypes(workItemType);

  const filtered = selected.length === 0 ? allItems : allItems.filter(i => selected.includes(i.iteration));
  const filteredItems = filtered.filter(i => ITEM_TYPES.includes(i.type));
  const total = filteredItems.length;
  const openItems = filteredItems.filter(i => !CLOSED_STATES.includes(i.state));
  const semEst = openItems.filter(i => i.pts == null || i.pts === 0).length;
  const semResp = openItems.filter(i => !i.assigned).length;
  const bugs = filtered.filter(i => i.type === 'Bug' && ACTIVE_BUG_STATES.includes(i.state)).length;

  // Stats grid
  const totalEl = card.querySelector('.card-total');
  if (totalEl) totalEl.textContent = total;

  const semEstEl = card.querySelector('.card-semest');
  if (semEstEl) {
    semEstEl.textContent = semEst;
    semEstEl.className = 'cstat-val card-semest ' + (semEst > 2 ? 'c' : semEst > 0 ? 'w' : 'g');
  }

  const semRespEl = card.querySelector('.card-semresp');
  if (semRespEl) {
    semRespEl.textContent = semResp;
    semRespEl.className = 'cstat-val card-semresp ' + (semResp > 2 ? 'c' : semResp > 0 ? 'w' : 'g');
  }

  const bugsEl = card.querySelector('.card-bugs');
  if (bugsEl) {
    bugsEl.textContent = bugs;
    bugsEl.className = 'cstat-val card-bugs ' + (bugs > 3 ? 'c' : bugs > 0 ? 'w' : 'g');
  }

  // Sprint progress bar
  const progPctEl = card.querySelector('.prog-pct');
  const progFillEl = card.querySelector('.prog-fill');
  if (progPctEl && progFillEl) {
    const closed = filteredItems.filter(i => CLOSED_STATES.includes(i.state)).length;
    const pct = total > 0 ? Math.min(Math.round(closed / total * 100), 100) : 0;
    const variant = pct >= 60 ? 'green' : pct >= 30 ? 'yellow' : 'red';
    progPctEl.textContent = closed + ' / ' + total + ' · ' + pct + '%';
    progFillEl.style.width = pct + '%';
    progFillEl.className = 'prog-fill ' + variant;
  }

  // Health bar + pill
  const health = calcHealth(openItems.length, semEst, semResp, bugs);
  const hbarEl = card.querySelector('.health-hbar');
  if (hbarEl) hbarEl.className = 'health-hbar ' + health[1];
  const healthEl = card.querySelector('.card-health');
  if (healthEl) {
    healthEl.className = 'health-pill card-health ' + health[1];
    healthEl.title = health[2];
  }

  // Sem sprint indicator
  const noSprint = openItems.filter(i => !i.iteration.includes('\\')).length;
  const noSprintVal = card.querySelector('.no-sprint-val');
  const issuesEl = card.querySelector('.card-issues');
  if (noSprintVal) noSprintVal.textContent = noSprint;
  if (issuesEl) issuesEl.style.display = noSprint === 0 ? 'none' : '';
}

export function openCardStat(statEl, stat) {
  const card = statEl.closest('.card');
  const allItems = JSON.parse(card.dataset.items);
  const workItemType = card.dataset.workitemtype || 'User Story';
  const ITEM_TYPES = getItemTypes(workItemType);
  const project = card.dataset.project;

  const selected = JSON.parse(localStorage.getItem('filter_' + project) || '[]');
  const filtered = selected.length === 0 ? allItems : allItems.filter(i => selected.includes(i.iteration));

  const mainItems = filtered.filter(i => ITEM_TYPES.includes(i.type));
  const openItems = mainItems.filter(i => !CLOSED_STATES.includes(i.state));

  let title, items, showPts = false, defaultFilters = null;

  if (stat === 'us') {
    title = t(workItemType === 'Task' ? 'stat_tasks' : 'stat_us');
    items = mainItems;
    showPts = true;
  } else if (stat === 'noEst') {
    title = t('stat_no_est');
    items = openItems.filter(i => i.pts == null || i.pts === 0);
    showPts = true;
  } else if (stat === 'noResp') {
    title = t('stat_no_resp');
    items = openItems.filter(i => !i.assigned);
    showPts = true;
  } else if (stat === 'bugs') {
    title = t('stat_bugs');
    items = filtered.filter(i => i.type === 'Bug');
    defaultFilters = [...ACTIVE_BUG_STATES];
  } else if (stat === 'noSprint') {
    title = t('stat_no_sprint');
    items = openItems.filter(i => !i.iteration.includes('\\'));
    showPts = true;
  }

  openItemsModal({ title, items, showPts, defaultFilters });
}

export function toggleUS(btn) {
  const table = btn.closest('.us-section').querySelector('.us-table');
  const icon = btn.querySelector('.us-toggle-icon');
  const isOpen = !table.hidden;
  table.hidden = isOpen;
  icon.textContent = isOpen ? '\u25b6' : '\u25bc';
  btn.classList.toggle('open', !isOpen);
}

export function initFilters() {
  document.querySelectorAll('.card[data-project]').forEach(card => {
    const project = card.dataset.project;
    const saved = localStorage.getItem('filter_' + project);
    if (!saved) return;
    const selected = JSON.parse(saved);
    if (!selected.length) return;

    const customSelect = card.querySelector('.custom-select');
    customSelect.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.checked = selected.includes(cb.value);
    });

    const checked = Array.from(customSelect.querySelectorAll('input[type="checkbox"]:checked'));
    const valueEl = customSelect.querySelector('.select-value');
    if (checked.length === 1) valueEl.textContent = checked[0].closest('.option-row').querySelector('span').textContent;
    else valueEl.textContent = t('sprints_selected', { count: checked.length });

    applyFilter(card, selected);
  });
}

export function initHealthBadges() {
  document.querySelectorAll('.card[data-project]').forEach(card => {
    const allItems = JSON.parse(card.dataset.items);
    const filteredUS = allItems.filter(i => US_TYPES.includes(i.type));
    const openUS = filteredUS.filter(i => !CLOSED_STATES.includes(i.state));
    const semEst = openUS.filter(i => i.pts == null).length;
    const semResp = openUS.filter(i => !i.assigned).length;
    const bugs = allItems.filter(i => i.type === 'Bug' && ACTIVE_BUG_STATES.includes(i.state)).length;
    const health = calcHealth(openUS.length, semEst, semResp, bugs);
    const hbarEl = card.querySelector('.health-hbar');
    if (hbarEl) hbarEl.className = 'health-hbar ' + health[1];
    const healthEl = card.querySelector('.card-health');
    if (healthEl) {
      healthEl.className = 'health-pill card-health ' + health[1];
      healthEl.title = health[2];
    }
  });
}

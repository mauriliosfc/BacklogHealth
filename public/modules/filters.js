import { US_TYPES, CLOSED_STATES, ACTIVE_BUG_STATES } from './constants.js';
import { calcHealth } from './health.js';
import { t } from './i18n.js';

export function toggleDropdown(trigger) {
  const panel = trigger.nextElementSibling;
  const isOpen = panel.classList.contains('open');
  document.querySelectorAll('.select-panel.open').forEach(p => {
    p.classList.remove('open');
    p.previousElementSibling.classList.remove('open');
  });
  if (!isOpen) {
    panel.classList.add('open');
    trigger.classList.add('open');
  }
}

document.addEventListener('click', e => {
  if (!e.target.closest('.custom-select')) {
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

  card.querySelectorAll('tbody tr[data-iteration]').forEach(row => {
    row.style.display = (selected.length === 0 || selected.includes(row.dataset.iteration)) ? '' : 'none';
  });

  card.querySelectorAll('tbody tr.group-header').forEach(header => {
    const group = header.dataset.group;
    const hasVisible = selected.length === 0 || selected.includes(group);
    header.style.display = hasVisible ? '' : 'none';
  });

  const filtered = selected.length === 0 ? allItems : allItems.filter(i => selected.includes(i.iteration));
  const filteredUS = filtered.filter(i => US_TYPES.includes(i.type));
  const total = filteredUS.length;
  const openUS = filteredUS.filter(i => !CLOSED_STATES.includes(i.state));
  const semEst = openUS.filter(i => i.pts == null).length;
  const semResp = openUS.filter(i => !i.assigned).length;
  const bugs = filtered.filter(i => i.type === 'Bug' && ACTIVE_BUG_STATES.includes(i.state)).length;

  card.querySelector('.card-total').textContent = total;

  const semEstEl = card.querySelector('.card-semest');
  semEstEl.textContent = semEst;
  semEstEl.className = 'stat-val card-semest' + (semEst > 2 ? ' warn' : '');

  const semRespEl = card.querySelector('.card-semresp');
  semRespEl.textContent = semResp;
  semRespEl.className = 'stat-val card-semresp' + (semResp > 2 ? ' warn' : '');

  const bugsEl = card.querySelector('.card-bugs');
  bugsEl.textContent = bugs;
  bugsEl.className = 'stat-val card-bugs' + (bugs > 3 ? ' crit' : '');

  const health = calcHealth(total, semEst, semResp, bugs);
  const healthEl = card.querySelector('.card-health');
  healthEl.textContent = health[0];
  healthEl.className = 'badge big card-health ' + health[1];
  healthEl.title = health[2];

  const usCount = filteredUS.length;
  const summaryBtn = card.querySelector('.card-summary');
  summaryBtn.querySelector('.us-toggle-count').textContent = '(' + usCount + ')';
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
    const total = filteredUS.length;
    const openUS = filteredUS.filter(i => !CLOSED_STATES.includes(i.state));
    const semEst = openUS.filter(i => i.pts == null).length;
    const semResp = openUS.filter(i => !i.assigned).length;
    const bugs = allItems.filter(i => i.type === 'Bug' && ACTIVE_BUG_STATES.includes(i.state)).length;
    const health = calcHealth(total, semEst, semResp, bugs);
    const healthEl = card.querySelector('.card-health');
    if (healthEl) {
      healthEl.textContent = health[0];
      healthEl.className = 'badge big card-health ' + health[1];
      healthEl.title = health[2];
    }
  });
}

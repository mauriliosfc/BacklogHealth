import { t } from './i18n.js';

let _abortCtrl = null;
let _activeFilters = new Set();

function _stateClass(s) {
  if (['Active', 'In Progress', 'Doing', 'Committed'].includes(s)) return 'blue';
  if (['Closed', 'Done', 'Resolved'].includes(s)) return 'green';
  if (['Blocked', 'Impediment'].includes(s)) return 'red';
  return 'gray';
}

function _updateFilterSummary() {
  const el = document.getElementById('items-filter-summary');
  if (!el) return;
  if (_activeFilters.size === 0) {
    el.textContent = 'All';
    el.classList.remove('has-filter');
  } else {
    const list = [..._activeFilters];
    el.textContent = list.length <= 2 ? list.join(', ') : list.length + ' selected';
    el.classList.add('has-filter');
  }
}

function _applyFilter() {
  document.querySelectorAll('#items-modal-body .items-modal-table tbody tr').forEach(row => {
    row.style.display = _activeFilters.size === 0 || _activeFilters.has(row.dataset.state) ? '' : 'none';
  });
  document.querySelectorAll('#items-filter-panel input[type="checkbox"]').forEach(cb => {
    cb.checked = _activeFilters.has(cb.dataset.state);
  });
  _updateFilterSummary();
}

function _closeDropdown() {
  const panel = document.getElementById('items-filter-panel');
  const trigger = document.getElementById('items-filter-trigger');
  if (panel) panel.classList.remove('open');
  if (trigger) trigger.classList.remove('open');
}

function _sprintLabel(iteration) {
  if (!iteration) return '—';
  return iteration.includes('\\') ? iteration.split('\\').pop() : iteration;
}

function _renderTable(items, showPts) {
  const ptsHeader = showPts ? '<th>' + t('th_estimate') + '</th>' : '';
  const rows = items.map(item => {
    const idCell = item.url
      ? '<a href="' + item.url.replace(/"/g, '&quot;') + '" target="_blank" rel="noopener">#' + item.id + '</a>'
      : '#' + (item.id || '—');
    const s = item.state || '';
    const sc = _stateClass(s);
    const ptsCell = showPts ? '<td>' + (item.pts != null ? item.pts + ' pts' : '—') + '</td>' : '';
    const assignee = item.assignedTo || (typeof item.assigned === 'string' ? item.assigned : null) || '—';
    const sprint = _sprintLabel(item.iteration);
    return '<tr data-state="' + s.replace(/"/g, '&quot;') + '">'
      + '<td class="daily-id-cell">' + idCell + '</td>'
      + '<td>' + (item.title || '') + '</td>'
      + '<td><span class="badge ' + sc + '">' + s + '</span></td>'
      + '<td class="items-modal-sprint">' + sprint + '</td>'
      + ptsCell
      + '<td>' + assignee + '</td>'
      + '</tr>';
  }).join('');

  return rows
    ? '<div class="items-modal-table-wrap"><table class="items-modal-table">'
      + '<thead><tr><th>ID</th><th>' + t('th_title') + '</th><th>' + t('th_status') + '</th>'
      + '<th>Sprint</th>'
      + ptsHeader + '<th>' + t('th_assignee') + '</th></tr></thead>'
      + '<tbody>' + rows + '</tbody></table></div>'
    : '<div class="items-modal-empty">No items found.</div>';
}

function _renderFilterBar(items, defaultFilters) {
  const filterEl = document.getElementById('items-modal-filters');
  const states = [...new Set(items.map(i => i.state).filter(Boolean))].sort();

  if (!states.length) { filterEl.innerHTML = ''; return; }

  _activeFilters = defaultFilters && defaultFilters.length > 0
    ? new Set(defaultFilters.filter(f => states.includes(f)))
    : new Set();

  const summaryText = _activeFilters.size === 0
    ? 'All'
    : ([..._activeFilters].length <= 2 ? [..._activeFilters].join(', ') : _activeFilters.size + ' selected');

  const options = states.map(s => {
    const checked = _activeFilters.has(s) ? ' checked' : '';
    return '<label class="option-row">'
      + '<input type="checkbox" data-state="' + s.replace(/"/g, '&quot;') + '"' + checked
      + ' onchange="toggleItemsFilter(this.dataset.state)">'
      + '<span class="option-text"><span class="option-name">' + s + '</span></span>'
      + '</label>';
  }).join('');

  filterEl.innerHTML = '<div class="items-filter-bar">'
    + '<span class="items-filter-label">Status</span>'
    + '<div class="items-filter-select" id="items-filter-select">'
      + '<button class="select-trigger" id="items-filter-trigger" type="button" onclick="toggleItemsFilterDropdown()">'
        + '<span id="items-filter-summary"' + (_activeFilters.size > 0 ? ' class="has-filter"' : '') + '>' + summaryText + '</span>'
        + '<span class="select-arrow">&#9662;</span>'
      + '</button>'
      + '<div class="select-panel" id="items-filter-panel">'
        + '<div class="select-options">' + options + '</div>'
        + '<div class="select-footer">'
          + '<button class="select-clear-btn" type="button" onclick="clearItemsFilter()">Clear</button>'
        + '</div>'
      + '</div>'
    + '</div>'
    + '</div>';
}

export function toggleItemsFilterDropdown() {
  const panel = document.getElementById('items-filter-panel');
  const trigger = document.getElementById('items-filter-trigger');
  if (!panel) return;
  const isOpen = panel.classList.toggle('open');
  trigger.classList.toggle('open', isOpen);
  if (isOpen) {
    const rect = trigger.getBoundingClientRect();
    panel.style.top = (rect.bottom + 6) + 'px';
    panel.style.right = (window.innerWidth - rect.right) + 'px';
    panel.style.left = 'auto';
  }
}

export function toggleItemsFilter(state) {
  if (_activeFilters.has(state)) _activeFilters.delete(state);
  else _activeFilters.add(state);
  _applyFilter();
}

export function clearItemsFilter() {
  _activeFilters.clear();
  _applyFilter();
}

export function toggleItemsModalMax() {
  const overlay = document.getElementById('items-modal');
  const btn = document.getElementById('items-modal-max');
  const isMax = overlay.classList.toggle('maximized');
  btn.textContent = isMax ? '\u2921' : '\u2922';
}

export function openItemsModal({ title, items, showPts = false, defaultFilters = null }) {
  document.getElementById('items-modal-title').textContent = title;
  document.getElementById('items-modal-body').innerHTML = _renderTable(items, showPts);
  _renderFilterBar(items, defaultFilters);
  _applyFilter();

  const overlay = document.getElementById('items-modal');
  const maxBtn = document.getElementById('items-modal-max');
  overlay.classList.remove('maximized');
  if (maxBtn) maxBtn.textContent = '\u2922';
  overlay.classList.add('open');

  if (_abortCtrl) _abortCtrl.abort();
  _abortCtrl = new AbortController();
  const { signal } = _abortCtrl;

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeItemsModal();
  }, { signal });

  document.addEventListener('click', e => {
    const select = document.getElementById('items-filter-select');
    if (select && !select.contains(e.target)) _closeDropdown();
  }, { signal });
}

export function closeItemsModal() {
  const overlay = document.getElementById('items-modal');
  overlay.classList.remove('open', 'maximized');
  const maxBtn = document.getElementById('items-modal-max');
  if (maxBtn) maxBtn.textContent = '\u2922';
  if (_abortCtrl) { _abortCtrl.abort(); _abortCtrl = null; }
}

export function closeItemsModalOverlay(event) {
  if (event.target === event.currentTarget) closeItemsModal();
}

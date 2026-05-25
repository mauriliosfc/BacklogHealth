import { t } from './i18n.js';

let _abortCtrl = null;

function _stateClass(s) {
  if (['Active', 'In Progress', 'Doing', 'Committed'].includes(s)) return 'blue';
  if (['Closed', 'Done', 'Resolved'].includes(s)) return 'green';
  if (['Blocked', 'Impediment'].includes(s)) return 'red';
  return 'gray';
}

function _render({ title, items, showPts = false, toggleBtn = null }) {
  document.getElementById('items-modal-title').textContent = title;

  const toggleEl = document.getElementById('items-modal-toggle');
  if (toggleBtn) {
    toggleEl.textContent = toggleBtn.label;
    toggleEl.classList.toggle('active', !!toggleBtn.active);
    toggleEl.style.display = '';
    toggleEl.onclick = toggleBtn.onClick;
  } else {
    toggleEl.style.display = 'none';
  }

  const ptsHeader = showPts ? '<th>' + t('th_estimate') + '</th>' : '';
  const rows = items.map(item => {
    const idCell = item.url
      ? '<a href="' + item.url.replace(/"/g, '&quot;') + '" target="_blank" rel="noopener">#' + item.id + '</a>'
      : '#' + (item.id || '—');
    const sc = _stateClass(item.state || '');
    const ptsCell = showPts ? '<td>' + (item.pts != null ? item.pts + ' pts' : '—') + '</td>' : '';
    return '<tr>'
      + '<td class="daily-id-cell">' + idCell + '</td>'
      + '<td>' + (item.title || '') + '</td>'
      + '<td><span class="badge ' + sc + '">' + (item.state || '') + '</span></td>'
      + ptsCell
      + '<td>' + (item.assignedTo || '—') + '</td>'
      + '</tr>';
  }).join('');

  document.getElementById('items-modal-body').innerHTML = rows
    ? '<div class="items-modal-table-wrap"><table class="items-modal-table">'
      + '<thead><tr><th>ID</th><th>' + t('th_title') + '</th><th>' + t('th_status') + '</th>'
      + ptsHeader + '<th>' + t('th_assignee') + '</th></tr></thead>'
      + '<tbody>' + rows + '</tbody></table></div>'
    : '<div class="items-modal-empty">No items found.</div>';
}

export function openItemsModal(opts) {
  _render(opts);
  document.getElementById('items-modal').classList.add('open');

  if (_abortCtrl) _abortCtrl.abort();
  _abortCtrl = new AbortController();
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeItemsModal();
  }, { signal: _abortCtrl.signal });
}

export function closeItemsModal() {
  document.getElementById('items-modal').classList.remove('open');
  if (_abortCtrl) { _abortCtrl.abort(); _abortCtrl = null; }
}

export function closeItemsModalOverlay(event) {
  if (event.target === event.currentTarget) closeItemsModal();
}

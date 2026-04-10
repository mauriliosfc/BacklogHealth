const STORAGE_KEY = 'cardOrder';
let _dragSrc  = null;
let _fromHandle = false;

function saveOrder() {
  const order = Array.from(
    document.querySelectorAll('#content .card[data-project]')
  ).map(c => c.dataset.project);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(order));
}

export function applyOrder() {
  const content = document.getElementById('content');
  if (!content) return;
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    if (!saved.length) return;
    const cards = Array.from(content.querySelectorAll('.card[data-project]'));
    if (cards.length < 2) return;
    cards.sort((a, b) => {
      const ai = saved.indexOf(a.dataset.project);
      const bi = saved.indexOf(b.dataset.project);
      if (ai === -1 && bi === -1) return 0;
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
    cards.forEach(c => content.appendChild(c));
    // Keep the empty "add project" card always last
    const emptyCard = content.querySelector('.card-empty');
    if (emptyCard) content.appendChild(emptyCard);
  } catch (_) {}
}

// Uses event delegation on #content — survives innerHTML refresh, call only once.
export function initDragOrder() {
  const content = document.getElementById('content');
  if (!content) return;

  // Track whether the drag originates from a handle
  content.addEventListener('mousedown', e => {
    _fromHandle = !!e.target.closest('.drag-handle');
    if (_fromHandle) {
      const card = e.target.closest('.card[data-project]');
      if (card) card.draggable = true;
    }
  });

  content.addEventListener('dragstart', e => {
    if (!_fromHandle) { e.preventDefault(); return; }
    _dragSrc = e.target.closest('.card[data-project]');
    if (!_dragSrc) return;
    _dragSrc.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', _dragSrc.dataset.project);
  });

  content.addEventListener('dragover', e => {
    e.preventDefault();
    if (!_dragSrc) return;
    const target = e.target.closest('.card[data-project]');
    if (!target || target === _dragSrc) return;
    const rect = target.getBoundingClientRect();
    if (e.clientY < rect.top + rect.height / 2) {
      content.insertBefore(_dragSrc, target);
    } else {
      target.after(_dragSrc);
    }
  });

  content.addEventListener('dragend', () => {
    if (_dragSrc) {
      _dragSrc.classList.remove('dragging');
      _dragSrc.draggable = false;
    }
    _dragSrc   = null;
    _fromHandle = false;
    // Keep the empty card always last after any reorder
    const emptyCard = content.querySelector('.card-empty');
    if (emptyCard) content.appendChild(emptyCard);
    saveOrder();
  });
}

const STORAGE_KEY = 'cardOrder';
const CARD_SEL    = '.card[data-project], .sn-inc-card[data-project]';
let _dragSrc  = null;
let _fromIcon = false;

function saveOrder() {
  const order = Array.from(
    document.querySelectorAll(`#content ${CARD_SEL}`)
  ).map(c => c.dataset.project);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(order));
}

export function applyOrder() {
  const content = document.getElementById('content');
  if (!content) return;
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    if (!saved.length) return;
    const cards = Array.from(content.querySelectorAll(CARD_SEL));
    if (cards.length < 2) return;
    const parent = cards[0].parentElement; // #content for DevOps, .sn-inc-cards for SN
    cards.sort((a, b) => {
      const ai = saved.indexOf(a.dataset.project);
      const bi = saved.indexOf(b.dataset.project);
      if (ai === -1 && bi === -1) return 0;
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
    cards.forEach(c => parent.appendChild(c));
    // Keep the empty "add project" card always last
    const emptyCard = content.querySelector('.card-empty');
    if (emptyCard) content.appendChild(emptyCard);
  } catch (_) {}
}

// Uses event delegation on #content — survives innerHTML refresh, call only once.
export function initDragOrder() {
  const content = document.getElementById('content');
  if (!content) return;

  // Enable draggable while cursor is over the project icon
  content.addEventListener('mouseover', e => {
    if (_dragSrc) return; // don't interfere with an active drag
    const icon = e.target.closest('.card-icon');
    if (!icon) return;
    _fromIcon = true;
    const card = icon.closest(CARD_SEL);
    if (card) card.draggable = true;
  });

  // Disable draggable when cursor leaves the project icon
  content.addEventListener('mouseout', e => {
    const icon = e.target.closest('.card-icon');
    if (!icon) return;
    if (icon.contains(e.relatedTarget)) return; // moved to a child — still inside
    _fromIcon = false;
    if (_dragSrc) return; // don't reset during active drag
    const card = icon.closest(CARD_SEL);
    if (card) card.draggable = false;
  });

  content.addEventListener('dragstart', e => {
    if (!_fromIcon) { e.preventDefault(); return; }
    _dragSrc = e.target.closest(CARD_SEL);
    if (!_dragSrc) { e.preventDefault(); return; }
    _dragSrc.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', _dragSrc.dataset.project);
  });

  content.addEventListener('dragover', e => {
    e.preventDefault();
    if (!_dragSrc) return;
    const target = e.target.closest(CARD_SEL);
    if (!target || target === _dragSrc) return;
    const rect = target.getBoundingClientRect();
    if (e.clientY < rect.top + rect.height / 2) {
      target.parentElement.insertBefore(_dragSrc, target);
    } else {
      target.after(_dragSrc);
    }
  });

  content.addEventListener('dragend', () => {
    if (_dragSrc) {
      _dragSrc.classList.remove('dragging');
      _dragSrc.draggable = false;
    }
    _dragSrc  = null;
    _fromIcon = false;
    // Keep the empty card always last after any reorder
    const emptyCard = content.querySelector('.card-empty');
    if (emptyCard) content.appendChild(emptyCard);
    saveOrder();
  });
}

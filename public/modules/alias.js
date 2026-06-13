const STORAGE_KEY = 'projectAliases';

const ICON_COLORS = ['#6366f1','#8b5cf6','#ec4899','#f43f5e','#f97316','#eab308','#22c55e','#14b8a6','#06b6d4','#3b82f6'];

function _iconColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  return ICON_COLORS[h % ICON_COLORS.length];
}

function _initials(name) {
  const base = name.includes(' - ') ? name.split(' - ')[0] : name;
  return base.split(/[\s_\-]+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('').slice(0, 2) || '??';
}

function _updateIcon(card, displayName) {
  const icon = card.querySelector('.card-icon');
  if (!icon) return;
  icon.textContent = _initials(displayName);
  icon.style.background = _iconColor(displayName);
}

function _load() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch(_) { return {}; }
}

export function getAlias(projectName) {
  return _load()[projectName] || projectName;
}

export function setAlias(projectName, alias) {
  const aliases = _load();
  const trimmed = (alias || '').trim();
  if (trimmed && trimmed !== projectName) {
    aliases[projectName] = trimmed;
  } else {
    delete aliases[projectName];
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(aliases));
}

export function applyAliases() {
  const sel = '#content .card[data-project], #content .sn-inc-card[data-project]';
  document.querySelectorAll(sel).forEach(card => {
    const name  = card.dataset.project;
    const alias = getAlias(name);
    const titleEl = card.querySelector('.card-project-title');
    if (titleEl) titleEl.textContent = alias;
    // SN cards use priority-based avatar colors — don't override them
    if (!card.classList.contains('sn-inc-card')) {
      _updateIcon(card, alias);
    }
  });
}

export function startRename(btn) {
  const card = btn.closest('.card, .sn-inc-card');
  if (!card) return;
  const projectName = card.dataset.project;
  const titleEl = card.querySelector('.card-project-title');
  if (!titleEl) return;

  const currentAlias = getAlias(projectName);
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'rename-input';
  input.value = currentAlias !== projectName ? currentAlias : '';
  input.placeholder = projectName;

  titleEl.hidden = true;
  btn.hidden = true;
  titleEl.parentElement.insertBefore(input, titleEl);
  input.focus();

  let done = false;

  function commit() {
    if (done) return;
    done = true;
    const val = input.value.trim();
    setAlias(projectName, val || projectName);
    const newAlias = getAlias(projectName);
    titleEl.textContent = newAlias;
    if (!card.classList.contains('sn-inc-card')) {
      _updateIcon(card, newAlias);
    }
    titleEl.hidden = false;
    btn.hidden = false;
    input.remove();
  }

  function cancel() {
    if (done) return;
    done = true;
    titleEl.hidden = false;
    btn.hidden = false;
    input.remove();
  }

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  });
  input.addEventListener('blur', commit);
}

const STORAGE_KEY = 'projectAliases';

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
  document.querySelectorAll('#content .card[data-project]').forEach(card => {
    const name = card.dataset.project;
    const h2 = card.querySelector('h2.card-project-title');
    if (h2) h2.textContent = getAlias(name);
  });
}

export function startRename(btn) {
  const card = btn.closest('.card');
  const projectName = card.dataset.project;
  const h2 = card.querySelector('h2.card-project-title');
  if (!h2) return;

  const currentAlias = getAlias(projectName);
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'rename-input';
  input.value = currentAlias !== projectName ? currentAlias : '';
  input.placeholder = projectName;

  h2.hidden = true;
  btn.hidden = true;
  h2.parentElement.insertBefore(input, h2);
  input.focus();

  let done = false;

  function commit() {
    if (done) return;
    done = true;
    const val = input.value.trim();
    setAlias(projectName, val || projectName);
    h2.textContent = getAlias(projectName);
    h2.hidden = false;
    btn.hidden = false;
    input.remove();
  }

  function cancel() {
    if (done) return;
    done = true;
    h2.hidden = false;
    btn.hidden = false;
    input.remove();
  }

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  });
  input.addEventListener('blur', commit);
}

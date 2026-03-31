export function setTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem('theme', t);
  const btn = document.getElementById('btnTheme');
  if (btn) { btn.textContent = t === 'dark' ? '\u2600\uFE0F' : '\uD83C\uDF19'; btn.title = t === 'dark' ? 'Tema claro' : 'Tema escuro'; }
}

export function toggleTheme() {
  setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
}

const LOCALES = { pt: 'pt-BR', en: 'en-US', es: 'es-ES' };

let _locale = 'en';
let _messages = {};

export async function initI18n() {
  _locale = localStorage.getItem('lang') || 'en';
  if (!LOCALES[_locale]) _locale = 'en';
  const resp = await fetch('/i18n/' + _locale + '.json');
  _messages = await resp.json();
}

export function t(key, vars = {}) {
  let msg = _messages[key];
  if (msg === undefined) return key;
  Object.entries(vars).forEach(([k, v]) => {
    msg = msg.split('{{' + k + '}}').join(String(v));
  });
  return msg;
}

export function setLocale(locale) {
  localStorage.setItem('lang', locale);
  localStorage.setItem('activeView', document.getElementById('tc-view')?.style.display === 'block' ? 'tc' : 'dashboard');
  location.reload();
}

export function getLocale() { return _locale; }

export function getDateLocale() { return LOCALES[_locale] || 'pt-BR'; }

export function applyTranslations(root = document) {
  root.querySelectorAll('[data-i18n]').forEach(el => {
    const val = _messages[el.dataset.i18n];
    if (val !== undefined) el.textContent = val;
  });
  root.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const val = _messages[el.dataset.i18nPlaceholder];
    if (val !== undefined) el.placeholder = val;
  });
  root.querySelectorAll('[data-i18n-title]').forEach(el => {
    const val = _messages[el.dataset.i18nTitle];
    if (val !== undefined) el.title = val;
  });
}

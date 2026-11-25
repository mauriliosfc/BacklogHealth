// Preferências da janela de carregamento (idioma e tema), lidas antes do servidor subir.
// O idioma e o tema do app ficam no localStorage do renderer; o renderer os avisa por IPC
// e o processo principal grava aqui para a próxima abertura. Sem require('electron'): testável.
const fs   = require('fs');
const path = require('path');

const LANGS    = ['pt', 'en', 'es'];
const I18N_DIR = path.join(__dirname, '..', 'public', 'i18n');
const FALLBACK_TEXT = 'Loading Azure DevOps projects…';

// Idioma salvo pelo app; senão o do Windows (pt-BR → pt); senão inglês (padrão do app)
function resolveLang(saved, osLocale) {
  if (LANGS.includes(saved)) return saved;
  const prefix = String(osLocale || '').toLowerCase().split(/[-_]/)[0];
  return LANGS.includes(prefix) ? prefix : 'en';
}

function resolveTheme(saved, osDark) {
  if (saved === 'dark' || saved === 'light') return saved;
  return osDark ? 'dark' : 'light';
}

function _readMessages(lang, dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, `${lang}.json`), 'utf8')); }
  catch (_) { return {}; }
}

function splashText(lang, dir = I18N_DIR) {
  const own = _readMessages(LANGS.includes(lang) ? lang : 'en', dir).splash_loading;
  if (own) return own;
  return _readMessages('en', dir).splash_loading || FALLBACK_TEXT;
}

function readPrefs(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch (_) {
    return {};
  }
}

// Mescla com o que já está salvo; só grava valores conhecidos
function writePrefs(file, patch) {
  const next = { ...readPrefs(file) };
  if (LANGS.includes(patch?.lang)) next.lang = patch.lang;
  if (patch?.theme === 'dark' || patch?.theme === 'light') next.theme = patch.theme;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(next));
  } catch (_) { /* preferência perdida não impede o app de abrir */ }
  return next;
}

module.exports = { LANGS, resolveLang, resolveTheme, splashText, readPrefs, writePrefs };

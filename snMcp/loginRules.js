// Regras puras do login SSO do Service Now: páginas de login/MFA pela URL e tratamento de cookies.
//
// Portado de mfa-servicenow-mcp (versão de referência em snMcp/upstream.json). Cada função cita
// a origem; o mapa completo caso → função → teste está em docs/sn-sso-upstream.md.
// Ao atualizar a referência, compare primeiro estes trechos (npm run check:sn-upstream).

// Origem: auth/_url_predicates.py · _is_login_page_url
// Falso negativo aqui = declarar login concluído com o usuário ainda digitando o código do MFA.
const LOGIN_PATH_MARKERS = [
  '/login.do', '/login_redirect.do', '/auth_redirect.do', '/external_logout_complete.do',
  '/multi_factor_auth_view.do', '/multi_factor_auth_setup.do', '/validate_multifactor_auth_code.do',
  '/external_login_complete.do', '/sys_auth_info.do', '/mfa.do', '/mfa_setup.do',
];
// Variantes genéricas de versões/instâncias que ainda não vimos ('/login_' cobre login_redirect.do,
// login_locate_sso.do e futuras login_*; 'multifactor' e 'mfa_' são estreitos o bastante).
const LOGIN_PATH_SUBSTRINGS = ['multifactor', '/mfa_', '/mfa/', '/login_'];
const LOGIN_QUERY_MARKERS   = ['sysparm_type=login', 'sysparm_reauth=true', 'sysparm_mfa_needed=true', 'sysparm_direct=true'];

// Origem: auth/_url_predicates.py · _is_mfa_challenge_url
// Mais estreito que isLoginPageUrl: o /login.do comum aparece de passagem num login que vai dar certo.
const MFA_PATH_MARKERS = [
  '/validate_multifactor_auth_code.do', '/multi_factor_auth_view.do', '/multi_factor_auth_setup.do', '/mfa.do', '/mfa_setup.do',
];

// Origem: auth/_response_predicates.py · _STALE_PROFILE_COOKIE_NAMES
// Cookies de sessão que um perfil reaproveitado pode trazer de uma sessão já morta no servidor; se
// chegarem ao novo login, o ServiceNow trata como logout e manda tudo para /logout_success.do.
const STALE_SESSION_COOKIES = [
  'glide_session_store', 'JSESSIONID', 'glide_user', 'glide_user_route', 'glide_user_activity',
  'glide_node_id_for_js', 'factor', 'UX-Token', '__CJ_g_startTime',
];

const MICROSOFT_LOGIN_HOSTS = ['login.microsoftonline.com', 'login.microsoft.com', 'login.live.com'];

function normalizeHost(v) {
  return String(v || '').trim().replace(/^https?:\/\//i, '').replace(/[/?#].*$/, '').toLowerCase();
}

function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch (_) { return ''; }
}

function _parts(url) {
  try {
    const u = new URL(url);
    return { path: u.pathname.toLowerCase(), query: u.search.toLowerCase() };
  } catch (_) {
    return null;
  }
}

function isLoginPageUrl(url) {
  const p = _parts(url);
  if (!p) return false;
  return LOGIN_PATH_MARKERS.some(m => p.path.includes(m))
    || LOGIN_PATH_SUBSTRINGS.some(s => p.path.includes(s))
    || LOGIN_QUERY_MARKERS.some(q => p.query.includes(q))
    || p.path === '/login' || p.path === '/auth';
}

function isMfaChallengeUrl(url) {
  const p = _parts(url);
  if (!p) return false;
  return MFA_PATH_MARKERS.some(m => p.path.includes(m)) || p.path.includes('multifactor');
}

// Página de erro de rede do Chromium/Edge (ERR_TIMED_OUT etc.) — comum no caminho até a Microsoft
// na rede corporativa. Achado do spike de 2026-11-19 (não existe no original).
function isNetworkErrorUrl(url) {
  return /^chrome-error:/i.test(String(url || ''));
}

function isMicrosoftLoginHost(host) {
  return MICROSOFT_LOGIN_HOSTS.includes(String(host || '').toLowerCase());
}

// Origem: auth/_url_predicates.py · _visible_window_mid_auth
// Ainda autenticando: página de login/MFA do ServiceNow ou janela parada num host externo (IdP).
// about:blank / host vazio NÃO conta, para não segurar o laço à toa.
function isMidAuth(url, instanceHost) {
  if (isLoginPageUrl(url)) return true;
  const h = hostOf(url);
  return !!h && h !== normalizeHost(instanceHost);
}

// Login concluído: de volta ao host da instância, fora das páginas de login.
function isLoggedInUrl(url, instanceHost) {
  return hostOf(url) === normalizeHost(instanceHost) && !isLoginPageUrl(url);
}

// Cookies do navegador que valem para a instância (domínio exato ou domínio-pai com ponto).
function selectInstanceCookies(cookies, instanceHost) {
  const host = normalizeHost(instanceHost);
  return (cookies || []).filter(c => {
    const d = String(c.domain || '').replace(/^\./, '').toLowerCase();
    return !!d && (host === d || host.endsWith('.' + d));
  });
}

function buildCookieHeader(cookies) {
  return (cookies || []).filter(c => c && c.name).map(c => `${c.name}=${c.value}`).join('; ');
}

function cookieHeaderToMap(header) {
  const map = new Map();
  String(header || '').split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i <= 0) return;
    map.set(part.slice(0, i).trim(), part.slice(i + 1).trim());
  });
  return map;
}

function mapToCookieHeader(map) {
  return [...map.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

// Origem: auth/auth_manager.py · comentário v1.12.0 em _login_with_browser_sync
// Sem JSESSIONID e BIGipServer*, chamadas paralelas caem em backends do balanceador onde a sessão
// não existe e voltam 401 em onda. Retorna os nomes que faltam ([] = cookie jar completo).
function missingRequiredCookies(cookies) {
  const names = (cookies || []).map(c => c.name);
  const missing = [];
  if (!names.includes('JSESSIONID')) missing.push('JSESSIONID');
  if (!names.some(n => /^BIGipServer/i.test(n))) missing.push('BIGipServer*');
  return missing;
}

// Origem: auth/_response_predicates.py · _extract_bigip_routing_hint
// O F5 BIG-IP responde com Set-Cookie BIGipServerpool_* apontando o backend que tem a sessão.
// Valor vazio = revogação, não é dica de rota.
function bigipHintFrom(setCookie) {
  const list = Array.isArray(setCookie) ? setCookie : (setCookie ? [setCookie] : []);
  for (const raw of list) {
    const first = String(raw).split(';')[0];
    const i = first.indexOf('=');
    if (i <= 0) continue;
    const name = first.slice(0, i).trim();
    const value = first.slice(i + 1).trim();
    if (!name.startsWith('BIGipServerpool') || !value) continue;
    return { name, value };
  }
  return null;
}

// Origem: auth/auth_manager.py · _absorb_response_bigip_rotation
// Troca o valor do cookie do balanceador no header; null quando não há dica nova.
function absorbBigipRotation(cookieHeader, setCookie) {
  const hint = bigipHintFrom(setCookie);
  if (!hint || !cookieHeader) return null;
  const map = cookieHeaderToMap(cookieHeader);
  if (map.get(hint.name) === hint.value) return null;   // mesmo backend: não é redirecionamento
  map.set(hint.name, hint.value);
  return mapToCookieHeader(map);
}

module.exports = {
  STALE_SESSION_COOKIES,
  normalizeHost, hostOf,
  isLoginPageUrl, isMfaChallengeUrl, isNetworkErrorUrl, isMicrosoftLoginHost, isMidAuth, isLoggedInUrl,
  selectInstanceCookies, buildCookieHeader, cookieHeaderToMap, missingRequiredCookies,
  bigipHintFrom, absorbBigipRotation,
};

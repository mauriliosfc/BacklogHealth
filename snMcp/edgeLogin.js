// Login SSO/MFA do Service Now no Microsoft Edge, controlado pelo CDP por pipe (snMcp/cdpPipe.js).
//
// Fluxo: abre o Edge com o perfil dedicado da instância → limpa cookies de sessão antigos → página
// de SSO (login_locate_sso.do) com o ID preenchido → Microsoft (escolhe a conta do ID quando há
// várias) → volta à instância → captura cookies, g_ck e User-Agent → fecha o Edge.
// headless=true tenta sem janela e desiste rápido (SN_LOGIN_NEEDS_INTERACTION) quando o login
// exige uma pessoa (MFA, senha, conta não encontrada); quem chama abre então a janela visível.
//
// Casos portados do mfa-servicenow-mcp estão marcados com "Origem:"; o mapa completo fica em
// docs/sn-sso-upstream.md.

const fs       = require('fs');
const nodePath = require('path');
const { launchEdge: defaultLaunch, findEdge, killProfileProcesses } = require('./cdpPipe');
const rules = require('./loginRules');

const POLL_MS              = 1000;
const STABLE_TICKS         = 2;       // Origem: auth_manager.py · stable_instance_ticks
const GCK_ATTEMPTS         = 8;       // Origem: auth_manager.py · GCK_CAPTURE_MAX_ATTEMPTS
const GCK_INTERVAL_MS      = 1000;    // Origem: auth_manager.py · GCK_CAPTURE_INTERVAL_SECONDS
const COOKIE_READS         = 3;
const NETWORK_RETRIES      = 3;
const HEADLESS_TIMEOUT_MS  = 60 * 1000;
const VISIBLE_TIMEOUT_MS   = 5 * 60 * 1000;
const INTERACTION_TICKS    = 4;       // sem janela: ticks seguidos numa tela que pede uma pessoa
const PROFILE_BUSY_ATTEMPTS = 3;

const SSO_LOCATOR_PATH = '/login_locate_sso.do';   // Origem: utils/instances.py · SSO_LOCATOR_PATH

function _err(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

// Origem: auth_manager.py · _get_instance_user_suffix (modo sem profile_label).
// Mesmo nome do MCP: a migração reaproveita perfil e sessão já existentes, sem novo MFA.
function sessionSuffix(instance, username) {
  const host = rules.normalizeHost(instance) || 'default';
  const id   = host.replace(/\./g, '_');
  const user = String(username || '').trim();
  return user ? `${id}_${user.replace(/@/g, '_at_').replace(/\./g, '_')}` : id;
}

function sessionPaths(root, instance, username) {
  const dir    = nodePath.join(root, 'session-edge');
  const suffix = sessionSuffix(instance, username);
  return {
    dir,
    profile: nodePath.join(dir, `profile_${suffix}`),
    file:    nodePath.join(dir, `session_${suffix}.json`),
  };
}

function startUrlFor({ instance, loginUrl }) {
  const custom = String(loginUrl || '').trim();
  if (custom) return custom;
  return `https://${rules.normalizeHost(instance)}${SSO_LOCATOR_PATH}`;
}

// Grava a sessão no mesmo formato do MCP (lido por snMcp/sessionStore.js), com escrita atômica.
function writeSessionFile(file, data, { fsImpl = fs, now = () => Date.now() } = {}) {
  const t = now() / 1000;
  const payload = {
    cookie_header:     data.cookieHeader,
    user_agent:        data.userAgent || '',
    session_token:     data.sessionToken || '',
    expires_at:        null,
    instance_url:      `https://${rules.normalizeHost(data.instance)}`,
    last_validated_at: t,
    last_login_at:     t,
    source:            'backlog-health',
  };
  fsImpl.mkdirSync(nodePath.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fsImpl.writeFileSync(tmp, JSON.stringify(payload), 'utf8');
  fsImpl.renameSync(tmp, file);
  return payload;
}

// --- scripts executados na página ---------------------------------------------------------------

const JS_HREF = 'location.href';

// Página de SSO: preenche o ID e envia. Só depois de a página terminar de carregar — antes disso o
// ServiceNow manda para o login.do comum (achado do spike de 2026-11-19).
// Origem dos seletores: browser/login.py · SSO_USER_FIELD, SSO_SUBMIT_SELECTORS
function jsFillSsoLocator(userId) {
  return `(() => {
    if (document.readyState !== 'complete') return false;
    const f = document.querySelector('input#sso_selector_id');
    if (!f) return false;
    f.value = ${JSON.stringify(userId)};
    f.dispatchEvent(new Event('input', { bubbles: true }));
    const b = document.querySelector("button[onclick*='locateSSO'], button[type='submit'], input[type='submit']");
    if (b) b.click(); else if (typeof window.locateSSO === 'function') window.locateSSO();
    return true;
  })()`;
}

// Seletor de contas da Microsoft: coordenadas do bloco da conta cujo texto contém o ID.
// O clique precisa ser de mouse (Input.dispatchMouseEvent): element.click() não dispara a ação.
function jsFindAccountTile(userId) {
  return `(() => {
    if (document.readyState !== 'complete') return '';
    const id = ${JSON.stringify(String(userId).toLowerCase())};
    const tiles = [...document.querySelectorAll('[role="button"], [role="listitem"], .table, .tile')]
      .filter(e => e.offsetParent !== null && (e.innerText || '').toLowerCase().includes(id));
    const t = tiles.sort((a, b) => a.innerText.length - b.innerText.length)[0];
    if (!t || t.dataset.bhPicked) return '';
    t.dataset.bhPicked = '1';
    const r = t.getBoundingClientRect();
    return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
  })()`;
}

// A tela pede uma pessoa? Devolve o seletor encontrado ('' = não) para o log de diagnóstico.
const JS_NEEDS_PERSON = `(() => {
  const vis = s => [...document.querySelectorAll(s)].some(e => e.offsetParent !== null);
  const sels = ['input[type="password"]', 'input[type="email"]', 'input[name="otc"]', 'input[autocomplete="one-time-code"]'];
  return sels.find(vis) || '';
})()`;

// Origem: auth_manager.py · captura do g_ck (janela principal e iframes, ex.: gsft_main)
const JS_GCK = `(() => {
  if (typeof window.g_ck === 'string' && window.g_ck.trim()) return window.g_ck.trim();
  for (const f of document.querySelectorAll('iframe')) {
    try { const v = f.contentWindow && f.contentWindow.g_ck; if (typeof v === 'string' && v.trim()) return v.trim(); } catch (_) {}
  }
  return '';
})()`;

// --- fluxo --------------------------------------------------------------------------------------

async function runLogin({
  instance,
  username = '',
  loginUrl = '',
  headless = false,
  userDataDir,
  timeoutMs,
  exe,
  signal = null,            // { aborted } — o gerenciador cancela ao sair/fechar o app
  launch = defaultLaunch,
  findEdgeImpl = findEdge,
  killProfileImpl = killProfileProcesses,
  sleep = ms => new Promise(r => setTimeout(r, ms)),
  now = () => Date.now(),
  log = () => {},
} = {}) {
  const host = rules.normalizeHost(instance);
  if (!host) throw _err('SN_LOGIN_CONFIG', 'Service Now instance not configured.');
  const userId = String(username || '').trim();
  if (headless && !userId && !loginUrl) throw _err('SN_LOGIN_NEEDS_INTERACTION', 'No user ID to sign in without a window.');

  const edgeExe = exe || findEdgeImpl();
  if (!edgeExe) throw _err('SN_EDGE_NOT_FOUND', 'Microsoft Edge was not found on this computer.');

  const budget   = timeoutMs || (headless ? HEADLESS_TIMEOUT_MS : VISIBLE_TIMEOUT_MS);
  const startUrl = startUrlFor({ instance: host, loginUrl });
  const t0 = now();

  // Edge que sai logo ao abrir = perfil preso por outro processo (sobra de sessão anterior ou do
  // MCP antigo). Fecha os processos desse perfil e tenta de novo (achado do teste de 2026-11-23).
  let browser, sessionId;
  for (let attempt = 1; ; attempt++) {
    browser = launch({ exe: edgeExe, userDataDir, headless, url: 'about:blank' });
    try {
      sessionId = await _attachToPage(browser.cdp, sleep);
      break;
    } catch (e) {
      await browser.close().catch(() => {});
      if (e.code !== 'CDP_CLOSED' || attempt >= PROFILE_BUSY_ATTEMPTS) {
        if (e.code === 'CDP_CLOSED') throw _err('SN_LOGIN_PROFILE_BUSY', 'The login profile is in use by another Edge process.');
        throw e;
      }
      const killed = await killProfileImpl(userDataDir);
      log(`edge exited at start (profile busy): closed ${killed} leftover process(es), retrying`);
      await sleep(1500);
    }
  }
  const { cdp } = browser;

  try {
    const evaluate = async expr => {
      try {
        const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true }, sessionId, { timeoutMs: 10000 });
        return r.result ? r.result.value : undefined;
      } catch (e) {
        if (e.code === 'CDP_CLOSED') throw e;
        return undefined;   // navegação em andamento destrói o contexto: tenta no próximo tick
      }
    };

    // Origem: auth_manager.py · _purge_stale_profile_cookies (antes do login.do)
    const purged = await _purgeStaleCookies(cdp, sessionId, host);
    if (purged.length) log(`purged stale cookies: ${purged.join(', ')}`);

    await cdp.send('Page.navigate', { url: startUrl }, sessionId);
    log(`login start (${headless ? 'headless' : 'window'}) ${startUrl}`);

    let filled = false, stable = 0, url = '', lastUrl = '', networkRetries = 0, personTicks = 0;
    for (;;) {
      if (signal && signal.aborted) throw _err('SN_LOGIN_ABORTED', 'Sign-in stopped.');
      if (browser.hasExited()) throw _err('SN_LOGIN_CANCELLED', 'The login window was closed before finishing.');
      if (now() - t0 > budget) {
        throw _err(headless ? 'SN_LOGIN_NEEDS_INTERACTION' : 'SN_LOGIN_TIMEOUT',
          headless ? 'Sign-in needs you (no silent login).' : 'The sign-in was not completed in time.');
      }
      url = (await evaluate(JS_HREF)) || url;
      if (url !== lastUrl) { log(`url ${_short(url)}`); lastUrl = url; stable = 0; personTicks = 0; }
      const urlHost = rules.hostOf(url);

      if (rules.isNetworkErrorUrl(url)) {
        if (++networkRetries > NETWORK_RETRIES) throw _err('SN_LOGIN_NETWORK', 'Could not reach the sign-in page (network).');
        log(`network error page, retry ${networkRetries}/${NETWORK_RETRIES}`);
        filled = false;
        await cdp.send('Page.navigate', { url: startUrl }, sessionId).catch(() => {});
        await sleep(2000);
        continue;
      }

      if (urlHost === host && url.toLowerCase().includes(SSO_LOCATOR_PATH) && !filled && userId) {
        if (await evaluate(jsFillSsoLocator(userId))) { filled = true; log('sso id submitted'); }
      }

      if (rules.isMicrosoftLoginHost(urlHost) && userId) {
        const tile = await evaluate(jsFindAccountTile(userId));
        if (tile) {
          const { x, y } = JSON.parse(tile);
          for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
            await cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }, sessionId).catch(() => {});
          }
          log('microsoft account picked');
        }
      }

      if (headless) {
        // Origem: auth_manager.py · headless-first com detecção rápida da página de MFA
        if (rules.isMfaChallengeUrl(url)) throw _err('SN_LOGIN_NEEDS_INTERACTION', 'MFA challenge needs you.');
        const needs = rules.isMidAuth(url, host) ? await evaluate(JS_NEEDS_PERSON) : '';
        if (needs) {
          if (personTicks === 0) log(`page asks for input (${needs}) at ${_short(url)}`);
          if (++personTicks >= INTERACTION_TICKS) throw _err('SN_LOGIN_NEEDS_INTERACTION', `Sign-in page needs you (${needs}).`);
        } else {
          personTicks = 0;
        }
      }

      if (rules.isLoggedInUrl(url, host)) {
        if (++stable >= STABLE_TICKS) break;
      } else {
        stable = 0;
      }
      await sleep(POLL_MS);
    }
    log(`login reached instance in ${now() - t0}ms`);

    let sessionToken = '';
    for (let i = 0; i < GCK_ATTEMPTS && !sessionToken; i++) {
      sessionToken = (await evaluate(JS_GCK)) || '';
      if (!sessionToken) await sleep(GCK_INTERVAL_MS);
    }
    if (!sessionToken) log('warning: no g_ck captured (X-UserToken missing)');

    let cookies = [];
    for (let i = 0; i < COOKIE_READS; i++) {
      const all = (await cdp.send('Storage.getCookies')).cookies || [];
      cookies = rules.selectInstanceCookies(all, host);
      if (!rules.missingRequiredCookies(cookies).length) break;
      await sleep(1000);
    }
    const missing = rules.missingRequiredCookies(cookies);
    if (missing.length) log(`warning: missing cookies ${missing.join(', ')}`);
    if (!cookies.length) throw _err('SN_LOGIN_NO_COOKIES', 'Sign-in finished but no Service Now cookies were found.');

    const userAgent = (await evaluate('navigator.userAgent')) || '';
    return {
      instance: host,
      cookieHeader: rules.buildCookieHeader(cookies),
      cookieNames: cookies.map(c => c.name),
      sessionToken,
      userAgent,
      finalUrl: url,
      missing,
      elapsedMs: now() - t0,
    };
  } catch (e) {
    // Janela fechada pelo usuário no meio do login: o pipe fecha e os comandos falham com CDP_CLOSED
    if (e.code === 'CDP_CLOSED') {
      if (signal && signal.aborted) throw _err('SN_LOGIN_ABORTED', 'Sign-in stopped.');
      throw _err('SN_LOGIN_CANCELLED', 'The login window was closed before finishing.');
    }
    throw e;
  } finally {
    await browser.close().catch(() => {});
  }
}

async function _attachToPage(cdp, sleep) {
  for (let i = 0; i < 50; i++) {
    const { targetInfos = [] } = await cdp.send('Target.getTargets');
    const page = targetInfos.find(t => t.type === 'page');
    if (page) {
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
      return sessionId;
    }
    await sleep(100);
  }
  throw _err('SN_LOGIN_NO_PAGE', 'Edge did not open a page.');
}

async function _purgeStaleCookies(cdp, sessionId, host) {
  let all = [];
  try { all = (await cdp.send('Storage.getCookies')).cookies || []; } catch (_) { return []; }
  const stale = rules.selectInstanceCookies(all, host).filter(c => rules.STALE_SESSION_COOKIES.includes(c.name));
  for (const c of stale) {
    await cdp.send('Network.deleteCookies', { name: c.name, domain: c.domain, path: c.path || '/' }, sessionId).catch(() => {});
  }
  return stale.map(c => c.name);
}

function _short(url) {
  const s = String(url || '');
  const q = s.indexOf('?');
  return q >= 0 ? s.slice(0, q) + '?…' : s;
}

module.exports = {
  runLogin, sessionPaths, sessionSuffix, startUrlFor, writeSessionFile,
  jsFillSsoLocator, jsFindAccountTile, JS_GCK, JS_NEEDS_PERSON,
  SSO_LOCATOR_PATH, HEADLESS_TIMEOUT_MS, VISIBLE_TIMEOUT_MS,
};

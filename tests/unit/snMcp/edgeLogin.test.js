const nodePath = require('path');
const edgeLogin = require('../../../snMcp/edgeLogin');
const { createSessionStore } = require('../../../snMcp/sessionStore');

const { runLogin, sessionSuffix, sessionPaths, startUrlFor, writeSessionFile, JS_GCK, JS_NEEDS_PERSON } = edgeLogin;

const HOST = 'vale.service-now.com';
const HOME = `https://${HOST}/now/sow/home`;
const LOCATOR = `https://${HOST}/login_locate_sso.do`;
const MS = 'https://login.microsoftonline.com/tenant/saml2?SAMLRequest=x';

const GOOD_COOKIES = [
  { name: 'JSESSIONID', value: 'j', domain: HOST, path: '/' },
  { name: 'BIGipServerpool_vale', value: 'b', domain: HOST, path: '/' },
  { name: 'glide_user_route', value: 'r', domain: HOST, path: '/' },
  { name: 'ESTSAUTH', value: 'ms', domain: '.login.microsoftonline.com', path: '/' },
];

// Edge falso: cada leitura de location.href avança um passo de `urls` (o último se repete).
function fakeBrowser({
  urls, cookies = GOOD_COOKIES, preCookies = [], gck = 'GCK123', ua = 'Mozilla/5.0 Edg/157',
  needsPerson = false, tile = false, exitAfter = Infinity, closeOnHref = false,
} = {}) {
  const calls = [];
  let step = 0, hrefReads = 0, exited = false, cookieReads = 0;
  const cdp = {
    send: jest.fn(async (method, params = {}) => {
      calls.push({ method, params });
      if (exited) { const e = new Error('closed'); e.code = 'CDP_CLOSED'; throw e; }
      switch (method) {
        case 'Target.getTargets':     return { targetInfos: [{ type: 'page', targetId: 'T1' }] };
        case 'Target.attachToTarget': return { sessionId: 'S1' };
        case 'Storage.getCookies':    return { cookies: cookieReads++ === 0 ? preCookies : cookies };
        case 'Runtime.evaluate': {
          const ex = params.expression;
          if (ex === 'location.href') {
            hrefReads++;
            if (closeOnHref && hrefReads > 2) { exited = true; const e = new Error('closed'); e.code = 'CDP_CLOSED'; throw e; }
            if (hrefReads > exitAfter) exited = true;
            const u = urls[Math.min(step, urls.length - 1)];
            step++;
            return { result: { value: u } };
          }
          if (ex === JS_GCK) return { result: { value: gck } };
          if (ex === JS_NEEDS_PERSON) return { result: { value: needsPerson } };
          if (ex === 'navigator.userAgent') return { result: { value: ua } };
          if (ex.includes('sso_selector_id')) return { result: { value: true } };
          if (ex.includes('bhPicked')) return { result: { value: tile ? JSON.stringify({ x: 10, y: 20 }) : '' } };
          return { result: { value: undefined } };
        }
        default: return {};
      }
    }),
  };
  const browser = { cdp, close: jest.fn(async () => {}), hasExited: () => exited };
  return { browser, calls, launch: jest.fn(() => browser) };
}

function deps(fake, extra = {}) {
  let t = 0;
  return {
    instance: HOST, username: 'C0733221', userDataDir: 'C:/p', exe: 'msedge.exe',
    launch: fake.launch, sleep: async ms => { t += ms; }, now: () => t, log: jest.fn(),
    ...extra,
  };
}

describe('runLogin — janela visível', () => {
  test('SSO → Microsoft → instância: devolve cookies da instância, g_ck e User-Agent', async () => {
    const fake = fakeBrowser({ urls: ['about:blank', LOCATOR, MS, HOME, HOME] });
    const r = await runLogin(deps(fake));
    expect(r).toMatchObject({
      instance: HOST,
      cookieHeader: 'JSESSIONID=j; BIGipServerpool_vale=b; glide_user_route=r',
      sessionToken: 'GCK123',
      userAgent: 'Mozilla/5.0 Edg/157',
      missing: [],
    });
    expect(r.cookieNames).not.toContain('ESTSAUTH');   // cookie da Microsoft não vai para a REST
    expect(fake.launch).toHaveBeenCalledWith(expect.objectContaining({ headless: false, userDataDir: 'C:/p', url: 'about:blank' }));
    expect(fake.calls.find(c => c.method === 'Page.navigate').params.url).toBe(LOCATOR);
    expect(fake.browser.close).toHaveBeenCalled();
  });

  test('C10: preenche o ID na página de SSO uma vez só', async () => {
    const fake = fakeBrowser({ urls: [LOCATOR, LOCATOR, LOCATOR, HOME, HOME] });
    await runLogin(deps(fake));
    const fills = fake.calls.filter(c => c.method === 'Runtime.evaluate' && c.params.expression.includes('sso_selector_id'));
    expect(fills).toHaveLength(1);
    expect(fills[0].params.expression).toContain('"C0733221"');
  });

  test('C5: apaga do perfil só os cookies de sessão antigos da instância antes de navegar', async () => {
    const fake = fakeBrowser({
      urls: [LOCATOR, HOME, HOME],
      preCookies: [
        { name: 'JSESSIONID', value: 'velho', domain: HOST, path: '/' },
        { name: 'glide_mfa_remembered_browser', value: 'fica', domain: HOST, path: '/' },
        { name: 'JSESSIONID', value: 'outra', domain: 'cnhi.service-now.com', path: '/' },
      ],
    });
    await runLogin(deps(fake));
    const deleted = fake.calls.filter(c => c.method === 'Network.deleteCookies').map(c => `${c.params.name}@${c.params.domain}`);
    expect(deleted).toEqual([`JSESSIONID@${HOST}`]);
    const firstNav = fake.calls.findIndex(c => c.method === 'Page.navigate');
    const lastDel  = fake.calls.map(c => c.method).lastIndexOf('Network.deleteCookies');
    expect(lastDel).toBeLessThan(firstNav);
  });

  test('seletor de contas da Microsoft: clique de mouse no centro da conta (não element.click)', async () => {
    const fake = fakeBrowser({ urls: [MS, MS, HOME, HOME], tile: true });
    await runLogin(deps(fake));
    const mouse = fake.calls.filter(c => c.method === 'Input.dispatchMouseEvent').map(c => c.params.type);
    expect(mouse.slice(0, 3)).toEqual(['mouseMoved', 'mousePressed', 'mouseReleased']);
    expect(fake.calls.find(c => c.method === 'Input.dispatchMouseEvent').params).toMatchObject({ x: 10, y: 20 });
  });

  test('página de erro de rede: volta para a página de SSO e segue', async () => {
    const fake = fakeBrowser({ urls: [LOCATOR, 'chrome-error://chromewebdata/', LOCATOR, HOME, HOME] });
    await runLogin(deps(fake));
    expect(fake.calls.filter(c => c.method === 'Page.navigate')).toHaveLength(2);
  });

  test('erro de rede persistente → SN_LOGIN_NETWORK', async () => {
    const fake = fakeBrowser({ urls: ['chrome-error://chromewebdata/'] });
    await expect(runLogin(deps(fake))).rejects.toMatchObject({ code: 'SN_LOGIN_NETWORK' });
    expect(fake.browser.close).toHaveBeenCalled();
  });

  test('janela fechada pelo usuário → SN_LOGIN_CANCELLED', async () => {
    const fake = fakeBrowser({ urls: [LOCATOR, MS], closeOnHref: true });
    await expect(runLogin(deps(fake))).rejects.toMatchObject({ code: 'SN_LOGIN_CANCELLED' });
  });

  test('processo do Edge saiu → SN_LOGIN_CANCELLED', async () => {
    const fake = fakeBrowser({ urls: [LOCATOR, MS], exitAfter: 2 });
    await expect(runLogin(deps(fake))).rejects.toMatchObject({ code: 'SN_LOGIN_CANCELLED' });
  });

  test('cancelado pelo app (sair/fechar) → SN_LOGIN_ABORTED', async () => {
    const fake = fakeBrowser({ urls: [MS] });
    const signal = { aborted: false };
    const p = runLogin(deps(fake, { signal, sleep: async () => { signal.aborted = true; } }));
    await expect(p).rejects.toMatchObject({ code: 'SN_LOGIN_ABORTED' });
  });

  test('não concluído no prazo → SN_LOGIN_TIMEOUT', async () => {
    const fake = fakeBrowser({ urls: [MS] });
    await expect(runLogin(deps(fake, { timeoutMs: 5000 }))).rejects.toMatchObject({ code: 'SN_LOGIN_TIMEOUT' });
  });

  test('C4: sem g_ck depois das tentativas segue sem token e registra o aviso', async () => {
    const fake = fakeBrowser({ urls: [HOME, HOME], gck: '' });
    const d = deps(fake);
    const r = await runLogin(d);
    expect(r.sessionToken).toBe('');
    expect(fake.calls.filter(c => c.params.expression === JS_GCK)).toHaveLength(8);
    expect(d.log).toHaveBeenCalledWith(expect.stringMatching(/no g_ck/));
  });

  test('C2: cookies obrigatórios ausentes → relê e avisa; nenhum cookie → erro', async () => {
    const partial = fakeBrowser({ urls: [HOME, HOME], cookies: [{ name: 'glide_user_route', value: 'r', domain: HOST }] });
    const d = deps(partial);
    const r = await runLogin(d);
    expect(r.missing).toEqual(['JSESSIONID', 'BIGipServer*']);
    expect(d.log).toHaveBeenCalledWith(expect.stringMatching(/missing cookies/));

    const none = fakeBrowser({ urls: [HOME, HOME], cookies: [] });
    await expect(runLogin(deps(none))).rejects.toMatchObject({ code: 'SN_LOGIN_NO_COOKIES' });
  });
});

describe('runLogin — sem janela (C6)', () => {
  test('sessão lembrada: conclui sozinho', async () => {
    const fake = fakeBrowser({ urls: [LOCATOR, MS, HOME, HOME], tile: true });
    const r = await runLogin(deps(fake, { headless: true }));
    expect(r.sessionToken).toBe('GCK123');
    expect(fake.launch).toHaveBeenCalledWith(expect.objectContaining({ headless: true }));
  });

  test('página de MFA → desiste na hora (SN_LOGIN_NEEDS_INTERACTION)', async () => {
    const fake = fakeBrowser({ urls: [LOCATOR, `https://${HOST}/validate_multifactor_auth_code.do`] });
    await expect(runLogin(deps(fake, { headless: true }))).rejects.toMatchObject({ code: 'SN_LOGIN_NEEDS_INTERACTION' });
    expect(fake.calls.filter(c => c.params.expression === 'location.href')).toHaveLength(2);
  });

  test('tela pedindo senha/e-mail por alguns segundos → desiste', async () => {
    const fake = fakeBrowser({ urls: [MS], needsPerson: true });
    await expect(runLogin(deps(fake, { headless: true }))).rejects.toMatchObject({ code: 'SN_LOGIN_NEEDS_INTERACTION' });
    expect(fake.calls.filter(c => c.params.expression === JS_NEEDS_PERSON)).toHaveLength(4);
  });

  test('passou do prazo sem janela → SN_LOGIN_NEEDS_INTERACTION (não TIMEOUT)', async () => {
    const fake = fakeBrowser({ urls: [MS] });
    await expect(runLogin(deps(fake, { headless: true, timeoutMs: 3000 }))).rejects.toMatchObject({ code: 'SN_LOGIN_NEEDS_INTERACTION' });
  });

  test('sem ID nem URL de login: nem abre o Edge', async () => {
    const fake = fakeBrowser({ urls: [HOME] });
    await expect(runLogin(deps(fake, { headless: true, username: '' }))).rejects.toMatchObject({ code: 'SN_LOGIN_NEEDS_INTERACTION' });
    expect(fake.launch).not.toHaveBeenCalled();
  });
});

describe('perfil preso por outro processo do Edge', () => {
  function closedAtStart() {
    const cdp = { send: jest.fn(async () => { const e = new Error('closed'); e.code = 'CDP_CLOSED'; throw e; }) };
    return { cdp, close: jest.fn(async () => {}), hasExited: () => true };
  }

  test('Edge sai ao abrir: fecha as sobras do perfil e tenta de novo', async () => {
    const ok = fakeBrowser({ urls: [HOME, HOME] });
    const launch = jest.fn().mockReturnValueOnce(closedAtStart()).mockImplementation(() => ok.browser);
    const killProfileImpl = jest.fn(async () => 1);
    const d = deps(ok, { launch, killProfileImpl });
    const r = await runLogin(d);
    expect(r.sessionToken).toBe('GCK123');
    expect(killProfileImpl).toHaveBeenCalledWith('C:/p');
    expect(launch).toHaveBeenCalledTimes(2);
    expect(d.log).toHaveBeenCalledWith(expect.stringMatching(/profile busy/));
  });

  test('continua preso depois das tentativas → SN_LOGIN_PROFILE_BUSY', async () => {
    const launch = jest.fn(() => closedAtStart());
    const killProfileImpl = jest.fn(async () => 0);
    const fake = fakeBrowser({ urls: [HOME] });
    await expect(runLogin(deps(fake, { launch, killProfileImpl }))).rejects.toMatchObject({ code: 'SN_LOGIN_PROFILE_BUSY' });
    expect(launch).toHaveBeenCalledTimes(3);
  });
});

test('Edge não encontrado → SN_EDGE_NOT_FOUND', async () => {
  await expect(runLogin({ instance: HOST, exe: '', findEdgeImpl: () => '', launch: jest.fn() }))
    .rejects.toMatchObject({ code: 'SN_EDGE_NOT_FOUND' });
});

test('sem instância → SN_LOGIN_CONFIG', async () => {
  await expect(runLogin({ instance: '' })).rejects.toMatchObject({ code: 'SN_LOGIN_CONFIG' });
});

describe('C11 — nomes e formato iguais aos do MCP (migração sem novo login)', () => {
  test('sufixo host_usuário com @ → _at_ e . → _', () => {
    expect(sessionSuffix('vale.service-now.com', 'C0733221')).toBe('vale_service-now_com_C0733221');
    expect(sessionSuffix('https://cnhi.service-now.com/', 'maurilio.martins@external.cnhind.com'))
      .toBe('cnhi_service-now_com_maurilio_martins_at_external_cnhind_com');
    expect(sessionSuffix('x.service-now.com', '')).toBe('x_service-now_com');
  });

  test('perfil e sessão em session-edge/', () => {
    const p = sessionPaths('C:/data/sn-mcp', HOST, 'C0733221');
    expect(p.profile).toBe(nodePath.join('C:/data/sn-mcp', 'session-edge', 'profile_vale_service-now_com_C0733221'));
    expect(p.file).toBe(nodePath.join('C:/data/sn-mcp', 'session-edge', 'session_vale_service-now_com_C0733221.json'));
  });

  test('arquivo gravado é lido pelo sessionStore com os mesmos headers', () => {
    const files = new Map();
    const fsImpl = {
      mkdirSync: jest.fn(),
      writeFileSync: (p, d) => files.set(p, d),
      renameSync: (a, b) => { files.set(b, files.get(a)); files.delete(a); },
      readFileSync: p => files.get(p),
      statSync: () => ({ mtimeMs: 1 }),
    };
    const payload = writeSessionFile('C:/s.json', { instance: HOST, cookieHeader: 'JSESSIONID=j', userAgent: 'UA', sessionToken: 'G' }, { fsImpl, now: () => 1000 });
    expect(payload).toMatchObject({ instance_url: `https://${HOST}`, last_login_at: 1, source: 'backlog-health' });
    const store = createSessionStore({ fsImpl });
    expect(store.readSessionHeaders('C:/s.json')).toEqual({ Cookie: 'JSESSIONID=j', 'User-Agent': 'UA', 'X-UserToken': 'G' });
  });
});

test('URL inicial: login_locate_sso.do da instância ou a URL configurada', () => {
  expect(startUrlFor({ instance: 'https://Vale.service-now.com/' })).toBe(LOCATOR);
  expect(startUrlFor({ instance: HOST, loginUrl: ' https://idp/sso ' })).toBe('https://idp/sso');
});

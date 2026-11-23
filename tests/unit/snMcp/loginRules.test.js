const r = require('../../../snMcp/loginRules');

const HOST = 'vale.service-now.com';

describe('C1 — páginas de login e MFA pela URL', () => {
  test.each([
    'https://vale.service-now.com/login.do',
    'https://vale.service-now.com/login_redirect.do?x=1',
    'https://vale.service-now.com/auth_redirect.do?sysparm_url=a',
    'https://vale.service-now.com/validate_multifactor_auth_code.do',
    'https://vale.service-now.com/external_login_complete.do',
    'https://vale.service-now.com/login_locate_sso.do',        // variante genérica /login_
    'https://vale.service-now.com/navpage.do?sysparm_type=login',
    'https://vale.service-now.com/x.do?sysparm_reauth=true',
    'https://vale.service-now.com/login',
    'https://vale.service-now.com/auth',
  ])('%s é página de login', url => {
    expect(r.isLoginPageUrl(url)).toBe(true);
  });

  test.each([
    'https://vale.service-now.com/now/sow/home',
    'https://vale.service-now.com/navpage.do',
    // sysparm_direct codificado dentro do caminho do Polaris (cnhi): não é query → não é login
    'https://cnhi.service-now.com/now/nav/ui/classic/params/target/home_splash.do%3Fsysparm_direct%3Dtrue',
    'not a url',
  ])('%s não é página de login', url => {
    expect(r.isLoginPageUrl(url)).toBe(false);
  });

  test('MFA é mais estreito que login: /login.do de passagem não aborta o login sem janela', () => {
    expect(r.isMfaChallengeUrl('https://x/login.do')).toBe(false);
    expect(r.isMfaChallengeUrl('https://x/validate_multifactor_auth_code.do')).toBe(true);
    expect(r.isMfaChallengeUrl('https://x/mfa_setup.do')).toBe(true);
    expect(r.isMfaChallengeUrl('https://x/some_multifactor_page')).toBe(true);
  });

  test('ainda autenticando: página de login ou host externo (IdP); about:blank não conta', () => {
    expect(r.isMidAuth('https://vale.service-now.com/login.do', HOST)).toBe(true);
    expect(r.isMidAuth('https://login.microsoftonline.com/tenant/saml2', HOST)).toBe(true);
    expect(r.isMidAuth('https://vale.service-now.com/now/sow/home', HOST)).toBe(false);
    expect(r.isMidAuth('about:blank', HOST)).toBe(false);
  });

  test('login concluído = de volta à instância, fora do login', () => {
    expect(r.isLoggedInUrl('https://vale.service-now.com/now/sow/home', HOST)).toBe(true);
    expect(r.isLoggedInUrl('https://vale.service-now.com/login_locate_sso.do', HOST)).toBe(false);
    expect(r.isLoggedInUrl('https://login.microsoftonline.com/x', HOST)).toBe(false);
  });

  test('página de erro de rede e host da Microsoft', () => {
    expect(r.isNetworkErrorUrl('chrome-error://chromewebdata/')).toBe(true);
    expect(r.isNetworkErrorUrl('https://x')).toBe(false);
    expect(r.isMicrosoftLoginHost('login.microsoftonline.com')).toBe(true);
    expect(r.isMicrosoftLoginHost('vale.service-now.com')).toBe(false);
  });
});

describe('C2 — cookie jar completo', () => {
  const cookies = [
    { name: 'JSESSIONID', value: 'j', domain: 'vale.service-now.com' },
    { name: 'BIGipServerpool_vale', value: 'b', domain: '.service-now.com' },
    { name: 'ESTSAUTH', value: 'ms', domain: '.login.microsoftonline.com' },
    { name: 'outro', value: 'o', domain: 'cnhi.service-now.com' },
  ];

  test('seleciona só os cookies que valem para a instância (domínio exato ou pai)', () => {
    expect(r.selectInstanceCookies(cookies, HOST).map(c => c.name)).toEqual(['JSESSIONID', 'BIGipServerpool_vale']);
  });

  test('monta o header Cookie', () => {
    expect(r.buildCookieHeader(r.selectInstanceCookies(cookies, HOST))).toBe('JSESSIONID=j; BIGipServerpool_vale=b');
  });

  test('aponta JSESSIONID e BIGipServer* ausentes', () => {
    expect(r.missingRequiredCookies(cookies)).toEqual([]);
    expect(r.missingRequiredCookies([{ name: 'glide_user_route' }])).toEqual(['JSESSIONID', 'BIGipServer*']);
  });
});

describe('C3 — rotação do cookie do balanceador (BIG-IP)', () => {
  test('lê a dica do Set-Cookie e ignora revogação (valor vazio)', () => {
    expect(r.bigipHintFrom(['glide_x=1; path=/', 'BIGipServerpool_vale=abc; path=/; secure'])).toEqual({ name: 'BIGipServerpool_vale', value: 'abc' });
    expect(r.bigipHintFrom('BIGipServerpool_vale=; Max-Age=0')).toBeNull();
    expect(r.bigipHintFrom(null)).toBeNull();
  });

  test('troca só o valor do cookie do balanceador no header', () => {
    expect(r.absorbBigipRotation('JSESSIONID=j; BIGipServerpool_vale=old', ['BIGipServerpool_vale=new; path=/']))
      .toBe('JSESSIONID=j; BIGipServerpool_vale=new');
  });

  test('mesmo backend ou sem dica: nada a fazer', () => {
    expect(r.absorbBigipRotation('BIGipServerpool_vale=same', ['BIGipServerpool_vale=same'])).toBeNull();
    expect(r.absorbBigipRotation('JSESSIONID=j', ['other=1'])).toBeNull();
    expect(r.absorbBigipRotation('', ['BIGipServerpool_vale=x'])).toBeNull();
  });
});

describe('C5 — cookies de sessão antigos', () => {
  test('lista igual à do original (glide_mfa_remembered_browser fica de fora)', () => {
    expect(r.STALE_SESSION_COOKIES).toEqual(expect.arrayContaining(['JSESSIONID', 'glide_session_store', 'glide_user_route', 'factor', 'UX-Token']));
    expect(r.STALE_SESSION_COOKIES).not.toContain('glide_mfa_remembered_browser');
    expect(r.STALE_SESSION_COOKIES).not.toContain('BIGipServerpool_vale');
  });
});

test('normalizeHost remove protocolo, caminho e maiúsculas', () => {
  expect(r.normalizeHost(' https://Vale.Service-Now.com/navpage.do?x=1 ')).toBe('vale.service-now.com');
  expect(r.hostOf('https://login.microsoftonline.com/a')).toBe('login.microsoftonline.com');
  expect(r.hostOf('lixo')).toBe('');
});

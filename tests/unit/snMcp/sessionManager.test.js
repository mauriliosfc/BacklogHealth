const nodePath = require('path');
const { createSessionManager, CIRCUIT_BACKOFF_MS } = require('../../../snMcp/sessionManager');

const ROOT = 'C:/data/sn-mcp';
const SN   = { mode: 'mcp', instance: 'vale.service-now.com', mcp: { username: 'C0733221' } };
const FILE = nodePath.join(ROOT, 'session-edge', 'session_vale_service-now_com_C0733221.json');

function authErr() { const e = new Error('Service Now session expired'); e.code = 'SN_AUTH'; return e; }
function codeErr(code) { const e = new Error(code); e.code = code; return e; }
const LOGIN_OK = { instance: 'vale.service-now.com', cookieHeader: 'JSESSIONID=j', sessionToken: 'G', userAgent: 'UA', elapsedMs: 10 };

function setup({ savedValid = false, savedFile = savedValid, login, restGet, edge = true, ...opts } = {}) {
  let t = 1000000;
  const files = new Map();
  if (savedFile) files.set(FILE, JSON.stringify({ cookie_header: 'JSESSIONID=old' }));
  const removed = [];
  const fsImpl = {
    existsSync: p => files.has(p),
    mkdirSync: jest.fn(),
    appendFileSync: jest.fn(),
    writeFileSync: (p, d) => files.set(p, d),
    renameSync: (a, b) => { files.set(b, files.get(a)); files.delete(a); },
    rmSync: p => { removed.push(p); [...files.keys()].filter(k => k.startsWith(p)).forEach(k => files.delete(k)); },
  };
  let valid = savedValid;
  const sessionStore = { readSessionHeaders: jest.fn(f => { if (!files.has(f)) throw new Error('ENOENT'); return { Cookie: 'x' }; }) };
  const rest = restGet || jest.fn(async (cfg, path) => {
    if (!valid) throw authErr();
    if (path.startsWith('table/sys_user?')) return { result: [{ name: 'Maurilio' }] };
    return { result: [] };
  });
  const loginFn = login || jest.fn(async () => { valid = true; return LOGIN_OK; });
  let intervalFn = null;
  const m = createSessionManager({
    root: ROOT, login: loginFn, restGet: rest, sessionStore, fsImpl,
    findEdgeImpl: () => (edge ? 'msedge.exe' : ''),
    now: () => t,
    setIntervalImpl: fn => { intervalFn = fn; return { unref() {} }; },
    clearIntervalImpl: () => { intervalFn = null; },
    ...opts,
  });
  const states = [];
  m.events.on('status', s => states.push(s.state));
  return {
    m, files, removed, login: loginFn, rest, states,
    advance: ms => { t += ms; },
    setValid: v => { valid = v; },
    tick: () => intervalFn && intervalFn(),
    hasKeepAlive: () => !!intervalFn,
  };
}

describe('ensureSession', () => {
  test('sessão salva válida: conecta sem abrir o Edge e lê o nome do usuário', async () => {
    const s = setup({ savedValid: true });
    const st = await s.m.ensureSession(SN);
    expect(st).toMatchObject({ state: 'connected', user: 'Maurilio', instance: 'vale.service-now.com' });
    expect(s.login).not.toHaveBeenCalled();
    expect(s.hasKeepAlive()).toBe(true);
  });

  test('sem sessão: login sem janela, grava o arquivo e conecta (sem awaiting_login)', async () => {
    const s = setup();
    await s.m.ensureSession(SN);
    expect(s.login).toHaveBeenCalledTimes(1);
    expect(s.login).toHaveBeenCalledWith(expect.objectContaining({
      headless: true, instance: 'vale.service-now.com', username: 'C0733221',
      userDataDir: nodePath.join(ROOT, 'session-edge', 'profile_vale_service-now_com_C0733221'),
    }));
    expect(JSON.parse(s.files.get(FILE))).toMatchObject({ cookie_header: 'JSESSIONID=j', session_token: 'G', user_agent: 'UA' });
    expect(s.states).toEqual(['connecting', 'connected']);
  });

  test('C6: sem janela precisa de uma pessoa → abre a janela (awaiting_login)', async () => {
    const login = jest.fn()
      .mockRejectedValueOnce(codeErr('SN_LOGIN_NEEDS_INTERACTION'))
      .mockResolvedValueOnce(LOGIN_OK);
    const s = setup({ login, restGet: jest.fn(async () => ({ result: [] })) });   // sem sessão salva; após o login a REST aceita
    await s.m.ensureSession(SN);
    expect(login.mock.calls.map(c => c[0].headless)).toEqual([true, false]);
    expect(s.states).toEqual(['connecting', 'awaiting_login', 'connected']);
  });

  test('sem ID nem URL de login: vai direto para a janela', async () => {
    const s = setup();
    await s.m.ensureSession({ ...SN, mcp: {} });
    expect(s.login.mock.calls.map(c => c[0].headless)).toEqual([false]);
  });

  test('single-flight: chamadas simultâneas fazem um login só', async () => {
    const s = setup();
    await Promise.all([s.m.ensureSession(SN), s.m.ensureSession(SN), s.m.ensureSession(SN)]);
    expect(s.login).toHaveBeenCalledTimes(1);
  });

  test('já conectado com a mesma config: não sonda de novo', async () => {
    const s = setup({ savedValid: true });
    await s.m.ensureSession(SN);
    s.rest.mockClear();
    await s.m.ensureSession(SN);
    expect(s.rest).not.toHaveBeenCalled();
  });

  test('outra instância: revalida', async () => {
    const s = setup({ savedValid: true });
    await s.m.ensureSession(SN);
    await s.m.ensureSession({ ...SN, instance: 'cnhi.service-now.com' });
    expect(s.login).toHaveBeenCalledTimes(1);   // cnhi não tem sessão salva
  });

  test('C8: login ok mas a REST recusa a sessão (nascida morta) → erro de autenticação', async () => {
    const s = setup({ login: jest.fn(async () => LOGIN_OK) });   // não torna a sessão válida
    await expect(s.m.ensureSession(SN)).rejects.toMatchObject({ code: 'SN_LOGIN_BORN_DEAD' });
    expect(s.m.getStatus()).toMatchObject({ state: 'error', reason: 'auth' });
  });

  test('erro de rede ao conferir a sessão salva não dispara login', async () => {
    const restGet = jest.fn(async () => { throw codeErr('ECONNRESET'); });
    const s = setup({ savedFile: true, restGet });
    await expect(s.m.ensureSession(SN)).rejects.toMatchObject({ code: 'ECONNRESET' });
    expect(s.login).not.toHaveBeenCalled();
    expect(s.m.getStatus()).toMatchObject({ state: 'error', reason: 'other' });
  });

  test('Edge ausente → erro edge_missing sem tentar login', async () => {
    const s = setup({ edge: false });
    await expect(s.m.ensureSession(SN)).rejects.toMatchObject({ code: 'SN_EDGE_NOT_FOUND' });
    expect(s.login).not.toHaveBeenCalled();
    expect(s.m.getStatus().reason).toBe('edge_missing');
    expect(s.m.edgeAvailable()).toBe(false);
  });

  test('sem instância rejeita', async () => {
    const s = setup();
    await expect(s.m.ensureSession({})).rejects.toThrow(/instance/);
  });
});

describe('C7 — cooldown e circuit breaker', () => {
  test('janela fechada: reason cancelled, espera curta e não conta como tentativa', async () => {
    const login = jest.fn().mockRejectedValue(codeErr('SN_LOGIN_CANCELLED'));
    const s = setup({ login });
    await expect(s.m.ensureSession({ ...SN, mcp: {} })).rejects.toMatchObject({ code: 'SN_LOGIN_CANCELLED' });
    expect(s.m.getStatus().reason).toBe('cancelled');
    await expect(s.m.ensureSession({ ...SN, mcp: {} })).rejects.toMatchObject({ code: 'SN_LOGIN_COOLDOWN' });
    s.advance(5001);
    login.mockResolvedValueOnce(LOGIN_OK);
    s.setValid(false);
    await s.m.ensureSession({ ...SN, mcp: {} }).catch(() => {});
    expect(login).toHaveBeenCalledTimes(2);   // sem o intervalo de 60 s
  });

  test('intervalo mínimo de 60 s entre logins automáticos; "Entrar" (force) ignora', async () => {
    const s = setup();
    await s.m.ensureSession(SN);
    s.setValid(false);
    s.m.invalidateSession();
    await expect(s.m.ensureSession(SN)).rejects.toMatchObject({ code: 'SN_LOGIN_COOLDOWN' });
    expect(s.m.getStatus().reason).toBe('cooldown');
    await s.m.ensureSession(SN, { force: true });
    expect(s.login).toHaveBeenCalledTimes(2);
  });

  test('3 falhas seguidas abrem o circuito (30 s) mesmo passado o intervalo mínimo', async () => {
    const login = jest.fn().mockRejectedValue(codeErr('SN_LOGIN_TIMEOUT'));
    const s = setup({ login, minLoginIntervalMs: 0 });
    for (let i = 0; i < 3; i++) await s.m.ensureSession(SN).catch(() => {});
    expect(login).toHaveBeenCalledTimes(3);
    await expect(s.m.ensureSession(SN)).rejects.toMatchObject({ code: 'SN_LOGIN_COOLDOWN' });
    s.advance(CIRCUIT_BACKOFF_MS[0] + 1);
    await s.m.ensureSession(SN).catch(() => {});
    expect(login).toHaveBeenCalledTimes(4);
  });

  test('"Entrar" zera o contador de falhas', async () => {
    const login = jest.fn().mockRejectedValue(codeErr('SN_LOGIN_TIMEOUT'));
    const s = setup({ login, minLoginIntervalMs: 0 });
    for (let i = 0; i < 3; i++) await s.m.ensureSession(SN).catch(() => {});
    await s.m.ensureSession(SN, { force: true }).catch(() => {});
    expect(login).toHaveBeenCalledTimes(4);
  });
});

describe('C9 — keep-alive', () => {
  test('sonda a sessão a cada intervalo', async () => {
    const s = setup({ savedValid: true });
    await s.m.ensureSession(SN);
    s.rest.mockClear();
    await s.tick();
    expect(s.rest).toHaveBeenCalledWith(SN, expect.stringContaining('sys_user_preference'), expect.anything());
  });

  test('sessão caiu: marca expirada sem abrir janela; o próximo uso faz login', async () => {
    const s = setup({ savedValid: true });
    await s.m.ensureSession(SN);
    s.setValid(false);
    await s.tick();
    expect(s.m.getStatus()).toMatchObject({ state: 'stopped', reason: 'expired' });
    expect(s.login).not.toHaveBeenCalled();
    s.advance(61000);
    await s.m.ensureSession(SN);
    expect(s.login).toHaveBeenCalledTimes(1);
  });

  test('após 6 h sem uso real, para de estender', async () => {
    const s = setup({ savedValid: true });
    await s.m.ensureSession(SN);
    s.rest.mockClear();
    s.advance(6 * 3600 * 1000 + 1);
    await s.tick();
    expect(s.rest).not.toHaveBeenCalled();
    s.m.touch();
    await s.tick();
    expect(s.rest).toHaveBeenCalled();
  });

  test('erro de rede no keep-alive não derruba a sessão', async () => {
    const s = setup({ savedValid: true });
    await s.m.ensureSession(SN);
    s.rest.mockRejectedValueOnce(codeErr('ETIMEDOUT'));
    await s.tick();
    expect(s.m.getStatus().state).toBe('connected');
  });
});

describe('warmup, invalidate, stop e logout', () => {
  test('warmup com sessão salva válida conecta sem login', async () => {
    const s = setup({ savedValid: true });
    await expect(s.m.warmup(SN)).resolves.toBe(true);
    expect(s.m.getStatus().state).toBe('connected');
    expect(s.login).not.toHaveBeenCalled();
  });

  test('warmup sem sessão salva não faz login', async () => {
    const s = setup();
    await expect(s.m.warmup(SN)).resolves.toBe(false);
    expect(s.login).not.toHaveBeenCalled();
    expect(s.m.getStatus().state).toBe('stopped');
  });

  test('invalidateSession força revalidar no próximo ensureSession', async () => {
    const s = setup({ savedValid: true });
    await s.m.ensureSession(SN);
    s.m.invalidateSession();
    expect(s.m.getStatus().state).toBe('connecting');
    s.rest.mockClear();
    await s.m.ensureSession(SN);
    expect(s.rest).toHaveBeenCalled();
  });

  test('stop cancela o login em andamento (fecha o Edge)', async () => {
    let signal;
    const login = jest.fn(opts => { signal = opts.signal; return new Promise(() => {}); });
    const s = setup({ login });
    s.m.ensureSession({ ...SN, mcp: {} }).catch(() => {});
    await new Promise(r => setImmediate(r));
    s.m.stop();
    expect(signal.aborted).toBe(true);
    expect(s.m.getStatus().state).toBe('stopped');
  });

  test('logout apaga sessões e perfis (Edge e a pasta antiga do Chromium)', async () => {
    const s = setup({ savedValid: true });
    await s.m.ensureSession(SN);
    s.m.logout();
    expect(s.removed).toEqual([nodePath.join(ROOT, 'session-edge'), nodePath.join(ROOT, 'session')]);
    expect(s.files.has(FILE)).toBe(false);
    expect(s.m.getStatus().state).toBe('stopped');
    expect(s.hasKeepAlive()).toBe(false);
  });

  test('getSessionFile segue o nome do MCP', () => {
    const s = setup();
    expect(s.m.getSessionFile(SN)).toBe(FILE);
  });
});

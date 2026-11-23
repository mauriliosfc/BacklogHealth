const { createSnMcpFacade } = require('../../../snMcp');

const SN      = { mode: 'mcp', instance: 'empresa.service-now.com', mcp: { username: 'C0001' } };
const FILE    = 'C:/data/sn-mcp/session-edge/session_empresa_service-now_com_C0001.json';
const HEADERS = { Cookie: 'JSESSIONID=abc; BIGipServerpool_empresa=1', 'X-UserToken': 'tok' };

function authErr() { const e = new Error('Service Now session expired'); e.code = 'SN_AUTH'; return e; }
function busyErr() { const e = new Error('Service Now busy (HTTP 202)'); e.code = 'SN_BUSY'; return e; }

function makeFacade({ restGet, readSessionHeaders, absorb = false, ...opts } = {}) {
  const manager = {
    ensureSession:     jest.fn(async () => ({ state: 'connected' })),
    invalidateSession: jest.fn(),
    touch:             jest.fn(),
    warmup:            jest.fn(async () => true),
    getSessionFile:    jest.fn(() => FILE),
  };
  const sessionStore = {
    readSessionHeaders:  jest.fn(readSessionHeaders || (() => HEADERS)),
    rotatedTokenFrom:    jest.fn(h => h['x-usertoken'] || ''),
    persistRotatedToken: jest.fn(),
    absorbBigipRotation: jest.fn(() => absorb),
  };
  const log = jest.fn();
  const sleep = jest.fn(async () => {});
  const facade = createSnMcpFacade({ manager, sessionStore, restGet, log, sleep, ...opts });
  return { facade, manager, sessionStore, log, sleep };
}

describe('snMcp.get — Table API com a sessão SSO', () => {
  test('usa a sessão salva para chamar a Table API direto', async () => {
    const restGet = jest.fn(async () => ({ result: [{ sys_id: '1' }] }));
    const { facade, manager, sessionStore } = makeFacade({ restGet });

    const r = await facade.get(SN, 'table/incident?sysparm_limit=1000&sysparm_display_value=all');

    expect(r).toEqual({ result: [{ sys_id: '1' }] });
    expect(manager.ensureSession).toHaveBeenCalledWith(SN);
    expect(manager.touch).toHaveBeenCalled();   // uso real conta para o limite de ociosidade do keep-alive
    expect(sessionStore.readSessionHeaders).toHaveBeenCalledWith(FILE);
    expect(restGet).toHaveBeenCalledWith(SN, 'table/incident?sysparm_limit=1000&sysparm_display_value=all',
      expect.objectContaining({ headers: HEADERS }));
  });

  test('persiste token rotacionado recebido na resposta', async () => {
    const restGet = jest.fn(async (cfg, path, { onResponseHeaders }) => { onResponseHeaders({ 'x-usertoken': 'novo' }); return { result: [] }; });
    const { facade, sessionStore } = makeFacade({ restGet });
    await facade.get(SN, 'table/incident');
    expect(sessionStore.persistRotatedToken).toHaveBeenCalledWith(FILE, 'novo');
  });

  test('sessão recusada: revalida (login silencioso ou janela) e tenta de novo', async () => {
    const restGet = jest.fn()
      .mockRejectedValueOnce(authErr())
      .mockResolvedValueOnce({ result: [{ sys_id: '2' }] });
    const { facade, manager } = makeFacade({ restGet });

    const r = await facade.get(SN, 'table/incident');

    expect(r.result[0].sys_id).toBe('2');
    expect(manager.invalidateSession).toHaveBeenCalledTimes(1);
    expect(manager.ensureSession).toHaveBeenCalledTimes(2);
  });

  test('C3: o balanceador indica outro backend — grava o cookie BIG-IP e repete sem novo login', async () => {
    const setCookie = ['BIGipServerpool_empresa=2; path=/'];
    const restGet = jest.fn()
      .mockImplementationOnce(async (cfg, path, { onResponseHeaders }) => { onResponseHeaders({ 'set-cookie': setCookie }); throw authErr(); })
      .mockResolvedValueOnce({ result: [{ sys_id: 'novo-backend' }] });
    const { facade, manager, sessionStore } = makeFacade({ restGet, absorb: true });

    const r = await facade.get(SN, 'table/incident');

    expect(r.result[0].sys_id).toBe('novo-backend');
    expect(sessionStore.absorbBigipRotation).toHaveBeenCalledWith(FILE, setCookie);
    expect(manager.invalidateSession).not.toHaveBeenCalled();
  });

  test('C3: BIG-IP absorvido mas ainda recusado → revalida a sessão', async () => {
    const restGet = jest.fn()
      .mockRejectedValueOnce(authErr())
      .mockRejectedValueOnce(authErr())
      .mockResolvedValueOnce({ result: [] });
    const { facade, manager } = makeFacade({ restGet, absorb: true });
    await facade.get(SN, 'table/incident');
    expect(manager.invalidateSession).toHaveBeenCalledTimes(1);
    expect(restGet).toHaveBeenCalledTimes(3);
  });

  test('recusada também depois de revalidar: o erro sobe (sem fallback)', async () => {
    const restGet = jest.fn().mockRejectedValue(authErr());
    const { facade } = makeFacade({ restGet });
    await expect(facade.get(SN, 'table/incident')).rejects.toMatchObject({ code: 'SN_AUTH' });
    expect(restGet).toHaveBeenCalledTimes(2);
  });

  test('sem arquivo de sessão: revalida e tenta de novo', async () => {
    let calls = 0;
    const restGet = jest.fn(async () => ({ result: [{ sys_id: 'depois-do-login' }] }));
    const { facade, manager } = makeFacade({
      restGet,
      readSessionHeaders: () => { if (calls++ === 0) throw new Error('ENOENT'); return HEADERS; },
    });
    const r = await facade.get(SN, 'table/incident');
    expect(r.result[0].sys_id).toBe('depois-do-login');
    expect(manager.invalidateSession).toHaveBeenCalledTimes(1);
  });

  test('erro que não é de sessão (ex.: HTTP 500) é propagado sem revalidar', async () => {
    const restGet = jest.fn().mockRejectedValue(new Error('Service Now HTTP 500: boom'));
    const { facade, manager } = makeFacade({ restGet });
    await expect(facade.get(SN, 'table/incident')).rejects.toThrow(/500/);
    expect(manager.invalidateSession).not.toHaveBeenCalled();
  });

  test('connect força (ignora cooldown); ensure respeita', async () => {
    const { facade, manager } = makeFacade({ restGet: jest.fn() });
    await facade.connect(SN);
    expect(manager.ensureSession).toHaveBeenLastCalledWith(SN, { force: true });
    await facade.ensure(SN);
    expect(manager.ensureSession).toHaveBeenLastCalledWith(SN);
  });

  test('warmup delega ao gerenciador', async () => {
    const { facade, manager } = makeFacade({ restGet: jest.fn() });
    await expect(facade.warmup(SN)).resolves.toBe(true);
    expect(manager.warmup).toHaveBeenCalledWith(SN);
  });
});

describe('snMcp.get — concorrência na sessão SSO', () => {
  test('202 (sessão ocupada) é repetido com espera e não vira resultado vazio', async () => {
    const restGet = jest.fn()
      .mockRejectedValueOnce(busyErr())
      .mockRejectedValueOnce(busyErr())
      .mockResolvedValueOnce({ result: [{ sys_id: 'ok' }] });
    const { facade, sleep, manager } = makeFacade({ restGet });

    const r = await facade.get(SN, 'table/incident');

    expect(r.result[0].sys_id).toBe('ok');
    expect(restGet).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep.mock.calls[1][0]).toBeGreaterThan(sleep.mock.calls[0][0] - 400);
    expect(manager.invalidateSession).not.toHaveBeenCalled();
  });

  test('desiste após o limite de tentativas, registra e propaga o erro', async () => {
    const restGet = jest.fn().mockRejectedValue(busyErr());
    const { facade, log } = makeFacade({ restGet, busyRetries: 2 });
    await expect(facade.get(SN, 'table/incident?x=1')).rejects.toMatchObject({ code: 'SN_BUSY' });
    expect(restGet).toHaveBeenCalledTimes(3);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/gave up.*table\/incident$/));
  });

  test('limita o número de chamadas simultâneas na sessão', async () => {
    let inFlight = 0, peak = 0;
    const restGet = jest.fn(async () => {
      inFlight++; peak = Math.max(peak, inFlight);
      await new Promise(r => setImmediate(r));
      inFlight--;
      return { result: [] };
    });
    const { facade } = makeFacade({ restGet, maxConcurrent: 3 });
    await Promise.all(Array.from({ length: 20 }, () => facade.get(SN, 'table/incident')));
    expect(restGet).toHaveBeenCalledTimes(20);
    expect(peak).toBe(3);
  });
});

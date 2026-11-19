const { createSnMcpFacade } = require('../../../snMcp');

const SN    = { mode: 'mcp', instance: 'empresa.service-now.com', mcp: { username: 'C0001' } };
const PATHS = { session: 'C:/data/sn-mcp/session' };
const HEADERS = { Cookie: 'JSESSIONID=abc', 'X-UserToken': 'tok' };

function authErr() { const e = new Error('Service Now session expired'); e.code = 'SN_AUTH'; return e; }

function makeFacade({ restGet, sessionFile = 'C:/data/sn-mcp/session-edge/session_x.json', toolsResult } = {}) {
  const manager = {
    ensureSession:     jest.fn(async () => ({ state: 'connected' })),
    invalidateSession: jest.fn(),
    setTransport:      jest.fn(),
    callTool:          jest.fn(async () => toolsResult || { success: true, results: [{ sys_id: 'via-tools' }] }),
  };
  const sessionStore = {
    findSessionFile:     jest.fn(() => sessionFile),
    readSessionHeaders:  jest.fn(() => HEADERS),
    rotatedTokenFrom:    jest.fn(h => h['x-usertoken'] || ''),
    persistRotatedToken: jest.fn(),
  };
  const log = jest.fn();
  const facade = createSnMcpFacade({ manager, installer: { paths: PATHS }, sessionStore, restGet, log });
  return { facade, manager, sessionStore, log };
}

describe('snMcp.get — caminho direto pela REST', () => {
  test('usa a sessão do MCP para chamar a Table API direto', async () => {
    const restGet = jest.fn(async () => ({ result: [{ sys_id: '1' }] }));
    const { facade, manager, sessionStore } = makeFacade({ restGet });

    const r = await facade.get(SN, 'table/incident?sysparm_limit=1000&sysparm_display_value=all');

    expect(r).toEqual({ result: [{ sys_id: '1' }] });
    expect(manager.ensureSession).toHaveBeenCalledWith(SN);
    expect(sessionStore.findSessionFile).toHaveBeenCalledWith('C:/data/sn-mcp/session-edge', SN.instance);
    expect(restGet).toHaveBeenCalledWith(SN, 'table/incident?sysparm_limit=1000&sysparm_display_value=all',
      expect.objectContaining({ headers: HEADERS }));
    expect(manager.callTool).not.toHaveBeenCalled();
    expect(manager.setTransport).toHaveBeenCalledWith('direct');
  });

  test('usa a pasta de sessão do Chromium quando configurado', async () => {
    const restGet = jest.fn(async () => ({ result: [] }));
    const { facade, sessionStore } = makeFacade({ restGet });
    await facade.get({ ...SN, mcp: { browser: 'chromium' } }, 'table/incident');
    expect(sessionStore.findSessionFile).toHaveBeenCalledWith('C:/data/sn-mcp/session', SN.instance);
  });

  test('persiste token rotacionado recebido na resposta', async () => {
    const restGet = jest.fn(async (cfg, path, { onResponseHeaders }) => { onResponseHeaders({ 'x-usertoken': 'novo' }); return { result: [] }; });
    const { facade, sessionStore } = makeFacade({ restGet });
    await facade.get(SN, 'table/incident');
    expect(sessionStore.persistRotatedToken).toHaveBeenCalledWith('C:/data/sn-mcp/session-edge/session_x.json', 'novo');
  });

  test('sessão recusada: revalida pelo MCP e tenta de novo', async () => {
    const restGet = jest.fn()
      .mockRejectedValueOnce(authErr())
      .mockResolvedValueOnce({ result: [{ sys_id: '2' }] });
    const { facade, manager } = makeFacade({ restGet });

    const r = await facade.get(SN, 'table/incident');

    expect(r.result[0].sys_id).toBe('2');
    expect(manager.invalidateSession).toHaveBeenCalledTimes(1);
    expect(manager.ensureSession).toHaveBeenCalledTimes(2);
    expect(manager.callTool).not.toHaveBeenCalled();
  });

  test('REST direta recusa mesmo após revalidar: cai para as ferramentas do MCP e mantém o fallback', async () => {
    const restGet = jest.fn().mockRejectedValue(authErr());
    const { facade, manager, log } = makeFacade({ restGet });

    const r1 = await facade.get(SN, 'table/incident?sysparm_fields=sys_id&sysparm_limit=1');
    expect(r1.result[0].sys_id).toBe('via-tools');
    expect(manager.setTransport).toHaveBeenCalledWith('mcp-tools', expect.any(String));
    expect(log).toHaveBeenCalledTimes(1);

    restGet.mockClear();
    await facade.get(SN, 'table/incident?sysparm_fields=sys_id&sysparm_limit=1');
    expect(restGet).not.toHaveBeenCalled();
    expect(facade.isDirectDisabled()).toBeTruthy();
  });

  test('sem arquivo de sessão: usa as ferramentas do MCP', async () => {
    const restGet = jest.fn();
    const { facade, manager } = makeFacade({ restGet, sessionFile: null });
    const r = await facade.get(SN, 'table/incident?sysparm_fields=sys_id&sysparm_limit=1');
    expect(r.result[0].sys_id).toBe('via-tools');
    expect(restGet).not.toHaveBeenCalled();
    expect(manager.callTool).toHaveBeenCalled();
  });

  test('erro que não é de sessão (ex.: HTTP 500) é propagado sem fallback', async () => {
    const restGet = jest.fn().mockRejectedValue(new Error('Service Now HTTP 500: boom'));
    const { facade, manager } = makeFacade({ restGet });
    await expect(facade.get(SN, 'table/incident')).rejects.toThrow(/500/);
    expect(manager.callTool).not.toHaveBeenCalled();
    expect(facade.isDirectDisabled()).toBe('');
  });

  test('connect reabilita o caminho direto', async () => {
    const restGet = jest.fn().mockRejectedValue(authErr());
    const { facade } = makeFacade({ restGet });
    await facade.get(SN, 'table/incident?sysparm_fields=sys_id&sysparm_limit=1');
    expect(facade.isDirectDisabled()).toBeTruthy();
    await facade.connect(SN);
    expect(facade.isDirectDisabled()).toBe('');
  });
});

describe('snMcp.get — concorrência na sessão SSO', () => {
  function busyErr() { const e = new Error('Service Now busy (HTTP 202)'); e.code = 'SN_BUSY'; return e; }

  function makeBusyFacade(restGet, opts = {}) {
    const manager = {
      ensureSession: jest.fn(async () => ({})), invalidateSession: jest.fn(), setTransport: jest.fn(), callTool: jest.fn(),
    };
    const sessionStore = {
      findSessionFile: () => 'f', readSessionHeaders: () => HEADERS, rotatedTokenFrom: () => '', persistRotatedToken: jest.fn(),
    };
    const log = jest.fn();
    const sleep = jest.fn(async () => {});
    const facade = createSnMcpFacade({ manager, installer: { paths: PATHS }, sessionStore, restGet, log, sleep, ...opts });
    return { facade, manager, log, sleep };
  }

  test('202 (sessão ocupada) é repetido com espera e não vira resultado vazio', async () => {
    const restGet = jest.fn()
      .mockRejectedValueOnce(busyErr())
      .mockRejectedValueOnce(busyErr())
      .mockResolvedValueOnce({ result: [{ sys_id: 'ok' }] });
    const { facade, sleep, manager } = makeBusyFacade(restGet);

    const r = await facade.get(SN, 'table/incident');

    expect(r.result[0].sys_id).toBe('ok');
    expect(restGet).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep.mock.calls[1][0]).toBeGreaterThan(sleep.mock.calls[0][0] - 400);
    expect(manager.invalidateSession).not.toHaveBeenCalled();
  });

  test('desiste após o limite de tentativas, registra e propaga o erro', async () => {
    const restGet = jest.fn().mockRejectedValue(busyErr());
    const { facade, log } = makeBusyFacade(restGet, { busyRetries: 2 });
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
    const { facade } = makeBusyFacade(restGet, { maxConcurrent: 3 });
    await Promise.all(Array.from({ length: 20 }, () => facade.get(SN, 'table/incident')));
    expect(restGet).toHaveBeenCalledTimes(20);
    expect(peak).toBe(3);
  });
});

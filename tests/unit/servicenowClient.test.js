jest.mock('https');
jest.mock('../../snMcp', () => ({ get: jest.fn() }));

const https = require('https');
const { EventEmitter } = require('events');
const snMcp = require('../../snMcp');
const { snGet } = require('../../servicenowClient');

function mockHttpsResponse(statusCode, body) {
  https.get.mockImplementation((url, opts, cb) => {
    const res = new EventEmitter();
    res.statusCode = statusCode;
    const req = new EventEmitter();
    setImmediate(() => { cb(res); res.emit('data', body); res.emit('end'); });
    return req;
  });
}

describe('snGet — dispatcher por modo', () => {
  test('modo mcp delega ao adaptador MCP sem tocar na REST', async () => {
    snMcp.get.mockResolvedValue({ result: [{ sys_id: '1' }] });
    const cfg = { mode: 'mcp', instance: 'x.service-now.com' };
    await expect(snGet(cfg, 'table/incident?sysparm_limit=1')).resolves.toEqual({ result: [{ sys_id: '1' }] });
    expect(snMcp.get).toHaveBeenCalledWith(cfg, 'table/incident?sysparm_limit=1');
    expect(https.get).not.toHaveBeenCalled();
  });

  test('modo api (padrão) usa Basic auth na REST', async () => {
    mockHttpsResponse(200, JSON.stringify({ result: [] }));
    await expect(snGet({ instance: 'https://x.service-now.com/', user: 'u', pass: 'p' }, 'table/incident?a=1')).resolves.toEqual({ result: [] });
    const [url, opts] = https.get.mock.calls[0];
    expect(url).toBe('https://x.service-now.com/api/now/table/incident?a=1');
    expect(opts.headers.Authorization).toBe(`Basic ${Buffer.from('u:p').toString('base64')}`);
    expect(snMcp.get).not.toHaveBeenCalled();
  });

  test('modo api: 401 gera mensagem de credencial inválida', async () => {
    mockHttpsResponse(401, '');
    await expect(snGet({ instance: 'x', user: 'u', pass: 'p' }, 'table/incident')).rejects.toThrow(/401/);
  });
});

// ── restGet com sessão SSO (modo MCP, caminho direto) ─────────────────────────

describe('restGet — headers de sessão', () => {
  const { restGet } = require('../../servicenowClient');

  function mockResponse(statusCode, body, headers = {}) {
    https.get.mockImplementation((url, opts, cb) => {
      const res = new EventEmitter();
      res.statusCode = statusCode;
      res.headers = headers;
      const req = new EventEmitter();
      setImmediate(() => { cb(res); res.emit('data', body); res.emit('end'); });
      return req;
    });
  }

  const SESSION = { Cookie: 'JSESSIONID=abc', 'User-Agent': 'Edg/157', 'X-UserToken': 'tok' };

  test('usa os headers de sessão no lugar do Basic auth', async () => {
    mockResponse(200, JSON.stringify({ result: [1] }));
    await expect(restGet({ instance: 'x.service-now.com' }, 'table/incident', { headers: SESSION })).resolves.toEqual({ result: [1] });
    const { headers } = https.get.mock.calls[0][1];
    expect(headers).toMatchObject(SESSION);
    expect(headers).not.toHaveProperty('Authorization');
  });

  test('401 vira SN_AUTH', async () => {
    mockResponse(401, '');
    await expect(restGet({ instance: 'x' }, 'table/incident', { headers: SESSION })).rejects.toMatchObject({ code: 'SN_AUTH' });
  });

  test('redirect para login vira SN_AUTH', async () => {
    mockResponse(302, '', { location: 'https://x/login.do' });
    await expect(restGet({ instance: 'x' }, 'table/incident', { headers: SESSION })).rejects.toMatchObject({ code: 'SN_AUTH' });
  });

  test('página HTML no lugar de JSON (sessão inválida) vira SN_AUTH', async () => {
    mockResponse(200, '<html><body>Login</body></html>');
    await expect(restGet({ instance: 'x' }, 'table/incident', { headers: SESSION })).rejects.toMatchObject({ code: 'SN_AUTH' });
  });

  test('entrega os headers da resposta ao callback (rotação de token)', async () => {
    mockResponse(200, JSON.stringify({ result: [] }), { 'x-usertoken': 'novo' });
    const onResponseHeaders = jest.fn();
    await restGet({ instance: 'x' }, 'table/incident', { headers: SESSION, onResponseHeaders });
    expect(onResponseHeaders).toHaveBeenCalledWith({ 'x-usertoken': 'novo' });
  });

  test('403 não é tratado como sessão expirada', async () => {
    mockResponse(403, '');
    await expect(restGet({ instance: 'x' }, 'table/incident', { headers: SESSION })).rejects.not.toMatchObject({ code: 'SN_AUTH' });
  });
});

describe('restGet — sessão ocupada', () => {
  const { restGet } = require('../../servicenowClient');

  test.each([202, 429])('HTTP %i vira SN_BUSY (para nova tentativa)', async (status) => {
    https.get.mockImplementation((url, opts, cb) => {
      const res = new EventEmitter();
      res.statusCode = status;
      res.headers = status === 429 ? { 'retry-after': '2' } : {};
      setImmediate(() => { cb(res); res.emit('end'); });
      return new EventEmitter();
    });
    await expect(restGet({ instance: 'x' }, 'table/incident', { headers: { Cookie: 'a' } }))
      .rejects.toMatchObject({ code: 'SN_BUSY', retryAfterMs: status === 429 ? 2000 : 0 });
  });
});

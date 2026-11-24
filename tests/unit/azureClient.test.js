// azureClient: PAT recusado (401/203 com corpo vazio) vira erro identificável
// em vez de "Parse error:".
jest.mock('https');
jest.mock('../../config');

const https = require('https');
const { EventEmitter } = require('events');
const { getCfg, getAuth } = require('../../config');
const { azureGet, azurePost, rawAzureGet, AUTH_ERROR_CODE, isAuthStatus } = require('../../azureClient');

// Resposta HTTP simulada: emite o corpo e o fim no próximo tick
function fakeResponse(statusCode, body = '', headers = {}) {
  const res = new EventEmitter();
  res.statusCode = statusCode;
  res.headers = headers;
  res.resume = jest.fn();
  process.nextTick(() => {
    if (body) res.emit('data', body);
    res.emit('end');
  });
  return res;
}

function mockGet(statusCode, body) {
  https.get.mockImplementation((url, opts, cb) => {
    cb(fakeResponse(statusCode, body));
    return { on: jest.fn().mockReturnThis() };
  });
}

function mockRequest(statusCode, body) {
  https.request.mockImplementation((opts, cb) => {
    const req = { on: jest.fn().mockReturnThis(), write: jest.fn(), end: jest.fn(() => cb(fakeResponse(statusCode, body))) };
    return req;
  });
}

beforeEach(() => {
  getCfg.mockReturnValue({ baseUrl: 'https://dev.azure.com/org' });
  getAuth.mockReturnValue('dG9rZW4=');
});

describe('isAuthStatus', () => {
  test('401 e 203 são falha de autenticação', () => {
    expect(isAuthStatus(401)).toBe(true);
    expect(isAuthStatus(203)).toBe(true);
    expect(isAuthStatus(200)).toBe(false);
    expect(isAuthStatus(404)).toBe(false);
  });
});

describe('azureGet', () => {
  test('200 com JSON resolve o corpo', async () => {
    mockGet(200, '{"value":[1]}');
    await expect(azureGet('P/_apis/x')).resolves.toEqual({ value: [1] });
    expect(https.get.mock.calls[0][0]).toBe('https://dev.azure.com/org/P/_apis/x');
  });

  test('401 com corpo vazio rejeita com código AZURE_AUTH e mensagem amigável', async () => {
    mockGet(401, '');
    await expect(azureGet('P/_apis/x')).rejects.toMatchObject({
      code: AUTH_ERROR_CODE, status: 401, message: expect.stringContaining('expirado ou inválido'),
    });
  });

  test('203 (página de login) também é falha de autenticação', async () => {
    mockGet(203, '<html>login</html>');
    await expect(azureGet('P/_apis/x')).rejects.toMatchObject({ code: AUTH_ERROR_CODE, status: 203 });
  });

  test('erro HTTP sem JSON vira mensagem legível (sem o HTML da página)', async () => {
    mockGet(500, '<html>erro</html>');
    await expect(azureGet('P/_apis/x')).rejects.toThrow('Azure DevOps respondeu HTTP 500.');
  });

  test('404 sem JSON explica que a organização ou o projeto não existe', async () => {
    mockGet(404, '<!DOCTYPE html><title>404</title>');
    await expect(azureGet('P/_apis/x')).rejects.toThrow('organização ou projeto não encontrado');
  });

  test('200 com corpo inválido continua como Parse error', async () => {
    mockGet(200, 'oops');
    await expect(azureGet('P/_apis/x')).rejects.toThrow('Parse error: oops');
  });
});

describe('azurePost', () => {
  test('200 com JSON resolve o corpo', async () => {
    mockRequest(200, '{"workItems":[]}');
    await expect(azurePost('P/_apis/wit/wiql', { query: 'x' })).resolves.toEqual({ workItems: [] });
  });

  test('401 rejeita com código AZURE_AUTH', async () => {
    mockRequest(401, '');
    await expect(azurePost('P/_apis/wit/wiql', { query: 'x' })).rejects.toMatchObject({ code: AUTH_ERROR_CODE });
  });
});

describe('organização informada', () => {
  const ORG_B = { id: 'b', org: 'B', label: 'Cliente B', baseUrl: 'https://b.visualstudio.com', pat: 'pb' };

  test('azureGet usa a URL e o token da organização', async () => {
    mockGet(200, '{}');
    await azureGet('P/_apis/x', ORG_B);
    expect(https.get.mock.calls[0][0]).toBe('https://b.visualstudio.com/P/_apis/x');
    expect(https.get.mock.calls[0][1].headers.Authorization).toBe('Basic ' + Buffer.from(':pb').toString('base64'));
  });

  test('azurePost usa o host e o token da organização', async () => {
    mockRequest(200, '{}');
    await azurePost('P/_apis/wit/wiql', { query: 'x' }, ORG_B);
    const opts = https.request.mock.calls[0][0];
    expect(opts.hostname).toBe('b.visualstudio.com');
    expect(opts.path).toBe('/P/_apis/wit/wiql');
    expect(opts.headers.Authorization).toBe('Basic ' + Buffer.from(':pb').toString('base64'));
  });

  test('sem organização continua usando a principal', async () => {
    mockGet(200, '{}');
    await azureGet('P/_apis/x');
    expect(https.get.mock.calls[0][0]).toBe('https://dev.azure.com/org/P/_apis/x');
    expect(https.get.mock.calls[0][1].headers.Authorization).toBe('Basic dG9rZW4=');
  });

  test('token recusado cita a organização e guarda o id', async () => {
    mockGet(401, '');
    await expect(azureGet('P/_apis/x', ORG_B)).rejects.toMatchObject({
      code: AUTH_ERROR_CODE, orgId: 'b', message: expect.stringContaining('"Cliente B"'),
    });
  });
});

describe('rawAzureGet', () => {
  test('401 sem corpo devolve o status em vez de rejeitar', async () => {
    mockGet(401, '');
    await expect(rawAzureGet('https://dev.azure.com/org/_apis/projects', 'x')).resolves.toEqual({ status: 401, data: {} });
  });

  test('200 com corpo inválido continua rejeitando', async () => {
    mockGet(200, 'nao-json');
    await expect(rawAzureGet('https://dev.azure.com/org/_apis/projects', 'x')).rejects.toThrow('HTTP 200');
  });
});

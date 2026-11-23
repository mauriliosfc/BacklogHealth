jest.mock('../../../config');
jest.mock('../../../snMcp', () => ({
  getStatus: jest.fn(),
  connect:   jest.fn(),
  warmup:    jest.fn(),
  logout:    jest.fn(),
}));

const { getSnConfig } = require('../../../config');
const snMcp = require('../../../snMcp');
const handlers = require('../../../handlers/snMcp');
const { getMcpStatus, connectMcp, warmupMcp, disconnectMcp } = handlers;

beforeEach(() => {
  snMcp.connect.mockResolvedValue({ state: 'connected' });
  snMcp.warmup.mockResolvedValue(true);
});

describe('getMcpStatus', () => {
  test('devolve status da sessão SSO com o modo salvo', () => {
    getSnConfig.mockReturnValue({ mode: 'mcp' });
    snMcp.getStatus.mockReturnValue({ state: 'connected', user: 'João', edgeAvailable: true });
    expect(getMcpStatus()).toEqual({ state: 'connected', user: 'João', edgeAvailable: true, mode: 'mcp' });
  });

  test('modo padrão é api', () => {
    getSnConfig.mockReturnValue(null);
    snMcp.getStatus.mockReturnValue({ state: 'stopped' });
    expect(getMcpStatus().mode).toBe('api');
  });
});

test('não existe mais a instalação de componentes', () => {
  expect(handlers.installMcp).toBeUndefined();
});

describe('connectMcp', () => {
  test('usa a instância informada (normalizada) e o usuário SSO', () => {
    getSnConfig.mockReturnValue({ instance: 'antiga.service-now.com', assignmentGroups: ['A'] });
    connectMcp({ instance: 'https://nova.service-now.com/', mcpUsername: ' joao ' });
    expect(snMcp.connect).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'mcp', instance: 'nova.service-now.com', assignmentGroups: ['A'], mcp: { username: 'joao' },
    }));
  });

  test('repassa a URL de login e ignora campos legados (navegador, CA)', () => {
    getSnConfig.mockReturnValue({ instance: 'a.service-now.com' });
    connectMcp({ mcpLoginUrl: ' https://a/sso ', mcpBrowser: 'chromium', mcpCaBundle: 'C:/ca.pem' });
    expect(snMcp.connect).toHaveBeenCalledWith(expect.objectContaining({ mcp: { loginUrl: 'https://a/sso' } }));
  });

  test('cai para a instância salva', () => {
    getSnConfig.mockReturnValue({ instance: 'salva.service-now.com', mcp: { username: 'ana' } });
    connectMcp();
    expect(snMcp.connect).toHaveBeenCalledWith(expect.objectContaining({ instance: 'salva.service-now.com', mcp: { username: 'ana' } }));
  });

  test('falha do login não derruba a requisição', async () => {
    getSnConfig.mockReturnValue({ instance: 'a.service-now.com' });
    snMcp.connect.mockRejectedValue(new Error('janela fechada'));
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(connectMcp()).toEqual({ ok: true, started: true });
    await new Promise(r => setImmediate(r));
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  test('400 sem instância', () => {
    getSnConfig.mockReturnValue(null);
    expect(() => connectMcp()).toThrow(expect.objectContaining({ status: 400 }));
  });
});

describe('disconnectMcp', () => {
  test('faz logout (apaga sessão e perfil)', () => {
    expect(disconnectMcp()).toEqual({ ok: true });
    expect(snMcp.logout).toHaveBeenCalled();
  });
});

describe('warmupMcp', () => {
  test('confere a sessão salva com a instância salva', () => {
    getSnConfig.mockReturnValue({ mode: 'mcp', instance: 'a.service-now.com' });
    expect(warmupMcp()).toEqual({ ok: true, started: true });
    expect(snMcp.warmup).toHaveBeenCalledWith(expect.objectContaining({ mode: 'mcp', instance: 'a.service-now.com' }));
  });

  test('sem instância não faz nada', () => {
    getSnConfig.mockReturnValue(null);
    expect(warmupMcp()).toEqual({ ok: false });
    expect(snMcp.warmup).not.toHaveBeenCalled();
  });
});

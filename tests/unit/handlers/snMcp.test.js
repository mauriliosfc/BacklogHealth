jest.mock('../../../config');
jest.mock('../../../snMcp', () => ({
  getStatus: jest.fn(),
  install:   jest.fn(),
  connect:   jest.fn(),
  warmup:    jest.fn(),
  logout:    jest.fn(),
}));

const { getSnConfig } = require('../../../config');
const snMcp = require('../../../snMcp');
const { getMcpStatus, installMcp, connectMcp, warmupMcp, disconnectMcp } = require('../../../handlers/snMcp');

beforeEach(() => {
  snMcp.install.mockResolvedValue();
  snMcp.connect.mockResolvedValue({ state: 'connected' });
  snMcp.warmup.mockResolvedValue(true);
});

describe('getMcpStatus', () => {
  test('devolve status do MCP com o modo salvo', () => {
    getSnConfig.mockReturnValue({ mode: 'mcp' });
    snMcp.getStatus.mockReturnValue({ state: 'connected', user: 'João' });
    expect(getMcpStatus()).toEqual({ state: 'connected', user: 'João', mode: 'mcp' });
  });

  test('modo padrão é api', () => {
    getSnConfig.mockReturnValue(null);
    snMcp.getStatus.mockReturnValue({ state: 'stopped' });
    expect(getMcpStatus().mode).toBe('api');
  });
});

describe('installMcp', () => {
  test('dispara instalação em background com o CA bundle salvo', () => {
    getSnConfig.mockReturnValue({ mcp: { caBundle: 'C:/ca.pem' } });
    expect(installMcp()).toEqual({ ok: true, started: true });
    expect(snMcp.install).toHaveBeenCalledWith({ caBundle: 'C:/ca.pem', browser: 'edge' });
  });

  test('repassa o navegador escolhido (Chromium baixa o navegador junto)', () => {
    getSnConfig.mockReturnValue({ mcp: { browser: 'chromium' } });
    installMcp();
    expect(snMcp.install).toHaveBeenCalledWith(expect.objectContaining({ browser: 'chromium' }));
  });

  test('CA bundle informado tem prioridade', () => {
    getSnConfig.mockReturnValue({ mcp: { caBundle: 'C:/ca.pem' } });
    installMcp({ mcpCaBundle: ' D:/outro.pem ' });
    expect(snMcp.install).toHaveBeenCalledWith({ caBundle: 'D:/outro.pem', browser: 'edge' });
  });

  test('falha da instalação não derruba a requisição', async () => {
    getSnConfig.mockReturnValue(null);
    snMcp.install.mockRejectedValue(new Error('rede'));
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(installMcp()).toEqual({ ok: true, started: true });
    await new Promise(r => setImmediate(r));
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('connectMcp', () => {
  test('usa a instância informada (normalizada) e o usuário SSO', () => {
    getSnConfig.mockReturnValue({ instance: 'antiga.service-now.com', assignmentGroups: ['A'] });
    connectMcp({ instance: 'https://nova.service-now.com/', mcpUsername: ' joao ' });
    expect(snMcp.connect).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'mcp', instance: 'nova.service-now.com', assignmentGroups: ['A'], mcp: { username: 'joao' },
    }));
  });

  test('repassa URL de login e navegador', () => {
    getSnConfig.mockReturnValue({ instance: 'a.service-now.com' });
    connectMcp({ mcpLoginUrl: ' https://a/sso ', mcpBrowser: 'chromium' });
    expect(snMcp.connect).toHaveBeenCalledWith(expect.objectContaining({ mcp: { loginUrl: 'https://a/sso', browser: 'chromium' } }));
  });

  test('cai para a instância salva', () => {
    getSnConfig.mockReturnValue({ instance: 'salva.service-now.com', mcp: { username: 'ana' } });
    connectMcp();
    expect(snMcp.connect).toHaveBeenCalledWith(expect.objectContaining({ instance: 'salva.service-now.com', mcp: { username: 'ana' } }));
  });

  test('400 sem instância', () => {
    getSnConfig.mockReturnValue(null);
    expect(() => connectMcp()).toThrow(expect.objectContaining({ status: 400 }));
  });
});

describe('disconnectMcp', () => {
  test('faz logout do MCP', () => {
    expect(disconnectMcp()).toEqual({ ok: true });
    expect(snMcp.logout).toHaveBeenCalled();
  });
});

describe('warmupMcp', () => {
  test('pré-aquece com a instância salva', () => {
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

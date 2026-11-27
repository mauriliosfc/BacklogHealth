jest.mock('../../../config');
jest.mock('../../../snMcp', () => ({
  getStatus: jest.fn(),
  connect:   jest.fn(),
  warmup:    jest.fn(),
  logout:    jest.fn(),
}));

const { getSnConfig, getSnInstance, getSnInstances, snLabel } = require('../../../config');
const snMcp = require('../../../snMcp');
const handlers = require('../../../handlers/snMcp');
const { getMcpStatus, connectMcp, warmupMcp, disconnectMcp } = handlers;

beforeEach(() => {
  getSnInstance.mockImplementation(() => getSnConfig());
  getSnInstances.mockImplementation(() => (getSnConfig() ? [getSnConfig()] : []));
  snLabel.mockImplementation(s => s.label || s.instance);
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
  test('usa a instância informada (normalizada) e o usuário SSO, sem herdar dados de outra instância', () => {
    getSnConfig.mockReturnValue({ instance: 'antiga.service-now.com', assignmentGroups: ['A'], mcp: { username: 'velho' } });
    connectMcp({ instance: 'https://nova.service-now.com/', mcpUsername: ' joao ' });
    expect(snMcp.connect).toHaveBeenCalledWith({ mode: 'mcp', instance: 'nova.service-now.com', mcp: { username: 'joao' } });
  });

  test('mesma instância salva: herda o usuário SSO salvo', () => {
    getSnConfig.mockReturnValue({ id: 'a', instance: 'a.service-now.com', mcp: { username: 'ana' } });
    connectMcp({ instance: 'https://A.service-now.com/' });
    expect(snMcp.connect).toHaveBeenCalledWith(expect.objectContaining({ instance: 'A.service-now.com', mcp: { username: 'ana' } }));
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

// ── Várias instâncias ─────────────────────────────────────────────────────────

describe('várias instâncias', () => {
  const A = { id: 'a', instance: 'a.service-now.com', mode: 'mcp', mcp: { username: 'ana' } };
  const B = { id: 'b', instance: 'b.service-now.com', mode: 'mcp', label: 'Cliente B', mcp: { username: 'bia' } };
  const C = { id: 'c', instance: 'c.service-now.com', mode: 'api', user: 'u', pass: 'p' };

  beforeEach(() => {
    getSnInstances.mockReturnValue([A, B, C]);
    getSnInstance.mockImplementation(id => [A, B, C].find(s => s.id === id) || A);
    snMcp.getStatus.mockImplementation(cfg => ({ state: cfg && cfg.instance === 'b.service-now.com' ? 'error' : 'connected' }));
  });

  test('status com all lista só as instâncias SSO, com nome e principal', () => {
    expect(getMcpStatus({ all: '1' })).toEqual({ statuses: [
      { instanceId: 'a', label: 'a.service-now.com', isPrimary: true,  dashboard: true,  state: 'connected' },
      { instanceId: 'b', label: 'Cliente B',         isPrimary: false, dashboard: false, state: 'error' },
    ] });
  });

  test('status de uma instância pelo id', () => {
    expect(getMcpStatus({ instanceId: 'b' })).toMatchObject({ state: 'error', mode: 'mcp', instanceId: 'b' });
  });

  test('connect e warmup usam a instância indicada', () => {
    connectMcp({ instanceId: 'b' });
    warmupMcp({ instanceId: 'b' });
    expect(snMcp.connect).toHaveBeenCalledWith(expect.objectContaining({ instance: 'b.service-now.com', mcp: { username: 'bia' } }));
    expect(snMcp.warmup).toHaveBeenCalledWith(expect.objectContaining({ instance: 'b.service-now.com' }));
  });

  test('disconnect com instância sai só dela; sem instância, de todas', () => {
    disconnectMcp({ instanceId: 'b' });
    expect(snMcp.logout).toHaveBeenLastCalledWith(expect.objectContaining({ instance: 'b.service-now.com' }));
    disconnectMcp();
    expect(snMcp.logout).toHaveBeenLastCalledWith();
  });
});

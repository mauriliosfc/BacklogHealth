jest.mock('../../../config');
jest.mock('../../../utils/health', () => ({
  DEFAULT_THRESHOLDS: { semEst: { warn: 30, crit: 50 }, semResp: { warn: 20 }, bugs: { warn: 5, crit: 10 } },
  calcHealth: jest.fn(),
}));

const { getHealthConfig, saveHealthConfig } = require('../../../handlers/healthConfig');
const { getCfg, saveConfig } = require('../../../config');

const DEFAULT = { semEst: { warn: 30, crit: 50 }, semResp: { warn: 20 }, bugs: { warn: 5, crit: 10 } };

// ── getHealthConfig ──────────────────────────────────────────────────────────

describe('getHealthConfig', () => {
  test('retorna defaults quando health não está configurado', async () => {
    getCfg.mockReturnValue({});

    const result = await getHealthConfig();

    expect(result).toEqual(DEFAULT);
  });

  test('mescla configuração salva com defaults', async () => {
    getCfg.mockReturnValue({ health: { semEst: { warn: 20, crit: 40 } } });

    const result = await getHealthConfig();

    expect(result.semEst).toEqual({ warn: 20, crit: 40 });
    expect(result.semResp).toEqual(DEFAULT.semResp);
    expect(result.bugs).toEqual(DEFAULT.bugs);
  });

  test('mescla parcialmente campos dentro de semResp', async () => {
    getCfg.mockReturnValue({ health: { semResp: { warn: 15 } } });

    const result = await getHealthConfig();

    expect(result.semResp.warn).toBe(15);
    expect(result.semEst).toEqual(DEFAULT.semEst);
  });
});

// ── saveHealthConfig ─────────────────────────────────────────────────────────

describe('saveHealthConfig', () => {
  beforeEach(() => {
    getCfg.mockReturnValue({ org: 'myorg' });
    saveConfig.mockReset();
  });

  test('salva configuração válida', async () => {
    const body = {
      semEst:  { warn: 25, crit: 45 },
      semResp: { warn: 15 },
      bugs:    { warn: 3,  crit: 8  },
    };

    await saveHealthConfig(body);

    expect(saveConfig).toHaveBeenCalledWith({
      org: 'myorg',
      health: {
        semEst:  { warn: 25, crit: 45 },
        semResp: { warn: 15 },
        bugs:    { warn: 3,  crit: 8  },
      },
    });
  });

  test('lança 400 quando semEst.warn >= semEst.crit', async () => {
    await expect(saveHealthConfig({
      semEst:  { warn: 50, crit: 50 },
      semResp: { warn: 20 },
      bugs:    { warn: 5,  crit: 10 },
    })).rejects.toMatchObject({ status: 400 });
  });

  test('lança 400 quando bugs.warn >= bugs.crit', async () => {
    await expect(saveHealthConfig({
      semEst:  { warn: 30, crit: 50 },
      semResp: { warn: 20 },
      bugs:    { warn: 10, crit: 10 },
    })).rejects.toMatchObject({ status: 400 });
  });

  test('lança 400 para valores não numéricos', async () => {
    await expect(saveHealthConfig({
      semEst:  { warn: 'abc', crit: 50 },
      semResp: { warn: 20 },
      bugs:    { warn: 5, crit: 10 },
    })).rejects.toMatchObject({ status: 400 });
  });

  test('lança 400 para body nulo', async () => {
    await expect(saveHealthConfig(null)).rejects.toMatchObject({ status: 400 });
  });

  test('preserva campos existentes do config ao salvar', async () => {
    getCfg.mockReturnValue({ org: 'myorg', pat: 'token', projects: [] });

    await saveHealthConfig({
      semEst:  { warn: 30, crit: 50 },
      semResp: { warn: 20 },
      bugs:    { warn: 5,  crit: 10 },
    });

    const saved = saveConfig.mock.calls[0][0];
    expect(saved.org).toBe('myorg');
    expect(saved.pat).toBe('token');
    expect(saved.projects).toEqual([]);
    expect(saved.health).toBeDefined();
  });

  test('converte strings numéricas para números', async () => {
    await saveHealthConfig({
      semEst:  { warn: '25', crit: '45' },
      semResp: { warn: '15' },
      bugs:    { warn: '3',  crit: '8'  },
    });

    const saved = saveConfig.mock.calls[0][0];
    expect(saved.health.semEst.warn).toBe(25);
    expect(typeof saved.health.semEst.warn).toBe('number');
  });
});

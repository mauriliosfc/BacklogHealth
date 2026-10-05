jest.mock('../../../config');

const { getIndicatorConfig, saveIndicatorConfig } = require('../../../handlers/indicatorConfig');
const { getCfg, getDisplayName, saveConfig } = require('../../../config');
const { DEFAULT_INDICATORS } = require('../../../utils/healthIndicators');

beforeEach(() => {
  jest.clearAllMocks();
  getDisplayName.mockImplementation(p => (typeof p === 'string' ? p : p.name));
});

describe('getIndicatorConfig', () => {
  test('retorna defaults quando o projeto não tem healthIndicators salvo', () => {
    getCfg.mockReturnValue({ projects: [{ name: 'Alpha' }] });

    expect(getIndicatorConfig({ project: 'Alpha' })).toEqual(DEFAULT_INDICATORS);
  });

  test('mescla config salva do projeto com os defaults', () => {
    getCfg.mockReturnValue({
      projects: [{
        name: 'Alpha',
        healthIndicators: {
          completion: { states: ['Concluído'], color: '#3b82f6' },
          bugRate:    { basis: 'count' },
        },
      }],
    });

    const result = getIndicatorConfig({ project: 'Alpha' });

    expect(result.completion).toEqual({ states: ['Concluído'], color: '#3b82f6' });
    expect(result.bugRate).toEqual({ basis: 'count', color: '' });
    expect(result.uat).toEqual(DEFAULT_INDICATORS.uat);
  });

  test('lança 400 quando project não é informado', () => {
    getCfg.mockReturnValue({ projects: [] });
    expect(() => getIndicatorConfig({})).toThrow('project required');
  });

  test('lança 404 quando o projeto não existe', () => {
    getCfg.mockReturnValue({ projects: [{ name: 'Alpha' }] });
    expect(() => getIndicatorConfig({ project: 'Beta' })).toThrow('Projeto não encontrado');
  });
});

describe('saveIndicatorConfig', () => {
  test('grava apenas os indicadores enviados, preservando os demais já salvos', () => {
    const proj = {
      name: 'Alpha',
      healthIndicators: {
        completion: { states: ['Done'], color: '#1' },
        uat:        { states: ['UAT'], color: '#2' },
      },
    };
    getCfg.mockReturnValue({ projects: [proj] });

    const result = saveIndicatorConfig({
      project: 'Alpha',
      bugRate: { basis: 'count', color: '#3' },
    });

    expect(result).toEqual({ ok: true });
    expect(proj.healthIndicators.completion).toEqual({ states: ['Done'], color: '#1' });
    expect(proj.healthIndicators.uat).toEqual({ states: ['UAT'], color: '#2' });
    expect(proj.healthIndicators.bugRate).toEqual({ basis: 'count', color: '#3' });
    expect(saveConfig).toHaveBeenCalledTimes(1);
  });

  test('mescla campo a campo dentro do mesmo indicador em vez de sobrescrever', () => {
    const proj = { name: 'Alpha', healthIndicators: { completion: { states: ['Done'], color: '#1' } } };
    getCfg.mockReturnValue({ projects: [proj] });

    saveIndicatorConfig({ project: 'Alpha', completion: { color: '#2' } });

    expect(proj.healthIndicators.completion).toEqual({ states: ['Done'], color: '#2' });
  });

  test('não grava config de outros projetos', () => {
    const alpha = { name: 'Alpha' };
    const beta  = { name: 'Beta', healthIndicators: { completion: { states: ['X'], color: '#9' } } };
    getCfg.mockReturnValue({ projects: [alpha, beta] });

    saveIndicatorConfig({ project: 'Alpha', completion: { states: ['Done'] } });

    expect(alpha.healthIndicators.completion).toEqual({ states: ['Done'] });
    expect(beta.healthIndicators.completion).toEqual({ states: ['X'], color: '#9' });
  });

  test('lança 400 quando project não é informado', () => {
    getCfg.mockReturnValue({ projects: [] });
    expect(() => saveIndicatorConfig({})).toThrow('project required');
  });

  test('lança 404 quando o projeto não existe', () => {
    getCfg.mockReturnValue({ projects: [{ name: 'Alpha' }] });
    expect(() => saveIndicatorConfig({ project: 'Beta', completion: {} })).toThrow('Projeto não encontrado');
  });
});

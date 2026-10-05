const { DEFAULT_INDICATORS, resolveIndicatorConfig } = require('../../../utils/healthIndicators');

describe('resolveIndicatorConfig', () => {
  test('retorna os defaults quando nada foi salvo', () => {
    expect(resolveIndicatorConfig()).toEqual(DEFAULT_INDICATORS);
    expect(resolveIndicatorConfig({})).toEqual(DEFAULT_INDICATORS);
  });

  test('mescla config parcial preservando os demais indicadores com default', () => {
    const result = resolveIndicatorConfig({
      completion: { states: ['Concluído'], color: '#3b82f6' },
    });

    expect(result.completion).toEqual({ states: ['Concluído'], color: '#3b82f6' });
    expect(result.uat).toEqual(DEFAULT_INDICATORS.uat);
    expect(result.bugRate).toEqual(DEFAULT_INDICATORS.bugRate);
    expect(result.estimateCoverage).toEqual(DEFAULT_INDICATORS.estimateCoverage);
    expect(result.effortSaved).toEqual(DEFAULT_INDICATORS.effortSaved);
  });

  test('mescla campo a campo dentro de um mesmo indicador', () => {
    const result = resolveIndicatorConfig({ bugRate: { color: '#f00' } });
    expect(result.bugRate).toEqual({ basis: 'hours', color: '#f00' });
  });

  test('aceita configuração completa dos 5 indicadores', () => {
    const saved = {
      completion:       { states: ['Done'], color: '#1' },
      uat:              { states: ['Homologação'], color: '#2' },
      bugRate:          { basis: 'count', color: '#3' },
      estimateCoverage: { scope: 'open', color: '#4' },
      effortSaved:      { color: '#5' },
    };
    expect(resolveIndicatorConfig(saved)).toEqual(saved);
  });
});

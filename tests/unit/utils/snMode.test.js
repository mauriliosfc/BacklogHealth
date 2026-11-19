const { getSnMode, isSnConfigured } = require('../../../utils/snMode');

describe('getSnMode', () => {
  test('mcp somente quando explícito', () => {
    expect(getSnMode({ mode: 'mcp' })).toBe('mcp');
    expect(getSnMode({ mode: 'api' })).toBe('api');
    expect(getSnMode({})).toBe('api');
    expect(getSnMode(null)).toBe('api');
  });
});

describe('isSnConfigured', () => {
  test('modo API exige instância, usuário e senha', () => {
    expect(isSnConfigured({ instance: 'x', user: 'u', pass: 'p' })).toBe(true);
    expect(isSnConfigured({ instance: 'x', user: 'u' })).toBe(false);
  });

  test('modo MCP exige apenas a instância', () => {
    expect(isSnConfigured({ mode: 'mcp', instance: 'x' })).toBe(true);
    expect(isSnConfigured({ mode: 'mcp' })).toBe(false);
  });

  test('null não está configurado', () => {
    expect(isSnConfigured(null)).toBe(false);
  });
});

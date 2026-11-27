const { normalizeHost, snIdFor, uniqueSnId, snLabel, normalizeSnInstances, snPublic } = require('../../../utils/snInstances');

describe('utils/snInstances', () => {
  test('normalizeHost remove protocolo, barra final e maiúsculas', () => {
    expect(normalizeHost('https://Empresa.Service-Now.com/')).toBe('empresa.service-now.com');
    expect(normalizeHost('')).toBe('');
  });

  test('snIdFor usa o primeiro trecho do host', () => {
    expect(snIdFor('cnhi.service-now.com')).toBe('cnhi');
    expect(snIdFor('https://vale.service-now.com')).toBe('vale');
    expect(snIdFor('')).toBe('sn');
  });

  test('uniqueSnId acrescenta sufixo quando o id já existe', () => {
    expect(uniqueSnId('a.service-now.com', [{ id: 'a' }, { id: 'a-2' }])).toBe('a-3');
    expect(uniqueSnId('b.service-now.com', [{ id: 'a' }])).toBe('b');
  });

  test('snLabel prefere o nome de exibição', () => {
    expect(snLabel({ instance: 'x.service-now.com', label: 'Cliente X' })).toBe('Cliente X');
    expect(snLabel({ instance: 'https://x.service-now.com/' })).toBe('x.service-now.com');
    expect(snLabel(null)).toBe('');
  });

  test('snPublic nunca devolve senha', () => {
    const p = snPublic({ id: 'a', instance: 'a.service-now.com', mode: 'api', user: 'u', pass: 'segredo' });
    expect(p).toEqual({ id: 'a', instance: 'a.service-now.com', label: '', mode: 'api', user: 'u', hasPass: true, mcpUsername: '', mcpLoginUrl: '' });
    expect(JSON.stringify(p)).not.toContain('segredo');
    expect(snPublic({ id: 'b', instance: 'b', mode: 'mcp', mcp: { username: 'me', loginUrl: 'https://sso' } }, { status: 'ok' }))
      .toMatchObject({ mode: 'mcp', mcpUsername: 'me', mcpLoginUrl: 'https://sso', status: 'ok', hasPass: false });
  });
});

describe('normalizeSnInstances', () => {
  test('config antiga: servicenow vira a primeira instância', () => {
    const d = normalizeSnInstances({ servicenow: { instance: 'a.service-now.com', user: 'u', pass: 'p', assignmentGroups: ['G'] } });
    expect(d.snInstances).toEqual([{ id: 'a', instance: 'a.service-now.com', user: 'u', pass: 'p', assignmentGroups: ['G'] }]);
    expect(d.servicenow).toEqual({ instance: 'a.service-now.com', user: 'u', pass: 'p', assignmentGroups: ['G'] });
  });

  test('sem Service Now configurado não cria instância', () => {
    expect(normalizeSnInstances({}).snInstances).toEqual([]);
    expect(normalizeSnInstances({ servicenow: { user: 'u' } }).snInstances).toEqual([]);
  });

  test('servicenow prevalece sobre a principal (quem grava direto não perde a alteração)', () => {
    const d = normalizeSnInstances({
      servicenow: { instance: 'a.service-now.com', mode: 'api', user: 'u', pass: 'p', assignmentGroups: ['Novo'] },
      snInstances: [
        { id: 'a', label: 'Cliente A', instance: 'a.service-now.com', mode: 'api', user: 'u', pass: 'p', assignmentGroups: ['Velho'] },
        { id: 'b', instance: 'b.service-now.com', mode: 'mcp' },
      ],
    });
    expect(d.snInstances[0]).toMatchObject({ id: 'a', label: 'Cliente A', assignmentGroups: ['Novo'] });
    expect(d.snInstances[1]).toEqual({ id: 'b', instance: 'b.service-now.com', mode: 'mcp' });
  });

  test('sem servicenow, ele é recriado a partir da principal (sem id e label)', () => {
    const d = normalizeSnInstances({ snInstances: [{ id: 'b', label: 'B', instance: 'b.service-now.com', mode: 'mcp' }] });
    expect(d.servicenow).toEqual({ instance: 'b.service-now.com', mode: 'mcp' });
  });

  test('ids repetidos ou ausentes são corrigidos', () => {
    const d = normalizeSnInstances({ snInstances: [
      { id: 'x', instance: 'x.service-now.com' }, { id: 'x', instance: 'x.service-now.com' }, { instance: 'y.service-now.com' }, { label: 'sem instância' },
    ] });
    expect(d.snInstances.map(s => s.id)).toEqual(['x', 'x-2', 'y']);
  });
});

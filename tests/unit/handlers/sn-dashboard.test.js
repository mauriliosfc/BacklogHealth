jest.mock('../../../config');
jest.mock('../../../servicenowClient');

const { getCfg }  = require('../../../config');
const { snGet }   = require('../../../servicenowClient');
const snDash      = require('../../../handlers/sn-dashboard');

const BASE_CFG = {
  servicenow: { instance: 'dev.service-now.com', user: 'admin', pass: 'secret' },
};

const SAMPLE_INCIDENTS = [
  { number: 'INC0001', short_description: 'Server down', priority: '1', assignment_group: 'Network Ops', opened_at: new Date(Date.now() - 2 * 3600_000).toISOString(), sys_id: 'aaa111' },
  { number: 'INC0002', short_description: 'Email issue',  priority: '2', assignment_group: 'Network Ops', opened_at: new Date(Date.now() - 25 * 3600_000).toISOString(), sys_id: 'bbb222' },
  { number: 'INC0003', short_description: 'VPN slow',    priority: '3', assignment_group: 'Network Ops', opened_at: new Date(Date.now() - 3 * 3600_000).toISOString(), sys_id: 'ccc333' },
  { number: 'INC0004', short_description: 'DB timeout',  priority: '1', assignment_group: 'Database',    opened_at: new Date(Date.now() - 1 * 3600_000).toISOString(), sys_id: 'ddd444' },
];

beforeEach(() => {
  getCfg.mockReturnValue(BASE_CFG);
  snGet.mockResolvedValue({ result: SAMPLE_INCIDENTS });
});

// ── fetchSNGroups ─────────────────────────────────────────────────────────────

describe('fetchSNGroups', () => {
  test('agrupa incidentes por assignment_group', async () => {
    const { groups } = await snDash.fetchSNGroups(BASE_CFG.servicenow);
    const names = groups.map(g => g.name);
    expect(names).toContain('Network Ops');
    expect(names).toContain('Database');
  });

  test('conta p1/p2/p3 por grupo corretamente', async () => {
    const { groups } = await snDash.fetchSNGroups(BASE_CFG.servicenow);
    const netOps = groups.find(g => g.name === 'Network Ops');
    expect(netOps.p1).toBe(1);
    expect(netOps.p2).toBe(1);
    expect(netOps.p3).toBe(1);
    const db = groups.find(g => g.name === 'Database');
    expect(db.p1).toBe(1);
    expect(db.p2).toBe(0);
    expect(db.p3).toBe(0);
  });

  test('calcula KPIs totais corretamente', async () => {
    const { kpi } = await snDash.fetchSNGroups(BASE_CFG.servicenow);
    expect(kpi.totalOpen).toBe(4);
    expect(kpi.totalP1).toBe(2);
    expect(kpi.totalP2).toBe(1);
    expect(kpi.totalP3).toBe(1);
    expect(kpi.activeGroups).toBe(2);
  });

  test('ordena grupos por severidade (mais crítico primeiro)', async () => {
    const { groups } = await snDash.fetchSNGroups(BASE_CFG.servicenow);
    // Network Ops tem p1=1,p2=1,p3=1 → score 111; Database tem p1=1 → score 100
    // Ambos têm p1=1, mas Network Ops tem p2 e p3 também → score maior
    expect(groups[0].name).toBe('Network Ops');
  });

  test('limita a 3 incidentes por grupo na lista de preview', async () => {
    // Adiciona mais incidentes ao mesmo grupo
    const extra = [...SAMPLE_INCIDENTS, ...Array.from({ length: 5 }, (_, i) => ({
      number: `INC00${10 + i}`, short_description: `Extra ${i}`, priority: '3',
      assignment_group: 'Network Ops', opened_at: new Date().toISOString(), sys_id: `eee${i}`,
    }))];
    snGet.mockResolvedValueOnce({ result: extra });
    const { groups } = await snDash.fetchSNGroups(BASE_CFG.servicenow);
    const netOps = groups.find(g => g.name === 'Network Ops');
    expect(netOps.incidents.length).toBeLessThanOrEqual(3);
  });


  test('usa "Unassigned" para incidentes sem grupo', async () => {
    snGet.mockResolvedValueOnce({ result: [
      { number: 'INC0099', short_description: 'orphan', priority: '2',
        assignment_group: null, opened_at: new Date().toISOString(), sys_id: 'zzz' },
    ]});
    const { groups } = await snDash.fetchSNGroups(BASE_CFG.servicenow);
    expect(groups[0].name).toBe('Unassigned');
  });

  test('retorna resultado vazio quando API retorna lista vazia', async () => {
    snGet.mockResolvedValueOnce({ result: [] });
    const { groups, kpi } = await snDash.fetchSNGroups(BASE_CFG.servicenow);
    expect(groups).toHaveLength(0);
    expect(kpi.totalOpen).toBe(0);
  });

  test('filtra por assignmentGroups quando configurado', async () => {
    const snCfgWithFilter = { ...BASE_CFG.servicenow, assignmentGroups: ['Database'] };
    const { groups, kpi } = await snDash.fetchSNGroups(snCfgWithFilter);
    expect(groups.length).toBe(1);
    expect(groups[0].name).toBe('Database');
    expect(kpi.totalOpen).toBe(1); // apenas o INC0004
    expect(kpi.activeGroups).toBe(1);
  });

  test('faz uma query por grupo selecionado (evita limite de paginação)', async () => {
    // 2 grupos selecionados → 2 chamadas ao snGet, cada uma com filtro de grupo na URL
    const snCfgWithFilter = { ...BASE_CFG.servicenow, assignmentGroups: ['Network Ops', 'Database'] };
    snGet.mockResolvedValue({ result: [] }); // sobrescreve o mock padrão para este teste
    await snDash.fetchSNGroups(snCfgWithFilter);
    expect(snGet).toHaveBeenCalledTimes(2);
    const urls = snGet.mock.calls.map(c => c[1]);
    expect(urls.some(u => u.includes('Network'))).toBe(true);
    expect(urls.some(u => u.includes('Database'))).toBe(true);
  });

  test('usa query única quando assignmentGroups não está configurado', async () => {
    await snDash.fetchSNGroups(BASE_CFG.servicenow);
    expect(snGet).toHaveBeenCalledTimes(1);
  });

  test('mostra todos os grupos quando assignmentGroups é array vazio', async () => {
    const snCfgEmpty = { ...BASE_CFG.servicenow, assignmentGroups: [] };
    const { groups } = await snDash.fetchSNGroups(snCfgEmpty);
    expect(groups.length).toBe(2); // Network Ops + Database
  });

  test('mostra todos os grupos quando assignmentGroups não está definido', async () => {
    const { groups } = await snDash.fetchSNGroups(BASE_CFG.servicenow);
    expect(groups.length).toBe(2);
  });

  test('grupo selecionado sem incidentes ainda aparece no dashboard (bug regressão)', async () => {
    // Simula: usuário selecionou 'Database' + 'Empty Group', mas 'Empty Group'
    // não tem nenhum incidente ativo. O grupo deve aparecer com contagens zeradas.
    const snCfgWithFilter = { ...BASE_CFG.servicenow, assignmentGroups: ['Database', 'Empty Group'] };
    const { groups, kpi } = await snDash.fetchSNGroups(snCfgWithFilter);
    expect(groups.length).toBe(2);
    const emptyGroup = groups.find(g => g.name === 'Empty Group');
    expect(emptyGroup).toBeDefined();
    expect(emptyGroup.p1).toBe(0);
    expect(emptyGroup.p2).toBe(0);
    expect(emptyGroup.p3).toBe(0);
    expect(emptyGroup.total).toBe(0);
    expect(emptyGroup.incidents).toHaveLength(0);
    // activeGroups conta apenas grupos com incidentes ("with open incidents")
    expect(kpi.activeGroups).toBe(1);
    expect(kpi.totalOpen).toBe(1);
  });

  test('incidentes P4/P5 entram no total mas não nos contadores p1/p2/p3', async () => {
    snGet.mockResolvedValueOnce({ result: [
      { number: 'INC0050', short_description: 'Minor issue', priority: '4',
        assignment_group: 'Network Ops', opened_at: new Date().toISOString(), sys_id: 'fff001' },
      { number: 'INC0051', short_description: 'Low prio',   priority: '5',
        assignment_group: 'Network Ops', opened_at: new Date().toISOString(), sys_id: 'fff002' },
    ]});
    const { groups, kpi } = await snDash.fetchSNGroups(BASE_CFG.servicenow);
    const netOps = groups.find(g => g.name === 'Network Ops');
    expect(netOps.p1).toBe(0);
    expect(netOps.p2).toBe(0);
    expect(netOps.p3).toBe(0);
    expect(netOps.total).toBe(2);
    expect(kpi.totalOpen).toBe(2);
    expect(kpi.totalP1).toBe(0);
    expect(kpi.activeGroups).toBe(1);
  });

  test('2 grupos selecionados aparecem mesmo que um só tenha incidentes', async () => {
    // Variação direta do bug reportado: "selecionei 2 mas só exibe 1"
    const snCfgWithFilter = { ...BASE_CFG.servicenow, assignmentGroups: ['Network Ops', 'Database'] };
    const { groups } = await snDash.fetchSNGroups(snCfgWithFilter);
    expect(groups.length).toBe(2);
    expect(groups.map(g => g.name)).toContain('Network Ops');
    expect(groups.map(g => g.name)).toContain('Database');
  });

  test('suporta campos com formato display_value/value (sysparm_display_value=all)', async () => {
    snGet.mockResolvedValueOnce({ result: [
      {
        number: { value: 'INC0010', display_value: 'INC0010' },
        short_description: { value: 'Test', display_value: 'Test desc' },
        priority: { value: '1', display_value: '1 - Critical' },
        assignment_group: { value: 'grp_sys_id', display_value: 'My Group' },
        opened_at: { value: new Date().toISOString(), display_value: '...' },
        sys_id: { value: 'sys123', display_value: 'sys123' },
      },
    ]});
    const { groups, kpi } = await snDash.fetchSNGroups(BASE_CFG.servicenow);
    expect(groups[0].name).toBe('My Group');
    expect(kpi.totalP1).toBe(1);
    // number (raw) and sys_id (raw) should use .value
    expect(groups[0].incidents[0].number).toBe('INC0010');
    expect(groups[0].incidents[0].url).toContain('sys123');
  });
});

// ── buildIncidentCardsHTML ────────────────────────────────────────────────────

describe('buildIncidentCardsHTML', () => {
  test('retorna div de estado vazio quando não há grupos', () => {
    const html = snDash.buildIncidentCardsHTML([], 'dev.service-now.com');
    expect(html).toContain('sn-empty-incidents');
    expect(html).toContain('No active incidents');
  });

  test('gera grid .sn-inc-cards com um card por grupo', () => {
    const groups = [
      { name: 'Network Ops', p1: 1, p2: 0, p3: 0, incidents: [] },
      { name: 'Database',    p1: 0, p2: 1, p3: 1, incidents: [] },
    ];
    const html = snDash.buildIncidentCardsHTML(groups, 'dev.service-now.com');
    expect(html).toContain('sn-inc-cards');
    expect((html.match(/sn-inc-card/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  test('inclui nome do grupo escapando caracteres HTML especiais', () => {
    const groups = [{ name: '<Script>', p1: 0, p2: 0, p3: 0, incidents: [] }];
    const html = snDash.buildIncidentCardsHTML(groups, 'dev.service-now.com');
    expect(html).toContain('&lt;Script&gt;');
    expect(html).not.toContain('<Script>');
  });

  test('rodapé tem botão que abre modal de incidentes (não link externo)', () => {
    const groups = [{ name: 'Ops', p1: 1, p2: 0, p3: 0, total: 3, incidents: [] }];
    const html = snDash.buildIncidentCardsHTML(groups);
    expect(html).toContain('openSNGroupIncidents(this)');
    expect(html).toContain('data-group');
    expect(html).not.toContain('incident_list.do');
  });
});

// ── fetchAndBuildCards ────────────────────────────────────────────────────────

describe('fetchAndBuildCards', () => {
  test('retorna kpi e cardsHtml em caso de sucesso', async () => {
    const result = await snDash.fetchAndBuildCards();
    expect(result.error).toBeNull();
    expect(result.kpi).toMatchObject({ totalOpen: 4, totalP1: 2 });
    expect(result.cardsHtml).toContain('sn-inc-cards');
  });

  test('inclui resolvedThisMonth e mttr no kpi', async () => {
    const result = await snDash.fetchAndBuildCards();
    expect(result.kpi).toHaveProperty('resolvedThisMonth');
    expect(result.kpi).toHaveProperty('mttr');
    expect(typeof result.kpi.resolvedThisMonth).toBe('number');
    expect(typeof result.kpi.mttr).toBe('string');
  });

  test('retorna kpi zerado e mensagem de erro quando API falha', async () => {
    snGet.mockRejectedValueOnce(new Error('Connection refused'));
    const result = await snDash.fetchAndBuildCards();
    expect(result.error).toBe('Connection refused');
    expect(result.kpi.totalOpen).toBe(0);
    expect(result.kpi.resolvedThisMonth).toBe(0);
    expect(result.kpi.mttr).toBe('—');
    expect(result.cardsHtml).toContain('Failed to load incidents');
    expect(result.cardsHtml).toContain('Connection refused');
  });

  test('usa instance do config para construir URLs', async () => {
    getCfg.mockReturnValueOnce({
      servicenow: { instance: 'https://myco.service-now.com/', user: 'u', pass: 'p' },
    });
    snGet.mockResolvedValueOnce({ result: SAMPLE_INCIDENTS });
    const result = await snDash.fetchAndBuildCards();
    expect(result.cardsHtml).toContain('myco.service-now.com');
  });
});

// ── _calcMttr ─────────────────────────────────────────────────────────────────

describe('_calcMttr', () => {
  test('retorna null para lista vazia', () => {
    expect(snDash._calcMttr([])).toBeNull();
  });

  test('ignora incidentes sem opened_at ou resolved_at', () => {
    const incs = [
      { opened_at: '', resolved_at: '2025-06-10 10:00:00' },
      { opened_at: '2025-06-01 08:00:00', resolved_at: '' },
    ];
    expect(snDash._calcMttr(incs)).toBeNull();
  });

  test('ignora incidentes com diff negativo (resolved anterior ao opened)', () => {
    const incs = [{ opened_at: '2025-06-05 10:00:00', resolved_at: '2025-06-01 10:00:00' }];
    expect(snDash._calcMttr(incs)).toBeNull();
  });

  test('calcula media em horas para um incidente de 24h', () => {
    const incs = [{ opened_at: '2025-06-01 08:00:00', resolved_at: '2025-06-02 08:00:00' }];
    expect(snDash._calcMttr(incs)).toBeCloseTo(24, 1);
  });

  test('calcula media de multiplos incidentes (12h + 24h = 18h)', () => {
    const incs = [
      { opened_at: '2025-06-01 00:00:00', resolved_at: '2025-06-01 12:00:00' },
      { opened_at: '2025-06-02 00:00:00', resolved_at: '2025-06-03 00:00:00' },
    ];
    expect(snDash._calcMttr(incs)).toBeCloseTo(18, 1);
  });

  test('aceita campos no formato {value, display_value} do SN', () => {
    const incs = [{
      opened_at:   { value: '2025-06-01 00:00:00', display_value: '01/06/2025' },
      resolved_at: { value: '2025-06-02 00:00:00', display_value: '02/06/2025' },
      sys_id:      { value: 'x', display_value: 'x' },
    }];
    expect(snDash._calcMttr(incs)).toBeCloseTo(24, 1);
  });
});

// ── _fmtMttr ──────────────────────────────────────────────────────────────────

describe('_fmtMttr', () => {
  test('retorna "—" para null', () => {
    expect(snDash._fmtMttr(null)).toBe('—');
  });

  test('retorna "< 1h" para menos de 1 hora', () => {
    expect(snDash._fmtMttr(0.5)).toBe('< 1h');
    expect(snDash._fmtMttr(0)).toBe('< 1h');
  });

  test('retorna horas arredondadas quando < 24h', () => {
    expect(snDash._fmtMttr(4.6)).toBe('5h');
    expect(snDash._fmtMttr(12)).toBe('12h');
    expect(snDash._fmtMttr(23)).toBe('23h');
  });

  test('retorna dias com 1 casa decimal quando >= 24h', () => {
    expect(snDash._fmtMttr(24)).toBe('1.0d');
    expect(snDash._fmtMttr(36)).toBe('1.5d');
    expect(snDash._fmtMttr(72)).toBe('3.0d');
  });
});

// ── fetchSNResolved ───────────────────────────────────────────────────────────

describe('fetchSNResolved', () => {
  const snCfg = { instance: 'acme.service-now.com', user: 'u', pass: 'p' };

  test('sem grupos: faz uma unica query sem filtro de grupo', async () => {
    snGet.mockResolvedValue({ result: [] });
    await snDash.fetchSNResolved(snCfg, null);
    expect(snGet).toHaveBeenCalledTimes(1);
    const url = snGet.mock.calls[0][1];
    expect(url).not.toContain('assignment_group.name');
    expect(url).toContain('state=6');
    expect(url).toContain('sysparm_fields=sys_id,opened_at,resolved_at');
  });

  test('com grupos: faz uma query por grupo', async () => {
    snGet.mockResolvedValue({ result: [] });
    await snDash.fetchSNResolved(snCfg, ['GroupA', 'GroupB']);
    expect(snGet).toHaveBeenCalledTimes(2);
    expect(snGet.mock.calls[0][1]).toContain('GroupA');
    expect(snGet.mock.calls[1][1]).toContain('GroupB');
  });

  test('deduplica incidentes que aparecem em multiplos grupos', async () => {
    const inc = { sys_id: { value: 'abc123' }, opened_at: { value: '2025-06-01' }, resolved_at: { value: '2025-06-02' } };
    snGet.mockResolvedValue({ result: [inc] });
    const result = await snDash.fetchSNResolved(snCfg, ['GroupA', 'GroupB']);
    expect(result).toHaveLength(1);
  });

  test('retorna array vazio se chamadas individuais falharem', async () => {
    snGet.mockRejectedValue(new Error('network error'));
    const result = await snDash.fetchSNResolved(snCfg, ['GroupA']);
    expect(result).toEqual([]);
  });

  test('query inclui filtro de data do mes atual', async () => {
    snGet.mockResolvedValue({ result: [] });
    await snDash.fetchSNResolved(snCfg, null);
    const url = snGet.mock.calls[0][1];
    const year = new Date().getFullYear();
    expect(url).toContain(String(year));
    expect(url).toContain('resolved_at>=');
    expect(url).toContain('resolved_at<');
  });

  test('retorna incidentes da resposta da API', async () => {
    const inc = { sys_id: { value: 'r1' }, opened_at: { value: '2025-06-01 09:00:00' }, resolved_at: { value: '2025-06-02 09:00:00' } };
    snGet.mockResolvedValue({ result: [inc] });
    const result = await snDash.fetchSNResolved(snCfg, null);
    expect(result).toHaveLength(1);
    expect(result[0].sys_id.value).toBe('r1');
  });
});

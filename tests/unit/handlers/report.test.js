jest.mock('../../../config');
jest.mock('../../../reportService');

const { getReportConfig, saveReportConfig, getReport, getIncidents, getRequests, getPrbs } = require('../../../handlers/report');
const { getCfg, getDisplayName, saveConfig } = require('../../../config');
const { buildReport, getLast6Months, cacheInvalidate, fetchSnIncidentBacklog, fetchSnRequestBacklog, fetchSnPrbBacklog } = require('../../../reportService');

beforeEach(() => {
  getCfg.mockReturnValue({ projects: [{ name: 'Alpha', workItemType: 'User Story' }] });
  getDisplayName.mockImplementation(p => (typeof p === 'string' ? p : p.name));
  getLast6Months.mockReturnValue(['2026-06', '2026-05', '2026-04', '2026-03', '2026-02', '2026-01']);
});

// ── getReportConfig ───────────────────────────────────────────────────────────

describe('getReportConfig', () => {
  test('retorna campos do projeto quando configurado', () => {
    getCfg.mockReturnValue({
      projects: [{
        name: 'Alpha',
        reportCharts:    ['chart1'],
        incidentMonths:  6,
        incidentTarget:  30,
        incidentGroupBy: 'u_additional_res_code',
        heatmapMax:      9,
        heatmapTopN:     5,
        locationMonths:  3,
        agingState:      'In Review',
        deliveryStates:  ['Done'],
      }],
    });

    const result = getReportConfig({ project: 'Alpha' });

    expect(result.reportCharts).toEqual(['chart1']);
    expect(result.incidentMonths).toBe(6);
    expect(result.incidentTarget).toBe(30);
    expect(result.incidentGroupBy).toBe('u_additional_res_code');
    expect(result.heatmapMax).toBe(9);
    expect(result.heatmapTopN).toBe(5);
    expect(result.locationMonths).toBe(3);
    expect(result.deliveryStates).toEqual(['Done']);
  });

  test('retorna campos ITIL quando configurados', () => {
    const indicatorCards       = { incidents: [{ id: 'inc_total', visible: true, order: 0 }] };
    const indicatorCardsPerRow = { incidents: 4, prbs: 3 };
    const incidentCharts       = [{ type: 'inc-sla-bars', size: 'md' }];
    const prbCharts            = [{ type: 'prb-category', size: 'sm' }];

    getCfg.mockReturnValue({
      projects: [{ name: 'Alpha', indicatorCards, indicatorCardsPerRow, incidentCharts, prbCharts }],
    });

    const result = getReportConfig({ project: 'Alpha' });

    expect(result.indicatorCards).toEqual(indicatorCards);
    expect(result.indicatorCardsPerRow).toEqual(indicatorCardsPerRow);
    expect(result.incidentCharts).toEqual(incidentCharts);
    expect(result.prbCharts).toEqual(prbCharts);
  });

  test('retorna defaults quando projeto não tem config de report', () => {
    const result = getReportConfig({ project: 'Alpha' });

    expect(result.reportCharts).toBeNull();
    expect(result.incidentMonths).toBe(5);
    expect(result.incidentTarget).toBeNull();
    expect(result.incidentGroupBy).toBe('cmdb_ci');
    expect(result.heatmapMax).toBe(0);
    expect(result.heatmapTopN).toBe(9);
    expect(result.locationMonths).toBe(6);
    expect(result.agingState).toBe('In Review');
    expect(result.deliveryStates).toBeNull();
  });

  test('retorna nulls para campos ITIL quando não configurados', () => {
    const result = getReportConfig({ project: 'Alpha' });

    expect(result.indicatorCards).toBeNull();
    expect(result.indicatorCardsPerRow).toBeNull();
    expect(result.incidentCharts).toBeNull();
    expect(result.prbCharts).toBeNull();
  });

  test('retorna slaTargets configurado do projeto', () => {
    getCfg.mockReturnValue({
      projects: [{ name: 'Alpha', slaTargets: { p1: 98, p2: 92, p3: 80 } }],
    });
    const result = getReportConfig({ project: 'Alpha' });
    expect(result.slaTargets).toEqual({ p1: 98, p2: 92, p3: 80 });
  });

  test('retorna null para slaTargets quando não configurado', () => {
    const result = getReportConfig({ project: 'Alpha' });
    expect(result.slaTargets).toBeNull();
  });

  test('retorna defaults quando projeto não existe', () => {
    const result = getReportConfig({ project: 'Nonexistent' });

    expect(result.incidentMonths).toBe(5);
  });

  test('retorna defaults para campos de requests quando não configurados', () => {
    const result = getReportConfig({ project: 'Alpha' });

    expect(result.requestMonths).toBe(5);
    expect(result.requestTarget).toBeNull();
    expect(result.requestCharts).toBeNull();
    expect(result.requestAgingBuckets).toBeNull();
  });

  test('retorna campos de requests configurados no projeto', () => {
    const requestCharts = [{ type: 'req-volume', size: 'lg' }];
    getCfg.mockReturnValue({
      projects: [{ name: 'Alpha', requestMonths: 8, requestTarget: 50, requestCharts, requestAgingBuckets: [2, 5, 10, 20] }],
    });

    const result = getReportConfig({ project: 'Alpha' });

    expect(result.requestMonths).toBe(8);
    expect(result.requestTarget).toBe(50);
    expect(result.requestCharts).toEqual(requestCharts);
    expect(result.requestAgingBuckets).toEqual([2, 5, 10, 20]);
  });
});

// ── saveReportConfig ──────────────────────────────────────────────────────────

describe('saveReportConfig', () => {
  test('atualiza incidentMonths com clamp (1–24)', () => {
    saveReportConfig({ project: 'Alpha', incidentMonths: 6 });
    const call = saveConfig.mock.calls[0][0];
    expect(call.projects[0].incidentMonths).toBe(6);
  });

  test('clampeia incidentMonths ao máximo de 24', () => {
    saveReportConfig({ project: 'Alpha', incidentMonths: 100 });
    const call = saveConfig.mock.calls[0][0];
    expect(call.projects[0].incidentMonths).toBe(24);
  });

  test('clampeia incidentMonths ao mínimo de 1', () => {
    saveReportConfig({ project: 'Alpha', incidentMonths: 0 });
    const call = saveConfig.mock.calls[0][0];
    expect(call.projects[0].incidentMonths).toBe(1);
  });

  test('atualiza incidentGroupBy', () => {
    saveReportConfig({ project: 'Alpha', incidentGroupBy: 'u_additional_res_code' });
    const call = saveConfig.mock.calls[0][0];
    expect(call.projects[0].incidentGroupBy).toBe('u_additional_res_code');
  });

  test('atualiza heatmapMax (mínimo 0)', () => {
    saveReportConfig({ project: 'Alpha', heatmapMax: -5 });
    const call = saveConfig.mock.calls[0][0];
    expect(call.projects[0].heatmapMax).toBe(0);
  });

  test('atualiza heatmapTopN (mínimo 0)', () => {
    saveReportConfig({ project: 'Alpha', heatmapTopN: 5 });
    const call = saveConfig.mock.calls[0][0];
    expect(call.projects[0].heatmapTopN).toBe(5);
  });

  test('clampeia heatmapTopN ao mínimo 0', () => {
    saveReportConfig({ project: 'Alpha', heatmapTopN: -3 });
    const call = saveConfig.mock.calls[0][0];
    expect(call.projects[0].heatmapTopN).toBe(0);
  });

  test('atualiza locationMonths com valor válido (1, 3 ou 6)', () => {
    saveReportConfig({ project: 'Alpha', locationMonths: 3 });
    const call = saveConfig.mock.calls[0][0];
    expect(call.projects[0].locationMonths).toBe(3);
  });

  test('normaliza locationMonths inválido para 6', () => {
    saveReportConfig({ project: 'Alpha', locationMonths: 4 });
    const call = saveConfig.mock.calls[0][0];
    expect(call.projects[0].locationMonths).toBe(6);
  });

  test('salva indicatorCards', () => {
    const cards = { incidents: [{ id: 'inc_total', visible: false, order: 0 }] };
    saveReportConfig({ project: 'Alpha', indicatorCards: cards });
    const call = saveConfig.mock.calls[0][0];
    expect(call.projects[0].indicatorCards).toEqual(cards);
  });

  test('salva indicatorCardsPerRow', () => {
    const perRow = { incidents: 4, prbs: 2 };
    saveReportConfig({ project: 'Alpha', indicatorCardsPerRow: perRow });
    const call = saveConfig.mock.calls[0][0];
    expect(call.projects[0].indicatorCardsPerRow).toEqual(perRow);
  });

  test('salva incidentCharts quando array', () => {
    const charts = [{ type: 'inc-sla-bars', size: 'md' }];
    saveReportConfig({ project: 'Alpha', incidentCharts: charts });
    const call = saveConfig.mock.calls[0][0];
    expect(call.projects[0].incidentCharts).toEqual(charts);
  });

  test('não salva incidentCharts quando não é array', () => {
    saveReportConfig({ project: 'Alpha', incidentCharts: 'invalid' });
    const call = saveConfig.mock.calls[0][0];
    expect(call.projects[0].incidentCharts).toBeUndefined();
  });

  test('salva prbCharts quando array', () => {
    const charts = [{ type: 'prb-category', size: 'sm' }];
    saveReportConfig({ project: 'Alpha', prbCharts: charts });
    const call = saveConfig.mock.calls[0][0];
    expect(call.projects[0].prbCharts).toEqual(charts);
  });

  test('salva slaTargets com clamp 0–100 por prioridade', () => {
    saveReportConfig({ project: 'Alpha', slaTargets: { p1: 98, p2: 110, p3: -5 } });
    const call = saveConfig.mock.calls[0][0];
    expect(call.projects[0].slaTargets).toEqual({ p1: 98, p2: 100, p3: 0 });
  });

  test('salva slaTargets parcial sem sobrescrever chaves ausentes', () => {
    getCfg.mockReturnValue({
      projects: [{ name: 'Alpha', workItemType: 'User Story', slaTargets: { p1: 98, p2: 90, p3: 85 } }],
    });
    saveReportConfig({ project: 'Alpha', slaTargets: { p2: 95 } });
    const call = saveConfig.mock.calls[0][0];
    expect(call.projects[0].slaTargets).toEqual({ p1: 98, p2: 95, p3: 85 });
  });

  test('ignora slaTargets quando não é objeto', () => {
    saveReportConfig({ project: 'Alpha', slaTargets: 'invalido' });
    const call = saveConfig.mock.calls[0][0];
    expect(call.projects[0].slaTargets).toBeUndefined();
  });

  test('salva em snGroupConfigs quando projeto não é Azure', () => {
    getCfg.mockReturnValue({ projects: [{ name: 'Alpha', workItemType: 'User Story' }] });
    const result = saveReportConfig({ project: 'L_BRA_SN_GROUP', incidentMonths: 3 });
    expect(result).toEqual({ ok: true });
    const call = saveConfig.mock.calls[0][0];
    expect(call.snGroupConfigs['L_BRA_SN_GROUP'].incidentMonths).toBe(3);
  });

  test('lê de snGroupConfigs quando projeto não é Azure', () => {
    getCfg.mockReturnValue({
      projects: [{ name: 'Alpha', workItemType: 'User Story' }],
      snGroupConfigs: { 'L_BRA_SN_GROUP': { incidentMonths: 7, incidentCharts: [{ type: 'inc-volume', size: 'lg' }] } },
    });
    const result = getReportConfig({ project: 'L_BRA_SN_GROUP' });
    expect(result.incidentMonths).toBe(7);
    expect(result.incidentCharts).toEqual([{ type: 'inc-volume', size: 'lg' }]);
  });

  test('retorna { ok: true } quando projeto existe', () => {
    const result = saveReportConfig({ project: 'Alpha', incidentMonths: 3 });
    expect(result).toEqual({ ok: true });
  });

  test('salva usAgingColumns quando é array', () => {
    const cols = [{ key: 'title', label: 'Título' }, { key: 'agingDays', label: 'Aging' }];
    saveReportConfig({ project: 'Alpha', usAgingColumns: cols });
    const call = saveConfig.mock.calls[0][0];
    expect(call.projects[0].usAgingColumns).toEqual(cols);
  });

  test('salva prbAgingColumns quando é array', () => {
    const cols = [{ key: 'title', label: 'Título' }, { key: 'state', label: 'Status' }];
    saveReportConfig({ project: 'Alpha', prbAgingColumns: cols });
    const call = saveConfig.mock.calls[0][0];
    expect(call.projects[0].prbAgingColumns).toEqual(cols);
  });

  test('não altera usAgingColumns quando parâmetro não é array', () => {
    saveReportConfig({ project: 'Alpha', usAgingColumns: null });
    const call = saveConfig.mock.calls[0][0];
    expect(call.projects[0].usAgingColumns).toBeUndefined();
  });

  test('atualiza requestMonths com clamp (1–24)', () => {
    saveReportConfig({ project: 'Alpha', requestMonths: 100 });
    const call = saveConfig.mock.calls[0][0];
    expect(call.projects[0].requestMonths).toBe(24);
  });

  test('atualiza requestTarget (mínimo 0)', () => {
    saveReportConfig({ project: 'Alpha', requestTarget: -10 });
    const call = saveConfig.mock.calls[0][0];
    expect(call.projects[0].requestTarget).toBe(0);
  });

  test('salva requestCharts quando array', () => {
    const charts = [{ type: 'req-catalog', size: 'lg' }];
    saveReportConfig({ project: 'Alpha', requestCharts: charts });
    const call = saveConfig.mock.calls[0][0];
    expect(call.projects[0].requestCharts).toEqual(charts);
  });

  test('salva requestAgingBuckets quando array de 4 posições', () => {
    saveReportConfig({ project: 'Alpha', requestAgingBuckets: [2, 5, 10, 20] });
    const call = saveConfig.mock.calls[0][0];
    expect(call.projects[0].requestAgingBuckets).toEqual([2, 5, 10, 20]);
  });

  test('não salva requestAgingBuckets quando array tem tamanho diferente de 4', () => {
    saveReportConfig({ project: 'Alpha', requestAgingBuckets: [2, 5] });
    const call = saveConfig.mock.calls[0][0];
    expect(call.projects[0].requestAgingBuckets).toBeUndefined();
  });
});

// ── getReportConfig colunas ────────────────────────────────────────────────────

describe('getReportConfig — usAgingColumns e prbAgingColumns', () => {
  test('retorna null quando não configurado', () => {
    getCfg.mockReturnValue({ projects: [{ name: 'Alpha' }] });
    const result = getReportConfig({ project: 'Alpha' });
    expect(result.usAgingColumns).toBeNull();
    expect(result.prbAgingColumns).toBeNull();
  });

  test('retorna colunas configuradas no projeto', () => {
    const usCols  = [{ key: 'title', label: 'Título' }, { key: 'agingDays', label: 'Aging' }];
    const prbCols = [{ key: 'title', label: 'Título' }, { key: 'state', label: 'Status' }];
    getCfg.mockReturnValue({ projects: [{ name: 'Alpha', usAgingColumns: usCols, prbAgingColumns: prbCols }] });
    const result = getReportConfig({ project: 'Alpha' });
    expect(result.usAgingColumns).toEqual(usCols);
    expect(result.prbAgingColumns).toEqual(prbCols);
  });
});

// ── getReport ─────────────────────────────────────────────────────────────────

describe('getReport', () => {
  const months = ['2026-06', '2026-05', '2026-04', '2026-03', '2026-02', '2026-01'];

  beforeEach(() => {
    buildReport.mockResolvedValue({ metadata: { project: 'Alpha' } });
  });

  test('chama buildReport com parâmetros corretos', async () => {
    await getReport({ project: 'Alpha', month: '2026-06', groupFields: [], agingState: 'In Review', incidentMonths: null, deliveryStates: null, refresh: false });

    expect(buildReport).toHaveBeenCalledWith('Alpha', '2026-06', [], 'In Review', expect.any(Number), null, null, null, '');
  });

  test('repassa ciFilter para buildReport quando fornecido', async () => {
    await getReport({ project: 'Alpha', month: '2026-06', deliveryStates: null, ciFilter: 'MMS - CNH-L-P' });

    expect(buildReport).toHaveBeenCalledWith('Alpha', '2026-06', [], 'In Review', expect.any(Number), null, null, null, 'MMS - CNH-L-P');
  });

  test('retorna { payload, months, month }', async () => {
    const result = await getReport({ project: 'Alpha', month: '2026-06' });

    expect(result).toMatchObject({
      payload: expect.any(Object),
      months:  expect.any(Array),
      month:   '2026-06',
    });
  });

  test('usa primeiro mês disponível quando month não está na lista', async () => {
    const result = await getReport({ project: 'Alpha', month: '2025-01' });
    expect(result.month).toBe(months[0]);
  });

  test('chama cacheInvalidate quando refresh=true', async () => {
    await getReport({ project: 'Alpha', month: '2026-06', refresh: true });
    expect(cacheInvalidate).toHaveBeenCalledTimes(1);
  });

  test('não chama cacheInvalidate quando refresh=false', async () => {
    await getReport({ project: 'Alpha', month: '2026-06', refresh: false });
    expect(cacheInvalidate).not.toHaveBeenCalled();
  });
});

// ── getIncidents ──────────────────────────────────────────────────────────────

describe('getIncidents', () => {
  test('delega para fetchSnIncidentBacklog com parâmetros corretos', async () => {
    const incidents = [{ number: 'INC001' }];
    fetchSnIncidentBacklog.mockResolvedValue(incidents);

    const result = await getIncidents({
      project:     'Alpha',
      month:       '2026-06',
      mode:        'backlog',
      filterField: 'cmdb_ci',
      filterValue: 'SAP',
    });

    expect(fetchSnIncidentBacklog).toHaveBeenCalledWith('Alpha', '2026-06', {
      mode:        'backlog',
      filterField: 'cmdb_ci',
      filterValue: 'SAP',
      ciFilter:    '',
      group:       '',
    });
    expect(result).toEqual({ incidents });
  });

  test('passa group para fetchSnIncidentBacklog quando fornecido', async () => {
    fetchSnIncidentBacklog.mockResolvedValue([]);

    await getIncidents({ project: '', month: '2026-06', group: 'L_BRA_OPS' });

    expect(fetchSnIncidentBacklog).toHaveBeenCalledWith('', '2026-06', {
      mode:        'backlog',
      filterField: '',
      filterValue: '',
      ciFilter:    '',
      group:       'L_BRA_OPS',
    });
  });

  test('passa ciFilter para fetchSnIncidentBacklog quando fornecido (filtro de Configuration Item)', async () => {
    fetchSnIncidentBacklog.mockResolvedValue([]);

    await getIncidents({ project: 'Alpha', month: '2026-06', ciFilter: 'MMS - CNH-L-P' });

    expect(fetchSnIncidentBacklog).toHaveBeenCalledWith('Alpha', '2026-06', {
      mode:        'backlog',
      filterField: '',
      filterValue: '',
      ciFilter:    'MMS - CNH-L-P',
      group:       '',
    });
  });
});

// ── getRequests ───────────────────────────────────────────────────────────────

describe('getRequests', () => {
  test('delega para fetchSnRequestBacklog com parâmetros corretos', async () => {
    const requests = [{ number: 'RITM001' }];
    fetchSnRequestBacklog.mockResolvedValue(requests);

    const result = await getRequests({
      project:     'Alpha',
      month:       '2026-06',
      mode:        'backlog',
      filterField: 'cat_item',
      filterValue: 'Acesso VPN',
    });

    expect(fetchSnRequestBacklog).toHaveBeenCalledWith('Alpha', '2026-06', {
      mode:        'backlog',
      filterField: 'cat_item',
      filterValue: 'Acesso VPN',
      ciFilter:    '',
      group:       '',
    });
    expect(result).toEqual({ requests });
  });

  test('passa group para fetchSnRequestBacklog quando fornecido', async () => {
    fetchSnRequestBacklog.mockResolvedValue([]);

    await getRequests({ project: '', month: '2026-06', group: 'L_BRA_OPS' });

    expect(fetchSnRequestBacklog).toHaveBeenCalledWith('', '2026-06', {
      mode:        'backlog',
      filterField: '',
      filterValue: '',
      ciFilter:    '',
      group:       'L_BRA_OPS',
    });
  });

  test('passa dayMin/dayMax para fetchSnRequestBacklog quando fornecidos (clique no gráfico de aging)', async () => {
    fetchSnRequestBacklog.mockResolvedValue([]);

    await getRequests({ project: 'Alpha', month: '2026-06', dayMin: 5, dayMax: 10 });

    expect(fetchSnRequestBacklog).toHaveBeenCalledWith('Alpha', '2026-06', {
      mode:        'backlog',
      filterField: '',
      filterValue: '',
      ciFilter:    '',
      dayMin:      5,
      dayMax:      10,
      group:       '',
    });
  });

  test('passa ciFilter para fetchSnRequestBacklog quando fornecido (filtro de Configuration Item)', async () => {
    fetchSnRequestBacklog.mockResolvedValue([]);

    await getRequests({ project: 'Alpha', month: '2026-06', ciFilter: 'MMS - CNH-L-P' });

    expect(fetchSnRequestBacklog).toHaveBeenCalledWith('Alpha', '2026-06', {
      mode:        'backlog',
      filterField: '',
      filterValue: '',
      ciFilter:    'MMS - CNH-L-P',
      group:       '',
    });
  });
});

// ── getPrbs ───────────────────────────────────────────────────────────────────

describe('getPrbs', () => {
  test('delega para fetchSnPrbBacklog com parâmetros corretos', async () => {
    const prbs = [{ number: 'PRB001' }];
    fetchSnPrbBacklog.mockResolvedValue(prbs);

    const result = await getPrbs({
      project:     'Alpha',
      filterField: 'category',
      filterValue: 'Software',
    });

    expect(fetchSnPrbBacklog).toHaveBeenCalledWith('Alpha', {
      filterField: 'category',
      filterValue: 'Software',
      ciFilter:    '',
      dayMin:      undefined,
      dayMax:      undefined,
      group:       '',
    });
    expect(result).toEqual({ prbs });
  });

  test('passa dayMin/dayMax para fetchSnPrbBacklog quando fornecidos (clique no gráfico de aging)', async () => {
    fetchSnPrbBacklog.mockResolvedValue([]);

    await getPrbs({ project: 'Alpha', dayMin: 30, dayMax: 60 });

    expect(fetchSnPrbBacklog).toHaveBeenCalledWith('Alpha', {
      filterField: '',
      filterValue: '',
      ciFilter:    '',
      dayMin:      30,
      dayMax:      60,
      group:       '',
    });
  });

  test('passa group para fetchSnPrbBacklog quando fornecido', async () => {
    fetchSnPrbBacklog.mockResolvedValue([]);

    await getPrbs({ project: '', group: 'L_BRA_OPS' });

    expect(fetchSnPrbBacklog).toHaveBeenCalledWith('', {
      filterField: '',
      filterValue: '',
      ciFilter:    '',
      dayMin:      undefined,
      dayMax:      undefined,
      group:       'L_BRA_OPS',
    });
  });

  test('passa ciFilter para fetchSnPrbBacklog quando fornecido (filtro de Configuration Item)', async () => {
    fetchSnPrbBacklog.mockResolvedValue([]);

    await getPrbs({ project: 'Alpha', ciFilter: 'MMS - CNH-L-P' });

    expect(fetchSnPrbBacklog).toHaveBeenCalledWith('Alpha', {
      filterField: '',
      filterValue: '',
      ciFilter:    'MMS - CNH-L-P',
      dayMin:      undefined,
      dayMax:      undefined,
      group:       '',
    });
  });
});

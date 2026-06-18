jest.mock('../../../config');
jest.mock('../../../reportService');

const { getReportConfig, saveReportConfig, getReport, getIncidents } = require('../../../handlers/report');
const { getCfg, getDisplayName, saveConfig } = require('../../../config');
const { buildReport, getLast6Months, cacheInvalidate, fetchSnIncidentBacklog } = require('../../../reportService');

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
    expect(result.incidentTarget).toBe(24);
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
});

// ── getReport ─────────────────────────────────────────────────────────────────

describe('getReport', () => {
  const months = ['2026-06', '2026-05', '2026-04', '2026-03', '2026-02', '2026-01'];

  beforeEach(() => {
    buildReport.mockResolvedValue({ metadata: { project: 'Alpha' } });
  });

  test('chama buildReport com parâmetros corretos', async () => {
    await getReport({ project: 'Alpha', month: '2026-06', groupFields: [], agingState: 'In Review', incidentMonths: null, deliveryStates: null, refresh: false });

    expect(buildReport).toHaveBeenCalledWith('Alpha', '2026-06', [], 'In Review', expect.any(Number), null);
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
      group:       'L_BRA_OPS',
    });
  });
});

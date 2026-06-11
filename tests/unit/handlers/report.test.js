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
    expect(result.deliveryStates).toEqual(['Done']);
  });

  test('retorna defaults quando projeto não tem config de report', () => {
    const result = getReportConfig({ project: 'Alpha' });

    expect(result.reportCharts).toBeNull();
    expect(result.incidentMonths).toBe(5);
    expect(result.incidentTarget).toBe(24);
    expect(result.incidentGroupBy).toBe('cmdb_ci');
    expect(result.heatmapMax).toBe(0);
    expect(result.agingState).toBe('In Review');
    expect(result.deliveryStates).toBeNull();
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

  test('não faz nada quando projeto não existe', () => {
    saveReportConfig({ project: 'Nonexistent', incidentMonths: 6 });
    expect(saveConfig).not.toHaveBeenCalled();
  });

  test('retorna { ok: true }', () => {
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

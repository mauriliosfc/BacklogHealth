// Tipos de work item personalizados nos handlers: resumo do dashboard, contexto
// da IA e padrões de estados (burndown, review mensal e indicadores).
jest.mock('../../../config');
jest.mock('../../../azureClient');
jest.mock('../../../projectService');
jest.mock('../../../teamCapacityService');
jest.mock('../../../reportService');

const { getCfg, getDisplayName } = require('../../../config');
const { fetchProjectDetail } = require('../../../projectService');
const { getContext, getBurndownConfig } = require('../../../handlers/azure');
const { buildSummaryBar } = require('../../../handlers/dashboard');
const { getReportConfig } = require('../../../handlers/report');
const { getIndicatorConfig } = require('../../../handlers/indicatorConfig');
const { getWorkItemProfile, clientProfile } = require('../../../utils/workItemProfile');
const { resolveIndicatorConfig, DEFAULT_INDICATORS } = require('../../../utils/healthIndicators');

const STATES = { new: ['To Do'], active: ['Doing'], done: ['Done'], removed: ['Cut'] };
const ISSUE  = { name: 'Beta', workItemType: 'Issue', estimateField: 'Microsoft.VSTS.Scheduling.Effort', states: STATES };
const LEGACY = { name: 'Alpha', workItemType: 'User Story' };

beforeEach(() => {
  getCfg.mockReturnValue({ projects: [LEGACY, ISSUE] });
  getDisplayName.mockImplementation(p => (typeof p === 'string' ? p : p.name));
});

describe('buildAuthBanner', () => {
  const { buildAuthBanner } = require('../../../handlers/dashboard');

  test('aparece quando algum projeto teve o PAT recusado', () => {
    const html = buildAuthBanner([{ project: 'A', error: 'x', errorCode: 'AZURE_AUTH' }, { project: 'B', items: [] }]);
    expect(html).toContain('az-auth-banner');
    expect(html).toContain('data-i18n="err_azure_auth_title"');
    expect(html).toContain('href="/settings"');
  });

  test('não aparece para outros erros ou sem erros', () => {
    expect(buildAuthBanner([{ project: 'A', error: 'falhou' }, { project: 'B', items: [] }])).toBe('');
  });
});

describe('buildSummaryBar — tipo personalizado', () => {
  const f = (type, state, extra = {}) => ({ fields: { 'System.WorkItemType': type, 'System.State': state, 'System.AssignedTo': { displayName: 'D' }, ...extra } });

  test('conta itens do tipo, estados do tipo e estimativa pelo campo detectado', () => {
    const html = buildSummaryBar([{
      workItemType: 'Issue', profile: getWorkItemProfile(ISSUE), sprint: null,
      items: [
        f('Issue', 'To Do', { 'Microsoft.VSTS.Scheduling.Effort': 2 }),
        f('Issue', 'Doing'),               // sem estimativa
        f('Issue', 'Done'),                // concluído
        f('User Story', 'Active'),         // fora do tipo
      ],
    }]);
    expect(html).toContain('id="sum-workitems">3<');
  });
});

describe('getContext — tipo personalizado', () => {
  test('usa tipos e estados do perfil', async () => {
    getCfg.mockReturnValue({ projects: [ISSUE] });
    fetchProjectDetail.mockResolvedValue({
      project: 'Beta', workItemType: 'Issue', profile: clientProfile(getWorkItemProfile(ISSUE)),
      items: [
        { type: 'Issue', state: 'To Do', pts: 1, iteration: 'B\\S1', assigned: 'A', title: 'a' },
        { type: 'Issue', state: 'Doing', pts: 2, iteration: 'B\\S1', assigned: 'A', title: 'b' },
        { type: 'Issue', state: 'Done',  pts: 3, iteration: 'B\\S1', assigned: 'A', title: 'c' },
        { type: 'User Story', state: 'New', pts: 0, iteration: 'B\\S1', assigned: 'A', title: 'd' },
      ],
      taskItems: [], bugItems: [], iterMap: { 'B\\S1': { isCurrent: true } },
    });
    const { projects: [p] } = await getContext({});
    expect(p.summary.userStories).toBe(3);
    expect(p.summary.inProgress).toBe(1);
    expect(p.summary.new).toBe(1);
    expect(p.summary.deliveredPts).toBe(3);
    expect(p.healthIndicators.completionRate).toBe(33);
  });
});

describe('padrões de estados por tipo', () => {
  test('burndown: tipo novo usa os estados concluídos do tipo; legado mantém Closed', () => {
    expect(getBurndownConfig({ project: 'Beta' })).toEqual({ doneStates: ['Done'] });
    expect(getBurndownConfig({ project: 'Alpha' })).toEqual({ doneStates: ['Closed'] });
  });

  test('burndown: configuração salva tem prioridade', () => {
    getCfg.mockReturnValue({ projects: [{ ...ISSUE, burndownDoneStates: ['Doing'] }] });
    expect(getBurndownConfig({ project: 'Beta' })).toEqual({ doneStates: ['Doing'] });
  });

  test('review mensal: deliveryStates padrão vem do tipo; legado continua null', () => {
    expect(getReportConfig({ project: 'Beta' }).deliveryStates).toEqual(['Done']);
    expect(getReportConfig({ project: 'Alpha' }).deliveryStates).toBeNull();
  });

  test('indicadores: conclusão padrão vem do tipo; legado mantém o padrão', () => {
    expect(getIndicatorConfig({ project: 'Beta' }).completion.states).toEqual(['Done']);
    expect(getIndicatorConfig({ project: 'Alpha' }).completion.states).toEqual(DEFAULT_INDICATORS.completion.states);
  });

  test('indicadores: estados salvos têm prioridade sobre o padrão do tipo', () => {
    getCfg.mockReturnValue({ projects: [{ ...ISSUE, healthIndicators: { completion: { states: ['Doing'] } } }] });
    expect(getIndicatorConfig({ project: 'Beta' }).completion.states).toEqual(['Doing']);
  });

  test('resolveIndicatorConfig sem padrão do tipo é idêntico ao anterior', () => {
    expect(resolveIndicatorConfig({})).toEqual(resolveIndicatorConfig({}, {}));
    expect(resolveIndicatorConfig({}).completion).toEqual(DEFAULT_INDICATORS.completion);
  });
});

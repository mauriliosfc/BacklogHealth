// Tipos de work item personalizados: listagem para o setup e gravação do perfil
jest.mock('../../../config');
jest.mock('../../../azureClient');
jest.mock('../../../handlers/dashboard');

const { listWorkItemTypes, setup } = require('../../../handlers/projects');
const { getCfg, saveConfig, parseOrgInput } = require('../../../config');
const { rawAzureGet } = require('../../../azureClient');
const { buildAndCache } = require('../../../handlers/dashboard');

beforeEach(() => {
  parseOrgInput.mockReturnValue({ org: 'myorg', baseUrl: 'https://dev.azure.com/myorg' });
});

// ── listWorkItemTypes ─────────────────────────────────────────────────────────

describe('listWorkItemTypes', () => {
  const CATEGORIES = { value: [
    { referenceName: 'Microsoft.RequirementCategory', defaultWorkItemType: { name: 'Product Backlog Item' }, workItemTypes: [{ name: 'Product Backlog Item' }] },
    { referenceName: 'Microsoft.BugCategory', workItemTypes: [{ name: 'Bug' }] },
    { referenceName: 'Microsoft.HiddenCategory', workItemTypes: [{ name: 'Code Review Request' }] },
    { referenceName: 'Microsoft.TestCaseCategory', workItemTypes: [{ name: 'Test Case' }] },
  ] };
  const TYPES = { value: [
    { name: 'Bug' }, { name: 'Epic' }, { name: 'Feature' }, { name: 'Task' },
    { name: 'Product Backlog Item' }, { name: 'Test Case' }, { name: 'Code Review Request' },
    { name: 'Impediment' }, { name: 'Legado', isDisabled: true },
  ] };

  test('throws 400 sem project', async () => {
    await expect(listWorkItemTypes({ org: 'myorg', pat: 'x', project: '' }))
      .rejects.toMatchObject({ status: 400 });
  });

  test('throws 400 sem pat', async () => {
    await expect(listWorkItemTypes({ org: 'myorg', pat: '', project: 'P' }))
      .rejects.toMatchObject({ status: 400 });
  });

  test('recomendado primeiro, depois Task, demais em ordem alfabética; oculta Bug/Test/Hidden/desativados', async () => {
    rawAzureGet.mockImplementation(url => Promise.resolve({
      status: 200, data: url.includes('workitemtypecategories') ? CATEGORIES : TYPES,
    }));

    const r = await listWorkItemTypes({ org: 'myorg', pat: 'x', project: 'Meu Projeto' });

    expect(r.recommended).toBe('Product Backlog Item');
    expect(r.types).toEqual([
      { name: 'Product Backlog Item', recommended: true },
      { name: 'Task', recommended: false },
      { name: 'Epic', recommended: false },
      { name: 'Feature', recommended: false },
      { name: 'Impediment', recommended: false },
    ]);
    expect(rawAzureGet.mock.calls[0][0]).toContain('/Meu%20Projeto/_apis/wit/');
  });

  test('sem categoria de requisitos: nenhum recomendado', async () => {
    rawAzureGet.mockImplementation(url => Promise.resolve({
      status: 200, data: url.includes('workitemtypecategories') ? { value: [] } : { value: [{ name: 'Issue' }, { name: 'Task' }] },
    }));
    const r = await listWorkItemTypes({ org: 'myorg', pat: 'x', project: 'P' });
    expect(r.recommended).toBeNull();
    expect(r.types.map(t => t.name)).toEqual(['Task', 'Issue']);
  });

  test('throws 401 quando o PAT é recusado', async () => {
    rawAzureGet.mockResolvedValue({ status: 401, data: {} });
    await expect(listWorkItemTypes({ org: 'myorg', pat: 'bad', project: 'P' }))
      .rejects.toMatchObject({ status: 401 });
  });

  test('401 com corpo vazio (rawAzureGet rejeita) vira 401', async () => {
    rawAzureGet.mockRejectedValue(new Error('HTTP 401: '));
    await expect(listWorkItemTypes({ org: 'myorg', pat: 'bad', project: 'P' }))
      .rejects.toMatchObject({ status: 401 });
  });

  test('erro de rede é repassado', async () => {
    rawAzureGet.mockRejectedValue(new Error('ECONNRESET'));
    await expect(listWorkItemTypes({ org: 'myorg', pat: 'x', project: 'P' }))
      .rejects.toThrow('ECONNRESET');
  });

  test('repassa outros erros HTTP', async () => {
    rawAzureGet.mockResolvedValue({ status: 404, data: {} });
    await expect(listWorkItemTypes({ org: 'myorg', pat: 'x', project: 'P' }))
      .rejects.toMatchObject({ status: 404 });
  });
});

// ── setup — tipos de item personalizados ──────────────────────────────────────

describe('setup — tipos de item', () => {
  const FIELDS = { value: [{ referenceName: 'System.Title' }, { referenceName: 'Microsoft.VSTS.Scheduling.Effort' }] };
  const STATES = { value: [
    { name: 'To Do', category: 'Proposed' }, { name: 'Doing', category: 'InProgress' },
    { name: 'Done', category: 'Completed' }, { name: 'Removed', category: 'Removed' },
  ] };

  beforeEach(() => {
    buildAndCache.mockResolvedValue();
    getCfg.mockReturnValue({ projects: [] });
    rawAzureGet.mockImplementation(url => Promise.resolve({
      status: 200, data: url.includes('/fields') ? FIELDS : STATES,
    }));
  });

  test('aceita projectsJson com nomes contendo ":" e ","', async () => {
    await setup({ rawOrg: 'myorg', pat: 't', projectsJson: JSON.stringify([
      { name: 'Alpha', workItemType: 'User Story', team: 'Time: A, B' },
    ]) });
    expect(saveConfig.mock.calls[0][0].projects).toEqual([
      { name: 'Alpha', workItemType: 'User Story', team: 'Time: A, B', orgId: 'myorg' },
    ]);
    expect(rawAzureGet).not.toHaveBeenCalled();
  });

  test('projectsJson sem tipo usa User Story e ignora entradas sem nome', async () => {
    await setup({ rawOrg: 'myorg', pat: 't', projectsJson: [{ name: ' Alpha ' }, { name: '' }, null] });
    expect(saveConfig.mock.calls[0][0].projects).toEqual([{ name: 'Alpha', workItemType: 'User Story', orgId: 'myorg' }]);
  });

  test('projectsJson inválido → 400', async () => {
    await expect(setup({ rawOrg: 'myorg', pat: 't', projectsJson: '{x' }))
      .rejects.toMatchObject({ status: 400 });
  });

  test('tipo novo grava campo de estimativa e estados detectados', async () => {
    await setup({ rawOrg: 'myorg', pat: 't', projectsJson: [{ name: 'Beta', workItemType: 'Issue' }] });
    expect(saveConfig.mock.calls[0][0].projects[0]).toEqual({
      name: 'Beta', workItemType: 'Issue', orgId: 'myorg',
      estimateField: 'Microsoft.VSTS.Scheduling.Effort', estimateUnit: 'points',
      states: { new: ['To Do'], active: ['Doing'], done: ['Done'], removed: ['Removed'] },
    });
    const urls = rawAzureGet.mock.calls.map(c => c[0]);
    expect(urls).toEqual(expect.arrayContaining([
      expect.stringContaining('/Beta/_apis/wit/workitemtypes/Issue/fields'),
      expect.stringContaining('/Beta/_apis/wit/workitemtypes/Issue/states'),
    ]));
  });

  test('falha ao detectar não bloqueia o save', async () => {
    rawAzureGet.mockRejectedValue(new Error('rede'));
    await setup({ rawOrg: 'myorg', pat: 't', projectsJson: [{ name: 'Beta', workItemType: 'Issue' }] });
    expect(saveConfig.mock.calls[0][0].projects[0]).toEqual({ name: 'Beta', workItemType: 'Issue', orgId: 'myorg' });
  });

  test('resposta HTTP diferente de 200 na detecção mantém o perfil anterior', async () => {
    getCfg.mockReturnValue({ projects: [{ name: 'Beta', workItemType: 'Issue', estimateField: null, states: { done: ['Fechado'] } }] });
    rawAzureGet.mockResolvedValue({ status: 500, data: {} });
    await setup({ rawOrg: 'myorg', pat: 't', projectsJson: [{ name: 'Beta', workItemType: 'Issue' }] });
    expect(saveConfig.mock.calls[0][0].projects[0]).toEqual({
      name: 'Beta', workItemType: 'Issue', estimateField: null, states: { done: ['Fechado'] }, orgId: 'myorg',
    });
  });

  test('mesmo tipo: preserva indicadores, burndown e report do projeto', async () => {
    const prev = {
      name: 'Alpha', workItemType: 'User Story', healthIndicators: { uat: { states: ['QA'] } },
      burndownDoneStates: ['Done'], deliveryStates: ['Closed'], reportCharts: [{ type: 'x' }],
    };
    getCfg.mockReturnValue({ projects: [prev] });
    await setup({ rawOrg: 'myorg', pat: 't', projectsRaw: 'Alpha:User Story' });
    expect(saveConfig.mock.calls[0][0].projects[0]).toEqual({ ...prev, orgId: 'myorg' });
  });

  test('tipo alterado: descarta configurações que dependem dos estados', async () => {
    getCfg.mockReturnValue({ projects: [{
      name: 'Alpha', workItemType: 'User Story', healthIndicators: { uat: { states: ['QA'] } },
      burndownDoneStates: ['Done'], deliveryStates: ['Closed'], agingState: 'In Review',
      reportCharts: [{ type: 'x' }], servicenow: { assignmentGroup: 'g1' },
    }] });
    await setup({ rawOrg: 'myorg', pat: 't', projectsRaw: 'Alpha:Task' });
    expect(saveConfig.mock.calls[0][0].projects[0]).toEqual({
      name: 'Alpha', workItemType: 'Task', reportCharts: [{ type: 'x' }], servicenow: { assignmentGroup: 'g1' }, orgId: 'myorg',
    });
  });

  test('tipo legado descarta campos de perfil antigos', async () => {
    getCfg.mockReturnValue({ projects: [{ name: 'Alpha', workItemType: 'User Story', estimateField: 'X', estimateUnit: 'hours', states: { done: ['Done'] } }] });
    await setup({ rawOrg: 'myorg', pat: 't', projectsRaw: 'Alpha:User Story' });
    expect(saveConfig.mock.calls[0][0].projects[0]).toEqual({ name: 'Alpha', workItemType: 'User Story', orgId: 'myorg' });
  });

  test('projeto com time só herda do mesmo projeto e time', async () => {
    getCfg.mockReturnValue({ projects: [
      { name: 'Alpha', workItemType: 'User Story', team: 'T1', reportCharts: ['t1'] },
      { name: 'Alpha', workItemType: 'User Story', reportCharts: ['sem-time'] },
    ] });
    await setup({ rawOrg: 'myorg', pat: 't', projectsJson: [{ name: 'Alpha', team: 'T1', workItemType: 'User Story' }] });
    expect(saveConfig.mock.calls[0][0].projects[0]).toEqual({
      name: 'Alpha', workItemType: 'User Story', team: 'T1', reportCharts: ['t1'], orgId: 'myorg',
    });
  });
});

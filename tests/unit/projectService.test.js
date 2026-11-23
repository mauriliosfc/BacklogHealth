// Testes de equivalência: congelam o comportamento de projectService para os
// tipos legados ('User Story' e 'Task'). Qualquer refactor de tipos de work item
// deve manter estes resultados idênticos para quem já usa o app.

jest.mock('../../azureClient');
jest.mock('../../utils/paginate');
jest.mock('../../utils/iterMap');
jest.mock('../../config');

const { azureGet, azurePost } = require('../../azureClient');
const { paginatedItems } = require('../../utils/paginate');
const { fetchIterMap } = require('../../utils/iterMap');
const { getCfg, getProjectConfig } = require('../../config');
const { fetchProject, fetchProjectDetail, buildCardHTML } = require('../../projectService');

const SP = 'Microsoft.VSTS.Scheduling.StoryPoints';
const RW = 'Microsoft.VSTS.Scheduling.RemainingWork';
const OE = 'Microsoft.VSTS.Scheduling.OriginalEstimate';

function wi(id, type, state, extra = {}) {
  return {
    id,
    fields: {
      'System.Id': id,
      'System.Title': `Item ${id}`,
      'System.WorkItemType': type,
      'System.State': state,
      'System.IterationPath': 'Alpha\\Sprint 1',
      'System.AssignedTo': { displayName: 'Dev' },
      ...extra,
    },
  };
}

// Extrai os números visíveis do card gerado
function parseCard(html) {
  const num = cls => Number((html.match(new RegExp(`${cls}">(\\d+)<`)) || [])[1]);
  const items = JSON.parse((html.match(/data-items='([^']*)'/) || [])[1].replace(/&#39;/g, "'"));
  return {
    total:   num('card-total'),
    bugs:    num('card-bugs'),
    semEst:  num('card-semest'),
    semResp: num('card-semresp'),
    open:    Number((html.match(/card-open" style="display:none">(\d+)</) || [])[1]),
    health:  (html.match(/health-pill (\w+) card-health/) || [])[1],
    typeTxt: (html.match(/card-sprint-type">([^<]*)</) || [])[1],
    sub:     (html.match(/card-total">\d+<\/div>\s*<div class="cstat-sub">([^<]*)</) || [])[1],
    wit:     (html.match(/data-workitemtype="([^"]*)"/) || [])[1],
    items,
  };
}

beforeEach(() => {
  getCfg.mockReturnValue({ baseUrl: 'https://dev.azure.com/org' });
  fetchIterMap.mockResolvedValue({ map: { 'Alpha\\Sprint 1': {} }, currentSprint: 'Sprint 1' });
  azureGet.mockResolvedValue({ value: [] });
});

describe('equivalência — buildCardHTML (User Story)', () => {
  const items = [
    wi(1, 'User Story', 'Active', { [SP]: 3 }),
    wi(2, 'User Story', 'New', { [SP]: null }),
    wi(3, 'Product Backlog Item', 'Closed', { [SP]: 5 }),
    wi(4, 'Requirement', 'Active', { 'System.AssignedTo': null }),
    wi(5, 'Task', 'Active', { [RW]: 4 }),
    wi(6, 'Bug', 'Active'),
    wi(7, 'Bug', 'Closed'),
  ];

  test('conta apenas US/PBI/Requirement e mantém números', () => {
    const c = parseCard(buildCardHTML([{ project: 'Alpha', items, sprint: 'Sprint 1', workItemType: 'User Story' }], 'https://x'));
    expect(c).toMatchObject({ total: 4, open: 3, semEst: 2, semResp: 1, bugs: 1, typeTxt: '· User Story', sub: 'user stories', wit: 'User Story' });
  });

  test('pts vem de StoryPoints e preserva null', () => {
    const c = parseCard(buildCardHTML([{ project: 'Alpha', items, sprint: null, workItemType: 'User Story' }], 'https://x'));
    expect(c.items.find(i => i.id === 1).pts).toBe(3);
    expect(c.items.find(i => i.id === 2).pts).toBeNull();
    expect(c.items.find(i => i.id === 5).pts).toBeNull();
    expect(c.items.find(i => i.id === 1).url).toBe('https://x/_workitems/edit/1');
  });

  test('workItemType ausente equivale a User Story', () => {
    const a = buildCardHTML([{ project: 'Alpha', items, sprint: null }], 'https://x');
    const b = buildCardHTML([{ project: 'Alpha', items, sprint: null, workItemType: 'User Story' }], 'https://x');
    expect(a).toBe(b);
  });
});

describe('equivalência — buildCardHTML (Task)', () => {
  const items = [
    wi(1, 'Task', 'Active', { [RW]: 4, [OE]: 8 }),
    wi(2, 'Task', 'Active', { [RW]: 0, [OE]: 6 }),
    wi(3, 'Task', 'New', { [RW]: 0, [OE]: 0 }),
    wi(4, 'Task', 'Done', {}),
    wi(5, 'User Story', 'Active', { [SP]: 3 }),
    wi(6, 'Bug', 'New'),
  ];

  test('conta apenas Tasks; sem estimativa = RW e OE vazios', () => {
    const c = parseCard(buildCardHTML([{ project: 'Alpha', items, sprint: 'Sprint 1', workItemType: 'Task' }], 'https://x'));
    expect(c).toMatchObject({ total: 4, open: 3, semEst: 1, bugs: 1, typeTxt: '· Task', sub: 'tasks', wit: 'Task' });
  });

  test('pts = RemainingWork com fallback em OriginalEstimate', () => {
    const c = parseCard(buildCardHTML([{ project: 'Alpha', items, sprint: null, workItemType: 'Task' }], 'https://x'));
    expect(c.items.find(i => i.id === 1).pts).toBe(4);
    expect(c.items.find(i => i.id === 2).pts).toBe(6);
    expect(c.items.find(i => i.id === 3).pts).toBe(0);
    expect('pts' in c.items.find(i => i.id === 4)).toBe(false);
  });
});

describe('equivalência — fetchProject', () => {
  test('User Story: WIQL e campos idênticos', async () => {
    azurePost.mockResolvedValue({ workItems: [{ id: 1 }] });
    paginatedItems.mockResolvedValue([wi(1, 'User Story', 'Active')]);
    const r = await fetchProject({ name: 'Alpha', workItemType: 'User Story' });
    expect(azurePost.mock.calls[0][1].query).toBe(
      "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = 'Alpha' AND [System.WorkItemType] IN ('User Story','Product Backlog Item','Requirement','Bug') AND [System.State] NOT IN ('Done','Removed') ORDER BY [System.ChangedDate] DESC"
    );
    expect(paginatedItems.mock.calls[0][2]).toBe(
      `System.Id,System.Title,System.State,System.WorkItemType,System.AssignedTo,${SP},System.IterationPath,Microsoft.VSTS.Common.StackRank`
    );
    expect(r).toMatchObject({ project: 'Alpha', workItemType: 'User Story', error: null });
  });

  test('Task: WIQL e campos idênticos', async () => {
    azurePost.mockResolvedValue({ workItems: [{ id: 1 }] });
    paginatedItems.mockResolvedValue([]);
    await fetchProject({ name: 'Alpha', team: 'T1', workItemType: 'Task' });
    expect(azurePost.mock.calls[0][1].query).toContain("[System.WorkItemType] IN ('Task','Bug') AND [System.State] NOT IN ('Done','Removed')");
    expect(paginatedItems.mock.calls[0][2]).toContain(`System.AssignedTo,${RW},${OE},System.IterationPath`);
  });

  test('string legada vira User Story', async () => {
    azurePost.mockResolvedValue({ workItems: [] });
    const r = await fetchProject('Alpha');
    expect(r).toEqual({ project: 'Alpha', items: [], sprint: null, error: null, workItemType: 'User Story' });
  });
});

describe('tipos personalizados — fetchProject e buildCardHTML', () => {
  const EF = 'Microsoft.VSTS.Scheduling.Effort';
  const issueCfg = {
    name: 'Alpha', workItemType: 'Issue', estimateField: EF, estimateUnit: 'points',
    states: { new: ['To Do'], active: ['Doing'], done: ['Done'], removed: ['Cut'] },
  };

  test('WIQL usa o tipo escolhido, exclui só estados removidos e busca o campo de estimativa', async () => {
    azurePost.mockResolvedValue({ workItems: [{ id: 1 }] });
    paginatedItems.mockResolvedValue([wi(1, 'Issue', 'To Do', { [EF]: 2 })]);
    const r = await fetchProject(issueCfg);
    expect(azurePost.mock.calls[0][1].query).toContain("[System.WorkItemType] IN ('Issue','Bug') AND [System.State] NOT IN ('Cut') ORDER BY");
    expect(paginatedItems.mock.calls[0][2]).toContain(`System.AssignedTo,${EF},System.IterationPath`);
    expect(r.profile.mainTypes).toEqual(['Issue']);
    expect(r.workItemType).toBe('Issue');
  });

  test('tipo sem estados removidos não aplica exclusão; aspas são escapadas', async () => {
    azurePost.mockResolvedValue({ workItems: [] });
    await fetchProject({ name: 'Alpha', workItemType: "Dev's Item", estimateField: null, states: { done: ['Done'] } });
    const q = azurePost.mock.calls[0][1].query;
    expect(q).toContain("IN ('Dev''s Item','Bug') ORDER BY");
    expect(q).not.toContain('NOT IN');
  });

  test('card conta pelos estados do tipo e mostra o nome do tipo', async () => {
    azurePost.mockResolvedValue({ workItems: [{ id: 1 }] });
    paginatedItems.mockResolvedValue([
      wi(1, 'Issue', 'To Do', { [EF]: 3 }),
      wi(2, 'Issue', 'Doing', {}),
      wi(3, 'Issue', 'Done', { [EF]: 1 }),
      wi(4, 'User Story', 'Active', { [SP]: 5 }),
      wi(5, 'Bug', 'Active'),
    ]);
    const result = await fetchProject(issueCfg);
    const html = buildCardHTML([result], 'https://x');
    const c = parseCard(html);
    expect(c).toMatchObject({ total: 3, open: 2, semEst: 1, bugs: 1, typeTxt: '· Issue', sub: 'issue', wit: 'Issue' });
    expect(c.items.find(i => i.id === 1).pts).toBe(3);
    const profile = JSON.parse(html.match(/data-profile='([^']*)'/)[1].replace(/&#39;/g, "'"));
    expect(profile).toMatchObject({ legacy: false, mainTypes: ['Issue'], hasEstimate: true, typeLabel: 'Issue' });
  });

  test('tipo sem campo de estimativa mostra "—" e não penaliza a saúde', async () => {
    const html = buildCardHTML([{
      project: 'Alpha', sprint: null, workItemType: 'Ticket',
      profile: require('../../utils/workItemProfile').getWorkItemProfile({ workItemType: 'Ticket', estimateField: null }),
      items: [wi(1, 'Ticket', 'Active'), wi(2, 'Ticket', 'New')],
    }], 'https://x');
    expect(html).toContain('card-semest">—<');
    expect(html).toContain('cstat_no_estimate_field');
    expect(html).toMatch(/health-pill green card-health/);
  });

  test('nome de tipo com HTML é escapado', () => {
    const html = buildCardHTML([{ project: 'Alpha', sprint: null, workItemType: '<b>X</b>', items: [] }], '');
    expect(html).toContain('· &lt;b&gt;X&lt;/b&gt;');
    expect(html).not.toContain('<b>X</b>');
  });
});

describe('PAT recusado', () => {
  test('fetchProject repassa o código do erro de autenticação', async () => {
    const err = Object.assign(new Error('Token expirado'), { code: 'AZURE_AUTH' });
    azurePost.mockRejectedValue(err);
    const r = await fetchProject({ name: 'Alpha', workItemType: 'User Story' });
    expect(r).toMatchObject({ project: 'Alpha', error: 'Token expirado', errorCode: 'AZURE_AUTH', items: [] });
  });

  test('erro comum não ganha errorCode (resultado igual ao anterior)', async () => {
    azurePost.mockRejectedValue(new Error('falhou'));
    const r = await fetchProject({ name: 'Alpha', workItemType: 'User Story' });
    expect('errorCode' in r).toBe(false);
  });

  test('card de autenticação mostra mensagem traduzível e link para Configurações', () => {
    const html = buildCardHTML([{ project: 'Alpha', items: [], error: 'Token <expirado>', errorCode: 'AZURE_AUTH' }]);
    expect(html).toContain('card-auth-error');
    expect(html).toContain('data-i18n="err_azure_auth_card"');
    expect(html).toContain('Token &lt;expirado&gt;');
    expect(html).toContain('href="/settings"');
    expect(html).not.toContain('Parse error');
  });

  test('outros erros mantêm o card de erro anterior', () => {
    const html = buildCardHTML([{ project: 'Alpha', items: [], error: 'falhou' }]);
    expect(html).toContain('<div class="card error">');
    expect(html).toContain('falhou');
  });
});

describe('equivalência — fetchProjectDetail', () => {
  function setup(workItemType) {
    getProjectConfig.mockReturnValue({ name: 'Alpha', workItemType, displayName: 'Alpha' });
    azurePost.mockImplementation((_, { query }) =>
      Promise.resolve({ workItems: query.includes("IN (") ? [{ id: 1 }, { id: 2 }] : [] }));
  }

  test('User Story: query principal e pts', async () => {
    setup('User Story');
    paginatedItems.mockResolvedValue([wi(1, 'User Story', 'Active', { [SP]: 2 }), wi(2, 'Bug', 'New')]);
    const r = await fetchProjectDetail('Alpha');
    expect(azurePost.mock.calls[0][1].query).toContain("IN ('User Story','Product Backlog Item','Requirement','Bug') AND [System.State] NOT IN ('Done','Removed')");
    expect(azurePost.mock.calls[1][1].query).toContain("[System.WorkItemType] = 'Task'");
    expect(paginatedItems.mock.calls[0][2]).toBe(
      `System.Id,System.Title,System.State,System.WorkItemType,System.AssignedTo,${SP},Microsoft.VSTS.Scheduling.CompletedWork,System.IterationPath`
    );
    expect(r.items[0]).toEqual({ id: 1, url: 'https://dev.azure.com/org/_workitems/edit/1', state: 'Active', type: 'User Story', pts: 2, assigned: 'Dev', iteration: 'Alpha\\Sprint 1', title: 'Item 1' });
    expect(r.items[1].pts).toBeNull();
    expect(r.workItemType).toBe('User Story');
  });

  test('tipo personalizado: devolve perfil para o navegador e pts pelo campo do tipo', async () => {
    getProjectConfig.mockReturnValue({
      name: 'Alpha', workItemType: 'Issue', displayName: 'Alpha',
      estimateField: 'Microsoft.VSTS.Scheduling.Size', states: { done: ['Done'], removed: [] },
    });
    azurePost.mockImplementation((_, { query }) =>
      Promise.resolve({ workItems: query.includes("IN (") ? [{ id: 1 }] : [] }));
    paginatedItems.mockResolvedValue([wi(1, 'Issue', 'Done', { 'Microsoft.VSTS.Scheduling.Size': 8 })]);
    const r = await fetchProjectDetail('Alpha');
    expect(azurePost.mock.calls[0][1].query).toContain("IN ('Issue','Bug') ORDER BY");
    expect(r.items[0].pts).toBe(8);
    expect(r.profile).toEqual({
      workItemType: 'Issue', legacy: false, mainTypes: ['Issue'], estimateUnit: 'points',
      hasEstimate: true, typeLabel: 'Issue', states: { new: [], active: [], done: ['Done'], removed: [] },
    });
  });

  test('legado não devolve perfil (resposta idêntica à anterior)', async () => {
    setup('User Story');
    paginatedItems.mockResolvedValue([]);
    const r = await fetchProjectDetail('Alpha');
    expect('profile' in r).toBe(false);
  });

  test('Task: pts = RemainingWork com fallback', async () => {
    setup('Task');
    paginatedItems.mockResolvedValue([wi(1, 'Task', 'Active', { [RW]: 0, [OE]: 7 })]);
    const r = await fetchProjectDetail('Alpha');
    expect(azurePost.mock.calls[0][1].query).toContain("IN ('Task','Bug')");
    expect(r.items[0].pts).toBe(7);
  });
});

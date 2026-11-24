// Múltiplas organizações nos serviços: cada projeto consulta a sua organização,
// com o token dela, e os links apontam para a URL dela.
jest.mock('../../azureClient');
jest.mock('../../utils/paginate');
jest.mock('../../utils/iterMap');
jest.mock('../../config');

const { azureGet, azurePost } = require('../../azureClient');
const { paginatedItems } = require('../../utils/paginate');
const { fetchIterMap } = require('../../utils/iterMap');
const config = require('../../config');
const { fetchProject, fetchProjectDetail, buildCardHTML, fetchUATPlans } = require('../../projectService');
const { fetchTeamCapacity } = require('../../teamCapacityService');

const ORG_A = { id: 'a', org: 'A', baseUrl: 'https://dev.azure.com/A', pat: 'pa' };
const ORG_B = { id: 'b', org: 'B', baseUrl: 'https://b.visualstudio.com', pat: 'pb', label: 'Cliente B' };

beforeEach(() => {
  config.getCfg.mockReturnValue({ baseUrl: ORG_A.baseUrl, organizations: [ORG_A, ORG_B] });
  config.getOrg.mockImplementation(id => [ORG_A, ORG_B].find(o => o.id === id) || ORG_A);
  config.getDisplayName.mockImplementation(p => p.key || (p.team ? `${p.name} - ${p.team}` : p.name));
  fetchIterMap.mockResolvedValue({ map: {}, currentSprint: null });
  azureGet.mockResolvedValue({ value: [] });
});

describe('projectService', () => {
  test('fetchProject consulta com a organização do projeto e devolve a URL dela', async () => {
    azurePost.mockResolvedValue({ workItems: [{ id: 1 }] });
    paginatedItems.mockResolvedValue([{ id: 1, fields: { 'System.WorkItemType': 'User Story', 'System.State': 'Active' } }]);
    const r = await fetchProject({ name: 'Alpha', orgId: 'b', key: 'Cliente B / Alpha' });
    expect(azurePost.mock.calls[0][2]).toBe(ORG_B);
    expect(paginatedItems.mock.calls[0][3]).toBe(ORG_B);
    expect(fetchIterMap.mock.calls[0][2]).toBe(ORG_B);
    expect(azureGet.mock.calls[0][1]).toBe(ORG_B);
    expect(r).toMatchObject({ project: 'Cliente B / Alpha', orgId: 'b', baseUrl: ORG_B.baseUrl });
  });

  test('erro de token guarda a organização para o aviso', async () => {
    azurePost.mockRejectedValue(Object.assign(new Error('expirado'), { code: 'AZURE_AUTH' }));
    const r = await fetchProject({ name: 'Alpha', orgId: 'b' });
    expect(r).toMatchObject({ errorCode: 'AZURE_AUTH', orgId: 'b' });
  });

  test('buildCardHTML usa a URL da organização do card e mostra o selo', () => {
    const html = buildCardHTML([{
      project: 'Alpha', sprint: null, baseUrl: ORG_B.baseUrl, orgLabel: 'Cliente B',
      items: [{ id: 7, fields: { 'System.WorkItemType': 'User Story', 'System.State': 'New' } }],
    }], ORG_A.baseUrl);
    expect(html).toContain('https://b.visualstudio.com/_workitems/edit/7');
    expect(html).toContain('class="card-org-chip"');
    expect(html).toContain('data-org="Cliente B"');
  });

  test('mensagem de erro com HTML é escapada no card', () => {
    const html = buildCardHTML([{ project: 'Alpha', items: [], error: 'Parse error: <style>x</style>' }], '');
    expect(html).toContain('Parse error: &lt;style&gt;x&lt;/style&gt;');
    expect(html).not.toContain('<style>');
  });

  test('sem organização no resultado, usa a URL padrão e não mostra selo', () => {
    const html = buildCardHTML([{
      project: 'Alpha', sprint: null,
      items: [{ id: 7, fields: { 'System.WorkItemType': 'User Story', 'System.State': 'New' } }],
    }], ORG_A.baseUrl);
    expect(html).toContain('https://dev.azure.com/A/_workitems/edit/7');
    expect(html).not.toContain('card-org-chip');
    expect(html).not.toContain('data-org=');
  });

  test('fetchProjectDetail e UAT montam links com a URL da organização', async () => {
    config.getProjectConfig.mockReturnValue({ name: 'Alpha', orgId: 'b', displayName: 'Alpha' });
    azurePost.mockImplementation((_, { query }) => Promise.resolve({ workItems: query.includes('IN (') ? [{ id: 3 }] : [] }));
    paginatedItems.mockResolvedValue([{ id: 3, fields: { 'System.WorkItemType': 'User Story' } }]);
    const d = await fetchProjectDetail('Alpha');
    expect(d.items[0].url).toBe('https://b.visualstudio.com/_workitems/edit/3');
    expect(azurePost.mock.calls.every(c => c[2] === ORG_B)).toBe(true);

    azureGet.mockResolvedValue({ value: [{ id: 9, name: 'Plano' }] });
    const u = await fetchUATPlans('Alpha');
    expect(u.plans[0].url).toBe('https://b.visualstudio.com/Alpha/_testPlans/execute?planId=9');
    expect(azureGet.mock.calls[azureGet.mock.calls.length - 1][1]).toBe(ORG_B);
  });
});

describe('teamCapacityService', () => {
  test('usa a organização do projeto', async () => {
    config.getProjectConfig.mockReturnValue({ name: 'Alpha', orgId: 'b' });
    azurePost.mockResolvedValue({ workItems: [{ id: 1 }] });
    paginatedItems.mockResolvedValue([]);
    await fetchTeamCapacity('Alpha');
    expect(azurePost.mock.calls[0][2]).toBe(ORG_B);
    expect(fetchIterMap.mock.calls[0][2]).toBe(ORG_B);
    expect(paginatedItems.mock.calls[0][3]).toBe(ORG_B);
  });
});

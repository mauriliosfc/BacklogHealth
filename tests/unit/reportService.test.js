// fetchAzureReport: tipos legados mantêm a consulta por US/PBI/Requirement e
// StoryPoints; tipos personalizados usam o próprio tipo, estimativa e estados.
jest.mock('fs');
jest.mock('../../config');
jest.mock('../../azureClient');
jest.mock('../../utils/paginate');
jest.mock('../../servicenowClient');

const fs = require('fs');
const { getCfg, getProjectConfig } = require('../../config');
const { azurePost } = require('../../azureClient');
const { paginatedItems } = require('../../utils/paginate');
const { fetchAzureReport } = require('../../reportService');

const SP = 'Microsoft.VSTS.Scheduling.StoryPoints';
const EF = 'Microsoft.VSTS.Scheduling.Effort';
const PERIOD = { month: '2026-10', start: '2026-10-01', end: '2026-10-31' };

const item = (id, type, state, extra) => ({
  id, fields: { 'System.State': state, 'System.WorkItemType': type, 'System.IterationPath': 'P\\S1', 'System.CreatedDate': '2026-10-02', ...extra },
});

beforeEach(() => {
  fs.readFileSync.mockImplementation(() => { throw new Error('sem cache'); });
  fs.writeFileSync.mockImplementation(() => {});
  fs.existsSync.mockReturnValue(true);
  getCfg.mockReturnValue({ baseUrl: 'https://dev.azure.com/org' });
  azurePost.mockImplementation((_, { query }) =>
    Promise.resolve({ workItems: query.includes("= 'Bug'") ? [] : [{ id: 1 }, { id: 2 }] }));
});

test('legado (User Story): consulta e pontos idênticos', async () => {
  getProjectConfig.mockReturnValue({ name: 'P', workItemType: 'User Story', displayName: 'P' });
  paginatedItems.mockResolvedValue([item(1, 'User Story', 'Closed', { [SP]: 5 }), item(2, 'Product Backlog Item', 'Active', { [SP]: 3 })]);

  const r = await fetchAzureReport('P', PERIOD);

  expect(azurePost.mock.calls[0][1].query).toContain("[System.WorkItemType] IN ('User Story','Product Backlog Item','Requirement')");
  expect(paginatedItems.mock.calls[0][2]).toBe(`System.Id,System.State,System.IterationPath,${SP},System.WorkItemType,System.CreatedDate`);
  expect(r.totalUS).toBe(2);
  expect(r.totalDelivered).toBe(1);
  expect(r.sprints[0]).toMatchObject({ points: 8, pointsDelivered: 5 });
});

test('legado (Task) continua consultando US/PBI/Requirement', async () => {
  getProjectConfig.mockReturnValue({ name: 'P', workItemType: 'Task', displayName: 'P' });
  paginatedItems.mockResolvedValue([]);
  await fetchAzureReport('P', PERIOD);
  expect(azurePost.mock.calls[0][1].query).toContain("IN ('User Story','Product Backlog Item','Requirement')");
});

test('tipo personalizado: tipo, campo de estimativa e estados concluídos do tipo', async () => {
  getProjectConfig.mockReturnValue({
    name: 'P', workItemType: 'Issue', displayName: 'P', estimateField: EF,
    states: { new: ['To Do'], active: ['Doing'], done: ['Done'], removed: [] },
  });
  paginatedItems.mockResolvedValue([item(1, 'Issue', 'Done', { [EF]: 4 }), item(2, 'Issue', 'Doing', { [EF]: 2 })]);

  const r = await fetchAzureReport('P', PERIOD);

  expect(azurePost.mock.calls[0][1].query).toContain("[System.WorkItemType] IN ('Issue')");
  expect(paginatedItems.mock.calls[0][2]).toContain(`System.IterationPath,${EF},System.WorkItemType`);
  expect(r.totalDelivered).toBe(1);
  expect(r.sprints[0]).toMatchObject({ points: 6, pointsDelivered: 4 });
});

test('estados de entrega informados têm prioridade sobre os do tipo', async () => {
  getProjectConfig.mockReturnValue({ name: 'P', workItemType: 'Issue', displayName: 'P', estimateField: EF, states: { done: ['Done'] } });
  paginatedItems.mockResolvedValue([item(1, 'Issue', 'Done', {}), item(2, 'Issue', 'Doing', {})]);
  const r = await fetchAzureReport('P', PERIOD, [], '', ['Doing']);
  expect(r.totalDelivered).toBe(1);
  expect(r.sprints[0].delivered).toBe(1);
});

jest.mock('../../../config');
jest.mock('../../../projectService');

const { getCfg } = require('../../../config');
const { buildCardHTML } = require('../../../projectService');
const { buildSummaryBar } = require('../../../handlers/dashboard');

const mkItem = (type, state, pts, assignedTo) => ({
  fields: {
    'System.WorkItemType': type,
    'System.State': state,
    'Microsoft.VSTS.Scheduling.StoryPoints': pts !== undefined ? pts : null,
    'System.AssignedTo': assignedTo !== undefined ? assignedTo : { displayName: 'Dev' },
  },
});

// ── buildSummaryBar ──────────────────────────────────────────────────────────

describe('buildSummaryBar', () => {
  test('retorna string vazia para lista vazia', () => {
    expect(buildSummaryBar([])).toBe('');
  });

  test('retorna string vazia quando todos os resultados têm erro', () => {
    expect(buildSummaryBar([{ error: 'fail' }, { error: 'fail2' }])).toBe('');
  });

  test('exclui resultados com erro da contagem de projetos', () => {
    const results = [
      { items: [], sprint: 'S1', workItemType: 'User Story' },
      { items: [], sprint: 'S1', workItemType: 'User Story' },
      { error: 'fail' },
    ];
    const html = buildSummaryBar(results);
    expect(html).toContain('>2<');
  });

  test('soma apenas mainItems (User Story, PBI, Requirement) no total', () => {
    const results = [{
      items: [
        mkItem('User Story', 'Active', 5),
        mkItem('User Story', 'Closed', 3),
        mkItem('Bug', 'Active', null),
        mkItem('Task', 'Active', null),
      ],
      sprint: 'S1',
      workItemType: 'User Story',
    }];
    const html = buildSummaryBar(results);
    expect(html).toContain('>2<'); // 2 User Stories
  });

  test('acumula items de múltiplos projetos', () => {
    const results = [
      { items: [mkItem('User Story', 'Active', 5)], sprint: 'S1', workItemType: 'User Story' },
      { items: [mkItem('User Story', 'Active', 3), mkItem('User Story', 'Closed', 2)], sprint: 'S1', workItemType: 'User Story' },
    ];
    const html = buildSummaryBar(results);
    expect(html).toContain('>3<'); // 1 + 2 = 3 US
  });

  test('exibe nome do sprint quando todos os projetos têm o mesmo sprint', () => {
    const results = [
      { items: [], sprint: 'Sprint 42', workItemType: 'User Story' },
      { items: [], sprint: 'Sprint 42', workItemType: 'User Story' },
    ];
    expect(buildSummaryBar(results)).toContain('Sprint 42');
  });

  test('exibe Multiple quando sprints diferem entre projetos', () => {
    const results = [
      { items: [], sprint: 'Sprint 1', workItemType: 'User Story' },
      { items: [], sprint: 'Sprint 2', workItemType: 'User Story' },
    ];
    expect(buildSummaryBar(results)).toContain('Multiple');
  });

  test('exibe — quando nenhum projeto tem sprint', () => {
    const results = [{ items: [], workItemType: 'User Story' }];
    expect(buildSummaryBar(results)).toContain('>—<');
  });

  test('aplica sum-val--warn quando há issues', () => {
    const results = [{
      items: [mkItem('User Story', 'Active', null, null)],
      sprint: 'S1',
      workItemType: 'User Story',
    }];
    expect(buildSummaryBar(results)).toContain('sum-val--warn');
  });

  test('não aplica sum-val--warn quando não há issues', () => {
    const results = [{
      items: [mkItem('User Story', 'Active', 5, { displayName: 'Dev' })],
      sprint: 'S1',
      workItemType: 'User Story',
    }];
    const html = buildSummaryBar(results);
    expect(html).not.toContain('sum-val--warn');
    expect(html).toContain('>—<');
  });

  test('bugs ativos contam como issues', () => {
    const results = [{
      items: [
        mkItem('User Story', 'Active', 5, { displayName: 'Dev' }),
        mkItem('Bug', 'Active', null, null),
      ],
      sprint: 'S1',
      workItemType: 'User Story',
    }];
    expect(buildSummaryBar(results)).toContain('sum-val--warn');
  });

  test('contém classes CSS e tokens i18n corretos', () => {
    const results = [{ items: [], sprint: 'S1', workItemType: 'User Story' }];
    const html = buildSummaryBar(results);
    expect(html).toContain('class="sum-bar"');
    expect(html).toContain('id="sum-bar"');
    expect(html).toContain('data-i18n="sum_projects"');
    expect(html).toContain('data-i18n="sum_items"');
    expect(html).toContain('data-i18n="sum_issues"');
    expect(html).toContain('data-i18n="sum_need_attention"');
  });

  test('modo Task conta apenas Task items (não User Stories)', () => {
    const results = [{
      items: [
        { fields: { 'System.WorkItemType': 'Task', 'System.State': 'Active', 'Microsoft.VSTS.Scheduling.RemainingWork': 4, 'System.AssignedTo': { displayName: 'Dev' } } },
        mkItem('User Story', 'Active', 5),
      ],
      sprint: 'S1',
      workItemType: 'Task',
    }];
    const html = buildSummaryBar(results);
    expect(html).toContain('>1<'); // apenas 1 Task
  });
});

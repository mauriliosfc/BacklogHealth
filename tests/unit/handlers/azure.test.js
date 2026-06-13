jest.mock('../../../config');
jest.mock('../../../azureClient');
jest.mock('../../../projectService');
jest.mock('../../../teamCapacityService');

const { getDetail, getTeamCapacity, getUAT, getReportFields, getUSStates, getContext } = require('../../../handlers/azure');
const { getCfg, getDisplayName } = require('../../../config');
const { azureGet } = require('../../../azureClient');
const { fetchProjectDetail, fetchUATPlans } = require('../../../projectService');
const { fetchTeamCapacity } = require('../../../teamCapacityService');

// ── Fixture reutilizável ──────────────────────────────────────────────────────

function makeDetail(overrides = {}) {
  return {
    project:      'Alpha',
    workItemType: 'User Story',
    items: [
      { type: 'User Story', state: 'Active', pts: 5,  iteration: 'Alpha\\Sprint 1', assigned: 'Alice', title: 'Story 1' },
      { type: 'User Story', state: 'Done',   pts: 3,  iteration: 'Alpha\\Sprint 1', assigned: 'Bob',   title: 'Story 2' },
      { type: 'User Story', state: 'Active', pts: 0,  iteration: 'Alpha\\Sprint 1', assigned: null,    title: 'Story 3' },
      { type: 'Bug',        state: 'Active', pts: 0,  iteration: 'Alpha\\Sprint 1', assigned: 'Alice', title: 'Bug 1'   },
    ],
    taskItems: [{ completedWork: 8, iteration: 'Alpha\\Sprint 1' }],
    bugItems:  [{ completedWork: 2, iteration: 'Alpha\\Sprint 1' }],
    iterMap: {
      'Alpha\\Sprint 1': { isCurrent: true, start: '2026-01-01', end: '2026-01-14' },
    },
    ...overrides,
  };
}

beforeEach(() => {
  getCfg.mockReturnValue({ projects: [{ name: 'Alpha' }] });
  getDisplayName.mockImplementation(p => (typeof p === 'string' ? p : p.name));
});

// ── getDetail ─────────────────────────────────────────────────────────────────

describe('getDetail', () => {
  test('throws 400 quando projeto não está na lista', async () => {
    await expect(getDetail({ project: 'Nonexistent' }))
      .rejects.toMatchObject({ status: 400 });
  });

  test('throws 400 quando project é nulo', async () => {
    await expect(getDetail({ project: null }))
      .rejects.toMatchObject({ status: 400 });
  });

  test('delega para fetchProjectDetail e retorna resultado', async () => {
    const expected = makeDetail();
    fetchProjectDetail.mockResolvedValue(expected);

    const result = await getDetail({ project: 'Alpha' });

    expect(fetchProjectDetail).toHaveBeenCalledWith('Alpha');
    expect(result).toBe(expected);
  });
});

// ── getTeamCapacity ───────────────────────────────────────────────────────────

describe('getTeamCapacity', () => {
  test('delega para fetchTeamCapacity', async () => {
    const expected = { developers: [] };
    fetchTeamCapacity.mockResolvedValue(expected);

    const result = await getTeamCapacity({ project: 'Alpha' });

    expect(fetchTeamCapacity).toHaveBeenCalledWith('Alpha');
    expect(result).toBe(expected);
  });
});

// ── getUAT ────────────────────────────────────────────────────────────────────

describe('getUAT', () => {
  test('delega para fetchUATPlans', async () => {
    const expected = { plans: [] };
    fetchUATPlans.mockResolvedValue(expected);

    const result = await getUAT({ project: 'Alpha' });

    expect(fetchUATPlans).toHaveBeenCalledWith('Alpha');
    expect(result).toBe(expected);
  });
});

// ── getReportFields ───────────────────────────────────────────────────────────

describe('getReportFields', () => {
  const allFields = [
    { referenceName: 'Custom.MyField',                    name: 'My Field' },
    { referenceName: 'System.State',                      name: 'State' },
    { referenceName: 'System.AssignedTo',                 name: 'Assigned To' },
    { referenceName: 'Microsoft.VSTS.Common.Priority',    name: 'Priority' },
    { referenceName: 'System.Description',                name: 'Description' },   // não deve aparecer
    { referenceName: 'Microsoft.VSTS.Common.ClosedDate',  name: 'Closed Date' },   // não deve aparecer
  ];

  beforeEach(() => {
    azureGet.mockResolvedValue({ value: allFields });
  });

  test('inclui campos Custom.*', async () => {
    const { fields } = await getReportFields({ project: 'Alpha' });
    expect(fields.map(f => f.ref)).toContain('Custom.MyField');
  });

  test('inclui campos standard permitidos (System.State, System.AssignedTo, etc.)', async () => {
    const { fields } = await getReportFields({ project: 'Alpha' });
    const refs = fields.map(f => f.ref);
    expect(refs).toContain('System.State');
    expect(refs).toContain('System.AssignedTo');
    expect(refs).toContain('Microsoft.VSTS.Common.Priority');
  });

  test('exclui campos System não listados (System.Description)', async () => {
    const { fields } = await getReportFields({ project: 'Alpha' });
    expect(fields.map(f => f.ref)).not.toContain('System.Description');
  });

  test('campos ordenados por label', async () => {
    const { fields } = await getReportFields({ project: 'Alpha' });
    const labels = fields.map(f => f.label);
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b)));
  });

  test('retorna { ref, label } por campo', async () => {
    const { fields } = await getReportFields({ project: 'Alpha' });
    expect(fields[0]).toMatchObject({ ref: expect.any(String), label: expect.any(String) });
  });

  test('usa nome do projeto da config, não o displayName', async () => {
    getCfg.mockReturnValue({
      projects: [{ name: 'InternalName', workItemType: 'User Story' }],
    });
    getDisplayName.mockReturnValue('DisplayName - Team');
    azureGet.mockResolvedValue({ value: [] });

    await getReportFields({ project: 'DisplayName - Team' });

    expect(azureGet).toHaveBeenCalledWith(
      expect.stringContaining('InternalName')
    );
  });
});

// ── getUSStates ───────────────────────────────────────────────────────────────

describe('getUSStates', () => {
  test('retorna nomes dos estados', async () => {
    azureGet.mockResolvedValue({ value: [{ name: 'New' }, { name: 'Active' }, { name: 'Done' }] });

    const { states } = await getUSStates({ project: 'Alpha' });

    expect(states).toEqual(['New', 'Active', 'Done']);
  });

  test('usa workItemType do projeto na URL', async () => {
    getCfg.mockReturnValue({
      projects: [{ name: 'Alpha', workItemType: 'Task' }],
    });
    azureGet.mockResolvedValue({ value: [] });

    await getUSStates({ project: 'Alpha' });

    expect(azureGet).toHaveBeenCalledWith(expect.stringContaining('Task'));
  });

  test('usa "User Story" como fallback quando workItemType ausente', async () => {
    getCfg.mockReturnValue({ projects: [{ name: 'Alpha' }] });
    azureGet.mockResolvedValue({ value: [] });

    await getUSStates({ project: 'Alpha' });

    expect(azureGet).toHaveBeenCalledWith(expect.stringContaining('User%20Story'));
  });
});

// ── getContext ────────────────────────────────────────────────────────────────

describe('getContext', () => {
  beforeEach(() => {
    fetchProjectDetail.mockResolvedValue(makeDetail());
  });

  test('retorna array projects com um entry por projeto', async () => {
    const { projects } = await getContext({});
    expect(projects).toHaveLength(1);
    expect(projects[0].name).toBe('Alpha');
  });

  test('computa userStories corretamente (apenas tipos US)', async () => {
    const { projects } = await getContext({});
    // 3 User Stories, 1 Bug → mainItems = 3
    expect(projects[0].summary.userStories).toBe(3);
  });

  test('computa storyPoints como soma de todos os items filtrados', async () => {
    const { projects } = await getContext({});
    // pts: 5+3+0+0 = 8
    expect(projects[0].summary.storyPoints).toBe(8);
  });

  test('computa openBugs corretamente', async () => {
    const { projects } = await getContext({});
    expect(projects[0].summary.openBugs).toBe(1);
  });

  test('computa noEstimate apenas entre mainItems', async () => {
    const { projects } = await getContext({});
    // 1 US sem pts (Story 3)
    expect(projects[0].summary.noEstimate).toBe(1);
  });

  test('healthIndicators: completionRate = round(closed/total*100)', async () => {
    const { projects } = await getContext({});
    // 1 Done / 3 US = 33%
    expect(projects[0].healthIndicators.completionRate).toBe(33);
  });

  test('healthIndicators: bugRate = round(bugHrs/totalHrs*100)', async () => {
    const { projects } = await getContext({});
    // bugHrs=2, taskHrs=8, total=10 → 20%
    expect(projects[0].healthIndicators.bugRate_pct).toBe(20);
  });

  test('healthIndicators: estimateCoverage = round((total-noEst)/total*100)', async () => {
    const { projects } = await getContext({});
    // (3-1)/3 = 67%
    expect(projects[0].healthIndicators.estimateCoverage).toBe(67);
  });

  test('aplica filtro de sprint — exclui items de outras sprints', async () => {
    fetchProjectDetail.mockResolvedValue(makeDetail({
      items: [
        { type: 'User Story', state: 'Active', pts: 5, iteration: 'Alpha\\Sprint 1', assigned: 'Alice', title: 'S1' },
        { type: 'User Story', state: 'Active', pts: 3, iteration: 'Alpha\\Sprint 2', assigned: 'Bob',   title: 'S2' },
      ],
      taskItems: [], bugItems: [],
    }));

    const { projects } = await getContext({ filters: { Alpha: ['Alpha\\Sprint 1'] } });

    expect(projects[0].summary.userStories).toBe(1);
    expect(projects[0].summary.storyPoints).toBe(5);
    expect(projects[0].activeSprintFilter).toEqual(['Sprint 1']);
  });

  test('sem filtro → activeSprintFilter é null', async () => {
    const { projects } = await getContext({});
    expect(projects[0].activeSprintFilter).toBeNull();
  });

  test('noEstimateItems contém apenas US abertas sem pts', async () => {
    const { projects } = await getContext({});
    expect(projects[0].noEstimateItems).toHaveLength(1);
    expect(projects[0].noEstimateItems[0].title).toBe('Story 3');
  });

  test('noAssigneeItems contém apenas US abertas sem responsável', async () => {
    const { projects } = await getContext({});
    // Story 3: Active + assigned=null
    expect(projects[0].noAssigneeItems).toHaveLength(1);
    expect(projects[0].noAssigneeItems[0].title).toBe('Story 3');
  });

  test('currentSprint apontada pela iterMap isCurrent=true', async () => {
    const { projects } = await getContext({});
    expect(projects[0].currentSprint.name).toBe('Sprint 1');
    expect(projects[0].currentSprint.start).toBe('2026-01-01');
  });

  test('currentSprint=null quando nenhuma sprint está marcada como current', async () => {
    fetchProjectDetail.mockResolvedValue(makeDetail({ iterMap: {} }));

    const { projects } = await getContext({});
    expect(projects[0].currentSprint).toBeNull();
  });

  test('retorna projetos de múltiplos projetos em paralelo', async () => {
    getCfg.mockReturnValue({
      projects: [{ name: 'Alpha' }, { name: 'Beta' }],
    });
    getDisplayName.mockImplementation(p => p.name);
    fetchProjectDetail
      .mockResolvedValueOnce(makeDetail({ project: 'Alpha' }))
      .mockResolvedValueOnce(makeDetail({ project: 'Beta' }));

    const { projects } = await getContext({});

    expect(projects).toHaveLength(2);
    expect(fetchProjectDetail).toHaveBeenCalledTimes(2);
  });
});

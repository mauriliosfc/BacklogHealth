const {
  FIELD, isLegacyType, getWorkItemProfile, readEstimate, lacksEstimate,
  excludedStates, statesOr, wiqlList, clientProfile,
  statesFromCategories, pickEstimateField,
} = require('../../../utils/workItemProfile');

describe('getWorkItemProfile — tipos legados', () => {
  test('User Story mantém US/PBI/Requirement e StoryPoints', () => {
    const p = getWorkItemProfile({ workItemType: 'User Story' });
    expect(p).toEqual({
      workItemType: 'User Story', legacy: true,
      mainTypes: ['User Story', 'Product Backlog Item', 'Requirement'],
      estimateFields: [FIELD.storyPoints], estimateUnit: 'points',
      typeLabel: 'User Story', states: null,
    });
  });

  test('ausente, string ou nulo equivale a User Story', () => {
    const us = getWorkItemProfile({ workItemType: 'User Story' });
    expect(getWorkItemProfile({})).toEqual(us);
    expect(getWorkItemProfile('Alpha')).toEqual(us);
    expect(getWorkItemProfile(null)).toEqual(us);
  });

  test('Task usa RemainingWork + OriginalEstimate em horas', () => {
    const p = getWorkItemProfile({ workItemType: 'Task' });
    expect(p.mainTypes).toEqual(['Task']);
    expect(p.estimateFields).toEqual([FIELD.remainingWork, FIELD.originalEstimate]);
    expect(p.estimateUnit).toBe('hours');
    expect(p.states).toBeNull();
    expect(p.legacy).toBe(true);
  });

  test('legado ignora estados e campo salvos no projeto', () => {
    const p = getWorkItemProfile({ workItemType: 'User Story', estimateField: FIELD.effort, states: { done: ['X'] } });
    expect(p.estimateFields).toEqual([FIELD.storyPoints]);
    expect(p.states).toBeNull();
  });

  test('isLegacyType', () => {
    expect(isLegacyType('User Story')).toBe(true);
    expect(isLegacyType('Task')).toBe(true);
    expect(isLegacyType(undefined)).toBe(true);
    expect(isLegacyType('Issue')).toBe(false);
    expect(isLegacyType('Product Backlog Item')).toBe(false);
  });
});

describe('getWorkItemProfile — tipos novos', () => {
  test('Issue com campo e estados detectados', () => {
    const p = getWorkItemProfile({
      workItemType: 'Issue', estimateField: FIELD.effort, estimateUnit: 'points',
      states: { new: ['To Do'], active: ['Doing'], done: ['Done'] },
    });
    expect(p).toEqual({
      workItemType: 'Issue', legacy: false, mainTypes: ['Issue'],
      estimateFields: [FIELD.effort], estimateUnit: 'points', typeLabel: 'Issue',
      states: { new: ['To Do'], active: ['Doing'], done: ['Done'], removed: [] },
    });
  });

  test('sem detecção tenta StoryPoints, Effort e Size', () => {
    const p = getWorkItemProfile({ workItemType: 'Product Backlog Item' });
    expect(p.estimateFields).toEqual([FIELD.storyPoints, FIELD.effort, FIELD.size]);
    expect(p.states).toBeNull();
    expect(p.mainTypes).toEqual(['Product Backlog Item']);
  });

  test('estimateField null = tipo sem estimativa', () => {
    expect(getWorkItemProfile({ workItemType: 'Ticket', estimateField: null }).estimateFields).toEqual([]);
  });

  test('unidade em horas inferida pelo campo quando não salva', () => {
    expect(getWorkItemProfile({ workItemType: 'Chamado', estimateField: FIELD.originalEstimate }).estimateUnit).toBe('hours');
  });

  test('estados inválidos são descartados', () => {
    const p = getWorkItemProfile({ workItemType: 'Issue', states: { done: ['Done', '', 3], active: 'x' } });
    expect(p.states).toEqual({ new: [], active: [], done: ['Done'], removed: [] });
  });
});

describe('readEstimate / lacksEstimate', () => {
  const us   = getWorkItemProfile({ workItemType: 'User Story' });
  const task = getWorkItemProfile({ workItemType: 'Task' });

  test('User Story: StoryPoints ?? null', () => {
    expect(readEstimate({ [FIELD.storyPoints]: 0 }, us)).toBe(0);
    expect(readEstimate({}, us)).toBeNull();
    expect(lacksEstimate({ [FIELD.storyPoints]: 0 }, us)).toBe(false);
    expect(lacksEstimate({}, us)).toBe(true);
  });

  test('Task: RemainingWork, senão OriginalEstimate (mesmo undefined)', () => {
    expect(readEstimate({ [FIELD.remainingWork]: 3, [FIELD.originalEstimate]: 8 }, task)).toBe(3);
    expect(readEstimate({ [FIELD.remainingWork]: 0, [FIELD.originalEstimate]: 8 }, task)).toBe(8);
    expect(readEstimate({}, task)).toBeUndefined();
    expect(lacksEstimate({ [FIELD.remainingWork]: 0, [FIELD.originalEstimate]: 0 }, task)).toBe(true);
    expect(lacksEstimate({ [FIELD.originalEstimate]: 2 }, task)).toBe(false);
  });

  test('tipo novo: primeiro campo não-nulo', () => {
    const p = getWorkItemProfile({ workItemType: 'PBI' });
    expect(readEstimate({ [FIELD.effort]: 5 }, p)).toBe(5);
    expect(lacksEstimate({}, p)).toBe(true);
  });

  test('tipo sem campo de estimativa nunca fica sem estimativa', () => {
    const p = getWorkItemProfile({ workItemType: 'Ticket', estimateField: null });
    expect(readEstimate({}, p)).toBeNull();
    expect(lacksEstimate({}, p)).toBe(false);
  });
});

describe('excludedStates / statesOr', () => {
  test('legado exclui Done e Removed', () => {
    expect(excludedStates(getWorkItemProfile({}))).toEqual(['Done', 'Removed']);
  });

  test('tipo com estados exclui apenas os removidos', () => {
    const p = getWorkItemProfile({ workItemType: 'Issue', states: { done: ['Done'], removed: ['Cut'] } });
    expect(excludedStates(p)).toEqual(['Cut']);
  });

  test('tipo novo sem estados usa a exclusão legada', () => {
    expect(excludedStates(getWorkItemProfile({ workItemType: 'Issue' }))).toEqual(['Done', 'Removed']);
  });

  test('statesOr devolve o fallback quando não há estados', () => {
    const fb = ['Closed'];
    expect(statesOr(getWorkItemProfile({}), 'done', fb)).toBe(fb);
  });

  test('statesOr: closed = done + removed', () => {
    const p = getWorkItemProfile({ workItemType: 'Issue', states: { new: ['To Do'], done: ['Done'], removed: ['Cut'] } });
    expect(statesOr(p, 'closed', [])).toEqual(['Done', 'Cut']);
    expect(statesOr(p, 'new', ['New'])).toEqual(['To Do']);
    expect(statesOr(p, 'active', ['Active'])).toEqual([]);
  });
});

describe('utilitários', () => {
  test('wiqlList escapa aspas simples', () => {
    expect(wiqlList(['User Story', "Dev's Item"])).toBe("'User Story','Dev''s Item'");
  });

  test('clientProfile expõe apenas o necessário ao navegador', () => {
    const c = clientProfile(getWorkItemProfile({ workItemType: 'Task' }));
    expect(c).toEqual({
      workItemType: 'Task', legacy: true, mainTypes: ['Task'], estimateUnit: 'hours',
      hasEstimate: true, typeLabel: 'Task', states: null,
    });
  });

  test('statesFromCategories agrupa por categoria do Azure', () => {
    const r = statesFromCategories([
      { name: 'To Do', category: 'Proposed' },
      { name: 'Doing', category: 'InProgress' },
      { name: 'Review', category: 'Resolved' },
      { name: 'Done', category: 'Completed' },
      { name: 'Cut', category: 'Removed' },
      { name: 'Odd', category: 'Other' },
      { category: 'Completed' },
    ]);
    expect(r).toEqual({ new: ['To Do'], active: ['Doing', 'Review'], done: ['Done'], removed: ['Cut'] });
  });

  test('pickEstimateField segue a ordem StoryPoints → Effort → Size → OriginalEstimate', () => {
    expect(pickEstimateField([{ referenceName: FIELD.size }, { referenceName: FIELD.effort }]))
      .toEqual({ estimateField: FIELD.effort, estimateUnit: 'points' });
    expect(pickEstimateField([{ referenceName: FIELD.originalEstimate }]))
      .toEqual({ estimateField: FIELD.originalEstimate, estimateUnit: 'hours' });
    expect(pickEstimateField([{ referenceName: 'System.Title' }]))
      .toEqual({ estimateField: null, estimateUnit: 'points' });
    expect(pickEstimateField(null)).toEqual({ estimateField: null, estimateUnit: 'points' });
  });
});

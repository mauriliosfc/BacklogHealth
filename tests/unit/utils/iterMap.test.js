jest.mock('../../../azureClient');

const { azureGet } = require('../../../azureClient');
const { fetchIterMap } = require('../../../utils/iterMap');

const ORG_B = { id: 'b', baseUrl: 'https://dev.azure.com/B', pat: 'pb' };

describe('fetchIterMap', () => {
  test('com time: usa teamsettings e marca a sprint atual', async () => {
    azureGet.mockResolvedValueOnce({ value: [
      { path: 'P\\S1', name: 'S1', attributes: { startDate: '2026-11-01', finishDate: '2026-11-14', timeFrame: 'past' } },
      { path: 'P\\S2', name: 'S2', attributes: { startDate: '2026-11-15', finishDate: '2026-11-28', timeFrame: 'current' } },
    ] });
    const r = await fetchIterMap('P', 'Time A', ORG_B);
    expect(azureGet.mock.calls[0][0]).toContain('P/Time%20A/_apis/work/teamsettings/iterations');
    expect(azureGet.mock.calls[0][1]).toBe(ORG_B);
    expect(r.currentSprint).toBe('S2');
    expect(r.map['P\\S2']).toEqual({ start: '2026-11-15', end: '2026-11-28', isCurrent: true });
  });

  test('sem time: usa classificationnodes com a organização informada', async () => {
    const today = new Date();
    const iso = d => d.toISOString();
    const start = new Date(today.getTime() - 86400000), end = new Date(today.getTime() + 86400000);
    azureGet.mockResolvedValueOnce({ children: [
      { name: 'S9', path: '\\P\\Iteration\\S9', attributes: { startDate: iso(start), finishDate: iso(end) } },
    ] });
    const r = await fetchIterMap('P', undefined, ORG_B);
    expect(azureGet.mock.calls[0][0]).toContain('P/_apis/wit/classificationnodes/iterations');
    expect(azureGet.mock.calls[0][1]).toBe(ORG_B);
    expect(r.currentSprint).toBe('S9');
  });

  test('sem organização repassa null (organização principal)', async () => {
    azureGet.mockRejectedValue(new Error('falhou'));
    await fetchIterMap('P');
    expect(azureGet.mock.calls.every(c => c[1] === null)).toBe(true);
  });
});

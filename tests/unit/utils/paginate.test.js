jest.mock('../../../azureClient');

const { paginatedItems } = require('../../../utils/paginate');
const { azureGet } = require('../../../azureClient');

describe('paginatedItems', () => {
  test('retorna lista vazia quando ids está vazio', async () => {
    const result = await paginatedItems('MyProject', [], 'System.Id');
    expect(result).toEqual([]);
    expect(azureGet).not.toHaveBeenCalled();
  });

  test('busca um único lote quando ids < 200', async () => {
    const ids  = [1, 2, 3];
    const items = [{ id: 1 }, { id: 2 }, { id: 3 }];
    azureGet.mockResolvedValue({ value: items });

    const result = await paginatedItems('MyProject', ids, 'System.Id,System.Title');

    expect(azureGet).toHaveBeenCalledTimes(1);
    expect(azureGet).toHaveBeenCalledWith(
      expect.stringContaining('ids=1,2,3')
    );
    expect(result).toEqual(items);
  });

  test('divide em lotes de 200 quando ids > 200', async () => {
    const ids = Array.from({ length: 250 }, (_, i) => i + 1);
    azureGet
      .mockResolvedValueOnce({ value: Array(200).fill({ id: 1 }) })
      .mockResolvedValueOnce({ value: Array(50).fill({ id: 2 }) });

    const result = await paginatedItems('MyProject', ids, 'System.Id');

    expect(azureGet).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(250);
  });

  test('lida com page.value ausente (API retorna vazio)', async () => {
    azureGet.mockResolvedValue({});
    const result = await paginatedItems('MyProject', [1], 'System.Id');
    expect(result).toEqual([]);
  });

  test('concatena resultados de múltiplos lotes corretamente', async () => {
    const ids = Array.from({ length: 400 }, (_, i) => i + 1);
    azureGet
      .mockResolvedValueOnce({ value: [{ id: 'batch1' }] })
      .mockResolvedValueOnce({ value: [{ id: 'batch2' }] });

    const result = await paginatedItems('MyProject', ids, 'System.Id');

    expect(result).toEqual([{ id: 'batch1' }, { id: 'batch2' }]);
  });

  test('encoda o nome do projeto na URL', async () => {
    azureGet.mockResolvedValue({ value: [] });
    await paginatedItems('My Project With Spaces', [1], 'System.Id');
    expect(azureGet).toHaveBeenCalledWith(
      expect.stringContaining('My%20Project%20With%20Spaces')
    );
  });
});

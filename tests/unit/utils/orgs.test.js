const { orgIdFor, uniqueOrgId, orgLabel, sameBaseUrl, getDisplayName, assignProjectKeys } = require('../../../utils/orgs');

describe('utils/orgs', () => {
  test('orgIdFor', () => {
    expect(orgIdFor('CNH Software', '')).toBe('cnh-software');
    expect(orgIdFor('', 'https://acme.visualstudio.com')).toBe('acme');
    expect(orgIdFor('', 'invalida')).toBe('org');
  });

  test('uniqueOrgId acrescenta sufixo quando o id já existe', () => {
    const orgs = [{ id: 'acme' }, { id: 'acme-2' }];
    expect(uniqueOrgId('Acme', '', orgs)).toBe('acme-3');
    expect(uniqueOrgId('Outra', '', orgs)).toBe('outra');
  });

  test('sameBaseUrl ignora barra final e maiúsculas', () => {
    expect(sameBaseUrl('https://dev.azure.com/Org/', 'https://dev.azure.com/org')).toBe(true);
    expect(sameBaseUrl('https://dev.azure.com/A', 'https://dev.azure.com/B')).toBe(false);
    expect(sameBaseUrl('', '')).toBe(false);
  });

  test('orgLabel prefere o nome de exibição', () => {
    expect(orgLabel({ org: 'A', label: 'Cliente' })).toBe('Cliente');
    expect(orgLabel({ org: 'A' })).toBe('A');
    expect(orgLabel(null)).toBe('');
  });

  test('getDisplayName aceita string legada', () => {
    expect(getDisplayName('Alpha')).toBe('Alpha');
  });

  test('assignProjectKeys usa o id quando a organização não tem nome', () => {
    const r = assignProjectKeys([{ name: 'A' }], [{ name: 'A' }], { id: 'x' });
    expect(r[0].key).toBe('x / A');
  });

  test('assignProjectKeys considera o time no nome', () => {
    const r = assignProjectKeys([{ name: 'A', team: 'T' }], [{ name: 'A', team: 'T' }], { org: 'B' });
    expect(r[0].key).toBe('B / A - T');
  });
});

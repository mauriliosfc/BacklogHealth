// Múltiplas organizações: migração do formato antigo, espelho da principal no topo,
// resolução da organização de cada projeto e identificador sem colisão.
jest.mock('fs');

const fs = require('fs');
const {
  loadConfig, saveConfig, getCfg, getOrg, getOrganizations, orgIdFor, orgLabel, authFor,
  getDisplayName, getBaseDisplayName, assignProjectKeys, getProjectConfig, getAppMode,
} = require('../../config');

function load(obj) {
  fs.readFileSync.mockReturnValueOnce(JSON.stringify(obj));
  return loadConfig();
}

beforeEach(() => {
  fs.writeFileSync.mockImplementation(() => {});
});

describe('migração do formato antigo', () => {
  test('cria organizations a partir dos campos do topo e marca os projetos', () => {
    expect(load({ org: 'MyOrg', baseUrl: 'https://dev.azure.com/MyOrg', pat: 't', projects: [{ name: 'A' }] })).toBe(true);
    expect(getOrganizations()).toEqual([{ id: 'myorg', org: 'MyOrg', baseUrl: 'https://dev.azure.com/MyOrg', pat: 't' }]);
    expect(getCfg().projects[0]).toMatchObject({ name: 'A', orgId: 'myorg' });
    expect(getCfg()).toMatchObject({ org: 'MyOrg', baseUrl: 'https://dev.azure.com/MyOrg', pat: 't' });
  });

  test('config sem Azure (só Service Now) não ganha organização', () => {
    load({ servicenow: { instance: 'x.service-now.com', user: 'u', pass: 'p' } });
    expect(getOrganizations()).toEqual([]);
    expect(getAppMode()).toBe('sn-only');
  });

  test('config já migrada é respeitada e o topo espelha a principal', () => {
    load({
      org: 'antigo', pat: 'velho',
      organizations: [
        { id: 'a', org: 'A', baseUrl: 'https://dev.azure.com/A', pat: 'pa' },
        { id: 'b', org: 'B', baseUrl: 'https://b.visualstudio.com', pat: 'pb', label: 'Cliente B' },
      ],
      projects: [{ name: 'X', orgId: 'b' }, { name: 'Y' }],
    });
    expect(getCfg()).toMatchObject({ org: 'A', baseUrl: 'https://dev.azure.com/A', pat: 'pa' });
    expect(getCfg().projects.map(p => p.orgId)).toEqual(['b', 'a']);
    expect(getAppMode()).toBe('azure');
  });
});

describe('saveConfig', () => {
  test('espelha a primeira organização no topo ao gravar', () => {
    const data = {
      org: 'x', pat: 'x',
      organizations: [{ id: 'b', org: 'B', baseUrl: 'https://dev.azure.com/B', pat: 'pb' }],
      projects: [{ name: 'P' }],
    };
    saveConfig(data);
    const written = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
    expect(written).toMatchObject({ org: 'B', baseUrl: 'https://dev.azure.com/B', pat: 'pb' });
    expect(written.projects[0].orgId).toBe('b');
  });

  test('sem organizations grava como antes', () => {
    saveConfig({ org: 'o', pat: 'p', projects: [] });
    expect(JSON.parse(fs.writeFileSync.mock.calls[0][1])).toEqual({ org: 'o', pat: 'p', projects: [] });
  });
});

describe('getOrg', () => {
  beforeEach(() => load({
    organizations: [
      { id: 'a', org: 'A', baseUrl: 'https://dev.azure.com/A', pat: 'pa' },
      { id: 'b', org: 'B', baseUrl: 'https://dev.azure.com/B', pat: 'pb', label: 'Cliente B' },
    ],
    projects: [],
  }));

  test('pelo id, ou a principal quando o id não existe', () => {
    expect(getOrg('b').pat).toBe('pb');
    expect(getOrg('zzz').id).toBe('a');
    expect(getOrg().id).toBe('a');
  });

  test('sem organizations usa os campos do topo', () => {
    saveConfig({ org: 'Old', pat: 'p' });
    expect(getOrg()).toEqual({ id: 'old', org: 'Old', baseUrl: 'https://dev.azure.com/Old', pat: 'p' });
  });

  test('config vazia devolve null', () => {
    saveConfig({});
    expect(getOrg()).toBeNull();
  });

  test('orgLabel e authFor', () => {
    expect(orgLabel(getOrg('b'))).toBe('Cliente B');
    expect(orgLabel(getOrg('a'))).toBe('A');
    expect(authFor({ pat: 'pb' })).toBe(Buffer.from(':pb').toString('base64'));
  });
});

describe('identificador do projeto', () => {
  test('orgIdFor normaliza o nome ou usa o host', () => {
    expect(orgIdFor('Minha Org', '')).toBe('minha-org');
    expect(orgIdFor('', 'https://contoso.visualstudio.com')).toBe('contoso');
  });

  test('getDisplayName usa key quando existe', () => {
    expect(getDisplayName({ name: 'A', team: 'T' })).toBe('A - T');
    expect(getDisplayName({ name: 'A', team: 'T', key: 'B / A - T' })).toBe('B / A - T');
    expect(getBaseDisplayName({ name: 'A', team: 'T', key: 'x' })).toBe('A - T');
  });

  test('assignProjectKeys só marca projetos novos que colidem com outra organização', () => {
    const others = [{ name: 'Alpha', orgId: 'a' }, { name: 'Beta', orgId: 'a' }];
    const org = { id: 'b', org: 'B', label: 'Cliente B' };
    const r = assignProjectKeys([{ name: 'Alpha' }, { name: 'Gamma' }, { name: 'Beta', key: 'manter' }], others, org);
    expect(r).toEqual([{ name: 'Alpha', key: 'Cliente B / Alpha' }, { name: 'Gamma' }, { name: 'Beta', key: 'manter' }]);
  });

  test('assignProjectKeys evita repetir uma key já usada', () => {
    const others = [{ name: 'Alpha' }, { name: 'Alpha', key: 'B / Alpha' }];
    const r = assignProjectKeys([{ name: 'Alpha' }], others, { id: 'b', org: 'B' });
    expect(r[0].key).toBe('B / Alpha (2)');
  });

  test('getProjectConfig encontra pela key e devolve orgId', () => {
    load({
      organizations: [{ id: 'a', org: 'A', pat: 'x' }, { id: 'b', org: 'B', pat: 'y' }],
      projects: [{ name: 'Alpha' }, { name: 'Alpha', orgId: 'b', key: 'B / Alpha' }],
    });
    expect(getProjectConfig('Alpha')).toMatchObject({ name: 'Alpha', orgId: 'a' });
    expect(getProjectConfig('B / Alpha')).toMatchObject({ name: 'Alpha', orgId: 'b', displayName: 'B / Alpha' });
  });
});

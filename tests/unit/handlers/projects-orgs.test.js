// Múltiplas organizações no setup: adicionar, editar uma sem mexer nas outras,
// PAT salvo, remoção e listagem sem expor o token.
jest.mock('../../../config');
jest.mock('../../../azureClient');
jest.mock('../../../handlers/dashboard');

const { setup, removeOrganization, listOrganizations, listProjects, disconnect } = require('../../../handlers/projects');
const { getCfg, saveConfig, parseOrgInput } = require('../../../config');
const { rawAzureGet } = require('../../../azureClient');
const { buildAndCache } = require('../../../handlers/dashboard');
const state = require('../../../handlers/state');

const ORG_A = { id: 'orga', org: 'OrgA', baseUrl: 'https://dev.azure.com/OrgA', pat: 'pat-a' };
const ORG_B = { id: 'orgb', org: 'OrgB', baseUrl: 'https://dev.azure.com/OrgB', pat: 'pat-b', label: 'Cliente B' };

function cfgWith(organizations, projects, extra = {}) {
  const primary = organizations[0] || {};
  return { org: primary.org, baseUrl: primary.baseUrl, pat: primary.pat, organizations, projects, ai: { endpoint: 'x' }, ...extra };
}

const saved = () => saveConfig.mock.calls[0][0];

beforeEach(() => {
  buildAndCache.mockResolvedValue();
  parseOrgInput.mockImplementation(input => {
    const org = String(input).replace(/^https:\/\/dev\.azure\.com\//, '');
    return { org, baseUrl: `https://dev.azure.com/${org}` };
  });
});

describe('setup — adicionar organização', () => {
  test('nova URL com várias organizações vira uma nova organização e preserva a existente', async () => {
    getCfg.mockReturnValue(cfgWith([ORG_A, { ...ORG_B, id: 'orgc', org: 'OrgC', baseUrl: 'https://dev.azure.com/OrgC' }], [
      { name: 'Alpha', orgId: 'orga', workItemType: 'User Story' },
    ]));
    const r = await setup({ rawOrg: 'OrgD', pat: 'pat-d', label: 'Cliente D', projectsJson: [{ name: 'Delta', workItemType: 'User Story' }] });

    expect(r).toEqual({ ok: true, orgId: 'orgd' });
    const c = saved();
    expect(c.organizations.map(o => o.id)).toEqual(['orga', 'orgc', 'orgd']);
    expect(c.organizations[2]).toEqual({ id: 'orgd', org: 'OrgD', baseUrl: 'https://dev.azure.com/OrgD', pat: 'pat-d', label: 'Cliente D' });
    expect(c.projects).toEqual([
      { name: 'Alpha', orgId: 'orga', workItemType: 'User Story' },
      { name: 'Delta', workItemType: 'User Story', orgId: 'orgd' },
    ]);
    expect(c).toMatchObject({ org: 'OrgA', pat: 'pat-a', ai: { endpoint: 'x' } });
  });

  test('addOrg com uma organização salva adiciona a segunda em vez de substituir', async () => {
    getCfg.mockReturnValue(cfgWith([ORG_A], [{ name: 'Alpha', orgId: 'orga', workItemType: 'User Story' }]));
    const r = await setup({ rawOrg: 'OrgV', pat: 'pat-v', label: 'Vale', addOrg: true, projectsJson: [] });
    expect(r).toEqual({ ok: true, orgId: 'orgv' });
    expect(saved().organizations.map(o => o.id)).toEqual(['orga', 'orgv']);
    expect(saved().organizations[0]).toEqual(ORG_A);
    expect(saved().projects).toEqual([{ name: 'Alpha', orgId: 'orga', workItemType: 'User Story' }]);
    expect(saved()).toMatchObject({ org: 'OrgA', pat: 'pat-a' });
  });

  test('addOrg com URL já conectada → 409', async () => {
    getCfg.mockReturnValue(cfgWith([ORG_A], []));
    await expect(setup({ rawOrg: 'OrgA', pat: 'x', addOrg: true, projectsJson: [] }))
      .rejects.toMatchObject({ status: 409 });
  });

  test('sem addOrg, lista de projetos vazia continua inválida', async () => {
    getCfg.mockReturnValue(cfgWith([ORG_A], []));
    await expect(setup({ rawOrg: 'OrgA', pat: 'x', projectsJson: [] }))
      .rejects.toMatchObject({ status: 400 });
  });

  test('com uma organização e sem orgId, substitui a existente (fluxo de sempre)', async () => {
    getCfg.mockReturnValue(cfgWith([ORG_A], [{ name: 'Alpha', orgId: 'orga', workItemType: 'User Story' }]));
    await setup({ rawOrg: 'OrgA', pat: '', projectsRaw: 'Alpha:User Story' });
    expect(saved().organizations).toEqual([ORG_A]);
    expect(saved().pat).toBe('pat-a');
  });

  test('mesmo nome de projeto em outra organização ganha identificador com o nome da organização', async () => {
    getCfg.mockReturnValue(cfgWith([ORG_A, ORG_B], [
      { name: 'Alpha', orgId: 'orga', workItemType: 'User Story' },
    ]));
    await setup({ rawOrg: 'OrgB', orgId: 'orgb', pat: '', projectsJson: [{ name: 'Alpha', workItemType: 'Issue' }] });
    const added = saved().projects.find(p => p.orgId === 'orgb');
    expect(added.key).toBe('Cliente B / Alpha');
    expect(saved().projects.find(p => p.orgId === 'orga').key).toBeUndefined();
  });

  test('URL já conectada em outra organização → 409', async () => {
    getCfg.mockReturnValue(cfgWith([ORG_A, ORG_B], []));
    await expect(setup({ rawOrg: 'OrgB', orgId: 'orga', pat: 'x', projectsRaw: 'P:User Story' }))
      .rejects.toMatchObject({ status: 409 });
  });

  test('orgId inexistente → 404', async () => {
    getCfg.mockReturnValue(cfgWith([ORG_A], []));
    await expect(setup({ rawOrg: 'OrgA', orgId: 'nao-existe', pat: 'x', projectsRaw: 'P:User Story' }))
      .rejects.toMatchObject({ status: 404 });
  });

  test('organização nova sem PAT → 400', async () => {
    getCfg.mockReturnValue(cfgWith([ORG_A, ORG_B], []));
    await expect(setup({ rawOrg: 'OrgZ', pat: '', projectsRaw: 'P:User Story' }))
      .rejects.toMatchObject({ status: 400 });
  });
});

describe('setup — editar uma organização', () => {
  beforeEach(() => {
    getCfg.mockReturnValue(cfgWith([ORG_A, ORG_B], [
      { name: 'Alpha', orgId: 'orga', workItemType: 'User Story', reportCharts: ['a'] },
      { name: 'Beta',  orgId: 'orgb', workItemType: 'User Story', reportCharts: ['b'] },
      { name: 'Gamma', orgId: 'orga', workItemType: 'Task' },
    ]));
  });

  test('substitui só os projetos daquela organização, na mesma posição', async () => {
    await setup({ rawOrg: 'OrgB', orgId: 'orgb', pat: '', projectsRaw: 'Beta:User Story,Zeta:Task' });
    expect(saved().projects.map(p => `${p.orgId}:${p.name}`)).toEqual(['orga:Alpha', 'orgb:Beta', 'orgb:Zeta', 'orga:Gamma']);
    expect(saved().projects[1].reportCharts).toEqual(['b']);
  });

  test('PAT em branco mantém o salvo; PAT novo substitui', async () => {
    await setup({ rawOrg: 'OrgB', orgId: 'orgb', pat: '', projectsRaw: 'Beta:User Story' });
    expect(saved().organizations[1].pat).toBe('pat-b');
    saveConfig.mockClear();
    await setup({ rawOrg: 'OrgB', orgId: 'orgb', pat: 'novo', projectsRaw: 'Beta:User Story' });
    expect(saved().organizations[1].pat).toBe('novo');
    expect(saved().organizations[0].pat).toBe('pat-a');
  });

  test('label vazio remove o nome de exibição; ausente mantém', async () => {
    await setup({ rawOrg: 'OrgB', orgId: 'orgb', pat: '', projectsRaw: 'Beta:User Story' });
    expect(saved().organizations[1].label).toBe('Cliente B');
    saveConfig.mockClear();
    await setup({ rawOrg: 'OrgB', orgId: 'orgb', pat: '', label: '  ', projectsRaw: 'Beta:User Story' });
    expect('label' in saved().organizations[1]).toBe(false);
  });

  test('a detecção de tipo usa o token da organização do projeto', async () => {
    rawAzureGet.mockResolvedValue({ status: 200, data: { value: [] } });
    await setup({ rawOrg: 'OrgB', orgId: 'orgb', pat: '', projectsJson: [{ name: 'Beta', workItemType: 'Issue' }] });
    expect(rawAzureGet.mock.calls[0][0]).toContain('https://dev.azure.com/OrgB/Beta/');
    expect(rawAzureGet.mock.calls[0][1]).toBe(Buffer.from(':pat-b').toString('base64'));
  });
});

describe('removeOrganization', () => {
  test('remove a organização e os projetos dela', async () => {
    getCfg.mockReturnValue(cfgWith([ORG_A, ORG_B], [
      { name: 'Alpha', orgId: 'orga' }, { name: 'Beta', orgId: 'orgb' },
    ]));
    const r = await removeOrganization({ orgId: 'orgb' });
    expect(r).toEqual({ ok: true, removedProjects: 1 });
    expect(saved().organizations).toEqual([ORG_A]);
    expect(saved().projects).toEqual([{ name: 'Alpha', orgId: 'orga' }]);
    expect(buildAndCache).toHaveBeenCalled();
  });

  test('remover a principal promove a próxima para o topo', async () => {
    getCfg.mockReturnValue(cfgWith([ORG_A, ORG_B], [{ name: 'Beta', orgId: 'orgb' }]));
    await removeOrganization({ orgId: 'orga' });
    expect(saved()).toMatchObject({ org: 'OrgB', baseUrl: 'https://dev.azure.com/OrgB', pat: 'pat-b' });
  });

  test('remover a última limpa a conexão com o Azure', async () => {
    getCfg.mockReturnValue(cfgWith([ORG_A], [{ name: 'Alpha', orgId: 'orga' }]));
    state.html = '<x>';
    await removeOrganization({ orgId: 'orga' });
    expect(saved()).toMatchObject({ org: '', pat: '', organizations: [], projects: [], ai: { endpoint: 'x' } });
    expect(state.html).toBe('');
  });

  test('sem orgId → 400; inexistente → 404', async () => {
    getCfg.mockReturnValue(cfgWith([ORG_A], []));
    await expect(removeOrganization({})).rejects.toMatchObject({ status: 400 });
    await expect(removeOrganization({ orgId: 'x' })).rejects.toMatchObject({ status: 404 });
  });
});

describe('listOrganizations', () => {
  test('lista organizações com contagem de projetos e nunca devolve o PAT', () => {
    getCfg.mockReturnValue(cfgWith([ORG_A, ORG_B], [
      { name: 'Alpha', orgId: 'orga', team: 'T1', workItemType: 'Task' }, { name: 'Beta', orgId: 'orgb' }, { name: 'Gamma' },
    ]));
    const { organizations } = listOrganizations();
    expect(organizations[0]).toEqual({
      id: 'orga', org: 'OrgA', baseUrl: 'https://dev.azure.com/OrgA', label: '', hasPat: true, projectCount: 2,
      projects: [{ name: 'Alpha', team: 'T1', workItemType: 'Task' }, { name: 'Gamma', team: undefined, workItemType: 'User Story' }],
    });
    expect(organizations[1]).toMatchObject({ id: 'orgb', label: 'Cliente B', projectCount: 1 });
    expect(JSON.stringify(organizations)).not.toContain('pat-');
  });

  test('config antiga (sem organizations) aparece como uma organização', () => {
    getCfg.mockReturnValue({ org: 'Old', baseUrl: 'https://dev.azure.com/Old', pat: 'p', projects: [{ name: 'A' }] });
    expect(listOrganizations().organizations).toMatchObject([{ id: 'old', org: 'Old', projectCount: 1 }]);
  });
});

describe('listProjects com organização salva', () => {
  test('PAT em branco usa o token salvo da organização', async () => {
    getCfg.mockReturnValue(cfgWith([ORG_A, ORG_B], []));
    rawAzureGet.mockResolvedValue({ status: 200, data: { value: [] } });
    await listProjects({ org: 'OrgB', pat: '', orgId: 'orgb' });
    expect(rawAzureGet.mock.calls[0][1]).toBe(Buffer.from(':pat-b').toString('base64'));
  });

  test('sem orgId, encontra o token pela URL', async () => {
    getCfg.mockReturnValue(cfgWith([ORG_A, ORG_B], []));
    rawAzureGet.mockResolvedValue({ status: 200, data: { value: [] } });
    await listProjects({ org: 'OrgA', pat: '' });
    expect(rawAzureGet.mock.calls[0][1]).toBe(Buffer.from(':pat-a').toString('base64'));
  });

  test('organização desconhecida sem PAT → 400', async () => {
    getCfg.mockReturnValue(cfgWith([ORG_A], []));
    await expect(listProjects({ org: 'Outra', pat: '' })).rejects.toMatchObject({ status: 400 });
  });
});

test('disconnect limpa todas as organizações', async () => {
  getCfg.mockReturnValue(cfgWith([ORG_A, ORG_B], [{ name: 'A' }]));
  await disconnect();
  expect(saved()).toMatchObject({ org: '', pat: '', organizations: [], projects: [] });
});

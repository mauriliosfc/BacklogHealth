jest.mock('../../../config');
jest.mock('../../../azureClient');
jest.mock('../../../handlers/dashboard');

const { listProjects, setup, removeProject, disconnect, markOnboarded } = require('../../../handlers/projects');
const { getCfg, saveConfig, parseOrgInput, getDisplayName } = require('../../../config');
const { rawAzureGet } = require('../../../azureClient');
const { buildAndCache } = require('../../../handlers/dashboard');

// ── listProjects ─────────────────────────────────────────────────────────────

describe('listProjects', () => {
  test('throws 400 quando org ausente', async () => {
    await expect(listProjects({ org: '', pat: 'valid' }))
      .rejects.toMatchObject({ status: 400 });
  });

  test('throws 400 quando pat ausente', async () => {
    await expect(listProjects({ org: 'myorg', pat: '' }))
      .rejects.toMatchObject({ status: 400 });
  });

  test('throws 401 quando PAT inválido (HTTP 401)', async () => {
    parseOrgInput.mockReturnValue({ baseUrl: 'https://dev.azure.com/myorg' });
    rawAzureGet.mockResolvedValue({ status: 401, data: {} });

    await expect(listProjects({ org: 'myorg', pat: 'bad' }))
      .rejects.toMatchObject({ status: 401 });
  });

  test('throws 401 quando API retorna 203 (PAT sem permissão)', async () => {
    parseOrgInput.mockReturnValue({ baseUrl: 'https://dev.azure.com/myorg' });
    rawAzureGet.mockResolvedValue({ status: 203, data: {} });

    await expect(listProjects({ org: 'myorg', pat: 'weak' }))
      .rejects.toMatchObject({ status: 401 });
  });

  test('throws 404 quando organização não existe', async () => {
    parseOrgInput.mockReturnValue({ baseUrl: 'https://dev.azure.com/unknown' });
    rawAzureGet.mockResolvedValue({ status: 404, data: {} });

    await expect(listProjects({ org: 'unknown', pat: 'valid' }))
      .rejects.toMatchObject({ status: 404 });
  });

  test('retorna projetos ordenados alfabeticamente', async () => {
    parseOrgInput.mockReturnValue({ baseUrl: 'https://dev.azure.com/myorg' });
    rawAzureGet
      .mockResolvedValueOnce({ status: 200, data: { value: [{ name: 'Zebra' }, { name: 'Alpha' }, { name: 'Mango' }] } })
      .mockResolvedValue({ status: 200, data: { value: [] } }); // teams

    const result = await listProjects({ org: 'myorg', pat: 'valid' });

    expect(result.projects.map(p => p.name)).toEqual(['Alpha', 'Mango', 'Zebra']);
  });

  test('projeto com 1 time → teams: []', async () => {
    parseOrgInput.mockReturnValue({ baseUrl: 'https://dev.azure.com/myorg' });
    rawAzureGet
      .mockResolvedValueOnce({ status: 200, data: { value: [{ name: 'Solo' }] } })
      .mockResolvedValueOnce({ status: 200, data: { value: [{ name: 'Solo Team' }] } }); // 1 time → não expande

    const result = await listProjects({ org: 'myorg', pat: 'valid' });

    expect(result.projects[0].teams).toEqual([]);
  });

  test('projeto com múltiplos times → teams preenchido', async () => {
    parseOrgInput.mockReturnValue({ baseUrl: 'https://dev.azure.com/myorg' });
    rawAzureGet
      .mockResolvedValueOnce({ status: 200, data: { value: [{ name: 'BigProject' }] } })
      .mockResolvedValueOnce({ status: 200, data: { value: [{ name: 'Team A' }, { name: 'Team B' }] } });

    const result = await listProjects({ org: 'myorg', pat: 'valid' });

    expect(result.projects[0].teams).toEqual(['Team A', 'Team B']);
  });

  test('falha na API de times não quebra — projeto retorna teams: []', async () => {
    parseOrgInput.mockReturnValue({ baseUrl: 'https://dev.azure.com/myorg' });
    rawAzureGet
      .mockResolvedValueOnce({ status: 200, data: { value: [{ name: 'ResilientProject' }] } })
      .mockRejectedValueOnce(new Error('network error'));

    const result = await listProjects({ org: 'myorg', pat: 'valid' });

    expect(result.projects[0].teams).toEqual([]);
  });
});

// ── removeProject ─────────────────────────────────────────────────────────────

describe('removeProject', () => {
  beforeEach(() => {
    buildAndCache.mockResolvedValue();
    getDisplayName.mockImplementation(p => (typeof p === 'string' ? p : p.name));
  });

  test('remove projeto correto e persiste config', async () => {
    getCfg.mockReturnValue({ projects: [{ name: 'Alpha' }, { name: 'Beta' }] });

    await removeProject({ project: 'Alpha' });

    expect(saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({ projects: [{ name: 'Beta' }] })
    );
  });

  test('chama buildAndCache após salvar', async () => {
    getCfg.mockReturnValue({ projects: [{ name: 'Alpha' }] });

    await removeProject({ project: 'Alpha' });

    expect(buildAndCache).toHaveBeenCalledTimes(1);
  });

  test('retorna { ok: true }', async () => {
    getCfg.mockReturnValue({ projects: [] });

    const result = await removeProject({ project: 'Nonexistent' });

    expect(result).toEqual({ ok: true });
  });

  test('lista vazia não quebra', async () => {
    getCfg.mockReturnValue({ projects: [] });

    await expect(removeProject({ project: 'X' })).resolves.toEqual({ ok: true });
  });
});

// ── setup ─────────────────────────────────────────────────────────────────────

describe('setup', () => {
  beforeEach(() => {
    buildAndCache.mockResolvedValue();
    getCfg.mockReturnValue({ projects: [] });
    parseOrgInput.mockReturnValue({ org: 'myorg', baseUrl: 'https://dev.azure.com/myorg' });
  });

  test('throws 400 quando rawOrg ausente', async () => {
    await expect(setup({ rawOrg: '', pat: 'token', projectsRaw: 'Alpha:User Story' }))
      .rejects.toMatchObject({ status: 400 });
  });

  test('throws 400 quando pat ausente', async () => {
    await expect(setup({ rawOrg: 'myorg', pat: '', projectsRaw: 'Alpha:User Story' }))
      .rejects.toMatchObject({ status: 400 });
  });

  test('throws 400 quando projectsRaw vazio', async () => {
    await expect(setup({ rawOrg: 'myorg', pat: 'token', projectsRaw: '' }))
      .rejects.toMatchObject({ status: 400 });
  });

  test('salva config e chama buildAndCache', async () => {
    const result = await setup({
      rawOrg:      'myorg',
      pat:         'mytoken',
      projectsRaw: 'Alpha:User Story',
    });

    expect(saveConfig).toHaveBeenCalledTimes(1);
    expect(buildAndCache).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true });
  });

  test('preserva campos existentes (ai, github, servicenow) no merge', async () => {
    getCfg.mockReturnValue({ projects: [], ai: { endpoint: 'https://ai.example.com' }, github: { token: 'gh_abc' } });

    await setup({ rawOrg: 'myorg', pat: 'token', projectsRaw: 'Alpha:User Story' });

    expect(saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        ai:     { endpoint: 'https://ai.example.com' },
        github: { token: 'gh_abc' },
        org:    'myorg',
        pat:    'token',
      })
    );
  });

  test('parseia projeto simples sem time', async () => {
    await setup({ rawOrg: 'myorg', pat: 'token', projectsRaw: 'MyProject:User Story' });

    expect(saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        projects: [{ name: 'MyProject', workItemType: 'User Story' }],
      })
    );
  });

  test('parseia projeto com time', async () => {
    await setup({ rawOrg: 'myorg', pat: 'token', projectsRaw: 'MyProject:User Story:Backend Team' });

    expect(saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        projects: [{ name: 'MyProject', workItemType: 'User Story', team: 'Backend Team' }],
      })
    );
  });

  test('parseia múltiplos projetos separados por vírgula', async () => {
    await setup({ rawOrg: 'myorg', pat: 'token', projectsRaw: 'Alpha:User Story,Beta:Task' });

    expect(saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        projects: [
          { name: 'Alpha', workItemType: 'User Story' },
          { name: 'Beta',  workItemType: 'Task' },
        ],
      })
    );
  });

  test('usa "User Story" como workItemType padrão quando omitido', async () => {
    await setup({ rawOrg: 'myorg', pat: 'token', projectsRaw: 'Alpha:' });

    const call = saveConfig.mock.calls[0][0];
    expect(call.projects[0].workItemType).toBe('User Story');
  });

  test('preserva servicenow do projeto existente ao reconfigurar', async () => {
    getCfg.mockReturnValue({
      projects: [{ name: 'Alpha', servicenow: { assignmentGroup: 'grp123' } }],
    });

    await setup({ rawOrg: 'myorg', pat: 'token', projectsRaw: 'Alpha:User Story' });

    const call = saveConfig.mock.calls[0][0];
    expect(call.projects[0].servicenow).toEqual({ assignmentGroup: 'grp123' });
  });

  test('salva _onboarded: true para marcar onboarding concluído', async () => {
    await setup({ rawOrg: 'myorg', pat: 'token', projectsRaw: 'Alpha:User Story' });

    expect(saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({ _onboarded: true })
    );
  });
});

// ── disconnect ───────────────────────────────────────────────────────────────

describe('disconnect', () => {
  beforeEach(() => {
    getCfg.mockReturnValue({ org: 'myorg', pat: 'token', projects: [{ name: 'Alpha' }], ai: { apiKey: 'key' } });
  });

  test('limpa org, baseUrl, pat e projects mas preserva outros campos', async () => {
    const result = await disconnect();

    expect(saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        org:      '',
        baseUrl:  '',
        pat:      '',
        projects: [],
        ai:       { apiKey: 'key' },
      })
    );
    expect(result).toEqual({ ok: true });
  });

  test('preserva _onboarded ao desconectar para redirecionar para settings (não onboarding)', async () => {
    getCfg.mockReturnValue({
      org: 'myorg', pat: 'token', projects: [], ai: { apiKey: 'key' }, _onboarded: true,
    });

    await disconnect();

    expect(saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({ _onboarded: true })
    );
  });

  test('retorna { ok: true }', async () => {
    const result = await disconnect();
    expect(result).toEqual({ ok: true });
  });
});

// ── markOnboarded ─────────────────────────────────────────────────────────────

describe('markOnboarded', () => {
  test('salva _onboarded: true preservando todos os outros campos', async () => {
    getCfg.mockReturnValue({ servicenow: { instance: 'acme.service-now.com' }, org: '' });

    await markOnboarded();

    expect(saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({ _onboarded: true, servicenow: { instance: 'acme.service-now.com' } })
    );
  });

  test('retorna { ok: true }', async () => {
    getCfg.mockReturnValue({});
    const result = await markOnboarded();
    expect(result).toEqual({ ok: true });
  });
});

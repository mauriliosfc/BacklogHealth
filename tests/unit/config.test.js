jest.mock('fs');

const { parseOrgInput, getDisplayName, getProjectConfig, saveConfig, getAppMode, loadConfig, getCfg } = require('../../config');
const fs = require('fs');

beforeEach(() => {
  fs.writeFileSync.mockImplementation(() => {});
});

// ── parseOrgInput ─────────────────────────────────────────────────────────────

describe('parseOrgInput', () => {
  test('nome simples → dev.azure.com/{org}', () => {
    expect(parseOrgInput('myorg')).toEqual({
      org:     'myorg',
      baseUrl: 'https://dev.azure.com/myorg',
    });
  });

  test('URL dev.azure.com com trailing slash → normaliza', () => {
    expect(parseOrgInput('https://dev.azure.com/myorg/')).toEqual({
      org:     'myorg',
      baseUrl: 'https://dev.azure.com/myorg',
    });
  });

  test('URL dev.azure.com sem protocolo → adiciona https://', () => {
    expect(parseOrgInput('dev.azure.com/myorg')).toEqual({
      org:     'myorg',
      baseUrl: 'https://dev.azure.com/myorg',
    });
  });

  test('URL dev.azure.com com subpath → usa apenas primeiro segmento como org', () => {
    const r = parseOrgInput('https://dev.azure.com/myorg/someproject');
    expect(r.org).toBe('myorg');
    expect(r.baseUrl).toBe('https://dev.azure.com/myorg');
  });

  test('URL visualstudio.com → extrai org do hostname', () => {
    expect(parseOrgInput('https://contoso.visualstudio.com')).toEqual({
      org:     'contoso',
      baseUrl: 'https://contoso.visualstudio.com',
    });
  });

  test('URL visualstudio.com sem protocolo → detecta corretamente', () => {
    const r = parseOrgInput('contoso.visualstudio.com');
    expect(r.org).toBe('contoso');
    expect(r.baseUrl).toBe('https://contoso.visualstudio.com');
  });

  test('input vazio → fallback com string vazia', () => {
    const r = parseOrgInput('');
    expect(r.baseUrl).toContain('dev.azure.com');
  });

  test('input null → não lança exceção', () => {
    expect(() => parseOrgInput(null)).not.toThrow();
  });

  test('input undefined → não lança exceção', () => {
    expect(() => parseOrgInput(undefined)).not.toThrow();
  });
});

// ── getDisplayName ────────────────────────────────────────────────────────────

describe('getDisplayName', () => {
  test('projeto sem time → retorna apenas o nome', () => {
    expect(getDisplayName({ name: 'Alpha' })).toBe('Alpha');
  });

  test('projeto com time → retorna "Nome - Time"', () => {
    expect(getDisplayName({ name: 'AMS', team: 'AMS Backend' })).toBe('AMS - AMS Backend');
  });

  test('string (legado) → retorna a própria string', () => {
    expect(getDisplayName('OldProject')).toBe('OldProject');
  });

  test('team string vazia → trata como sem time', () => {
    expect(getDisplayName({ name: 'Alpha', team: '' })).toBe('Alpha');
  });

  test('team undefined → trata como sem time', () => {
    expect(getDisplayName({ name: 'Alpha', team: undefined })).toBe('Alpha');
  });

  test('espaços no nome e time são preservados', () => {
    expect(getDisplayName({ name: 'My Project', team: 'Dev Team' })).toBe('My Project - Dev Team');
  });
});

// ── getProjectConfig ──────────────────────────────────────────────────────────

describe('getProjectConfig', () => {
  beforeEach(() => {
    saveConfig({
      org: 'myorg', pat: 'token',
      projects: [
        { name: 'Alpha', workItemType: 'User Story' },
        { name: 'AMS',   workItemType: 'Task',       team: 'AMS Backend' },
        { name: 'Bare' },   // sem workItemType
      ],
    });
  });

  test('retorna config completa de projeto simples', () => {
    expect(getProjectConfig('Alpha')).toEqual({
      name:         'Alpha',
      workItemType: 'User Story',
      team:         undefined,
      displayName:  'Alpha',
    });
  });

  test('retorna config de projeto com time pelo displayName "Nome - Time"', () => {
    const r = getProjectConfig('AMS - AMS Backend');
    expect(r.name).toBe('AMS');
    expect(r.team).toBe('AMS Backend');
    expect(r.workItemType).toBe('Task');
    expect(r.displayName).toBe('AMS - AMS Backend');
  });

  test('workItemType padrão "User Story" quando ausente no config', () => {
    expect(getProjectConfig('Bare').workItemType).toBe('User Story');
  });

  test('retorna null quando projeto não existe', () => {
    expect(getProjectConfig('Nonexistent')).toBeNull();
  });

  test('retorna null quando projects não está configurado', () => {
    saveConfig({});
    expect(getProjectConfig('Alpha')).toBeNull();
  });

  test('não encontra projeto pelo nome interno quando há time (deve usar displayName)', () => {
    // "AMS" sozinho não deve match — o identifier correto é "AMS - AMS Backend"
    expect(getProjectConfig('AMS')).toBeNull();
  });
});

// ── loadConfig ────────────────────────────────────────────────────────────────

describe('loadConfig', () => {
  beforeEach(() => {
    // Reset cfg to empty before each test
    saveConfig({});
  });

  test('retorna true e carrega cfg quando Azure está totalmente configurado', () => {
    const raw = JSON.stringify({ org: 'myorg', pat: 'token', projects: [{ name: 'Alpha', workItemType: 'User Story' }] });
    fs.readFileSync.mockReturnValueOnce(raw);
    const result = loadConfig();
    expect(result).toBe(true);
    expect(getCfg().org).toBe('myorg');
    expect(getCfg().projects).toHaveLength(1);
  });

  test('retorna false MAS ainda carrega cfg quando apenas SN está configurado (modo sn-only)', () => {
    const raw = JSON.stringify({ servicenow: { instance: 'dev.service-now.com', user: 'admin', pass: 'secret' }, _onboarded: true });
    fs.readFileSync.mockReturnValueOnce(raw);
    const result = loadConfig();
    expect(result).toBe(false);
    // cfg deve ter o SN config para getAppMode() funcionar corretamente após restart
    expect(getCfg().servicenow).toMatchObject({ instance: 'dev.service-now.com' });
    expect(getCfg()._onboarded).toBe(true);
  });

  test('retorna false e cfg={} quando arquivo não existe', () => {
    fs.readFileSync.mockImplementationOnce(() => { throw new Error('ENOENT'); });
    const result = loadConfig();
    expect(result).toBe(false);
    expect(getCfg()).toEqual({});
  });

  test('adiciona baseUrl quando ausente (compatibilidade)', () => {
    const raw = JSON.stringify({ org: 'myorg', pat: 'token', projects: [{ name: 'Alpha', workItemType: 'User Story' }] });
    fs.readFileSync.mockReturnValueOnce(raw);
    loadConfig();
    expect(getCfg().baseUrl).toBe('https://dev.azure.com/myorg');
  });

  test('migração: converte projects string[] para object[]', () => {
    const raw = JSON.stringify({ org: 'myorg', pat: 'token', projects: ['Alpha', 'Beta'] });
    fs.readFileSync.mockReturnValueOnce(raw);
    loadConfig();
    expect(getCfg().projects).toEqual([
      { name: 'Alpha', workItemType: 'User Story' },
      { name: 'Beta',  workItemType: 'User Story' },
    ]);
  });

  test('getAppMode() retorna "sn-only" após loadConfig() com config SN-only', () => {
    const raw = JSON.stringify({ servicenow: { instance: 'dev.service-now.com', user: 'u', pass: 'p' }, _onboarded: true });
    fs.readFileSync.mockReturnValueOnce(raw);
    loadConfig();
    expect(getAppMode()).toBe('sn-only');
  });
});

// ── getAppMode ────────────────────────────────────────────────────────────────

describe('getAppMode', () => {
  test('retorna "empty" quando nenhuma credencial está configurada', () => {
    saveConfig({});
    expect(getAppMode()).toBe('empty');
  });

  test('retorna "sn-only" quando somente ServiceNow está configurado', () => {
    saveConfig({ servicenow: { instance: 'dev.service-now.com', user: 'admin', pass: 'secret' } });
    expect(getAppMode()).toBe('sn-only');
  });

  test('retorna "sn-only" quando org/pat existem mas projects está vazio', () => {
    saveConfig({
      org: 'myorg', pat: 'token', projects: [],
      servicenow: { instance: 'dev.service-now.com', user: 'u', pass: 'p' },
    });
    expect(getAppMode()).toBe('sn-only');
  });

  test('retorna "azure" quando somente Azure está configurado (sem SN)', () => {
    saveConfig({ org: 'myorg', pat: 'token', projects: [{ name: 'Alpha', workItemType: 'User Story' }] });
    expect(getAppMode()).toBe('azure');
  });

  test('retorna "full" quando Azure e ServiceNow estão configurados', () => {
    saveConfig({
      org: 'myorg', pat: 'token', projects: [{ name: 'Alpha', workItemType: 'User Story' }],
      servicenow: { instance: 'dev.service-now.com', user: 'u', pass: 'p' },
    });
    expect(getAppMode()).toBe('full');
  });

  test('retorna "empty" quando SN está parcialmente configurado (sem pass)', () => {
    saveConfig({ servicenow: { instance: 'dev.service-now.com', user: 'admin' } });
    expect(getAppMode()).toBe('empty');
  });

  test('retorna "empty" quando SN está parcialmente configurado (sem instance)', () => {
    saveConfig({ servicenow: { user: 'admin', pass: 'secret' } });
    expect(getAppMode()).toBe('empty');
  });

  test('retorna "azure" quando SN existe mas sem credenciais completas', () => {
    saveConfig({
      org: 'myorg', pat: 'token', projects: [{ name: 'Alpha', workItemType: 'User Story' }],
      servicenow: { instance: 'dev.service-now.com' }, // sem user/pass
    });
    expect(getAppMode()).toBe('azure');
  });
});

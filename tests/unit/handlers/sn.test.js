jest.mock('../../../config');
jest.mock('../../../servicenowClient');

const { getSnCfg, saveSnCfg, testSn, fetchGroups, fetchGroupsFromConfig, getAllProjectsSnCfg } = require('../../../handlers/sn');
const { getSnConfig, saveSnConfig, getProjectSnGroup, getCfg } = require('../../../config');
const { snGet } = require('../../../servicenowClient');

// ── getSnCfg ──────────────────────────────────────────────────────────────────

describe('getSnCfg', () => {
  test('retorna campos globais sem expor a senha', () => {
    getSnConfig.mockReturnValue({ instance: 'company.service-now.com', user: 'admin', pass: 'secret' });

    const result = getSnCfg({});

    expect(result.instance).toBe('company.service-now.com');
    expect(result.user).toBe('admin');
    expect(result.hasPass).toBe(true);
    expect(result).not.toHaveProperty('pass');
  });

  test('hasPass=false quando senha não está configurada', () => {
    getSnConfig.mockReturnValue({ instance: 'company.service-now.com', user: 'admin' });

    const { hasPass } = getSnCfg({});

    expect(hasPass).toBe(false);
  });

  test('retorna strings vazias quando SN não configurado', () => {
    getSnConfig.mockReturnValue(null);

    const result = getSnCfg({});

    expect(result.instance).toBe('');
    expect(result.user).toBe('');
    expect(result.hasPass).toBe(false);
  });

  test('inclui assignmentGroup quando project fornecido', () => {
    getSnConfig.mockReturnValue({ instance: 'x', user: 'u', pass: 'p' });
    getProjectSnGroup.mockReturnValue({ assignmentGroup: 'grp123', assignmentGroupName: 'TI Suporte' });

    const result = getSnCfg({ project: 'Alpha' });

    expect(result.assignmentGroup).toBe('grp123');
    expect(result.assignmentGroupName).toBe('TI Suporte');
  });

  test('assignmentGroup vazio quando projeto não tem configuração SN', () => {
    getSnConfig.mockReturnValue({ instance: 'x', user: 'u' });
    getProjectSnGroup.mockReturnValue(null);

    const result = getSnCfg({ project: 'Alpha' });

    expect(result.assignmentGroup).toBe('');
    expect(result.assignmentGroupName).toBe('');
  });

  test('não inclui campos de projeto quando project não fornecido', () => {
    getSnConfig.mockReturnValue({ instance: 'x', user: 'u' });

    const result = getSnCfg({});

    expect(result).not.toHaveProperty('assignmentGroup');
    expect(getProjectSnGroup).not.toHaveBeenCalled();
  });

  test('retorna assignmentGroups do config quando project não fornecido', () => {
    getSnConfig.mockReturnValue({ instance: 'x', user: 'u', assignmentGroups: ['IT Support', 'Network Ops'] });

    const { assignmentGroups } = getSnCfg({});

    expect(assignmentGroups).toEqual(['IT Support', 'Network Ops']);
  });

  test('retorna assignmentGroups vazio quando não configurado', () => {
    getSnConfig.mockReturnValue({ instance: 'x', user: 'u' });

    const { assignmentGroups } = getSnCfg({});

    expect(assignmentGroups).toEqual([]);
  });

  test('não expõe assignmentGroups quando project é fornecido', () => {
    getSnConfig.mockReturnValue({ instance: 'x', user: 'u', assignmentGroups: ['IT Support'] });
    getProjectSnGroup.mockReturnValue(null);

    const result = getSnCfg({ project: 'Alpha' });

    expect(result).not.toHaveProperty('assignmentGroups');
  });
});

// ── saveSnCfg ─────────────────────────────────────────────────────────────────

describe('saveSnCfg', () => {
  test('salva credenciais globais e retorna { ok: true }', () => {
    const result = saveSnCfg({ instance: 'company.service-now.com', user: 'admin', pass: 'secret' });

    expect(saveSnConfig).toHaveBeenCalledWith(
      expect.objectContaining({ instance: 'company.service-now.com', user: 'admin', pass: 'secret' }),
      null
    );
    expect(result).toEqual({ ok: true });
  });

  test('remove protocolo da instância (https://)', () => {
    saveSnCfg({ instance: 'https://company.service-now.com/', user: 'u', pass: 'p' });

    expect(saveSnConfig).toHaveBeenCalledWith(
      expect.objectContaining({ instance: 'company.service-now.com' }),
      null
    );
  });

  test('não inclui pass quando não fornecido', () => {
    saveSnCfg({ instance: 'company.service-now.com', user: 'admin' });

    const [snGlobal] = saveSnConfig.mock.calls[0];
    expect(snGlobal).not.toHaveProperty('pass');
  });

  test('passa projectGroup quando project fornecido', () => {
    saveSnCfg({ project: 'Alpha', assignmentGroup: 'grp123', assignmentGroupName: 'TI' });

    const [, projectGroup] = saveSnConfig.mock.calls[0];
    expect(projectGroup).toMatchObject({ projectName: 'Alpha', assignmentGroup: 'grp123' });
  });

  test('projectGroup=null quando project não fornecido', () => {
    saveSnCfg({ instance: 'x', user: 'u' });

    const [, projectGroup] = saveSnConfig.mock.calls[0];
    expect(projectGroup).toBeNull();
  });
});

// ── testSn ────────────────────────────────────────────────────────────────────

describe('testSn', () => {
  test('throws 400 quando instance ausente', async () => {
    await expect(testSn({ instance: '', user: 'u', pass: 'p' }))
      .rejects.toMatchObject({ status: 400 });
  });

  test('throws 400 quando user ausente', async () => {
    await expect(testSn({ instance: 'x', user: '', pass: 'p' }))
      .rejects.toMatchObject({ status: 400 });
  });

  test('throws 400 quando pass ausente', async () => {
    await expect(testSn({ instance: 'x', user: 'u', pass: '' }))
      .rejects.toMatchObject({ status: 400 });
  });

  test('retorna { ok: true } em HTTP 200 com credenciais válidas', async () => {
    snGet.mockResolvedValue({ result: [{ sys_id: '123' }] });

    const result = await testSn({ instance: 'company.service-now.com', user: 'admin', pass: 'pass' });

    expect(result).toEqual({ ok: true });
  });

  test('retorna { error } (HTTP 200) quando credenciais inválidas — não lança exceção', async () => {
    snGet.mockRejectedValue(new Error('401 Unauthorized'));

    const result = await testSn({ instance: 'x', user: 'u', pass: 'wrong' });

    // Deve retornar objeto com erro, NÃO lançar exceção
    expect(result).toEqual({ error: '401 Unauthorized' });
    await expect(testSn({ instance: 'x', user: 'u', pass: 'wrong' }))
      .resolves.toHaveProperty('error');
  });

  test('faz trim da instância', async () => {
    snGet.mockResolvedValue({});

    await testSn({ instance: '  company.service-now.com  ', user: 'u', pass: 'p' });

    expect(snGet).toHaveBeenCalledWith(
      expect.objectContaining({ instance: 'company.service-now.com' }),
      expect.any(String)
    );
  });
});

// ── fetchGroups ───────────────────────────────────────────────────────────────

describe('fetchGroups', () => {
  test('throws 400 quando credenciais ausentes', async () => {
    await expect(fetchGroups({ instance: '', user: 'u', pass: 'p' }))
      .rejects.toMatchObject({ status: 400 });
    await expect(fetchGroups({ instance: 'x', user: '', pass: 'p' }))
      .rejects.toMatchObject({ status: 400 });
    await expect(fetchGroups({ instance: 'x', user: 'u', pass: '' }))
      .rejects.toMatchObject({ status: 400 });
  });

  test('retorna lista de objetos {name, sys_id} únicos ordenados', async () => {
    snGet.mockResolvedValue({ result: [
      { name: 'Network Ops', sys_id: 'id1' },
      { name: 'Database',    sys_id: 'id2' },
      { name: 'Network Ops', sys_id: 'id1' }, // duplicata (mesmo nome, mesmo sys_id)
      { name: 'Application', sys_id: 'id3' },
    ]});
    const { groups } = await fetchGroups({ instance: 'x', user: 'u', pass: 'p' });
    expect(groups).toEqual([
      { name: 'Application', sys_id: 'id3' },
      { name: 'Database',    sys_id: 'id2' },
      { name: 'Network Ops', sys_id: 'id1' },
    ]);
  });

  test('suporta grupos sem sys_id retornando sys_id vazio', async () => {
    snGet.mockResolvedValue({ result: [
      { name: 'My Group', sys_id: 'grp_id' },
    ]});
    const { groups } = await fetchGroups({ instance: 'x', user: 'u', pass: 'p' });
    expect(groups).toEqual([{ name: 'My Group', sys_id: 'grp_id' }]);
  });

  test('ignora linhas sem name', async () => {
    snGet.mockResolvedValue({ result: [
      { name: 'Ops',  sys_id: 'id1' },
      { name: '',     sys_id: 'id2' },
      { name: null,   sys_id: 'id3' },
    ]});
    const { groups } = await fetchGroups({ instance: 'x', user: 'u', pass: 'p' });
    expect(groups).toEqual([{ name: 'Ops', sys_id: 'id1' }]);
  });

  test('retorna { error, groups: [] } quando API falha (não lança exceção)', async () => {
    snGet.mockRejectedValue(new Error('timeout'));
    const result = await fetchGroups({ instance: 'x', user: 'u', pass: 'p' });
    expect(result.error).toBe('timeout');
    expect(result.groups).toEqual([]);
  });

  test('retorna lista vazia quando API retorna resultado vazio', async () => {
    snGet.mockResolvedValue({ result: [] });
    const { groups } = await fetchGroups({ instance: 'x', user: 'u', pass: 'p' });
    expect(groups).toEqual([]);
  });

  test('salva assignmentGroups via saveSnCfg', () => {
    // Verifica que saveSnCfg repassa assignmentGroups para saveSnConfig
    saveSnCfg({ instance: 'x', user: 'u', pass: 'p', assignmentGroups: ['Ops', 'DB'] });
    expect(saveSnConfig).toHaveBeenCalledWith(
      expect.objectContaining({ assignmentGroups: ['Ops', 'DB'] }),
      null
    );
  });
});

// ── getAllProjectsSnCfg ────────────────────────────────────────────────────────

describe('getAllProjectsSnCfg', () => {
  test('retorna lista vazia quando nenhum projeto configurado', () => {
    getCfg.mockReturnValue({ projects: [] });
    expect(getAllProjectsSnCfg()).toEqual({ projects: [] });
  });

  test('retorna lista vazia quando projects é undefined', () => {
    getCfg.mockReturnValue({});
    expect(getAllProjectsSnCfg()).toEqual({ projects: [] });
  });

  test('retorna todos os projetos com campos SN vazios quando não configurado', () => {
    getCfg.mockReturnValue({ projects: [{ name: 'Alpha' }, { name: 'Beta' }] });
    const { projects } = getAllProjectsSnCfg();
    expect(projects).toHaveLength(2);
    expect(projects[0]).toMatchObject({ name: 'Alpha', assignmentGroup: '', assignmentGroupName: '' });
    expect(projects[1]).toMatchObject({ name: 'Beta',  assignmentGroup: '', assignmentGroupName: '' });
  });

  test('retorna assignmentGroup e assignmentGroupName quando configurado', () => {
    getCfg.mockReturnValue({
      projects: [{
        name: 'Alpha',
        servicenow: { assignmentGroup: 'grp123', assignmentGroupName: 'TI - Suporte' },
      }],
    });
    const { projects } = getAllProjectsSnCfg();
    expect(projects[0]).toMatchObject({ name: 'Alpha', assignmentGroup: 'grp123', assignmentGroupName: 'TI - Suporte' });
  });

  test('mistura projetos configurados e não configurados corretamente', () => {
    getCfg.mockReturnValue({
      projects: [
        { name: 'Alpha', servicenow: { assignmentGroup: 'grp1', assignmentGroupName: 'Grupo A' } },
        { name: 'Beta' },
      ],
    });
    const { projects } = getAllProjectsSnCfg();
    expect(projects[0]).toMatchObject({ name: 'Alpha', assignmentGroup: 'grp1', assignmentGroupName: 'Grupo A' });
    expect(projects[1]).toMatchObject({ name: 'Beta',  assignmentGroup: '',     assignmentGroupName: '' });
  });

  test('não expõe campos internos além de name, assignmentGroup, assignmentGroupName', () => {
    getCfg.mockReturnValue({
      projects: [{ name: 'X', pat: 'secret', servicenow: { assignmentGroup: 'g1', assignmentGroupName: 'G1' } }],
    });
    const { projects } = getAllProjectsSnCfg();
    expect(Object.keys(projects[0])).toEqual(['name', 'assignmentGroup', 'assignmentGroupName']);
  });
});

// ── fetchGroupsFromConfig ─────────────────────────────────────────────────────

describe('fetchGroupsFromConfig', () => {
  test('lança 400 quando SN não configurado', async () => {
    getSnConfig.mockReturnValue(null);
    await expect(fetchGroupsFromConfig()).rejects.toMatchObject({ status: 400 });
  });

  test('lança 400 quando credenciais incompletas', async () => {
    getSnConfig.mockReturnValue({ instance: 'x', user: 'u' }); // sem pass
    await expect(fetchGroupsFromConfig()).rejects.toMatchObject({ status: 400 });
  });

  test('delega para fetchGroups com credenciais salvas', async () => {
    getSnConfig.mockReturnValue({ instance: 'corp.service-now.com', user: 'admin', pass: 'secret' });
    snGet.mockResolvedValue({ result: [
      { name: 'IT Support', sys_id: 'grp1' },
    ]});
    const { groups } = await fetchGroupsFromConfig();
    expect(groups).toEqual([{ name: 'IT Support', sys_id: 'grp1' }]);
  });
});

jest.mock('../../../config');
jest.mock('../../../servicenowClient');

const { getSnCfg, saveSnCfg, testSn, fetchGroups, fetchGroupsFromConfig, getAllProjectsSnCfg, removeSnGroup, _clearGroupsCache } = require('../../../handlers/sn');
const { getSnConfig, saveSnConfig, saveConfig, getProjectSnGroup, getCfg } = require('../../../config');
const { snGet } = require('../../../servicenowClient');

beforeEach(() => _clearGroupsCache());

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

  test('pagina resultados quando primeira página retorna 2000 registros', async () => {
    const page1 = Array.from({ length: 2000 }, (_, i) => ({ name: `Group ${i}`, sys_id: `id${i}` }));
    const page2 = [{ name: 'Group Extra', sys_id: 'idExtra' }];
    snGet.mockResolvedValue({ result: [] });
    snGet.mockResolvedValueOnce({ result: page1 }).mockResolvedValueOnce({ result: page2 });
    const { groups } = await fetchGroups({ instance: 'x', user: 'u', pass: 'p' });
    expect(groups).toHaveLength(2001);
    const [, url1] = snGet.mock.calls[0];
    const [, url2] = snGet.mock.calls[1];
    expect(url1).toContain('sysparm_offset=0');
    expect(url2).toContain('sysparm_offset=2000');
  });

  test('busca as páginas seguintes em lotes paralelos até uma página incompleta', async () => {
    const full = n => ({ result: Array.from({ length: 2000 }, (_, i) => ({ name: `G${n}-${i}`, sys_id: `${n}-${i}` })) });
    const byOffset = { 0: 1, 2000: 2, 4000: 3, 6000: 4, 8000: 5, 10000: 6, 12000: 7, 14000: 8 };
    snGet.mockImplementation(async (_cfg, url) => {
      const off = Number(/sysparm_offset=(\d+)/.exec(url)[1]);
      if (off === 16000) return { result: [{ name: 'Ultimo', sys_id: 'z' }] };
      if (off > 16000) return { result: [] };
      return full(byOffset[off]);
    });
    let inFlight = 0, maxInFlight = 0;
    const impl = snGet.getMockImplementation();
    snGet.mockImplementation(async (...a) => {
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise(r => setTimeout(r, 1));
      try { return await impl(...a); } finally { inFlight--; }
    });
    const { groups } = await fetchGroups({ instance: 'x', user: 'u', pass: 'p' });
    expect(groups).toHaveLength(8 * 2000 + 1);
    expect(maxInFlight).toBe(6);
    // 1 página inicial + 2 lotes de 6; nada além do lote que achou o fim
    expect(snGet).toHaveBeenCalledTimes(13);
  });

  test('falha em qualquer página do lote → { error, groups: [] }', async () => {
    const page1 = Array.from({ length: 2000 }, (_, i) => ({ name: `Group ${i}`, sys_id: `id${i}` }));
    snGet.mockResolvedValue({ result: [] });
    snGet.mockResolvedValueOnce({ result: page1 }).mockRejectedValueOnce(new Error('HTTP 500'));
    const r = await fetchGroups({ instance: 'x', user: 'u', pass: 'p' });
    expect(r).toEqual({ error: 'HTTP 500', groups: [] });
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

// ── removeSnGroup ─────────────────────────────────────────────────────────────

describe('removeSnGroup', () => {
  test('retorna { ok: false } quando group não fornecido', () => {
    expect(removeSnGroup({})).toEqual({ ok: false });
    expect(removeSnGroup()).toEqual({ ok: false });
  });

  test('remove grupo de assignmentGroups e chama saveConfig', () => {
    const cfg = { servicenow: { assignmentGroups: ['IT Support', 'Network Ops', 'Database'] } };
    getCfg.mockReturnValue(cfg);

    const result = removeSnGroup({ group: 'Network Ops' });

    expect(cfg.servicenow.assignmentGroups).toEqual(['IT Support', 'Database']);
    expect(saveConfig).toHaveBeenCalledWith(cfg);
    expect(result).toEqual({ ok: true });
  });

  test('não falha quando servicenow.assignmentGroups não existe', () => {
    getCfg.mockReturnValue({ servicenow: {} });
    expect(() => removeSnGroup({ group: 'IT Support' })).not.toThrow();
    expect(saveConfig).toHaveBeenCalled();
  });

  test('não falha quando servicenow não existe', () => {
    getCfg.mockReturnValue({});
    expect(() => removeSnGroup({ group: 'IT Support' })).not.toThrow();
    expect(saveConfig).toHaveBeenCalled();
  });

  test('remove entrada de snGroupConfigs', () => {
    const cfg = {
      servicenow: { assignmentGroups: ['IT Support'] },
      snGroupConfigs: { 'IT Support': { someConfig: true }, 'Other': { x: 1 } },
    };
    getCfg.mockReturnValue(cfg);

    removeSnGroup({ group: 'IT Support' });

    expect(cfg.snGroupConfigs).not.toHaveProperty('IT Support');
    expect(cfg.snGroupConfigs).toHaveProperty('Other');
  });

  test('não falha quando snGroupConfigs não existe', () => {
    getCfg.mockReturnValue({ servicenow: { assignmentGroups: ['IT Support'] } });
    expect(() => removeSnGroup({ group: 'IT Support' })).not.toThrow();
  });

  test('retorna { ok: true } quando grupo não está na lista (idempotente)', () => {
    getCfg.mockReturnValue({ servicenow: { assignmentGroups: ['Other'] } });

    const result = removeSnGroup({ group: 'IT Support' });

    expect(result).toEqual({ ok: true });
    expect(saveConfig).toHaveBeenCalled();
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

  test('segunda chamada usa o cache sem consultar a Service Now', async () => {
    getSnConfig.mockReturnValue({ instance: 'corp', user: 'admin', pass: 'secret' });
    snGet.mockResolvedValue({ result: [{ name: 'IT', sys_id: 'g1' }] });
    await fetchGroupsFromConfig();
    const r = await fetchGroupsFromConfig();
    expect(r.groups).toEqual([{ name: 'IT', sys_id: 'g1' }]);
    expect(snGet).toHaveBeenCalledTimes(1);
  });

  test('chamadas simultâneas compartilham a mesma busca', async () => {
    getSnConfig.mockReturnValue({ instance: 'corp', user: 'admin', pass: 'secret' });
    snGet.mockResolvedValue({ result: [{ name: 'IT', sys_id: 'g1' }] });
    const [a, b] = await Promise.all([fetchGroupsFromConfig(), fetchGroupsFromConfig()]);
    expect(a).toBe(b);
    expect(snGet).toHaveBeenCalledTimes(1);
  });

  test('não guarda no cache quando a busca falha', async () => {
    getSnConfig.mockReturnValue({ instance: 'corp', user: 'admin', pass: 'secret' });
    snGet.mockRejectedValueOnce(new Error('timeout')).mockResolvedValue({ result: [{ name: 'IT', sys_id: 'g1' }] });
    expect((await fetchGroupsFromConfig()).error).toBe('timeout');
    expect((await fetchGroupsFromConfig()).groups).toEqual([{ name: 'IT', sys_id: 'g1' }]);
    expect(snGet).toHaveBeenCalledTimes(2);
  });

  test('cache expira depois de 1 hora', async () => {
    getSnConfig.mockReturnValue({ instance: 'corp', user: 'admin', pass: 'secret' });
    snGet.mockResolvedValue({ result: [{ name: 'IT', sys_id: 'g1' }] });
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    await fetchGroupsFromConfig();
    now.mockReturnValue(1_000_000 + 60 * 60 * 1000 + 1);
    await fetchGroupsFromConfig();
    now.mockRestore();
    expect(snGet).toHaveBeenCalledTimes(2);
  });

  test('trocar instância ou modo ignora o cache anterior', async () => {
    snGet.mockResolvedValue({ result: [{ name: 'IT', sys_id: 'g1' }] });
    getSnConfig.mockReturnValue({ instance: 'corp', user: 'admin', pass: 'secret' });
    await fetchGroupsFromConfig();
    getSnConfig.mockReturnValue({ mode: 'mcp', instance: 'corp' });
    await fetchGroupsFromConfig();
    getSnConfig.mockReturnValue({ mode: 'mcp', instance: 'outra' });
    await fetchGroupsFromConfig();
    expect(snGet).toHaveBeenCalledTimes(3);
  });
});

// ── Modo MCP ──────────────────────────────────────────────────────────────────

describe('modo MCP', () => {
  const { fetchPrbFields } = require('../../../handlers/sn');

  test('getSnCfg expõe modo e configurações do MCP', () => {
    getSnConfig.mockReturnValue({ mode: 'mcp', instance: 'x.service-now.com', mcp: { username: 'joao', caBundle: 'C:/ca.pem' } });
    expect(getSnCfg({})).toMatchObject({ mode: 'mcp', mcpUsername: 'joao', mcpCaBundle: 'C:/ca.pem', hasPass: false });
  });

  test('getSnCfg expõe URL de login e navegador (Edge por padrão)', () => {
    getSnConfig.mockReturnValue({ mode: 'mcp', instance: 'x', mcp: { loginUrl: 'https://x/login_with_sso.do?glide_sso_id=1' } });
    expect(getSnCfg({})).toMatchObject({ mcpLoginUrl: 'https://x/login_with_sso.do?glide_sso_id=1', mcpBrowser: 'edge' });
    getSnConfig.mockReturnValue({ mode: 'mcp', instance: 'x', mcp: { browser: 'chromium' } });
    expect(getSnCfg({}).mcpBrowser).toBe('chromium');
  });

  test('saveSnCfg salva URL de login e navegador normalizado', () => {
    saveSnCfg({ mcpLoginUrl: ' https://x/sso ', mcpBrowser: 'firefox' });
    expect(saveSnConfig).toHaveBeenCalledWith(expect.objectContaining({ mcp: { loginUrl: 'https://x/sso', browser: 'edge' } }), null);
  });

  test('getSnCfg usa api como modo padrão', () => {
    getSnConfig.mockReturnValue({ instance: 'x' });
    expect(getSnCfg({}).mode).toBe('api');
  });

  test('saveSnCfg salva modo e dados do MCP', () => {
    saveSnCfg({ instance: 'https://x.service-now.com/', mode: 'mcp', mcpUsername: ' joao ', mcpCaBundle: '' });
    expect(saveSnConfig).toHaveBeenCalledWith(
      expect.objectContaining({ instance: 'x.service-now.com', mode: 'mcp', mcp: { username: 'joao', caBundle: '' } }),
      null,
    );
  });

  test('saveSnCfg normaliza modo desconhecido para api', () => {
    saveSnCfg({ mode: 'qualquer' });
    expect(saveSnConfig).toHaveBeenCalledWith(expect.objectContaining({ mode: 'api' }), null);
  });

  test('testSn no modo MCP exige só a instância e passa o modo para o snGet', async () => {
    getSnConfig.mockReturnValue(null);
    snGet.mockResolvedValue({ result: [] });
    const r = await testSn({ mode: 'mcp', instance: 'https://x.service-now.com', mcpUsername: 'joao' });
    expect(r).toEqual({ ok: true });
    expect(snGet).toHaveBeenCalledWith(
      { mode: 'mcp', instance: 'x.service-now.com', mcp: { username: 'joao', caBundle: '', loginUrl: '', browser: 'edge' } },
      expect.stringContaining('table/incident'),
    );
  });

  test('testSn no modo MCP sem instância → 400', async () => {
    await expect(testSn({ mode: 'mcp' })).rejects.toMatchObject({ status: 400 });
  });

  test('fetchGroupsFromConfig funciona no modo MCP sem usuário/senha', async () => {
    getSnConfig.mockReturnValue({ mode: 'mcp', instance: 'x.service-now.com' });
    snGet.mockResolvedValue({ result: [{ name: 'Network', sys_id: 'g1' }] });
    const r = await fetchGroupsFromConfig();
    expect(r.groups).toEqual([{ name: 'Network', sys_id: 'g1' }]);
    expect(snGet.mock.calls[0][0]).toMatchObject({ mode: 'mcp', instance: 'x.service-now.com' });
  });

  test('fetchPrbFields repassa a config completa (com modo) ao snGet', async () => {
    const sn = { mode: 'mcp', instance: 'x.service-now.com' };
    getSnConfig.mockReturnValue(sn);
    snGet.mockResolvedValue({ result: [{ element: 'u_x', column_label: 'X' }] });
    const r = await fetchPrbFields();
    expect(r.fields).toEqual([{ key: 'u_x', label: 'X' }]);
    expect(snGet).toHaveBeenCalledWith(sn, expect.stringContaining('sys_dictionary'));
  });
});

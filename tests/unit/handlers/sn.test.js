jest.mock('../../../config');
jest.mock('../../../servicenowClient');

const { getSnCfg, saveSnCfg, testSn } = require('../../../handlers/sn');
const { getSnConfig, saveSnConfig, getProjectSnGroup } = require('../../../config');
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

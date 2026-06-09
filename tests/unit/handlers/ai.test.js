jest.mock('../../../config');
jest.mock('../../../aiClient');

const { getAiConfig, saveAiCfg, testAiConnection, chat } = require('../../../handlers/ai');
const { getAiCfg, saveAiConfig } = require('../../../config');
const { chatCompletion, testConnection } = require('../../../aiClient');

// ── getAiConfig ───────────────────────────────────────────────────────────────

describe('getAiConfig', () => {
  test('retorna campos completos quando configurado', () => {
    getAiCfg.mockReturnValue({ endpoint: 'https://ai.example.com', apiKey: 'key123', model: 'gpt-4', apiVersion: '2024-02' });

    const result = getAiConfig();

    expect(result).toEqual({
      configured:  true,
      endpoint:    'https://ai.example.com',
      apiKey:      'key123',
      model:       'gpt-4',
      apiVersion:  '2024-02',
    });
  });

  test('configured=false quando endpoint ausente', () => {
    getAiCfg.mockReturnValue({ apiKey: 'key', model: 'gpt-4' });
    expect(getAiConfig().configured).toBe(false);
  });

  test('configured=false quando AI não está configurada (null)', () => {
    getAiCfg.mockReturnValue(null);
    expect(getAiConfig().configured).toBe(false);
  });

  test('retorna strings vazias para campos ausentes', () => {
    getAiCfg.mockReturnValue(null);

    const result = getAiConfig();

    expect(result.endpoint).toBe('');
    expect(result.apiKey).toBe('');
    expect(result.model).toBe('');
    expect(result.apiVersion).toBe('');
  });
});

// ── saveAiCfg ─────────────────────────────────────────────────────────────────

describe('saveAiCfg', () => {
  test('throws 400 quando endpoint ausente', () => {
    expect(() => saveAiCfg({ endpoint: '', apiKey: 'k', model: 'm' }))
      .toThrow(expect.objectContaining({ status: 400 }));
  });

  test('throws 400 quando apiKey ausente', () => {
    expect(() => saveAiCfg({ endpoint: 'e', apiKey: '', model: 'm' }))
      .toThrow(expect.objectContaining({ status: 400 }));
  });

  test('throws 400 quando model ausente', () => {
    expect(() => saveAiCfg({ endpoint: 'e', apiKey: 'k', model: '' }))
      .toThrow(expect.objectContaining({ status: 400 }));
  });

  test('salva config com trim nos campos e retorna { ok: true }', () => {
    const result = saveAiCfg({ endpoint: '  https://ai.example.com  ', apiKey: '  key  ', model: '  gpt-4  ', apiVersion: '  2024  ' });

    expect(saveAiConfig).toHaveBeenCalledWith({
      endpoint:   'https://ai.example.com',
      apiKey:     'key',
      model:      'gpt-4',
      apiVersion: '2024',
    });
    expect(result).toEqual({ ok: true });
  });

  test('apiVersion padrão string vazia quando não fornecido', () => {
    saveAiCfg({ endpoint: 'e', apiKey: 'k', model: 'm' });

    expect(saveAiConfig).toHaveBeenCalledWith(
      expect.objectContaining({ apiVersion: '' })
    );
  });
});

// ── testAiConnection ──────────────────────────────────────────────────────────

describe('testAiConnection', () => {
  test('throws 400 quando campos obrigatórios ausentes', async () => {
    await expect(testAiConnection({ endpoint: '', apiKey: 'k', model: 'm' }))
      .rejects.toMatchObject({ status: 400 });
  });

  test('retorna { ok: true } quando conexão bem-sucedida', async () => {
    testConnection.mockResolvedValue();

    const result = await testAiConnection({ endpoint: 'e', apiKey: 'k', model: 'm' });

    expect(result).toEqual({ ok: true });
  });

  test('retorna { error } (HTTP 200) quando conexão falha — não lança exceção', async () => {
    testConnection.mockRejectedValue(new Error('Connection refused'));

    const result = await testAiConnection({ endpoint: 'e', apiKey: 'k', model: 'm' });

    expect(result).toEqual({ error: 'Connection refused' });
    await expect(testAiConnection({ endpoint: 'e', apiKey: 'k', model: 'm' }))
      .resolves.toHaveProperty('error');
  });

  test('faz trim nos campos antes de chamar testConnection', async () => {
    testConnection.mockResolvedValue();

    await testAiConnection({ endpoint: '  https://ai.com  ', apiKey: '  key  ', model: '  gpt  ' });

    expect(testConnection).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'https://ai.com', apiKey: 'key', model: 'gpt' })
    );
  });
});

// ── chat ──────────────────────────────────────────────────────────────────────

describe('chat', () => {
  const validAi = { endpoint: 'https://ai.example.com', apiKey: 'key', model: 'gpt-4' };

  test('throws 400 quando IA não está configurada', async () => {
    getAiCfg.mockReturnValue(null);

    await expect(chat({ message: 'Olá' }))
      .rejects.toMatchObject({ status: 400 });
  });

  test('throws 400 quando endpoint ausente na config', async () => {
    getAiCfg.mockReturnValue({ apiKey: 'k', model: 'm' });

    await expect(chat({ message: 'Olá' }))
      .rejects.toMatchObject({ status: 400 });
  });

  test('retorna { reply } com resposta da IA', async () => {
    getAiCfg.mockReturnValue(validAi);
    chatCompletion.mockResolvedValue('Resposta da IA');

    const result = await chat({ message: 'Qual o status do projeto?' });

    expect(result).toEqual({ reply: 'Resposta da IA' });
  });

  test('inclui role system, histórico e mensagem do usuário na chamada', async () => {
    getAiCfg.mockReturnValue(validAi);
    chatCompletion.mockResolvedValue('ok');
    const history = [{ role: 'user', content: 'msg anterior' }, { role: 'assistant', content: 'resp anterior' }];

    await chat({ message: 'Nova pergunta', history, context: 'dados do projeto' });

    const [, messages] = chatCompletion.mock.calls[0];
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('dados do projeto');
    expect(messages).toContainEqual({ role: 'user',      content: 'msg anterior' });
    expect(messages).toContainEqual({ role: 'assistant', content: 'resp anterior' });
    expect(messages[messages.length - 1]).toEqual({ role: 'user', content: 'Nova pergunta' });
  });

  test('funciona sem histórico (default [])', async () => {
    getAiCfg.mockReturnValue(validAi);
    chatCompletion.mockResolvedValue('ok');

    await expect(chat({ message: 'Oi' })).resolves.toEqual({ reply: 'ok' });
  });

  test('system prompt menciona ausência de contexto quando context vazio', async () => {
    getAiCfg.mockReturnValue(validAi);
    chatCompletion.mockResolvedValue('ok');

    await chat({ message: 'Oi' });

    const [, messages] = chatCompletion.mock.calls[0];
    expect(messages[0].content).toContain('No project data available');
  });
});

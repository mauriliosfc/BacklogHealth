const { EventEmitter } = require('events');
const { createProcessManager, classifyError, buildServerEnv, normalizeHost, getLoginBrowser, sessionDirFor, WHOAMI_ARGS, TOOL_PACKAGE } = require('../../../snMcp/mcpProcess');

const PATHS = {
  root: 'C:/data/sn-mcp', venvPython: 'C:/data/sn-mcp/venv/Scripts/python.exe',
  session: 'C:/data/sn-mcp/session', browsers: 'C:/data/sn-mcp/browsers',
  pythonDir: 'C:/data/sn-mcp/python', uvCache: 'C:/data/sn-mcp/uv-cache',
};
const SN = { mode: 'mcp', instance: 'https://empresa.service-now.com/', mcp: { username: 'joao' } };

function makeInstaller({ installed = true, needsUpdate = false, chromium = false, python = PATHS.venvPython } = {}) {
  return {
    paths: PATHS,
    getPythonExe:   jest.fn(() => python),
    isInstalled:    jest.fn(() => installed),
    needsUpdate:    jest.fn(() => needsUpdate),
    hasChromium:    jest.fn(() => chromium),
    install:        jest.fn(async () => {}),
    installBrowser: jest.fn(async () => {}),
  };
}

// Cliente MCP falso: cada instância registra a si mesma; `responder(name, args)` define respostas.
function makeClientClass(responder) {
  const instances = [];
  class FakeClient extends EventEmitter {
    constructor(opts) {
      super();
      this.opts = opts;
      this.running = false;
      this.proc = { pid: 4242 };
      this.calls = [];
      instances.push(this);
    }
    async start() { this.running = true; this.ready = true; }
    async callTool(name, args) {
      this.calls.push({ name, args });
      return responder(name, args, this);
    }
    stop() { this.running = false; this.stopped = (this.stopped || 0) + 1; }
  }
  return { FakeClient, instances };
}

const okWhoAmI = { success: true, results: [{ name: 'João Silva', user_name: 'joao' }] };
const fakeFs = { mkdirSync: jest.fn(), writeFileSync: jest.fn(), readFileSync: jest.fn(() => 'yaml'), rmSync: jest.fn(), appendFileSync: jest.fn() };

function makeManager({ responder = () => okWhoAmI, installer = makeInstaller(), ...rest } = {}) {
  const { FakeClient, instances } = makeClientClass(responder);
  const manager = createProcessManager({
    installer, ClientClass: FakeClient, sleep: async () => {}, fsImpl: fakeFs,
    retryDelayMs: 0, ...rest,
  });
  return { manager, instances, installer };
}

describe('classifyError', () => {
  test.each([
    ['Browser login is still in progress after 360s', 'in_progress'],
    ['login is currently in progress', 'in_progress'],
    ['Login cancelled by user', 'cancelled'],
    ['LOGIN_COOLDOWN: previous browser login attempted', 'cooldown'],
    ['Browser session expired', 'auth'],
    ['MFA_REQUIRED', 'auth'],
    ['HTTP 500', 'other'],
  ])('"%s" → %s', (msg, kind) => {
    expect(classifyError(msg)).toBe(kind);
  });
});

describe('buildServerEnv', () => {
  test('monta env de login SSO com pacote somente leitura', () => {
    const env = buildServerEnv({ ...SN, mcp: { username: ' joao ', caBundle: 'C:/ca.pem' } }, PATHS, 'C:/data/sn-mcp/readonly-tools.yaml', 'C:/data/sn-mcp/pyhooks');
    expect(env).toMatchObject({
      SERVICENOW_INSTANCE_URL:          'https://empresa.service-now.com',
      SERVICENOW_AUTH_TYPE:             'sso',
      SERVICENOW_BROWSER_USER_DATA_DIR: `${PATHS.session}-edge`,
      PLAYWRIGHT_BROWSERS_PATH:         PATHS.browsers,
      MCP_TOOL_PACKAGE:                 TOOL_PACKAGE,
      TOOL_PACKAGE_CONFIG_PATH:         'C:/data/sn-mcp/readonly-tools.yaml',
      SERVICENOW_BROWSER_USERNAME:      'joao',
      REQUESTS_CA_BUNDLE:               'C:/ca.pem',
    });
  });

  test('omite usuário e URL de login quando não informados', () => {
    const env = buildServerEnv({ instance: 'x.service-now.com' }, PATHS, 'y', 'h');
    expect(env).not.toHaveProperty('SERVICENOW_BROWSER_USERNAME');
    expect(env).not.toHaveProperty('SERVICENOW_BROWSER_LOGIN_URL');
  });

  test('URL de login SSO personalizada vai para SERVICENOW_BROWSER_LOGIN_URL', () => {
    const env = buildServerEnv({ instance: 'x', mcp: { loginUrl: ' https://x/login_with_sso.do?glide_sso_id=abc ' } }, PATHS, 'y', 'h');
    expect(env.SERVICENOW_BROWSER_LOGIN_URL).toBe('https://x/login_with_sso.do?glide_sso_id=abc');
  });

  test('Edge é o padrão: hook via PYTHONPATH e sessão separada', () => {
    const env = buildServerEnv({ instance: 'x' }, PATHS, 'y', 'C:/data/sn-mcp/pyhooks');
    expect(getLoginBrowser({ instance: 'x' })).toBe('edge');
    expect(env).toMatchObject({
      BH_SN_BROWSER_CHANNEL: 'msedge',
      BH_SN_FAST_PROBE: '1',
      PYTHONPATH: 'C:/data/sn-mcp/pyhooks',
      SERVICENOW_BROWSER_USER_DATA_DIR: `${PATHS.session}-edge`,
    });
  });

  test('Chromium: sem canal do Edge, com checagem rápida e a pasta de sessão original', () => {
    const env = buildServerEnv({ instance: 'x', mcp: { browser: 'chromium' } }, PATHS, 'y', 'C:/data/sn-mcp/pyhooks');
    expect(env).not.toHaveProperty('BH_SN_BROWSER_CHANNEL');
    expect(env).toMatchObject({ PYTHONPATH: 'C:/data/sn-mcp/pyhooks', BH_SN_FAST_PROBE: '1' });
    expect(env.SERVICENOW_BROWSER_USER_DATA_DIR).toBe(PATHS.session);
    expect(sessionDirFor(PATHS, 'chromium')).toBe(PATHS.session);
  });

  test('normalizeHost remove protocolo e barras', () => {
    expect(normalizeHost(' https://a.service-now.com// ')).toBe('a.service-now.com');
  });
});

describe('ensureSession', () => {
  test('sobe o python do venv e fica conectado com o nome do usuário', async () => {
    const { manager, instances } = makeManager();
    const st = await manager.ensureSession(SN);

    expect(instances).toHaveLength(1);
    expect(instances[0].opts.command).toBe(PATHS.venvPython);
    expect(instances[0].opts.args).toEqual(['-m', 'servicenow_mcp']);
    expect(instances[0].calls[0]).toEqual({ name: 'sn_query', args: WHOAMI_ARGS });
    expect(st).toMatchObject({ state: 'connected', user: 'João Silva', instance: 'empresa.service-now.com' });
  });

  test('com o runtime embutido instalado, sobe o python dele', async () => {
    const python = 'C:/data/sn-mcp/runtime/python.exe';
    const { manager, instances } = makeManager({ installer: makeInstaller({ python }) });
    await manager.ensureSession(SN);
    expect(instances[0].opts.command).toBe(python);
  });

  test('copia o yaml de ferramentas e o hook do Edge para fora do app', async () => {
    const { manager, instances } = makeManager();
    await manager.ensureSession(SN);
    expect(fakeFs.writeFileSync).toHaveBeenCalledWith(expect.stringContaining('readonly-tools.yaml'), 'yaml', 'utf8');
    expect(fakeFs.writeFileSync).toHaveBeenCalledWith(expect.stringMatching(/pyhooks[\\/]sitecustomize\.py$/), 'yaml', 'utf8');
    expect(instances[0].opts.env.PYTHONPATH).toMatch(/pyhooks$/);
  });

  test('trocar URL de login ou navegador reinicia o processo', async () => {
    const { manager, instances } = makeManager();
    await manager.ensureSession(SN);
    await manager.ensureSession({ ...SN, mcp: { ...SN.mcp, loginUrl: 'https://x/sso' } });
    await manager.ensureSession({ ...SN, mcp: { ...SN.mcp, loginUrl: 'https://x/sso', browser: 'chromium' } });
    expect(instances).toHaveLength(3);
  });

  test('é single-flight: chamadas concorrentes compartilham a mesma validação', async () => {
    const { manager, instances } = makeManager();
    await Promise.all([manager.ensureSession(SN), manager.ensureSession(SN), manager.ensureSession(SN)]);
    expect(instances).toHaveLength(1);
    expect(instances[0].calls).toHaveLength(1);
  });

  test('não revalida quando já conectado', async () => {
    const { manager, instances } = makeManager();
    await manager.ensureSession(SN);
    await manager.ensureSession(SN);
    expect(instances[0].calls).toHaveLength(1);
  });

  test('aguarda enquanto o login está em andamento', async () => {
    let n = 0;
    const { manager } = makeManager({
      responder: () => (++n < 3 ? { success: false, error: 'login is currently in progress' } : okWhoAmI),
    });
    const states = [];
    manager.events.on('status', s => states.push(s.state));

    await manager.ensureSession(SN);
    expect(n).toBe(3);
    expect(states).toContain('awaiting_login');
    expect(states[states.length - 1]).toBe('connected');
  });

  test('linha de stderr de janela visível muda o estado para awaiting_login', async () => {
    let release;
    const gate = new Promise(r => { release = r; });
    const { manager, instances } = makeManager({ responder: async () => { await gate; return okWhoAmI; } });

    const p = manager.ensureSession(SN);
    await new Promise(r => setImmediate(r));
    instances[0].emit('stderr', 'INFO Headless login attempt cannot proceed — opening visible browser for interactive MFA/SSO.');
    expect(manager.getStatus().state).toBe('awaiting_login');

    release();
    await p;
    expect(manager.getStatus().state).toBe('connected');
  });

  test('usa consulta alternativa quando a instância recusa javascript: na query', async () => {
    const { manager, instances } = makeManager({
      responder: (name, args) => (args.query ? { success: false, message: 'Bad Request' } : { success: true, results: [{ sys_id: '1' }] }),
    });
    const st = await manager.ensureSession(SN);
    expect(instances[0].calls).toHaveLength(2);
    expect(st.state).toBe('connected');
  });

  test('login cancelado vira estado de erro com motivo', async () => {
    const { manager } = makeManager({ responder: () => ({ success: false, error: 'Login cancelled by user' }) });
    await expect(manager.ensureSession(SN)).rejects.toThrow(/cancelled/);
    expect(manager.getStatus()).toMatchObject({ state: 'error', reason: 'cancelled' });
  });

  test('sem componentes instalados lança SN_MCP_NOT_INSTALLED', async () => {
    const { manager } = makeManager({ installer: makeInstaller({ installed: false }) });
    await expect(manager.ensureSession(SN)).rejects.toMatchObject({ code: 'SN_MCP_NOT_INSTALLED' });
    expect(manager.getStatus().state).toBe('not_installed');
  });

  test('atualiza componentes antes de subir quando a versão mudou', async () => {
    const installer = makeInstaller({ needsUpdate: true });
    const { manager } = makeManager({ installer });
    await manager.ensureSession(SN);
    expect(installer.install).toHaveBeenCalled();
  });

  test('troca de instância reinicia o processo', async () => {
    const { manager, instances } = makeManager();
    await manager.ensureSession(SN);
    await manager.ensureSession({ ...SN, instance: 'outra.service-now.com' });
    expect(instances).toHaveLength(2);
    expect(instances[0].running).toBe(false);
    expect(instances[0].stopped).toBe(1);
  });

  test('rejeita sem instância configurada', async () => {
    const { manager } = makeManager();
    await expect(manager.ensureSession({ mode: 'mcp' })).rejects.toThrow(/instance/);
  });
});

describe('callTool', () => {
  test('repassa a chamada depois de validar a sessão', async () => {
    const { manager, instances } = makeManager({
      responder: (name) => (name === 'sn_query' ? okWhoAmI : { success: true, result: 1 }),
    });
    const r = await manager.callTool(SN, 'sn_aggregate', { table: 'incident' });
    expect(r).toEqual({ success: true, result: 1 });
    expect(instances[0].calls.map(c => c.name)).toEqual(['sn_query', 'sn_aggregate']);
  });

  test('sessão expirada no meio do uso: revalida e tenta de novo uma vez', async () => {
    let expired = false;
    const { manager, instances } = makeManager({
      responder: (name, args) => {
        if (args === WHOAMI_ARGS) return okWhoAmI;
        if (!expired) { expired = true; return { success: false, error: 'Browser session expired', error_type: 'auth_session_expired' }; }
        return { success: true, results: [] };
      },
    });
    const r = await manager.callTool(SN, 'sn_query', { table: 'incident' });
    expect(r).toEqual({ success: true, results: [] });
    const whoami = instances[0].calls.filter(c => c.args === WHOAMI_ARGS);
    expect(whoami).toHaveLength(2);
  });

  test('erro comum não dispara revalidação', async () => {
    const { manager, instances } = makeManager({
      responder: (name, args) => (args === WHOAMI_ARGS ? okWhoAmI : { success: false, message: 'unknown_query_fields' }),
    });
    const r = await manager.callTool(SN, 'sn_query', { table: 'incident' });
    expect(r.success).toBe(false);
    expect(instances[0].calls).toHaveLength(2);
  });
});

describe('getStatus', () => {
  test('passa de not_installed para stopped quando os componentes são instalados depois', () => {
    let installed = false;
    const installer = { ...makeInstaller(), isInstalled: jest.fn(() => installed) };
    const { manager } = makeManager({ installer });
    expect(manager.getStatus().state).toBe('not_installed');
    installed = true;
    expect(manager.getStatus().state).toBe('stopped');
  });
});

describe('stop / logout', () => {
  test('stop encerra o cliente e volta para stopped', async () => {
    const { manager, instances } = makeManager();
    await manager.ensureSession(SN);
    manager.stop();
    expect(instances[0].stopped).toBe(1);
    expect(instances[0].running).toBe(false);
    expect(manager.getStatus().state).toBe('stopped');
  });

  test('logout apaga as pastas de sessão dos dois navegadores', async () => {
    const { manager } = makeManager();
    await manager.ensureSession(SN);
    manager.logout();
    expect(fakeFs.rmSync).toHaveBeenCalledWith(PATHS.session, { recursive: true, force: true });
    expect(fakeFs.rmSync).toHaveBeenCalledWith(`${PATHS.session}-edge`, { recursive: true, force: true });
    expect(manager.getStatus().user).toBe('');
  });

  test('saída inesperada do processo marca stopped e permite reconectar', async () => {
    const { manager, instances } = makeManager();
    await manager.ensureSession(SN);
    instances[0].running = false;
    instances[0].emit('exit', 1);
    expect(manager.getStatus().state).toBe('stopped');

    await manager.ensureSession(SN);
    expect(instances).toHaveLength(2);
  });
});

describe('invalidateSession / setTransport', () => {
  test('invalidateSession força revalidação no próximo ensureSession', async () => {
    const { manager, instances } = makeManager();
    await manager.ensureSession(SN);
    manager.invalidateSession();
    expect(manager.getStatus().state).toBe('connecting');
    await manager.ensureSession(SN);
    expect(instances[0].calls.filter(c => c.args === WHOAMI_ARGS)).toHaveLength(2);
    expect(manager.getStatus().state).toBe('connected');
  });

  test('setTransport aparece no status', () => {
    const { manager } = makeManager();
    manager.setTransport('direct');
    expect(manager.getStatus().transport).toBe('direct');
    manager.setTransport('mcp-tools', 'REST recusada');
    expect(manager.getStatus()).toMatchObject({ transport: 'mcp-tools', transportReason: 'REST recusada' });
  });
});

describe('warmup', () => {
  test('sobe o processo e faz o handshake sem validar a sessão (não abre login)', async () => {
    const { manager, instances } = makeManager();
    await expect(manager.warmup(SN)).resolves.toBe(true);
    expect(instances).toHaveLength(1);
    expect(instances[0].calls).toHaveLength(0);
    expect(manager.getStatus().state).toBe('stopped');
  });

  test('login durante o pré-aquecimento reaproveita o mesmo processo', async () => {
    const { manager, instances } = makeManager();
    const w = manager.warmup(SN);
    const s = manager.ensureSession(SN);
    await Promise.all([w, s]);
    expect(instances).toHaveLength(1);
    expect(manager.getStatus().state).toBe('connected');
  });

  test('não faz nada sem componentes ou sem instância', async () => {
    const { manager, instances } = makeManager({ installer: makeInstaller({ installed: false }) });
    await expect(manager.warmup(SN)).resolves.toBe(false);
    await expect(manager.warmup({ mode: 'mcp' })).resolves.toBe(false);
    expect(instances).toHaveLength(0);
  });

  test('não atualiza componentes no pré-aquecimento', async () => {
    const installer = makeInstaller({ needsUpdate: true });
    const { manager } = makeManager({ installer });
    await expect(manager.warmup(SN)).resolves.toBe(false);
    expect(installer.install).not.toHaveBeenCalled();
  });

  test('registra marcos de tempo no log do app', async () => {
    const { manager } = makeManager();
    await manager.ensureSession(SN);
    const lines = fakeFs.appendFileSync.mock.calls.map(c => c[1]).join('');
    expect(lines).toMatch(/spawn mcp/);
    expect(lines).toMatch(/handshake ok in \d+ms/);
    expect(lines).toMatch(/session ok in \d+ms/);
  });

  test('env do MCP grava log em arquivo na pasta logs', () => {
    const env = buildServerEnv({ instance: 'x' }, PATHS, 'y', 'h');
    expect(env.LOG_FILE).toBe(require('path').join(PATHS.root, 'logs') + require('path').sep);
  });
});

describe('Chromium sob demanda', () => {
  test('modo Chromium sem navegador instalado: baixa antes de subir o MCP', async () => {
    const installer = makeInstaller({ chromium: false });
    const { manager, instances } = makeManager({ installer });
    await manager.ensureSession({ ...SN, mcp: { ...SN.mcp, browser: 'chromium' } });
    expect(installer.installBrowser).toHaveBeenCalledTimes(1);
    expect(instances).toHaveLength(1);
  });

  test('modo Edge (padrão) nunca baixa o Chromium', async () => {
    const installer = makeInstaller({ chromium: false });
    const { manager } = makeManager({ installer });
    await manager.ensureSession(SN);
    expect(installer.installBrowser).not.toHaveBeenCalled();
  });

  test('atualização de componentes repassa o navegador escolhido', async () => {
    const installer = makeInstaller({ needsUpdate: true, chromium: true });
    const { manager } = makeManager({ installer });
    await manager.ensureSession({ ...SN, mcp: { ...SN.mcp, browser: 'chromium' } });
    expect(installer.install).toHaveBeenCalledWith(expect.objectContaining({ browser: 'chromium' }));
    expect(installer.installBrowser).not.toHaveBeenCalled();
  });
});

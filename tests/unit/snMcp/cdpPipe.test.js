const { EventEmitter } = require('events');
const { PassThrough } = require('stream');
const nodePath = require('path');
const { createCdpConnection, findEdge, edgeArgs, launchEdge, killProfileProcesses } = require('../../../snMcp/cdpPipe');

function pipePair() {
  const toBrowser = new PassThrough();
  const fromBrowser = new PassThrough();
  const sent = [];
  toBrowser.on('data', d => String(d).split('\0').filter(Boolean).forEach(m => sent.push(JSON.parse(m))));
  const reply = obj => fromBrowser.write(JSON.stringify(obj) + '\0');
  return { toBrowser, fromBrowser, sent, reply };
}

const tick = () => new Promise(r => setImmediate(r));

describe('createCdpConnection', () => {
  test('envia JSON terminado em \\0 e resolve pela correlação de id', async () => {
    const p = pipePair();
    const cdp = createCdpConnection(p.toBrowser, p.fromBrowser);
    const a = cdp.send('Browser.getVersion');
    const b = cdp.send('Runtime.evaluate', { expression: '1' }, 'S1');
    await tick();
    expect(p.sent).toEqual([
      { id: 1, method: 'Browser.getVersion', params: {} },
      { id: 2, method: 'Runtime.evaluate', params: { expression: '1' }, sessionId: 'S1' },
    ]);
    p.reply({ id: 2, result: { result: { value: 1 } } });
    p.reply({ id: 1, result: { product: 'Edg/157' } });
    await expect(a).resolves.toEqual({ product: 'Edg/157' });
    await expect(b).resolves.toEqual({ result: { value: 1 } });
  });

  test('mensagens partidas em pedaços e várias num pedaço só', async () => {
    const p = pipePair();
    const cdp = createCdpConnection(p.toBrowser, p.fromBrowser);
    const a = cdp.send('A');
    const c = cdp.send('B');
    const raw = JSON.stringify({ id: 1, result: { a: 1 } }) + '\0' + JSON.stringify({ id: 2, result: { b: 2 } }) + '\0';
    p.fromBrowser.write(raw.slice(0, 7));
    p.fromBrowser.write(raw.slice(7));
    await expect(a).resolves.toEqual({ a: 1 });
    await expect(c).resolves.toEqual({ b: 2 });
  });

  test('erro de protocolo rejeita com CDP_ERROR', async () => {
    const p = pipePair();
    const cdp = createCdpConnection(p.toBrowser, p.fromBrowser);
    const a = cdp.send('Page.navigate');
    p.reply({ id: 1, error: { message: 'Invalid parameters' } });
    await expect(a).rejects.toMatchObject({ code: 'CDP_ERROR', message: expect.stringContaining('Invalid parameters') });
  });

  test('eventos vão para os ouvintes', async () => {
    const p = pipePair();
    const cdp = createCdpConnection(p.toBrowser, p.fromBrowser);
    const got = [];
    cdp.onEvent(m => got.push(m.method));
    p.reply({ method: 'Target.targetCreated', params: {} });
    await tick();
    expect(got).toEqual(['Target.targetCreated']);
  });

  test('fim do pipe rejeita pendentes e chamadas novas com CDP_CLOSED', async () => {
    const p = pipePair();
    const cdp = createCdpConnection(p.toBrowser, p.fromBrowser);
    const a = cdp.send('X');
    p.fromBrowser.end();
    await expect(a).rejects.toMatchObject({ code: 'CDP_CLOSED' });
    await expect(cdp.send('Y')).rejects.toMatchObject({ code: 'CDP_CLOSED' });
    expect(cdp.isClosed()).toBe(true);
  });

  test('timeout por chamada', async () => {
    jest.useFakeTimers();
    const p = pipePair();
    const cdp = createCdpConnection(p.toBrowser, p.fromBrowser, { callTimeoutMs: 1000 });
    const a = cdp.send('Lento');
    jest.advanceTimersByTime(1001);
    await expect(a).rejects.toMatchObject({ code: 'CDP_TIMEOUT' });
    jest.useRealTimers();
  });
});

describe('findEdge', () => {
  test('procura nas instalações por máquina e por usuário', () => {
    const want = nodePath.join('C:\\PF86', 'Microsoft', 'Edge', 'Application', 'msedge.exe');
    const fsImpl = { existsSync: p => p === want };
    expect(findEdge({ fsImpl, env: { 'ProgramFiles(x86)': 'C:\\PF86' }, platform: 'win32' })).toBe(want);
  });

  test('não encontrado ou fora do Windows → vazio', () => {
    expect(findEdge({ fsImpl: { existsSync: () => false }, env: {}, platform: 'win32' })).toBe('');
    expect(findEdge({ fsImpl: { existsSync: () => true }, env: {}, platform: 'linux' })).toBe('');
  });
});

test('edgeArgs: perfil dedicado, pipe, sem primeira execução e headless opcional', () => {
  const a = edgeArgs({ userDataDir: 'C:/p', headless: true, url: 'about:blank' });
  expect(a).toEqual(expect.arrayContaining([`--user-data-dir=${nodePath.resolve('C:/p')}`, '--remote-debugging-pipe', '--no-first-run', '--headless=new']));
  expect(a[a.length - 1]).toBe('about:blank');
  expect(edgeArgs({ userDataDir: 'C:/p', headless: false })).not.toContain('--headless=new');
});

test('edgeArgs: caminho relativo do perfil vira absoluto (relativo faz o Edge sair na hora)', () => {
  expect(edgeArgs({ userDataDir: 'sn-mcp/perfil' })[0]).toBe(`--user-data-dir=${nodePath.resolve('sn-mcp/perfil')}`);
});

describe('killProfileProcesses', () => {
  test('mata só os msedge.exe com o --user-data-dir do perfil e devolve quantos', async () => {
    const execFileImpl = jest.fn((cmd, args, opts, cb) => cb(null, '2' + String.fromCharCode(10)));
    await expect(killProfileProcesses('C:/data/perfil', { execFileImpl, platform: 'win32' })).resolves.toBe(2);
    const script = execFileImpl.mock.calls[0][1].join(' ');
    expect(execFileImpl.mock.calls[0][0]).toBe('powershell');
    expect(script).toContain(nodePath.resolve('C:/data/perfil'));
    expect(script).toContain("Name='msedge.exe'");
  });

  test('erro do PowerShell ou fora do Windows → 0, sem lançar', async () => {
    await expect(killProfileProcesses('C:/p', { execFileImpl: (c, a, o, cb) => cb(new Error('x')), platform: 'win32' })).resolves.toBe(0);
    await expect(killProfileProcesses('C:/p', { platform: 'linux' })).resolves.toBe(0);
  });
});

describe('launchEdge', () => {
  function fakeChild() {
    const child = new EventEmitter();
    child.pid = 4321;
    const p = pipePair();
    child.stdio = [null, null, null, p.toBrowser, p.fromBrowser];
    return { child, p };
  }

  test('sem Edge → SN_EDGE_NOT_FOUND', () => {
    expect(() => launchEdge({ exe: '' })).toThrow(expect.objectContaining({ code: 'SN_EDGE_NOT_FOUND' }));
  });

  test('abre com pipes nos fds 3/4', () => {
    const { child } = fakeChild();
    const spawnImpl = jest.fn(() => child);
    launchEdge({ exe: 'msedge.exe', userDataDir: 'C:/p', headless: true, spawnImpl });
    expect(spawnImpl).toHaveBeenCalledWith('msedge.exe', expect.any(Array), expect.objectContaining({ stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] }));
  });

  test('close: Browser.close e, se o processo não sair, mata a árvore', async () => {
    const { child, p } = fakeChild();
    const killTreeImpl = jest.fn(async () => { child.emit('exit', 0); });
    const b = launchEdge({ exe: 'msedge.exe', userDataDir: 'C:/p', spawnImpl: () => child, killTreeImpl });
    await b.close({ graceMs: 10 });
    expect(p.sent.map(m => m.method)).toContain('Browser.close');
    expect(killTreeImpl).toHaveBeenCalledWith(4321);
  });

  test('close: processo que sai sozinho não é morto', async () => {
    const { child } = fakeChild();
    const killTreeImpl = jest.fn();
    const b = launchEdge({ exe: 'msedge.exe', userDataDir: 'C:/p', spawnImpl: () => child, killTreeImpl });
    child.emit('exit', 0);
    expect(b.hasExited()).toBe(true);
    await b.close({ graceMs: 10 });
    expect(killTreeImpl).not.toHaveBeenCalled();
  });
});

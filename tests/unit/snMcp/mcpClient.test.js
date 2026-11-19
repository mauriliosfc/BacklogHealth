const { EventEmitter } = require('events');
const { McpClient, parseToolResult, ALLOWED_TOOLS } = require('../../../snMcp/mcpClient');

// Processo falso: captura o que o cliente escreve no stdin e permite responder pelo stdout.
function makeFakeProc({ autoInit = true, onRequest } = {}) {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.sent   = [];
  proc.kill   = jest.fn(() => proc.emit('exit', null));
  proc.reply  = (msg) => proc.stdout.emit('data', JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');
  proc.stdin  = {
    write: (line) => {
      const msg = JSON.parse(line);
      proc.sent.push(msg);
      if (autoInit && msg.method === 'initialize') {
        setImmediate(() => proc.reply({ id: msg.id, result: { serverInfo: { name: 'ServiceNow' } } }));
      } else if (onRequest && msg.id !== undefined && msg.method) {
        onRequest(msg, proc);
      }
    },
    end: jest.fn(),
    on:  jest.fn(),
  };
  return proc;
}

function toolReply(obj) {
  return { content: [{ type: 'text', text: JSON.stringify(obj) }], isError: false };
}

function makeClient(procOpts, clientOpts = {}) {
  const proc    = makeFakeProc(procOpts);
  const spawnFn = jest.fn(() => proc);
  const killTreeFn = jest.fn();
  const client  = new McpClient({ command: 'python', args: ['-m', 'servicenow_mcp'], env: { A: '1' }, spawnFn, killTreeFn, ...clientOpts });
  return { client, proc, spawnFn, killTreeFn };
}

describe('McpClient — handshake', () => {
  test('envia initialize e depois notifications/initialized', async () => {
    const { client, proc, spawnFn } = makeClient();
    await client.start();

    expect(spawnFn).toHaveBeenCalledWith('python', ['-m', 'servicenow_mcp'], expect.objectContaining({ windowsHide: true }));
    expect(spawnFn.mock.calls[0][2].env.A).toBe('1');
    expect(proc.sent[0].method).toBe('initialize');
    expect(proc.sent[0].params.protocolVersion).toBeDefined();
    expect(proc.sent[1]).toEqual({ jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(client.ready).toBe(true);
  });

  test('start é idempotente enquanto o processo está vivo', async () => {
    const { client, spawnFn } = makeClient();
    await client.start();
    await client.start();
    expect(spawnFn).toHaveBeenCalledTimes(1);
  });
});

describe('McpClient — tools/call', () => {
  test('correlaciona respostas pelo id mesmo fora de ordem', async () => {
    const pendingReqs = [];
    const { client, proc } = makeClient({ onRequest: (msg) => pendingReqs.push(msg) });
    await client.start();

    const p1 = client.callTool('sn_query', { table: 'a' });
    const p2 = client.callTool('sn_query', { table: 'b' });
    await new Promise(r => setImmediate(r));
    const [r1, r2] = pendingReqs;
    proc.reply({ id: r2.id, result: toolReply({ success: true, table: 'b' }) });
    proc.reply({ id: r1.id, result: toolReply({ success: true, table: 'a' }) });

    await expect(p1).resolves.toEqual({ success: true, table: 'a' });
    await expect(p2).resolves.toEqual({ success: true, table: 'b' });
    expect(r1.params).toEqual({ name: 'sn_query', arguments: { table: 'a' } });
  });

  test('bloqueia ferramentas fora da whitelist de leitura', async () => {
    const { client, proc } = makeClient();
    await client.start();
    await expect(client.callTool('sn_write', { table: 'incident' })).rejects.toThrow(/not allowed/);
    expect(proc.sent.find(m => m.method === 'tools/call')).toBeUndefined();
  });

  test('whitelist padrão contém apenas ferramentas de leitura', () => {
    expect([...ALLOWED_TOOLS].sort()).toEqual(['sn_aggregate', 'sn_health', 'sn_query', 'sn_schema']);
  });

  test('respeita o limite de concorrência', async () => {
    const pendingReqs = [];
    const { client, proc } = makeClient({ onRequest: (msg) => pendingReqs.push(msg) }, { maxConcurrent: 2 });
    await client.start();

    const all = [1, 2, 3, 4].map(n => client.callTool('sn_query', { n }));
    await new Promise(r => setImmediate(r));
    expect(pendingReqs).toHaveLength(2);

    proc.reply({ id: pendingReqs[0].id, result: toolReply({ ok: 1 }) });
    await new Promise(r => setImmediate(r));
    expect(pendingReqs).toHaveLength(3);

    pendingReqs.slice(1).forEach(m => proc.reply({ id: m.id, result: toolReply({ ok: 1 }) }));
    await new Promise(r => setImmediate(r));
    proc.reply({ id: pendingReqs[3].id, result: toolReply({ ok: 1 }) });
    await expect(Promise.all(all)).resolves.toHaveLength(4);
  });

  test('rejeita por timeout', async () => {
    jest.useFakeTimers();
    try {
      const { client } = makeClient({ autoInit: false });
      const started = client.start();
      jest.advanceTimersByTime(121000);
      await expect(started).rejects.toThrow(/timed out/);
    } finally {
      jest.useRealTimers();
    }
  });

  test('erro JSON-RPC vira Error', async () => {
    const { client, proc } = makeClient({ onRequest: (msg, p) => p.reply({ id: msg.id, error: { code: -32602, message: 'Invalid params' } }) });
    await client.start();
    await expect(client.callTool('sn_query', {})).rejects.toThrow(/Invalid params/);
    expect(proc.sent.length).toBeGreaterThan(2);
  });

  test('saída do processo rejeita chamadas pendentes e emite exit', async () => {
    const { client, proc } = makeClient({ onRequest: () => {} });
    await client.start();
    const onExit = jest.fn();
    client.on('exit', onExit);

    const p = client.callTool('sn_query', {});
    await new Promise(r => setImmediate(r));
    proc.emit('exit', 1);

    await expect(p).rejects.toThrow(/exited/);
    expect(onExit).toHaveBeenCalledWith(1, undefined);
    expect(client.running).toBe(false);
  });

  test('responde pedidos do servidor (ping) e emite linhas do stderr', async () => {
    const { client, proc } = makeClient();
    await client.start();
    const lines = [];
    client.on('stderr', l => lines.push(l));

    proc.stdout.emit('data', JSON.stringify({ jsonrpc: '2.0', id: 'srv-1', method: 'ping' }) + '\n');
    proc.stderr.emit('data', 'linha 1\nlinha');
    proc.stderr.emit('data', ' 2\n');

    expect(proc.sent.find(m => m.id === 'srv-1')).toEqual({ jsonrpc: '2.0', id: 'srv-1', result: {} });
    expect(lines).toEqual(['linha 1', 'linha 2']);
  });

  test('stop encerra a árvore de processos (lançador do venv + python real)', async () => {
    const { client, proc, killTreeFn } = makeClient();
    proc.pid = 777;
    await client.start();
    client.stop();
    expect(killTreeFn).toHaveBeenCalledWith(777);
    expect(proc.kill).toHaveBeenCalled();
    expect(client.running).toBe(false);
  });
});

describe('parseToolResult', () => {
  test('usa structuredContent quando presente', () => {
    expect(parseToolResult({ structuredContent: { a: 1 }, content: [] })).toEqual({ a: 1 });
  });

  test('faz parse do primeiro TextContent', () => {
    expect(parseToolResult(toolReply({ success: true }))).toEqual({ success: true });
  });

  test('isError com mensagem de sessão vira SN_AUTH', () => {
    expect(() => parseToolResult({ isError: true, content: [{ type: 'text', text: 'Browser session expired' }] }))
      .toThrow(expect.objectContaining({ code: 'SN_AUTH' }));
  });

  test('texto que não é JSON gera erro claro', () => {
    expect(() => parseToolResult({ content: [{ type: 'text', text: 'oops' }] })).toThrow(/Invalid MCP tool output/);
  });
});

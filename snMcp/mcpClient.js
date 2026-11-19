// Cliente MCP mínimo sobre stdio (JSON-RPC 2.0, uma mensagem por linha). Sem dependências.
//
// Fluxo: spawn → initialize → notifications/initialized → tools/call ...
// Somente ferramentas da whitelist podem ser chamadas — segunda barreira de "somente leitura"
// (a primeira é o pacote de ferramentas restrito passado ao servidor MCP).

const { EventEmitter } = require('events');
const childProcess     = require('child_process');

const ALLOWED_TOOLS      = Object.freeze(['sn_query', 'sn_aggregate', 'sn_health', 'sn_schema']);
const PROTOCOL_VERSION   = '2025-06-18';
const DEFAULT_TIMEOUT_MS = 120000;
const INIT_TIMEOUT_MS    = 120000;  // 1ª execução em máquina corporativa (antivírus) mediu ~30s

class McpClient extends EventEmitter {
  constructor({
    command, args = [], env = {}, cwd,
    spawnFn = childProcess.spawn,
    callTimeoutMs = DEFAULT_TIMEOUT_MS,
    maxConcurrent = 4,
    allowedTools = ALLOWED_TOOLS,
    clientInfo = { name: 'backlog-health', version: '0.0.0' },
    killTreeFn = killProcessTree,
  } = {}) {
    super();
    this.command       = command;
    this.args          = args;
    this.env           = env;
    this.cwd           = cwd;
    this.spawnFn       = spawnFn;
    this.callTimeoutMs = callTimeoutMs;
    this.maxConcurrent = Math.max(1, maxConcurrent);
    this.allowedTools  = new Set(allowedTools);
    this.clientInfo    = clientInfo;
    this.killTreeFn    = killTreeFn;

    this.proc     = null;
    this.nextId   = 1;
    this.pending  = new Map();   // id → { resolve, reject, timer }
    this.buffer   = '';
    this.active   = 0;
    this.queue    = [];
    this.ready    = false;
    this.serverInfo = null;
  }

  get running() { return !!this.proc && !this.exited; }

  async start() {
    if (this.proc) return this.serverInfo;
    this.exited = false;
    const proc = this.spawnFn(this.command, this.args, {
      env: { ...process.env, ...this.env },
      cwd: this.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.proc = proc;

    proc.stdout.setEncoding?.('utf8');
    proc.stderr.setEncoding?.('utf8');
    proc.stdout.on('data', chunk => this._onStdout(chunk));
    let errBuf = '';
    proc.stderr.on('data', chunk => {
      errBuf += chunk;
      const lines = errBuf.split(/\r?\n/);
      errBuf = lines.pop();
      lines.filter(Boolean).forEach(l => this.emit('stderr', l));
    });
    proc.on('error', err => this._onExit(null, err));
    proc.on('exit', code => this._onExit(code));
    proc.stdin.on?.('error', () => {});

    const res = await this._request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities:    {},
      clientInfo:      this.clientInfo,
    }, INIT_TIMEOUT_MS);
    this.serverInfo = res;
    this._send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    this.ready = true;
    return res;
  }

  stop() {
    const proc = this.proc;
    if (!proc) return;
    try { proc.stdin.end(); } catch (_) {}
    // No Windows o python.exe do venv é só um lançador: matar o pai deixa o Python real
    // (e o Chromium de login) órfãos. Encerra a árvore inteira antes do kill normal.
    if (proc.pid) { try { this.killTreeFn(proc.pid); } catch (_) {} }
    try { proc.kill(); } catch (_) {}
    this._onExit(null, new Error('MCP client stopped'));
  }

  async listTools() {
    const res = await this._request('tools/list', {});
    return (res && res.tools) || [];
  }

  // Chama uma ferramenta e devolve o JSON já parseado.
  async callTool(name, args = {}, { timeoutMs } = {}) {
    if (!this.allowedTools.has(name)) {
      throw new Error(`MCP tool not allowed (read-only client): ${name}`);
    }
    await this._acquire();
    try {
      const res = await this._request('tools/call', { name, arguments: args }, timeoutMs || this.callTimeoutMs);
      return parseToolResult(res);
    } finally {
      this._release();
    }
  }

  // ── internos ────────────────────────────────────────────────────────────────

  _acquire() {
    if (this.active < this.maxConcurrent) { this.active++; return Promise.resolve(); }
    return new Promise(resolve => this.queue.push(resolve));
  }

  _release() {
    const next = this.queue.shift();
    if (next) next(); else this.active = Math.max(0, this.active - 1);
  }

  _send(msg) {
    if (!this.proc || this.exited) throw new Error('MCP server is not running');
    this.proc.stdin.write(JSON.stringify(msg) + '\n');
  }

  _request(method, params, timeoutMs = this.callTimeoutMs) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request timed out after ${Math.round(timeoutMs / 1000)}s (${method})`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this._send({ jsonrpc: '2.0', id, method, params });
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e);
      }
    });
  }

  _onStdout(chunk) {
    this.buffer += chunk;
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      let msg;
      try { msg = JSON.parse(line); } catch (_) { this.emit('stderr', line); continue; }
      this._onMessage(msg);
    }
  }

  _onMessage(msg) {
    // Requisições do servidor (ex.: ping) — respondemos vazio para não travar o servidor
    if (msg.method && msg.id !== undefined) {
      try { this._send({ jsonrpc: '2.0', id: msg.id, result: {} }); } catch (_) {}
      return;
    }
    if (msg.method) { this.emit('notification', msg); return; }
    const entry = this.pending.get(msg.id);
    if (!entry) return;
    this.pending.delete(msg.id);
    clearTimeout(entry.timer);
    if (msg.error) entry.reject(new Error(`MCP error ${msg.error.code}: ${msg.error.message}`));
    else entry.resolve(msg.result);
  }

  _onExit(code, err) {
    if (this.exited) return;
    this.exited = true;
    this.ready  = false;
    const reason = err || new Error(`MCP server exited (code ${code})`);
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(reason);
    }
    this.pending.clear();
    this.queue.splice(0).forEach(resolve => resolve());
    this.active = 0;
    this.proc = null;
    this.emit('exit', code, err);
  }
}

function killProcessTree(pid) {
  if (process.platform !== 'win32') return;
  childProcess.spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
}

// Extrai o JSON do resultado de tools/call (structuredContent ou primeiro TextContent).
function parseToolResult(res) {
  if (!res) throw new Error('Empty MCP tool result');
  const text = (res.content || []).filter(c => c && c.type === 'text').map(c => c.text).join('');
  if (res.isError) {
    const err = new Error(`Service Now (MCP): ${text || 'tool error'}`);
    if (/browser session expired|re-authentication|mfa|login is currently in progress/i.test(text)) err.code = 'SN_AUTH';
    throw err;
  }
  if (res.structuredContent && typeof res.structuredContent === 'object') return res.structuredContent;
  try {
    return JSON.parse(text);
  } catch (_) {
    throw new Error(`Invalid MCP tool output: ${text.slice(0, 200)}`);
  }
}

module.exports = { McpClient, parseToolResult, killProcessTree, ALLOWED_TOOLS, PROTOCOL_VERSION };

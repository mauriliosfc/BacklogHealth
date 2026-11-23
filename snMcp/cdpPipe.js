// Cliente do Chrome DevTools Protocol (CDP) por pipe, sem dependências.
//
// O Edge iniciado com --remote-debugging-pipe lê comandos do descritor 3 e escreve respostas e
// eventos no descritor 4; cada mensagem é um JSON terminado em '\0'. É o mesmo transporte que o
// Playwright usa com channel=msedge, sem precisar dele nem de WebSocket.

const { spawn: nodeSpawn, execFile } = require('child_process');
const fs       = require('fs');
const nodePath = require('path');

const DEFAULT_CALL_TIMEOUT_MS = 30000;

// Conexão CDP sobre um par (escrita, leitura) de streams.
function createCdpConnection(writable, readable, { callTimeoutMs = DEFAULT_CALL_TIMEOUT_MS } = {}) {
  const pending   = new Map();
  const listeners = new Set();
  let nextId = 1;
  let buffer = '';
  let closed = null;   // motivo do encerramento

  readable.on('data', chunk => {
    buffer += chunk.toString('utf8');
    let i;
    while ((i = buffer.indexOf('\0')) >= 0) {
      const raw = buffer.slice(0, i);
      buffer = buffer.slice(i + 1);
      let msg;
      try { msg = JSON.parse(raw); } catch (_) { continue; }
      if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.error) {
          const err = new Error(`CDP ${p.method}: ${msg.error.message || 'error'}`);
          err.code = 'CDP_ERROR';
          p.reject(err);
        } else {
          p.resolve(msg.result || {});
        }
      } else if (msg.method) {
        listeners.forEach(fn => { try { fn(msg); } catch (_) {} });
      }
    }
  });

  function close(reason = 'closed') {
    if (closed) return;
    closed = reason;
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      const err = new Error(`CDP connection ${reason}`);
      err.code = 'CDP_CLOSED';
      p.reject(err);
    }
    pending.clear();
  }
  readable.on('end', () => close('ended'));
  readable.on('error', () => close('errored'));

  function send(method, params = {}, sessionId, { timeoutMs = callTimeoutMs } = {}) {
    if (closed) {
      const err = new Error(`CDP connection ${closed}`);
      err.code = 'CDP_CLOSED';
      return Promise.reject(err);
    }
    return new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        const err = new Error(`CDP ${method}: timeout after ${timeoutMs}ms`);
        err.code = 'CDP_TIMEOUT';
        reject(err);
      }, timeoutMs);
      if (timer.unref) timer.unref();
      pending.set(id, { resolve, reject, timer, method });
      const msg = { id, method, params };
      if (sessionId) msg.sessionId = sessionId;
      writable.write(JSON.stringify(msg) + '\0');
    });
  }

  function onEvent(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  return { send, onEvent, close, isClosed: () => !!closed };
}

// Caminho do msedge.exe: instalações por máquina (x86/x64) e por usuário.
function findEdge({ fsImpl = fs, env = process.env, platform = process.platform } = {}) {
  if (platform !== 'win32') return '';
  const rel = nodePath.join('Microsoft', 'Edge', 'Application', 'msedge.exe');
  const bases = [env['ProgramFiles(x86)'], env.ProgramFiles, env.LOCALAPPDATA, 'C:\\Program Files (x86)', 'C:\\Program Files'];
  for (const base of bases) {
    if (!base) continue;
    const p = nodePath.join(base, rel);
    try { if (fsImpl.existsSync(p)) return p; } catch (_) {}
  }
  return '';
}

function edgeArgs({ userDataDir, headless, url }) {
  return [
    `--user-data-dir=${nodePath.resolve(userDataDir)}`,   // relativo: o Edge abre e sai na hora
    '--remote-debugging-pipe',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-sync',
    ...(headless ? ['--headless=new'] : []),
    url || 'about:blank',
  ];
}

// Encerra a árvore de processos do Edge no Windows (o Edge às vezes segue vivo segurando o perfil
// depois de Browser.close — achado do spike de 2026-11-19).
function killTree(pid, { execFileImpl = execFile, platform = process.platform } = {}) {
  return new Promise(resolve => {
    if (!pid) return resolve();
    if (platform === 'win32') {
      execFileImpl('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => resolve());
    } else {
      try { process.kill(pid, 'SIGKILL'); } catch (_) {}
      resolve();
    }
  });
}

// Encerra processos do Edge que seguram ESTE perfil (sobras de uma sessão anterior, de uma queda
// ou do MCP antigo): um Edge novo no mesmo perfil entrega a vez ao processo existente e sai na hora.
// Só casa processos com o --user-data-dir do perfil — o Edge do próprio usuário não é tocado.
function killProfileProcesses(userDataDir, { execFileImpl = execFile, platform = process.platform } = {}) {
  return new Promise(resolve => {
    if (platform !== 'win32' || !userDataDir) return resolve(0);
    const needle = nodePath.resolve(userDataDir).replace(/'/g, "''");
    const script =
      "$n='" + needle + "'; $c=0; " +
      "Get-CimInstance Win32_Process -Filter \"Name='msedge.exe'\" | " +
      "Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf($n, [StringComparison]::OrdinalIgnoreCase) -ge 0 } | " +
      'ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; $c++ }; $c';
    execFileImpl('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 20000 },
      (err, stdout) => resolve(err ? 0 : (parseInt(String(stdout).trim(), 10) || 0)));
  });
}

// Inicia o Edge com o pipe CDP. Retorna { child, cdp, close() }.
function launchEdge({ exe, userDataDir, headless = false, url, spawnImpl = nodeSpawn, killTreeImpl = killTree, callTimeoutMs } = {}) {
  if (!exe) {
    const err = new Error('Microsoft Edge not found.');
    err.code = 'SN_EDGE_NOT_FOUND';
    throw err;
  }
  const child = spawnImpl(exe, edgeArgs({ userDataDir, headless, url }), {
    stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'],
    windowsHide: headless,
  });
  const cdp = createCdpConnection(child.stdio[3], child.stdio[4], { callTimeoutMs });
  let exited = false;
  const exitPromise = new Promise(resolve => child.once('exit', () => { exited = true; cdp.close('browser exited'); resolve(); }));
  child.once('error', () => cdp.close('spawn failed'));

  // Fecha com garantia: Browser.close, espera a saída e, se o processo continuar, mata a árvore.
  async function close({ graceMs = 3000 } = {}) {
    if (!exited) {
      cdp.send('Browser.close', {}, undefined, { timeoutMs: graceMs }).catch(() => {});
      await Promise.race([exitPromise, new Promise(r => { const t = setTimeout(r, graceMs); if (t.unref) t.unref(); })]);
    }
    if (!exited) await killTreeImpl(child.pid);
    cdp.close('closed');
  }

  return { child, cdp, close, hasExited: () => exited, exited: exitPromise };
}

module.exports = { createCdpConnection, findEdge, edgeArgs, launchEdge, killTree, killProfileProcesses };

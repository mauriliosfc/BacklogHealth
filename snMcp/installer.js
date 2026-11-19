// Provisiona o ambiente isolado do mfa-servicenow-mcp em <DATA_DIR>/sn-mcp:
//   1. baixa o uv (exe único) na versão fixa e confere o SHA-256
//   2. uv python install <versão>        → Python gerenciado, sem depender do Python do usuário
//   3. uv venv                            → ambiente virtual isolado
//   4. uv pip install mfa-servicenow-mcp==X playwright==Y  (versões fixas em mcp-version.json)
//   5. python -m playwright install chromium — SÓ no modo Chromium. O login usa o Microsoft Edge
//      do Windows (pyhooks/sitecustomize.py), então o Chromium (~715 MB) é baixado sob demanda.
// Ao trocar as versões em mcp-version.json (nova release do app), `needsUpdate()` fica true e
// `install()` refaz apenas os passos necessários (pacotes e, se o Playwright mudou, o Chromium).
//
// Runtime embutido: os EXEs trazem resources/sn-mcp-runtime/sn-mcp-runtime.zip (montado por
// scripts/build-sn-mcp-runtime.js) com Python + pacotes prontos. Quando ele existe e bate com
// mcp-version.json, a instalação é só extrair o zip em <root>/runtime — sem internet. O fluxo
// online acima fica como reserva (node server.js sem build, versão diferente).

const fs           = require('fs');
const nodePath     = require('path');
const https        = require('https');
const crypto       = require('crypto');
const childProcess = require('child_process');
const { SN_MCP_DIR } = require('../utils/paths');
const VERSIONS     = require('./mcp-version.json');

const STEPS = ['download_uv', 'python', 'venv', 'packages', 'browser'];
const BUNDLE_ZIP  = 'sn-mcp-runtime.zip';
const BUNDLE_META = 'runtime.json';

// O runtime embutido serve se foi montado com as mesmas versões que o app espera
function isRuntimeCurrent(meta, versions) {
  return !!meta
    && meta.mcp === versions.mcp
    && meta.playwright === versions.playwright
    && meta.python === versions.python;
}

// Onde procurar o runtime embutido: resources/ do Electron empacotado e build/ do repositório (dev)
function defaultBundleDirs() {
  const dirs = [];
  if (process.resourcesPath) dirs.push(nodePath.join(process.resourcesPath, 'sn-mcp-runtime'));
  dirs.push(nodePath.join(__dirname, '..', 'build', 'sn-mcp-runtime'));
  return dirs;
}

function buildPaths(root = SN_MCP_DIR) {
  const isWin = process.platform === 'win32';
  return {
    root,
    uvDir:      nodePath.join(root, 'uv'),
    uvExe:      nodePath.join(root, 'uv', isWin ? 'uv.exe' : 'uv'),
    uvZip:      nodePath.join(root, 'uv.zip'),
    uvCache:    nodePath.join(root, 'uv-cache'),
    pythonDir:  nodePath.join(root, 'python'),
    venv:       nodePath.join(root, 'venv'),
    venvPython: isWin ? nodePath.join(root, 'venv', 'Scripts', 'python.exe') : nodePath.join(root, 'venv', 'bin', 'python'),
    runtimeDir:    nodePath.join(root, 'runtime'),
    runtimeTmp:    nodePath.join(root, 'runtime.tmp'),
    runtimePython: nodePath.join(root, 'runtime', isWin ? 'python.exe' : nodePath.join('bin', 'python')),
    browsers:   nodePath.join(root, 'browsers'),
    session:    nodePath.join(root, 'session'),
    marker:     nodePath.join(root, 'installed.json'),
  };
}

// Variáveis de ambiente comuns a uv / pip / playwright (proxy corporativo incluso).
function buildToolEnv(paths, { caBundle } = {}) {
  const env = {
    UV_PYTHON_INSTALL_DIR:   paths.pythonDir,
    UV_CACHE_DIR:            paths.uvCache,
    UV_NATIVE_TLS:           '1',   // usa o repositório de certificados do Windows (ex.: Zscaler)
    UV_NO_CONFIG:            '1',
    PLAYWRIGHT_BROWSERS_PATH: paths.browsers,
    PYTHONUTF8:              '1',
  };
  if (caBundle) {
    env.SSL_CERT_FILE       = caBundle;
    env.REQUESTS_CA_BUNDLE  = caBundle;
    env.CURL_CA_BUNDLE      = caBundle;
    env.NODE_EXTRA_CA_CERTS = caBundle;
  }
  return env;
}

// ── Dependências padrão (substituíveis nos testes) ────────────────────────────

function _runCommand(cmd, args, { env, onLine } = {}) {
  return new Promise((resolve, reject) => {
    const proc = childProcess.spawn(cmd, args, { env: { ...process.env, ...env }, windowsHide: true });
    const tail = [];
    const onData = d => String(d).split(/\r?\n/).filter(Boolean).forEach(l => {
      tail.push(l); if (tail.length > 15) tail.shift();
      onLine?.(l);
    });
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('error', reject);
    proc.on('exit', code => {
      if (code === 0) resolve(tail.join('\n'));
      else reject(new Error(`${nodePath.basename(cmd)} ${args[0] || ''} failed (exit ${code}): ${tail.slice(-5).join(' | ')}`));
    });
  });
}

function _httpsDownload(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const go = (target, hops = 0) => {
      https.get(target, { headers: { 'User-Agent': 'BacklogHealth-SnMcp' } }, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && hops < 5) {
          res.resume();
          return go(res.headers.location, hops + 1);
        }
        if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
        const total = parseInt(res.headers['content-length'] || '0', 10);
        let received = 0;
        const out = fs.createWriteStream(dest);
        res.on('data', c => { received += c.length; if (total) onProgress?.(Math.round(received / total * 100)); });
        res.pipe(out);
        out.on('finish', () => out.close(() => resolve(dest)));
        out.on('error', reject);
        res.on('error', reject);
      }).on('error', reject);
    };
    go(url);
  });
}

// Fallback para redes corporativas: PowerShell usa o repositório de certificados do Windows.
async function _download(url, dest, onProgress) {
  try {
    return await _httpsDownload(url, dest, onProgress);
  } catch (e) {
    if (process.platform !== 'win32') throw e;
    const ps = `$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -UseBasicParsing -Uri '${url}' -OutFile '${dest.replace(/'/g, "''")}'`;
    await _runCommand('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps]);
    return dest;
  }
}

function _sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

// tar.exe (bsdtar) do Windows 10+ extrai .zip. Usa o caminho completo: com o Git Bash no PATH,
// "tar" resolve para o GNU tar, que interpreta "C:" como host remoto e falha.
function systemTarPath(env = process.env) {
  const root = env.SystemRoot || env.SYSTEMROOT || env.windir || 'C:\\Windows';
  return nodePath.join(root, 'System32', 'tar.exe');
}

// onLine (opcional): com o tar, recebe uma linha por arquivo extraído (-v) — usado no progresso
async function _extractZip(zip, destDir, { onLine } = {}) {
  const tar = systemTarPath();
  if (fs.existsSync(tar)) {
    try { return await _runCommand(tar, [onLine ? '-xvf' : '-xf', zip, '-C', destDir], { onLine }); } catch (_) { /* tenta o PowerShell */ }
  }
  const ps = `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`;
  return _runCommand('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps]);
}

function _findFile(dir, name) {
  if (!fs.existsSync(dir)) return null;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = nodePath.join(dir, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === name.toLowerCase()) return full;
    if (entry.isDirectory()) { const hit = _findFile(full, name); if (hit) return hit; }
  }
  return null;
}

const DEFAULT_DEPS = { fs, run: _runCommand, download: _download, sha256: _sha256, extractZip: _extractZip, findFile: _findFile };

// ── Instalador ────────────────────────────────────────────────────────────────

function createInstaller({ root, versions = VERSIONS, deps = {}, bundleDirs } = {}) {
  const d     = { ...DEFAULT_DEPS, ...deps };
  const paths = buildPaths(root);
  let status  = { running: false, step: null, stepIndex: 0, totalSteps: STEPS.length, progress: null, error: null, lastLine: '' };
  let current = null;
  let bundleCache;   // undefined = ainda não procurado; o conteúdo de resources/ não muda em execução

  function readMarker() {
    try { return JSON.parse(d.fs.readFileSync(paths.marker, 'utf8')); } catch (_) { return null; }
  }

  // { dir, zip, meta } do runtime embutido compatível, ou null
  function findBundledRuntime() {
    if (bundleCache !== undefined) return bundleCache;
    bundleCache = null;
    for (const dir of (bundleDirs || defaultBundleDirs())) {
      const zip = nodePath.join(dir, BUNDLE_ZIP);
      let meta = null;
      try { meta = JSON.parse(d.fs.readFileSync(nodePath.join(dir, BUNDLE_META), 'utf8')); } catch (_) { continue; }
      if (isRuntimeCurrent(meta, versions) && d.fs.existsSync(zip)) { bundleCache = { dir, zip, meta }; break; }
    }
    return bundleCache;
  }

  // Python que roda o MCP: o do runtime extraído ou o do venv (instalação online)
  function getPythonExe() {
    return readMarker()?.source === 'bundled' ? paths.runtimePython : paths.venvPython;
  }

  function isInstalled() {
    return !!readMarker() && d.fs.existsSync(getPythonExe());
  }

  // Chromium do Playwright presente (só é necessário no modo de login "Chromium")
  function hasChromium() {
    try { return d.fs.readdirSync(paths.browsers).some(n => /^chromium-\d+$/.test(n)); } catch (_) { return false; }
  }

  function needsUpdate() {
    const m = readMarker();
    if (!m) return false;
    return m.mcp !== versions.mcp || m.playwright !== versions.playwright;
  }

  function getInfo() {
    const m = readMarker();
    return {
      installed:        isInstalled(),
      needsUpdate:      needsUpdate(),
      installedVersion: m?.mcp || null,
      expectedVersion:  versions.mcp,
      hasChromium:      hasChromium(),
      bundled:          !!findBundledRuntime(),
      platformSupported: process.platform === 'win32',
      install:          { ...status },
    };
  }

  function _set(patch) { status = { ...status, ...patch }; }

  async function _step(name, fn, steps) {
    _set({ step: name, stepIndex: steps.indexOf(name) + 1, totalSteps: steps.length, progress: null, lastLine: '' });
    await fn();
  }

  // browser: 'edge' (padrão, sem Chromium) | 'chromium' (baixa o navegador do Playwright)
  // browserOnly: só o passo do navegador (componentes já instalados)
  async function _install({ caBundle, browser = 'edge', browserOnly = false } = {}) {
    if (process.platform !== 'win32' && !deps.allowAnyPlatform) {
      throw new Error('Automatic installation is only supported on Windows.');
    }
    const env    = buildToolEnv(paths, { caBundle });
    const onLine = l => _set({ lastLine: l.slice(0, 200) });
    const marker = readMarker();
    const fresh  = !marker || !d.fs.existsSync(getPythonExe());
    if (browserOnly && fresh) throw new Error('Service Now MCP components are not installed.');
    // Chromium entra se foi pedido agora ou se já estava instalado (para acompanhar a versão do Playwright)
    const wantChromium = browser === 'chromium' || marker?.chromium === true;
    const bundle = browserOnly ? null : findBundledRuntime();
    const steps = browserOnly ? ['browser']
      : bundle ? ['extract', ...(wantChromium ? ['browser'] : [])]
      : STEPS.filter(s => s !== 'browser' || wantChromium);
    _set({ totalSteps: steps.length });
    d.fs.mkdirSync(paths.root, { recursive: true });

    if (browserOnly) {
      await _step('browser', async () => {
        await d.run(getPythonExe(), ['-m', 'playwright', 'install', 'chromium'], { env, onLine });
      }, steps);
      d.fs.writeFileSync(paths.marker, JSON.stringify({ ...marker, chromium: true }, null, 2), 'utf8');
      return;
    }

    if (bundle) {
      await _step('extract', async () => {
        const total = Number(bundle.meta.fileCount) || 0;
        let done = 0;
        const onExtractLine = l => {
          done++;
          _set({ lastLine: l.slice(0, 200), ...(total ? { progress: Math.min(99, Math.round(done / total * 100)) } : {}) });
        };
        d.fs.rmSync(paths.runtimeTmp, { recursive: true, force: true });
        d.fs.mkdirSync(paths.runtimeTmp, { recursive: true });
        try {
          await d.extractZip(bundle.zip, paths.runtimeTmp, { onLine: onExtractLine });
          if (!d.fs.existsSync(nodePath.join(paths.runtimeTmp, nodePath.basename(paths.runtimePython)))) {
            throw new Error('Bundled runtime is incomplete (python executable missing)');
          }
          d.fs.rmSync(paths.runtimeDir, { recursive: true, force: true });
          d.fs.renameSync(paths.runtimeTmp, paths.runtimeDir);
        } catch (e) {
          d.fs.rmSync(paths.runtimeTmp, { recursive: true, force: true });
          throw e;
        }
      }, steps);

      if (wantChromium) {
        await _step('browser', async () => {
          if (hasChromium() && marker?.playwright === versions.playwright) return;
          await d.run(paths.runtimePython, ['-m', 'playwright', 'install', 'chromium'], { env, onLine });
        }, steps);
      }

      d.fs.writeFileSync(paths.marker, JSON.stringify({
        mcp: versions.mcp, playwright: versions.playwright, python: versions.python,
        source: 'bundled', chromium: wantChromium, installedAt: new Date().toISOString(),
      }, null, 2), 'utf8');
      return;
    }

    await _step('download_uv', async () => {
      if (d.fs.existsSync(paths.uvExe) && marker?.uv === versions.uv.version) return;
      const url = `https://github.com/astral-sh/uv/releases/download/${versions.uv.version}/${versions.uv.asset}`;
      await d.download(url, paths.uvZip, pct => _set({ progress: pct }));
      const hash = d.sha256(paths.uvZip);
      if (hash !== versions.uv.sha256) {
        d.fs.rmSync(paths.uvZip, { force: true });
        throw new Error('uv download checksum mismatch');
      }
      d.fs.rmSync(paths.uvDir, { recursive: true, force: true });
      d.fs.mkdirSync(paths.uvDir, { recursive: true });
      await d.extractZip(paths.uvZip, paths.uvDir);
      const found = d.findFile(paths.uvDir, nodePath.basename(paths.uvExe));
      if (!found) throw new Error('uv executable not found after extraction');
      if (found !== paths.uvExe) d.fs.copyFileSync(found, paths.uvExe);
      d.fs.rmSync(paths.uvZip, { force: true });
    }, steps);

    await _step('python', async () => {
      if (!fresh && marker?.python === versions.python) return;
      await d.run(paths.uvExe, ['python', 'install', versions.python], { env, onLine });
    }, steps);

    await _step('venv', async () => {
      if (!fresh && marker?.python === versions.python) return;
      await d.run(paths.uvExe, ['venv', paths.venv, '--python', versions.python, '--python-preference', 'only-managed', '--clear'], { env, onLine });
    }, steps);

    await _step('packages', async () => {
      if (!fresh && marker?.mcp === versions.mcp && marker?.playwright === versions.playwright) return;
      await d.run(paths.uvExe, ['pip', 'install', '--python', paths.venvPython,
        `mfa-servicenow-mcp==${versions.mcp}`, `playwright==${versions.playwright}`], { env, onLine });
    }, steps);

    if (wantChromium) {
      await _step('browser', async () => {
        if (hasChromium() && !fresh && marker?.playwright === versions.playwright) return;
        await d.run(paths.venvPython, ['-m', 'playwright', 'install', 'chromium'], { env, onLine });
      }, steps);
    }

    d.fs.writeFileSync(paths.marker, JSON.stringify({
      mcp: versions.mcp, playwright: versions.playwright, python: versions.python,
      uv: versions.uv.version, chromium: wantChromium, installedAt: new Date().toISOString(),
    }, null, 2), 'utf8');
  }

  // Single-flight: chamadas concorrentes reaproveitam a instalação em andamento.
  function install(opts = {}) {
    if (current) return current;
    _set({ running: true, error: null, step: null, stepIndex: 0, progress: null });
    current = _install(opts)
      .then(() => { _set({ running: false, step: 'done', stepIndex: status.totalSteps, progress: 100 }); })
      .catch(e => { _set({ running: false, error: e.message }); throw e; })
      .finally(() => { current = null; });
    return current;
  }

  // Baixa só o Chromium (usuário escolheu "Chromium" como navegador de login)
  function installBrowser(opts = {}) {
    return install({ ...opts, browser: 'chromium', browserOnly: true });
  }

  function getStatus() { return { ...status }; }

  return { paths, versions, isInstalled, hasChromium, needsUpdate, getInfo, install, installBrowser, getStatus, readMarker, findBundledRuntime, getPythonExe };
}

const defaultInstaller = createInstaller();

module.exports = { STEPS, BUNDLE_ZIP, BUNDLE_META, buildPaths, buildToolEnv, createInstaller, systemTarPath, isRuntimeCurrent, defaultBundleDirs, installer: defaultInstaller, DEFAULT_DEPS };

// Monta o runtime do login SSO (Python + mfa-servicenow-mcp + Playwright) que vai embutido nos EXEs.
// Saída: build/sn-mcp-runtime/{sn-mcp-runtime.zip, runtime.json} — empacotado via build.extraResources.
// No primeiro uso do modo SSO o app só extrai esse zip (snMcp/installer.js), sem internet.
//
// Os pacotes são instalados direto no site-packages de um Python standalone (sem venv), então a
// pasta é relocável: pode ser extraída em qualquer %APPDATA%. Só refaz quando as versões de
// snMcp/mcp-version.json mudam.

const fs       = require('fs');
const nodePath = require('path');
const { DEFAULT_DEPS: d, systemTarPath, buildToolEnv, isRuntimeCurrent,
        BUNDLE_ZIP: ZIP_NAME, BUNDLE_META: META } = require('../snMcp/installer');

const ROOT     = nodePath.join(__dirname, '..');
const OUT_DIR  = nodePath.join(ROOT, 'build', 'sn-mcp-runtime');
const STAGE    = nodePath.join(ROOT, 'build', '.sn-mcp-runtime-stage');

// Pastas/arquivos sem uso no runtime (relativos à raiz do Python)
const PRUNE = [
  'Lib/test', 'Lib/idlelib', 'Lib/tkinter', 'Lib/turtledemo', 'Lib/ensurepip',
  'tcl', 'DLLs/_tkinter.pyd', 'DLLs/tcl86t.dll', 'DLLs/tk86t.dll',
  'Scripts', // launchers de console com caminho absoluto do staging — o app roda "python -m"
];

// Caminhos existentes a remover dentro do runtime: lista fixa + pip no site-packages
function pruneTargets(dir, fsImpl = fs) {
  const out = PRUNE.map(p => nodePath.join(dir, ...p.split('/'))).filter(p => fsImpl.existsSync(p));
  const site = nodePath.join(dir, 'Lib', 'site-packages');
  if (fsImpl.existsSync(site)) {
    for (const name of fsImpl.readdirSync(site)) {
      if (/^pip(-[\d.]+\.dist-info)?$/i.test(name)) out.push(nodePath.join(site, name));
    }
  }
  return out;
}

function countFiles(dir) {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    n += e.isDirectory() ? countFiles(nodePath.join(dir, e.name)) : 1;
  }
  return n;
}

function readMeta(dir = OUT_DIR) {
  try { return JSON.parse(fs.readFileSync(nodePath.join(dir, META), 'utf8')); } catch (_) { return null; }
}

async function build({ force = false, log = console.log } = {}) {
  const versions = require('../snMcp/mcp-version.json');
  const zipPath = nodePath.join(OUT_DIR, ZIP_NAME);

  if (!force && isRuntimeCurrent(readMeta(), versions) && fs.existsSync(zipPath)) {
    log(`[sn-mcp-runtime] já atualizado (mcp ${versions.mcp}) — nada a fazer`);
    return readMeta();
  }
  if (process.platform !== 'win32') throw new Error('O runtime do SSO só é montado no Windows.');

  const t0 = Date.now();
  fs.rmSync(STAGE, { recursive: true, force: true });
  fs.mkdirSync(STAGE, { recursive: true });
  const paths = {
    pythonDir: nodePath.join(STAGE, 'pythons'),
    uvCache:   nodePath.join(STAGE, 'uv-cache'),
    browsers:  nodePath.join(STAGE, 'browsers'),
  };
  const env = buildToolEnv(paths);
  const runtime = nodePath.join(STAGE, 'runtime');

  log('[sn-mcp-runtime] baixando uv…');
  const uvZip = nodePath.join(STAGE, 'uv.zip');
  const uvDir = nodePath.join(STAGE, 'uv');
  await d.download(`https://github.com/astral-sh/uv/releases/download/${versions.uv.version}/${versions.uv.asset}`, uvZip);
  if (d.sha256(uvZip) !== versions.uv.sha256) throw new Error('uv download checksum mismatch');
  fs.mkdirSync(uvDir, { recursive: true });
  await d.extractZip(uvZip, uvDir);
  const uvExe = d.findFile(uvDir, 'uv.exe');
  if (!uvExe) throw new Error('uv.exe not found after extraction');

  log(`[sn-mcp-runtime] instalando Python ${versions.python}…`);
  await d.run(uvExe, ['python', 'install', versions.python], { env });
  const found = (await d.run(uvExe, ['python', 'find', versions.python, '--python-preference', 'only-managed'], { env }))
    .split(/\r?\n/).map(s => s.trim()).filter(Boolean).pop();
  if (!found || !fs.existsSync(found)) throw new Error(`Python ${versions.python} not found after install`);
  // Copia o Python gerenciado (resolvendo links) para uma pasta própria, que vira o runtime
  fs.cpSync(nodePath.dirname(fs.realpathSync(found)), runtime, { recursive: true, dereference: true });
  const python = nodePath.join(runtime, 'python.exe');

  log('[sn-mcp-runtime] instalando pacotes…');
  await d.run(uvExe, ['pip', 'install', '--python', python, '--break-system-packages', '--compile-bytecode',
    `mfa-servicenow-mcp==${versions.mcp}`, `playwright==${versions.playwright}`], { env });

  for (const p of pruneTargets(runtime)) fs.rmSync(p, { recursive: true, force: true });

  // Sanidade: o pacote importa a partir da pasta montada
  await d.run(python, ['-c', 'import servicenow_mcp, playwright, win32api; print("ok")'], { env: { PYTHONUTF8: '1' } });

  log('[sn-mcp-runtime] compactando…');
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await d.run(systemTarPath(), ['-a', '-c', '-f', zipPath, '-C', runtime, '.']);

  const meta = {
    mcp: versions.mcp, playwright: versions.playwright, python: versions.python,
    fileCount: countFiles(runtime), sha256: d.sha256(zipPath), size: fs.statSync(zipPath).size,
    builtAt: new Date().toISOString(),
  };
  fs.writeFileSync(nodePath.join(OUT_DIR, META), JSON.stringify(meta, null, 2), 'utf8');
  fs.rmSync(STAGE, { recursive: true, force: true });
  log(`[sn-mcp-runtime] pronto: ${(meta.size / 1048576).toFixed(0)} MB, ${meta.fileCount} arquivos, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  return meta;
}

if (require.main === module) {
  build({ force: process.argv.includes('--force') }).catch(e => {
    console.error('[sn-mcp-runtime] falhou:', e.message);
    process.exit(1);
  });
}

module.exports = { build, isRuntimeCurrent, pruneTargets, readMeta, OUT_DIR, ZIP_NAME, META };

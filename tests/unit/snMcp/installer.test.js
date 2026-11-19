const nodePath = require('path');
const { createInstaller, buildPaths, buildToolEnv, systemTarPath, STEPS, BUNDLE_ZIP, BUNDLE_META, isRuntimeCurrent } = require('../../../snMcp/installer');

const VERSIONS = {
  mcp: '1.25.48', playwright: '1.64.1', python: '3.12',
  uv: { version: '0.13.7', asset: 'uv-x86_64-pc-windows-msvc.zip', sha256: 'abc123' },
};
const ROOT = nodePath.join('C:', 'data', 'sn-mcp');

// Sistema de arquivos em memória com o mínimo usado pelo instalador.
function makeFs(initial = {}) {
  const files = new Map(Object.entries(initial));
  return {
    files,
    existsSync:   p => files.has(p),
    readFileSync: p => { if (!files.has(p)) throw new Error('ENOENT'); return files.get(p); },
    writeFileSync: (p, c) => files.set(p, c),
    mkdirSync:    () => {},
    // remove o caminho e tudo abaixo dele (pastas simuladas pelas chaves com prefixo)
    rmSync:       p => { for (const k of [...files.keys()]) if (k === p || k.startsWith(p + nodePath.sep)) files.delete(k); },
    renameSync:   (a, b) => {
      for (const k of [...files.keys()]) {
        if (k === a || k.startsWith(a + nodePath.sep)) { files.set(b + k.slice(a.length), files.get(k)); files.delete(k); }
      }
    },
    copyFileSync: (a, b) => files.set(b, files.get(a)),
    // lista os nomes imediatamente abaixo de `dir` (pastas simuladas pelas chaves com prefixo)
    readdirSync:  dir => {
      const pre = dir.endsWith(nodePath.sep) ? dir : dir + nodePath.sep;
      const names = [...files.keys()].filter(k => k.startsWith(pre)).map(k => k.slice(pre.length).split(nodePath.sep)[0]);
      if (!names.length) throw new Error('ENOENT');
      return [...new Set(names)];
    },
  };
}

function makeDeps(fsMock, overrides = {}) {
  const paths = buildPaths(ROOT);
  const run = jest.fn(async (cmd, args) => {
    if (args[0] === 'venv') fsMock.files.set(paths.venvPython, 'python');
    if (args[1] === 'playwright') fsMock.files.set(nodePath.join(paths.browsers, 'chromium-1248', 'chrome.exe'), 'x');
    return '';
  });
  return {
    fs: fsMock,
    run,
    download:   jest.fn(async (url, dest) => { fsMock.files.set(dest, 'zip'); }),
    sha256:     jest.fn(() => VERSIONS.uv.sha256),
    extractZip: jest.fn(async () => { fsMock.files.set(paths.uvExe, 'uv'); }),
    findFile:   jest.fn(() => paths.uvExe),
    allowAnyPlatform: true,
    ...overrides,
  };
}

function marker(extra = {}) {
  return JSON.stringify({ mcp: VERSIONS.mcp, playwright: VERSIONS.playwright, python: VERSIONS.python, uv: VERSIONS.uv.version, ...extra });
}

describe('installer — instalação completa', () => {
  test('executa os passos na ordem com versões fixas, sem baixar o Chromium (login usa o Edge)', async () => {
    const fsMock = makeFs();
    const deps   = makeDeps(fsMock);
    const inst   = createInstaller({ root: ROOT, versions: VERSIONS, deps });

    await inst.install();

    expect(deps.download).toHaveBeenCalledWith(
      'https://github.com/astral-sh/uv/releases/download/0.13.7/uv-x86_64-pc-windows-msvc.zip',
      inst.paths.uvZip, expect.any(Function));
    const cmds = deps.run.mock.calls.map(([cmd, args]) => [nodePath.basename(cmd), args.slice(0, 2).join(' ')]);
    expect(cmds).toEqual([
      [nodePath.basename(inst.paths.uvExe), 'python install'],
      [nodePath.basename(inst.paths.uvExe), `venv ${inst.paths.venv}`],
      [nodePath.basename(inst.paths.uvExe), `pip install`],
    ]);
    const pipArgs = deps.run.mock.calls[2][1];
    expect(pipArgs).toEqual(expect.arrayContaining(['mfa-servicenow-mcp==1.25.48', 'playwright==1.64.1']));
    expect(inst.isInstalled()).toBe(true);
    expect(JSON.parse(fsMock.files.get(inst.paths.marker))).toMatchObject({ mcp: '1.25.48', playwright: '1.64.1', chromium: false });
    expect(inst.getStatus()).toMatchObject({ running: false, step: 'done', error: null, stepIndex: STEPS.length - 1, totalSteps: STEPS.length - 1 });
    expect(inst.hasChromium()).toBe(false);
  });

  test('checksum diferente aborta a instalação', async () => {
    const fsMock = makeFs();
    const deps   = makeDeps(fsMock, { sha256: jest.fn(() => 'outro-hash') });
    const inst   = createInstaller({ root: ROOT, versions: VERSIONS, deps });

    await expect(inst.install()).rejects.toThrow(/checksum/);
    expect(deps.run).not.toHaveBeenCalled();
    expect(inst.getStatus()).toMatchObject({ running: false, error: expect.stringMatching(/checksum/) });
    expect(inst.isInstalled()).toBe(false);
  });

  test('falha de um comando fica registrada no status', async () => {
    const fsMock = makeFs();
    const deps   = makeDeps(fsMock, { run: jest.fn(async () => { throw new Error('uv python failed (exit 1)'); }) });
    const inst   = createInstaller({ root: ROOT, versions: VERSIONS, deps });

    await expect(inst.install()).rejects.toThrow(/exit 1/);
    expect(inst.getStatus()).toMatchObject({ step: 'python', error: expect.stringMatching(/exit 1/) });
  });

  test('install é single-flight', async () => {
    const fsMock = makeFs();
    const deps   = makeDeps(fsMock);
    const inst   = createInstaller({ root: ROOT, versions: VERSIONS, deps });

    await Promise.all([inst.install(), inst.install()]);
    expect(deps.download).toHaveBeenCalledTimes(1);
  });
});

describe('installer — atualização', () => {
  function installedFs(paths, markerJson) {
    return makeFs({ [paths.venvPython]: 'python', [paths.uvExe]: 'uv', [paths.marker]: markerJson });
  }

  test('nova versão do MCP reinstala só os pacotes', async () => {
    const paths  = buildPaths(ROOT);
    const fsMock = installedFs(paths, marker({ mcp: '1.25.40' }));
    const deps   = makeDeps(fsMock);
    const inst   = createInstaller({ root: ROOT, versions: VERSIONS, deps });

    expect(inst.needsUpdate()).toBe(true);
    await inst.install();

    expect(deps.download).not.toHaveBeenCalled();
    expect(deps.run).toHaveBeenCalledTimes(1);
    expect(deps.run.mock.calls[0][1].slice(0, 2)).toEqual(['pip', 'install']);
    expect(inst.needsUpdate()).toBe(false);
  });

  test('nova versão do Playwright sem Chromium instalado: só reinstala os pacotes', async () => {
    const paths  = buildPaths(ROOT);
    const fsMock = installedFs(paths, marker({ playwright: '1.60.0' }));
    const deps   = makeDeps(fsMock);
    const inst   = createInstaller({ root: ROOT, versions: VERSIONS, deps });

    await inst.install();
    expect(deps.run.mock.calls.map(c => c[1][0])).toEqual(['pip']);
  });

  test('nova versão do Playwright com Chromium instalado: baixa o Chromium de novo', async () => {
    const paths  = buildPaths(ROOT);
    const fsMock = installedFs(paths, marker({ playwright: '1.60.0', chromium: true }));
    const deps   = makeDeps(fsMock);
    const inst   = createInstaller({ root: ROOT, versions: VERSIONS, deps });

    await inst.install();
    expect(deps.run.mock.calls.map(c => c[1][0])).toEqual(['pip', '-m']);
  });

  test('getInfo informa versão instalada e esperada', () => {
    const paths  = buildPaths(ROOT);
    const fsMock = installedFs(paths, marker({ mcp: '1.20.0' }));
    const inst   = createInstaller({ root: ROOT, versions: VERSIONS, deps: makeDeps(fsMock) });
    expect(inst.getInfo()).toMatchObject({ installed: true, needsUpdate: true, installedVersion: '1.20.0', expectedVersion: '1.25.48' });
  });

  test('sem marcador: não instalado e sem atualização pendente', () => {
    const inst = createInstaller({ root: ROOT, versions: VERSIONS, deps: makeDeps(makeFs()) });
    expect(inst.isInstalled()).toBe(false);
    expect(inst.needsUpdate()).toBe(false);
  });
});

describe('buildToolEnv', () => {
  test('isola python, cache e navegadores dentro da pasta do app', () => {
    const paths = buildPaths(ROOT);
    const env   = buildToolEnv(paths);
    expect(env).toMatchObject({
      UV_PYTHON_INSTALL_DIR: paths.pythonDir,
      UV_CACHE_DIR: paths.uvCache,
      PLAYWRIGHT_BROWSERS_PATH: paths.browsers,
      UV_NATIVE_TLS: '1',
    });
    expect(env).not.toHaveProperty('SSL_CERT_FILE');
  });

  test('aplica CA bundle corporativo em todas as ferramentas', () => {
    const env = buildToolEnv(buildPaths(ROOT), { caBundle: 'C:/ca.pem' });
    expect(env).toMatchObject({ SSL_CERT_FILE: 'C:/ca.pem', REQUESTS_CA_BUNDLE: 'C:/ca.pem', CURL_CA_BUNDLE: 'C:/ca.pem', NODE_EXTRA_CA_CERTS: 'C:/ca.pem' });
  });
});

test('mcp-version.json real tem versões fixas e checksum do uv', () => {
  const real = require('../../../snMcp/mcp-version.json');
  expect(real.mcp).toMatch(/^\d+\.\d+\.\d+$/);
  expect(real.playwright).toMatch(/^\d+\.\d+\.\d+$/);
  expect(real.uv.sha256).toMatch(/^[a-f0-9]{64}$/);
});

describe('installer — Chromium sob demanda', () => {
  function installedFs(paths, markerJson, extra = {}) {
    return makeFs({ [paths.venvPython]: 'python', [paths.uvExe]: 'uv', [paths.marker]: markerJson, ...extra });
  }

  test('instalação no modo Chromium inclui o passo do navegador', async () => {
    const fsMock = makeFs();
    const deps   = makeDeps(fsMock);
    const inst   = createInstaller({ root: ROOT, versions: VERSIONS, deps });

    await inst.install({ browser: 'chromium' });

    expect(deps.run.mock.calls.map(c => c[1].slice(0, 2).join(' ')).pop()).toBe('-m playwright');
    expect(inst.hasChromium()).toBe(true);
    expect(JSON.parse(fsMock.files.get(inst.paths.marker)).chromium).toBe(true);
    expect(inst.getStatus().totalSteps).toBe(STEPS.length);
  });

  test('installBrowser baixa só o Chromium e marca no installed.json', async () => {
    const paths  = buildPaths(ROOT);
    const fsMock = installedFs(paths, marker());
    const deps   = makeDeps(fsMock);
    const inst   = createInstaller({ root: ROOT, versions: VERSIONS, deps });

    expect(inst.hasChromium()).toBe(false);
    await inst.installBrowser();

    expect(deps.run).toHaveBeenCalledTimes(1);
    expect(deps.run.mock.calls[0][1]).toEqual(['-m', 'playwright', 'install', 'chromium']);
    expect(deps.download).not.toHaveBeenCalled();
    expect(inst.hasChromium()).toBe(true);
    expect(JSON.parse(fsMock.files.get(paths.marker))).toMatchObject({ mcp: VERSIONS.mcp, chromium: true });
    expect(inst.getStatus()).toMatchObject({ running: false, step: 'done', stepIndex: 1, totalSteps: 1 });
  });

  test('installBrowser sem componentes instalados falha com erro claro', async () => {
    const inst = createInstaller({ root: ROOT, versions: VERSIONS, deps: makeDeps(makeFs()) });
    await expect(inst.installBrowser()).rejects.toThrow(/not installed/);
  });

  test('getInfo expõe se o Chromium está presente (instalações antigas já têm a pasta)', () => {
    const paths  = buildPaths(ROOT);
    const fsMock = installedFs(paths, marker(), { [nodePath.join(paths.browsers, 'chromium-1248', 'chrome.exe')]: 'x' });
    const inst   = createInstaller({ root: ROOT, versions: VERSIONS, deps: makeDeps(fsMock) });
    expect(inst.getInfo().hasChromium).toBe(true);
  });
});

describe('installer — runtime embutido no app', () => {
  const BUNDLE = nodePath.join('C:', 'app', 'resources', 'sn-mcp-runtime');
  const ZIP    = nodePath.join(BUNDLE, BUNDLE_ZIP);
  const meta   = (extra = {}) => JSON.stringify({ mcp: VERSIONS.mcp, playwright: VERSIONS.playwright, python: VERSIONS.python, fileCount: 4, ...extra });

  function bundleFs(extra = {}, metaJson = meta()) {
    return makeFs({ [ZIP]: 'zip', [nodePath.join(BUNDLE, BUNDLE_META)]: metaJson, ...extra });
  }

  // extrai "4 arquivos" com uma linha de log por arquivo, como o tar -v
  function bundleDeps(fsMock, overrides = {}) {
    const paths = buildPaths(ROOT);
    return makeDeps(fsMock, {
      extractZip: jest.fn(async (zip, dest, { onLine } = {}) => {
        ['python.exe', 'python312.dll', 'Lib/os.py', 'Lib/site-packages/servicenow_mcp/__init__.py'].forEach(f => {
          fsMock.files.set(nodePath.join(dest, ...f.split('/')), 'x');
          onLine?.(`x ${f}`);
        });
      }),
      ...overrides,
    });
  }

  test('com o runtime embutido, instalar é só extrair — sem internet e sem uv', async () => {
    const fsMock = bundleFs();
    const deps   = bundleDeps(fsMock);
    const inst   = createInstaller({ root: ROOT, versions: VERSIONS, deps, bundleDirs: [BUNDLE] });

    expect(inst.getInfo().bundled).toBe(true);
    await inst.install();

    expect(deps.download).not.toHaveBeenCalled();
    expect(deps.run).not.toHaveBeenCalled();
    expect(deps.extractZip).toHaveBeenCalledWith(ZIP, inst.paths.runtimeTmp, expect.objectContaining({ onLine: expect.any(Function) }));
    expect(fsMock.files.has(inst.paths.runtimePython)).toBe(true);
    expect([...fsMock.files.keys()].some(k => k.startsWith(inst.paths.runtimeTmp))).toBe(false);
    expect(JSON.parse(fsMock.files.get(inst.paths.marker))).toMatchObject({ mcp: VERSIONS.mcp, source: 'bundled', chromium: false });
    expect(inst.getPythonExe()).toBe(inst.paths.runtimePython);
    expect(inst.isInstalled()).toBe(true);
    expect(inst.getStatus()).toMatchObject({ running: false, step: 'done', stepIndex: 1, totalSteps: 1, error: null });
  });

  test('progresso da extração segue os arquivos extraídos', async () => {
    const fsMock = bundleFs({}, meta({ fileCount: 8 }));
    const seen   = [];
    let inst;
    const deps = bundleDeps(fsMock);
    const realExtract = deps.extractZip.getMockImplementation();
    deps.extractZip.mockImplementation(async (zip, dest, opts) => {
      await realExtract(zip, dest, { onLine: l => { opts.onLine(l); seen.push(inst.getStatus().progress); } });
    });
    inst = createInstaller({ root: ROOT, versions: VERSIONS, deps, bundleDirs: [BUNDLE] });
    await inst.install();
    expect(seen).toEqual([13, 25, 38, 50]);
    expect(inst.getStatus()).toMatchObject({ step: 'done', progress: 100 });
  });

  test('falha na extração não deixa runtime pela metade', async () => {
    const fsMock = bundleFs();
    const deps   = bundleDeps(fsMock, { extractZip: jest.fn(async (zip, dest) => {
      fsMock.files.set(nodePath.join(dest, 'python.exe'), 'x');
      throw new Error('tar -xf failed');
    }) });
    const inst = createInstaller({ root: ROOT, versions: VERSIONS, deps, bundleDirs: [BUNDLE] });

    await expect(inst.install()).rejects.toThrow(/tar -xf failed/);
    const keys = [...fsMock.files.keys()];
    expect(keys.some(k => k.startsWith(inst.paths.runtimeTmp) || k.startsWith(inst.paths.runtimeDir + nodePath.sep))).toBe(false);
    expect(fsMock.files.has(inst.paths.marker)).toBe(false);
    expect(inst.isInstalled()).toBe(false);
    expect(inst.getStatus()).toMatchObject({ step: 'extract', error: expect.stringMatching(/tar/) });
  });

  test('zip sem o python.exe é rejeitado', async () => {
    const fsMock = bundleFs();
    const deps   = bundleDeps(fsMock, { extractZip: jest.fn(async () => {}) });
    const inst   = createInstaller({ root: ROOT, versions: VERSIONS, deps, bundleDirs: [BUNDLE] });
    await expect(inst.install()).rejects.toThrow(/incomplete/);
    expect(inst.isInstalled()).toBe(false);
  });

  test('runtime embutido de outra versão é ignorado: segue a instalação online', async () => {
    const fsMock = bundleFs({}, meta({ mcp: '1.0.0' }));
    const deps   = bundleDeps(fsMock);
    const inst   = createInstaller({ root: ROOT, versions: VERSIONS, deps, bundleDirs: [BUNDLE] });

    expect(inst.getInfo().bundled).toBe(false);
    await inst.install();
    expect(deps.download).toHaveBeenCalled();
    expect(inst.getPythonExe()).toBe(inst.paths.venvPython);
    expect(JSON.parse(fsMock.files.get(inst.paths.marker)).source).toBeUndefined();
  });

  test('sem o zip ao lado do runtime.json, não usa o runtime embutido', () => {
    const fsMock = makeFs({ [nodePath.join(BUNDLE, BUNDLE_META)]: meta() });
    const inst   = createInstaller({ root: ROOT, versions: VERSIONS, deps: makeDeps(fsMock), bundleDirs: [BUNDLE] });
    expect(inst.findBundledRuntime()).toBeNull();
  });

  test('usa a primeira pasta candidata que tiver runtime compatível', () => {
    const other  = nodePath.join('C:', 'repo', 'build', 'sn-mcp-runtime');
    const fsMock = makeFs({ [nodePath.join(other, BUNDLE_ZIP)]: 'zip', [nodePath.join(other, BUNDLE_META)]: meta() });
    const inst   = createInstaller({ root: ROOT, versions: VERSIONS, deps: makeDeps(fsMock), bundleDirs: [BUNDLE, other] });
    expect(inst.findBundledRuntime()).toMatchObject({ dir: other, zip: nodePath.join(other, BUNDLE_ZIP) });
  });

  test('instalação online existente continua usando o venv', () => {
    const paths  = buildPaths(ROOT);
    const fsMock = bundleFs({ [paths.venvPython]: 'python', [paths.marker]: marker() });
    const inst   = createInstaller({ root: ROOT, versions: VERSIONS, deps: bundleDeps(fsMock), bundleDirs: [BUNDLE] });
    expect(inst.getPythonExe()).toBe(paths.venvPython);
    expect(inst.isInstalled()).toBe(true);
    expect(inst.needsUpdate()).toBe(false);
  });

  test('modo Chromium com runtime embutido: extrai e baixa o navegador com o python do runtime', async () => {
    const fsMock = bundleFs();
    const deps   = bundleDeps(fsMock);
    const inst   = createInstaller({ root: ROOT, versions: VERSIONS, deps, bundleDirs: [BUNDLE] });

    await inst.install({ browser: 'chromium' });
    expect(deps.run).toHaveBeenCalledTimes(1);
    expect(deps.run.mock.calls[0]).toEqual([inst.paths.runtimePython, ['-m', 'playwright', 'install', 'chromium'], expect.any(Object)]);
    expect(JSON.parse(fsMock.files.get(inst.paths.marker))).toMatchObject({ source: 'bundled', chromium: true });
    expect(inst.getStatus().totalSteps).toBe(2);
  });

  test('installBrowser depois do runtime embutido usa o python do runtime', async () => {
    const paths  = buildPaths(ROOT);
    const fsMock = bundleFs({ [paths.runtimePython]: 'x', [paths.marker]: marker({ source: 'bundled' }) });
    const deps   = bundleDeps(fsMock);
    const inst   = createInstaller({ root: ROOT, versions: VERSIONS, deps, bundleDirs: [BUNDLE] });

    await inst.installBrowser();
    expect(deps.run.mock.calls[0][0]).toBe(paths.runtimePython);
    expect(JSON.parse(fsMock.files.get(paths.marker))).toMatchObject({ source: 'bundled', chromium: true });
  });

  test('isRuntimeCurrent compara mcp, playwright e python', () => {
    expect(isRuntimeCurrent(JSON.parse(meta()), VERSIONS)).toBe(true);
    expect(isRuntimeCurrent(JSON.parse(meta({ playwright: '1.0.0' })), VERSIONS)).toBe(false);
    expect(isRuntimeCurrent(JSON.parse(meta({ python: '3.11' })), VERSIONS)).toBe(false);
    expect(isRuntimeCurrent(null, VERSIONS)).toBe(false);
  });
});

describe('systemTarPath', () => {
  test('usa o tar.exe do Windows (não o GNU tar do Git Bash)', () => {
    expect(systemTarPath({ SystemRoot: 'C:\Windows' })).toBe(nodePath.join('C:\Windows', 'System32', 'tar.exe'));
    expect(systemTarPath({ windir: 'D:\Win' })).toBe(nodePath.join('D:\Win', 'System32', 'tar.exe'));
  });
});

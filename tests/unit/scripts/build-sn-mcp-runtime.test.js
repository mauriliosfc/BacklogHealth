const fs       = require('fs');
const os       = require('os');
const nodePath = require('path');
const { pruneTargets, isRuntimeCurrent, readMeta } = require('../../../scripts/build-sn-mcp-runtime');

describe('build-sn-mcp-runtime — pruneTargets', () => {
  let dir;
  const touch = rel => {
    const p = nodePath.join(dir, ...rel.split('/'));
    fs.mkdirSync(nodePath.dirname(p), { recursive: true });
    fs.writeFileSync(p, 'x');
  };

  beforeEach(() => { dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'snrt-')); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('remove testes, IDLE, Tk, pip e launchers; mantém o resto', () => {
    ['python.exe', 'Lib/os.py', 'Lib/test/test_os.py', 'Lib/idlelib/idle.py', 'Lib/tkinter/__init__.py',
     'tcl/tcl8.6/init.tcl', 'DLLs/_tkinter.pyd', 'DLLs/_ssl.pyd', 'Scripts/playwright.exe',
     'Lib/site-packages/pip/__init__.py', 'Lib/site-packages/pip-25.0.dist-info/METADATA',
     'Lib/site-packages/pipx_like/__init__.py', 'Lib/site-packages/playwright/__init__.py',
    ].forEach(touch);

    const rel = pruneTargets(dir).map(p => nodePath.relative(dir, p).split(nodePath.sep).join('/')).sort();
    expect(rel).toEqual([
      'DLLs/_tkinter.pyd', 'Lib/idlelib', 'Lib/site-packages/pip', 'Lib/site-packages/pip-25.0.dist-info',
      'Lib/test', 'Lib/tkinter', 'Scripts', 'tcl',
    ]);
  });

  test('pasta sem nada a podar → lista vazia', () => {
    touch('python.exe');
    expect(pruneTargets(dir)).toEqual([]);
  });

  test('readMeta lê o runtime.json ou devolve null', () => {
    expect(readMeta(dir)).toBeNull();
    fs.writeFileSync(nodePath.join(dir, 'runtime.json'), JSON.stringify({ mcp: '1' }));
    expect(readMeta(dir)).toEqual({ mcp: '1' });
  });

  test('reexporta isRuntimeCurrent do instalador', () => {
    expect(isRuntimeCurrent).toBe(require('../../../snMcp/installer').isRuntimeCurrent);
  });
});

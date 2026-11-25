jest.mock('child_process', () => ({ spawn: jest.fn() }));

const { spawn } = require('child_process');
const { launchAndQuit, isNewer, INSTALLER_ARGS } = require('../../../electron/updater');

describe('launchAndQuit', () => {
  let unref;
  beforeEach(() => {
    unref = jest.fn();
    spawn.mockReturnValue({ unref });
  });

  test('roda o installer em modo silencioso e pede para abrir o app ao terminar', () => {
    launchAndQuit('C:\\tmp\\Backlog.Health.Setup.1.6.0.exe');
    expect(spawn).toHaveBeenCalledWith(
      'C:\\tmp\\Backlog.Health.Setup.1.6.0.exe',
      ['/S', '--force-run'],
      { detached: true, stdio: 'ignore' },
    );
    expect(unref).toHaveBeenCalled();
  });

  test('argumentos exportados incluem /S e --force-run', () => {
    expect(INSTALLER_ARGS).toEqual(['/S', '--force-run']);
  });
});

describe('isNewer', () => {
  test('compara major, minor e patch', () => {
    expect(isNewer('v1.6.0', '1.5.1')).toBe(true);
    expect(isNewer('v2.0.0', '1.9.9')).toBe(true);
    expect(isNewer('1.5.2', '1.5.1')).toBe(true);
    expect(isNewer('v1.5.1', '1.5.1')).toBe(false);
    expect(isNewer('v1.4.9', '1.5.0')).toBe(false);
  });
});

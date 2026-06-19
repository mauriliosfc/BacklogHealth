const { app, BrowserWindow, shell, dialog, Menu, nativeTheme, ipcMain } = require('electron');
const { checkForUpdates, downloadUpdate, launchAndQuit } = require('./updater');
const path = require('path');
const net  = require('net');

const PORT = 3030;

// Desabilita cache HTTP do Chromium para garantir que arquivos JS/CSS sejam sempre buscados frescos
app.commandLine.appendSwitch('disable-http-cache');

// Remove o menu padrão do Electron (File / Edit / View / Window / Help)
Menu.setApplicationMenu(null);

function _titleBarColors() {
  return nativeTheme.shouldUseDarkColors
    ? { color: '#0f172a', symbolColor: '#94a3b8' }
    : { color: '#ffffff', symbolColor: '#475569' };
}

// Em produção (app empacotado) usa userData isolado por usuário.
// Em dev, omite para que utils/paths.js use a raiz do projeto (mesmo que npm start).
if (app.isPackaged) {
  process.env.ELECTRON_DATA_DIR = app.getPath('userData');
}

// Inicia o servidor HTTP embutido (sem subprocess, sem PKG)
require('../server');

// ── Aguarda o servidor estar pronto na porta ──────────────────────────────────
function waitForServer(retries = 40, delay = 250) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    function tryConnect() {
      const socket = new net.Socket();
      socket.setTimeout(300);
      socket.once('connect', () => { socket.destroy(); resolve(); });
      socket.once('error',   () => { socket.destroy(); retry(); });
      socket.once('timeout', () => { socket.destroy(); retry(); });
      socket.connect(PORT, '127.0.0.1');
    }
    function retry() {
      if (++attempts >= retries) return reject(new Error('Servidor nao respondeu apos 10s'));
      setTimeout(tryConnect, delay);
    }
    tryConnect();
  });
}

// ── Cria a janela principal ───────────────────────────────────────────────────
function createWindow() {
  const iconPath = path.join(__dirname, '..', 'build', 'icon.ico');

  const colors = _titleBarColors();

  const win = new BrowserWindow({
    width:     1280,
    height:    800,
    minWidth:  900,
    minHeight: 600,
    title:     'Backlog Health',
    icon:      iconPath,
    backgroundColor: colors.color,
    show: false,
    titleBarStyle:   'hidden',
    titleBarOverlay: { ...colors, height: 36 },
    webPreferences: {
      contextIsolation: true,
      nodeIntegration:  false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // Atualiza cores da barra de título quando o Windows troca de tema
  nativeTheme.on('updated', () => {
    if (win.isDestroyed()) return;
    const c = _titleBarColors();
    win.setTitleBarOverlay(c);
    win.setBackgroundColor(c.color);
  });

  // Marca o renderer para que o CSS aplique ajustes Electron
  win.webContents.on('did-finish-load', () => {
    win.webContents.executeJavaScript('document.body.classList.add("electron-app")').catch(() => {});
  });

  // Links externos abrem no browser padrao, nao dentro do Electron
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.session.clearCache().finally(() => win.loadURL(`http://localhost:${PORT}`));
  win.once('ready-to-show', () => {
    win.show();
    // Checa atualização 8s após a janela aparecer (non-blocking, silencioso)
    setTimeout(async () => {
      const info = await checkForUpdates(app.getVersion());
      if (info && !win.isDestroyed()) win.webContents.send('update:available', info);
    }, 8000);
  });

  // Ctrl+scroll zoom
  win.webContents.on('zoom-changed', (_e, direction) => {
    const cur  = win.webContents.getZoomFactor();
    const next = direction === 'in' ? Math.min(cur + 0.1, 2.0) : Math.max(cur - 0.1, 0.5);
    win.webContents.setZoomFactor(parseFloat(next.toFixed(1)));
  });

  // Ctrl++ / Ctrl+- / Ctrl+0
  win.webContents.on('before-input-event', (_e, input) => {
    if (!input.control) return;
    const cur = win.webContents.getZoomFactor();
    if (input.key === '=' || input.key === '+') win.webContents.setZoomFactor(Math.min(parseFloat((cur + 0.1).toFixed(1)), 2.0));
    else if (input.key === '-')                 win.webContents.setZoomFactor(Math.max(parseFloat((cur - 0.1).toFixed(1)), 0.5));
    else if (input.key === '0')                 win.webContents.setZoomFactor(1.0);
  });

  return win;
}

// ── Updater IPC ───────────────────────────────────────────────────────────────
let _installerPath = null;

ipcMain.handle('updater:download', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  try {
    const info = await checkForUpdates(app.getVersion());
    if (!info) return;
    _installerPath = await downloadUpdate(info.installerUrl, pct => {
      win?.webContents.send('update:progress', pct);
    });
    win?.webContents.send('update:complete');
  } catch (err) {
    win?.webContents.send('update:error', err.message);
  }
});

ipcMain.on('updater:install', () => {
  if (_installerPath) {
    launchAndQuit(_installerPath);
    app.quit();
  }
});

// Renderer avisa quando o usuário troca o tema interno do app
ipcMain.on('theme-changed', (e, theme) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win || win.isDestroyed()) return;
  const c = theme === 'dark'
    ? { color: '#0f172a', symbolColor: '#94a3b8' }
    : { color: '#ffffff', symbolColor: '#475569' };
  win.setTitleBarOverlay(c);
  win.setBackgroundColor(c.color);
});

// ── Ciclo de vida do app ──────────────────────────────────────────────────────
app.whenReady().then(async () => {
  try {
    await waitForServer();
    createWindow();
  } catch (e) {
    dialog.showErrorBox('Backlog Health', 'Nao foi possivel iniciar o servidor:\n\n' + e.message);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    waitForServer().then(createWindow).catch(() => {});
  }
});

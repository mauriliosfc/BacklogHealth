const { app, BrowserWindow, shell, dialog } = require('electron');
const path = require('path');
const net  = require('net');

const PORT = 3030;

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

  const win = new BrowserWindow({
    width:     1280,
    height:    800,
    minWidth:  900,
    minHeight: 600,
    title:     'Backlog Health',
    icon:      iconPath,
    backgroundColor: '#0f172a', // evita flash branco enquanto carrega
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration:  false,
    },
  });

  // Links externos abrem no browser padrao, nao dentro do Electron
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.loadURL(`http://localhost:${PORT}`);
  win.once('ready-to-show', () => win.show());

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

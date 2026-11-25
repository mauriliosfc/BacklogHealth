const { app, BrowserWindow, shell, dialog, Menu, nativeTheme, ipcMain } = require('electron');
const { checkForUpdates, downloadUpdate, launchAndQuit } = require('./updater');
const { resolveLang, resolveTheme, splashText, readPrefs, writePrefs } = require('./splashPrefs');
const path = require('path');
const net  = require('net');

// Instância única: cliques repetidos no atalho enquanto o app carrega não abrem outro processo
// (que buscaria tudo no Azure de novo e abriria outra janela). A 2ª instância sai sem subir o
// servidor e a 1ª recebe 'second-instance' para trazer a janela para frente.
const isPrimaryInstance = app.requestSingleInstanceLock();
if (!isPrimaryInstance) app.quit();

let mainWin   = null;
let splashWin = null;

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

// Mesma porta do servidor: 3030 empacotado, 3031 em dev (config.js). Requer o ELECTRON_DATA_DIR já definido.
const { PORT } = require('../config');

const SPLASH_PREFS = path.join(app.getPath('userData'), 'splash.json');
const ICON_PATH    = path.join(__dirname, '..', 'build', 'icon.ico');

// ── Janela de carregamento ────────────────────────────────────────────────────
// Aparece logo após o clique, antes do servidor (que só escuta depois de buscar os projetos).
function createSplash() {
  const prefs = readPrefs(SPLASH_PREFS);
  const lang  = resolveLang(prefs.lang, app.getLocale());
  const theme = resolveTheme(prefs.theme, nativeTheme.shouldUseDarkColors);

  const win = new BrowserWindow({
    width:  440,
    height: 280,
    frame:  false,
    resizable:      false,
    maximizable:    false,
    fullscreenable: false,
    center: true,
    // Visível na hora, com a cor de fundo: em máquinas com antivírus corporativo o processo de
    // renderização leva vários segundos para subir, e esperar o 'ready-to-show' deixaria a tela vazia
    show:   true,
    title:  'Backlog Health',
    icon:   ICON_PATH,
    backgroundColor: theme === 'dark' ? '#0f172a' : '#ffffff',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  win.setProgressBar(2); // > 1 = indeterminado no ícone da barra de tarefas (nativo, aparece antes do HTML)
  win.on('closed', () => { if (splashWin === win) splashWin = null; });
  win.loadFile(path.join(__dirname, 'splash.html'), { query: { theme, text: splashText(lang) } }).catch(() => {});
  return win;
}

// Resolve quando a janela de carregamento termina de carregar (ou após o limite), para só então
// pré-aquecer a principal sem disputar a subida do processo de renderização com a splash
function splashLoaded(win, limitMs = 8000) {
  return new Promise(resolve => {
    const timer = setTimeout(resolve, limitMs);
    const done  = () => { clearTimeout(timer); resolve(); };
    if (!win || win.isDestroyed()) return done();
    win.webContents.once('did-finish-load', done);
    win.once('closed', done);
  });
}

function closeSplash() {
  if (splashWin && !splashWin.isDestroyed()) splashWin.destroy();
  splashWin = null;
}

// ── Aguarda o servidor estar pronto na porta ──────────────────────────────────
// Até ~2 min: com muitos projetos a busca inicial no Azure passa de 10s (a janela de
// carregamento fica visível enquanto isso)
function waitForServer(retries = 480, delay = 250) {
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
      if (++attempts >= retries) return reject(new Error(`Servidor nao respondeu apos ${Math.round(retries * delay / 1000)}s`));
      setTimeout(tryConnect, delay);
    }
    tryConnect();
  });
}

// ── Cria a janela principal ───────────────────────────────────────────────────
// Criada oculta em about:blank enquanto o servidor busca os projetos: o processo de renderização
// já sobe nesse tempo (2–4s em máquinas com antivírus) e o dashboard abre logo que o servidor responde.
function createWindow() {
  const colors = _titleBarColors();

  const win = new BrowserWindow({
    width:     1280,
    height:    800,
    minWidth:  900,
    minHeight: 600,
    title:     'Backlog Health',
    icon:      ICON_PATH,
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

  win.on('closed', () => { if (mainWin === win) mainWin = null; });
  win.loadURL('about:blank').catch(() => {});

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

// Resolve quando a página carregada for a do servidor. Não dá para confiar só na promise do
// loadURL: ela se resolve cedo quando a navegação se sobrepõe ao about:blank do pré-aquecimento
// (e rejeita em redirects como / → /onboarding). Limite de 30s para nunca deixar a janela oculta.
function loadServerPage(win, url) {
  return new Promise(resolve => {
    const wc = win.webContents;
    const finish = () => { clearTimeout(timer); wc.off('did-finish-load', onLoad); resolve(); };
    const onLoad = () => { if (wc.getURL().startsWith(url)) finish(); };
    const timer  = setTimeout(finish, 30000);
    wc.on('did-finish-load', onLoad);
    win.loadURL(url).catch(() => {});
  });
}

// Carrega o dashboard na janela principal (já pré-aquecida), mostra e fecha a splash
async function openMain(win) {
  await win.webContents.session.clearCache().catch(() => {});
  if (win.isDestroyed()) return;
  await loadServerPage(win, `http://localhost:${PORT}`);
  if (win.isDestroyed()) return;
  win.show();
  closeSplash();
  // Checa atualização 8s após a janela aparecer (non-blocking, silencioso)
  setTimeout(async () => {
    const info = await checkForUpdates(app.getVersion());
    if (info && !win.isDestroyed()) win.webContents.send('update:available', info);
  }, 8000);
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
  writePrefs(SPLASH_PREFS, { theme });
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win || win.isDestroyed()) return;
  const c = theme === 'dark'
    ? { color: '#0f172a', symbolColor: '#94a3b8' }
    : { color: '#ffffff', symbolColor: '#475569' };
  win.setTitleBarOverlay(c);
  win.setBackgroundColor(c.color);
});

// Renderer avisa o idioma ativo; a janela de carregamento usa na próxima abertura
ipcMain.on('locale-changed', (_e, lang) => {
  writePrefs(SPLASH_PREFS, { lang });
});

// Clique no atalho com o app já aberto (ou ainda carregando): traz a janela para frente
app.on('second-instance', () => {
  const win = mainWin && !mainWin.isDestroyed() && mainWin.isVisible() ? mainWin : splashWin;
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
});

// ── Ciclo de vida do app ──────────────────────────────────────────────────────
app.whenReady().then(async () => {
  if (!isPrimaryInstance) return;
  splashWin = createSplash();
  // Inicia o servidor HTTP embutido (sem subprocess, sem PKG) logo depois da janela de carregamento
  require('../server');
  splashLoaded(splashWin).then(() => { if (!mainWin) mainWin = createWindow(); });
  try {
    await waitForServer();
    if (!mainWin) mainWin = createWindow();
    await openMain(mainWin);
  } catch (e) {
    closeSplash();
    dialog.showErrorBox('Backlog Health', 'Nao foi possivel iniciar o servidor:\n\n' + e.message);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Encerra o processo do MCP do Service Now (Python + Chromium de login) ao sair
app.on('before-quit', () => {
  try { require('../snMcp').shutdown(); } catch (_) {}
});

app.on('activate', () => {
  if (isPrimaryInstance && BrowserWindow.getAllWindows().length === 0) {
    waitForServer().then(() => { mainWin = createWindow(); return openMain(mainWin); }).catch(() => {});
  }
});

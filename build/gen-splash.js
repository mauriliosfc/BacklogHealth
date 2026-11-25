/**
 * Gera build/splash.bmp — imagem mostrada pelo executável portátil enquanto ele descompacta
 * (antes do Electron iniciar). Renderiza electron/splash.html sem animação e sem texto de idioma.
 *
 * Uso: npx electron build/gen-splash.js
 */
const { app, BrowserWindow } = require('electron');
const fs   = require('fs');
const path = require('path');
const { toBmp24 } = require('./bmp');

const WIDTH  = 440;
const HEIGHT = 280;
const OUT    = path.join(__dirname, 'splash.bmp');

// Captura em 1:1 mesmo em telas com escala (125%, 150%...)
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: WIDTH, height: HEIGHT, show: false, frame: false, useContentSize: true,
    backgroundColor: '#0f172a',
    webPreferences: { offscreen: true },
  });
  try {
    await win.loadFile(path.join(__dirname, '..', 'electron', 'splash.html'), { query: { theme: 'dark', static: '1' } });
    await new Promise(r => setTimeout(r, 300));
    const img  = (await win.webContents.capturePage()).resize({ width: WIDTH, height: HEIGHT });
    const { width, height } = img.getSize();
    fs.writeFileSync(OUT, toBmp24(img.toBitmap(), width, height));
    console.log(`build/splash.bmp gerado (${width}x${height})`);
  } catch (e) {
    console.error('Falha ao gerar splash.bmp:', e.message);
    process.exitCode = 1;
  }
  app.quit();
});

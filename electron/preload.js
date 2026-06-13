const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Tema
  themeChanged: (theme) => ipcRenderer.send('theme-changed', theme),

  // Atualizações
  onUpdateAvailable:   (cb) => ipcRenderer.on('update:available',  (_e, info) => cb(info)),
  onDownloadProgress:  (cb) => ipcRenderer.on('update:progress',   (_e, pct)  => cb(pct)),
  onDownloadComplete:  (cb) => ipcRenderer.on('update:complete',   ()         => cb()),
  onDownloadError:     (cb) => ipcRenderer.on('update:error',      (_e, msg)  => cb(msg)),
  downloadUpdate:      ()   => ipcRenderer.invoke('updater:download'),
  installUpdate:       ()   => ipcRenderer.send('updater:install'),
});

// Gerencia o banner de atualização — só ativo quando rodando em Electron.

let _info = null;

export function initUpdater() {
  if (!window.electronAPI?.onUpdateAvailable) return;

  window.electronAPI.onUpdateAvailable(info => {
    _info = info;
    _show(info);
  });

  window.electronAPI.onDownloadProgress(pct => {
    const bar  = document.getElementById('upd-bar');
    const pctEl = document.getElementById('upd-pct');
    if (bar)   bar.style.width = pct + '%';
    if (pctEl) pctEl.textContent = pct + '%';
  });

  window.electronAPI.onDownloadComplete(() => {
    _setState('ready');
  });

  window.electronAPI.onDownloadError(msg => {
    _setState('error', msg);
  });
}

function _show(info) {
  const banner = document.getElementById('update-banner');
  if (!banner) return;
  document.getElementById('upd-version').textContent = info.version;
  banner.style.display = 'flex';
}

function _setState(state, msg) {
  const banner  = document.getElementById('update-banner');
  if (!banner) return;

  const stIdle  = document.getElementById('upd-state-idle');
  const stDl    = document.getElementById('upd-state-downloading');
  const stReady = document.getElementById('upd-state-ready');
  const stErr   = document.getElementById('upd-state-error');

  [stIdle, stDl, stReady, stErr].forEach(el => { if (el) el.style.display = 'none'; });

  if (state === 'downloading' && stDl)  stDl.style.display  = 'flex';
  if (state === 'ready'       && stReady) stReady.style.display = 'flex';
  if (state === 'error'       && stErr) {
    stErr.style.display = 'flex';
    const msgEl = document.getElementById('upd-error-msg');
    if (msgEl) msgEl.textContent = msg || 'Erro ao baixar.';
  }
}

export function updDownload() {
  _setState('downloading');
  window.electronAPI?.downloadUpdate();
}

export function updInstall() {
  window.electronAPI?.installUpdate();
}

export function updDismiss() {
  const banner = document.getElementById('update-banner');
  if (banner) banner.style.display = 'none';
}

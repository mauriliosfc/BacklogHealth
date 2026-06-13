/**
 * updater.js — checa GitHub Releases e baixa o installer.
 * Usa apenas módulos nativos do Node.js (https, fs, os, path).
 */
const https        = require('https');
const fs           = require('fs');
const os           = require('os');
const path         = require('path');
const { shell }    = require('electron');

const OWNER = 'mauriliosfc';
const REPO  = 'BacklogHealth';
const API   = `https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`;

// ── Comparação semver simples (sem bibliotecas) ───────────────────────────────
function _semver(tag) {
  return (tag || '').replace(/^v/, '').split('.').map(Number);
}

function isNewer(remote, local) {
  const [rMaj, rMin, rPat] = _semver(remote);
  const [lMaj, lMin, lPat] = _semver(local);
  if (rMaj !== lMaj) return rMaj > lMaj;
  if (rMin !== lMin) return rMin > lMin;
  return rPat > lPat;
}

// ── Requisição HTTPS com timeout ──────────────────────────────────────────────
function _get(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'BacklogHealth-Updater' }, ...opts }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(_get(res.headers.location, opts));
      }
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
    });
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
  });
}

// ── Checar se há atualização disponível ──────────────────────────────────────
async function checkForUpdates(currentVersion) {
  try {
    const { status, body } = await _get(API);
    if (status !== 200) return null;

    const release = JSON.parse(body);
    const tag     = release.tag_name || '';
    if (!isNewer(tag, currentVersion)) return null;

    // Seleciona o asset do installer NSIS (*Setup*.exe)
    const asset = (release.assets || []).find(a =>
      /setup/i.test(a.name) && a.name.endsWith('.exe')
    );
    if (!asset) return null;

    return {
      version:      tag,
      installerUrl: asset.browser_download_url,
      installerName: asset.name,
      releaseUrl:   release.html_url,
      notes:        (release.body || '').slice(0, 300),
    };
  } catch (_) {
    return null; // silencioso — offline ou GitHub fora do ar
  }
}

// ── Baixar o installer com progresso ─────────────────────────────────────────
function downloadUpdate(url, onProgress) {
  return new Promise((resolve, reject) => {
    const dest = path.join(os.tmpdir(), path.basename(url));

    function doDownload(targetUrl) {
      https.get(targetUrl, { headers: { 'User-Agent': 'BacklogHealth-Updater' } }, res => {
        // Segue redirect (GitHub usa CDN)
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return doDownload(res.headers.location);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}`));
        }

        const total = parseInt(res.headers['content-length'] || '0', 10);
        let received = 0;
        const out = fs.createWriteStream(dest);

        res.on('data', chunk => {
          received += chunk.length;
          if (total > 0 && onProgress) onProgress(Math.round(received / total * 100));
        });
        res.pipe(out);
        out.on('finish', () => resolve(dest));
        out.on('error', reject);
        res.on('error', reject);
      }).on('error', reject);
    }

    doDownload(url);
  });
}

// ── Lançar o installer e fechar o app ────────────────────────────────────────
function launchAndQuit(installerPath) {
  shell.openPath(installerPath);
}

module.exports = { checkForUpdates, downloadUpdate, launchAndQuit };

const nodePath = require('path');

// Writable data directory — resolved in priority order:
//   1. ELECTRON_DATA_DIR env var  (set by Electron main process: app.getPath('userData'))
//   2. process.pkg                 (PKG distribution — next to the .exe, writable)
//   3. Development                 (project root)
//
// IMPORTANT: static/read-only assets (views/, public/) must NOT use DATA_DIR.
// They are always resolved relative to __dirname in the file that needs them.
// This module only handles writable runtime paths.
function _dataDir() {
  if (process.env.ELECTRON_DATA_DIR) return process.env.ELECTRON_DATA_DIR;
  if (process.pkg)                    return nodePath.dirname(process.execPath);
  return nodePath.join(__dirname, '..');   // project root in dev
}

const DATA_DIR    = _dataDir();
const CONFIG_PATH = nodePath.join(DATA_DIR, 'config.json');
const CACHE_DIR   = nodePath.join(DATA_DIR, 'cache');

module.exports = { DATA_DIR, CONFIG_PATH, CACHE_DIR };

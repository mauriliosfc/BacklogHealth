const fs       = require("fs");
const nodePath  = require("path");

const PORT        = 3030;
// Quando rodando como .exe (PKG), __dirname aponta para o filesystem virtual
// somente leitura. Salvar config.json ao lado do executável em vez disso.
const CONFIG_DIR  = process.pkg ? nodePath.dirname(process.execPath) : __dirname;
const CONFIG_PATH = nodePath.join(CONFIG_DIR, "config.json");

let cfg = {};

function loadConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    if (raw.org && raw.pat && Array.isArray(raw.projects) && raw.projects.length) {
      cfg = raw;
      return true;
    }
  } catch (_) {}
  cfg = {};
  return false;
}

function saveConfig(data) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), "utf8");
  cfg = data;
}

function getAuth() {
  return Buffer.from(`:${cfg.pat}`).toString("base64");
}

function getCfg() {
  return cfg;
}

module.exports = { PORT, CONFIG_PATH, loadConfig, saveConfig, getAuth, getCfg };

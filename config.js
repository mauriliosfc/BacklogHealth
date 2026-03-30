const fs       = require("fs");
const nodePath  = require("path");

const PORT        = 3030;
const CONFIG_PATH = nodePath.join(__dirname, "config.json");

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

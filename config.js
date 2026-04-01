const fs       = require("fs");
const nodePath  = require("path");

const PORT        = 3030;
// Quando rodando como .exe (PKG), __dirname aponta para o filesystem virtual
// somente leitura. Salvar config.json ao lado do executável em vez disso.
const CONFIG_DIR  = process.pkg ? nodePath.dirname(process.execPath) : __dirname;
const CONFIG_PATH = nodePath.join(CONFIG_DIR, "config.json");

let cfg = {};

// Aceita nome simples, dev.azure.com/org ou xxx.visualstudio.com
function parseOrgInput(input) {
  input = (input || "").trim();
  const withProto = input.startsWith("http") ? input : "https://" + input;
  try {
    const u = new URL(withProto);
    if (u.hostname.endsWith(".visualstudio.com")) {
      const org = u.hostname.replace(".visualstudio.com", "");
      return { org, baseUrl: `https://${u.hostname}` };
    }
    if (u.hostname === "dev.azure.com") {
      const org = u.pathname.replace(/^\//, "").split("/")[0];
      if (org) return { org, baseUrl: `https://dev.azure.com/${org}` };
    }
  } catch (_) {}
  // fallback: nome simples da organização
  return { org: input, baseUrl: `https://dev.azure.com/${input}` };
}

function loadConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    if (raw.org && raw.pat && Array.isArray(raw.projects) && raw.projects.length) {
      // compatibilidade: configs sem baseUrl usam dev.azure.com
      if (!raw.baseUrl) raw.baseUrl = `https://dev.azure.com/${raw.org}`;
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

module.exports = { PORT, CONFIG_PATH, loadConfig, saveConfig, getAuth, getCfg, parseOrgInput };

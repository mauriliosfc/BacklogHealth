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

      // Migração automática: converter string[] para object[]
      if (raw.projects && raw.projects.length > 0) {
        raw.projects = raw.projects.map(p =>
          typeof p === 'string'
            ? { name: p, workItemType: 'User Story' }
            : { name: p.name, workItemType: p.workItemType || 'User Story' }
        );
      }

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

function getProjectNames() {
  const cfg = loadConfig() ? getCfg() : { projects: [] };
  return cfg.projects.map(p => typeof p === 'string' ? p : p.name);
}

function getProjectConfig(projectName) {
  const cfg = getCfg();
  if (!cfg.projects) return null;
  const found = cfg.projects.find(p => {
    const name = typeof p === 'string' ? p : p.name;
    return name === projectName;
  });
  if (!found) return null;
  return typeof found === 'string'
    ? { name: found, workItemType: 'User Story' }
    : { name: found.name, workItemType: found.workItemType || 'User Story' };
}

module.exports = { PORT, CONFIG_PATH, loadConfig, saveConfig, getAuth, getCfg, parseOrgInput, getProjectNames, getProjectConfig };

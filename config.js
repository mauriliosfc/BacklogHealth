const fs          = require("fs");
const { CONFIG_PATH } = require('./utils/paths');

const PORT = 3030;

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

    // Always load whatever is on disk so SN-only / partial configs survive restart.
    // compatibilidade: configs sem baseUrl usam dev.azure.com
    if (!raw.baseUrl && raw.org) raw.baseUrl = `https://dev.azure.com/${raw.org}`;

    // Migração automática: converter string[] para object[]
    if (raw.projects && raw.projects.length > 0) {
      raw.projects = raw.projects.map(p =>
        typeof p === 'string'
          ? { name: p, workItemType: 'User Story' }
          : { ...p, workItemType: p.workItemType || 'User Story' }
      );
    }

    cfg = raw;
    // Return true only when Azure is fully configured (projects to fetch exist)
    return !!(raw.org && raw.pat && Array.isArray(raw.projects) && raw.projects.length);
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

// Returns "ProjectName - TeamName" when a team is set, otherwise just "ProjectName"
function getDisplayName(p) {
  if (typeof p === 'string') return p;
  return p.team ? `${p.name} - ${p.team}` : p.name;
}

function getProjectConfig(identifier) {
  const cfg = getCfg();
  if (!cfg.projects) return null;
  const found = cfg.projects.find(p => getDisplayName(p) === identifier);
  if (!found) return null;
  const name        = typeof found === 'string' ? found : found.name;
  const workItemType = typeof found === 'string' ? 'User Story' : (found.workItemType || 'User Story');
  const team        = typeof found === 'string' ? undefined : (found.team || undefined);
  return { name, workItemType, team, displayName: getDisplayName(found) };
}

function getAiCfg() {
  return cfg.ai || null;
}

function saveAiConfig(ai) {
  cfg.ai = ai;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), "utf8");
}

function getGithubCfg() {
  return cfg.github || null;
}

function getSnConfig() {
  return cfg.servicenow || null;
}

function saveSnConfig({ instance, user, pass, assignmentGroups } = {}, projectGroup = null) {
  if (instance !== undefined || user !== undefined || pass !== undefined || assignmentGroups !== undefined) {
    cfg.servicenow = {
      ...(cfg.servicenow || {}),
      ...(instance         !== undefined ? { instance }         : {}),
      ...(user             !== undefined ? { user }             : {}),
      ...(pass             !== undefined ? { pass }             : {}),
      ...(assignmentGroups !== undefined ? { assignmentGroups } : {}),
    };
  }
  if (projectGroup) {
    const { projectName, assignmentGroup, assignmentGroupName, slaThresholds, slaEnabled } = projectGroup;
    const proj = (cfg.projects || []).find(p => getDisplayName(p) === projectName || p.name === projectName);
    if (proj) {
      const existing = proj.servicenow || {};
      proj.servicenow = {
        ...existing,
        ...(assignmentGroup     !== undefined ? { assignmentGroup }     : {}),
        ...(assignmentGroupName !== undefined ? { assignmentGroupName } : {}),
        ...(slaEnabled          !== undefined ? { slaEnabled: slaEnabled === true } : {}),
        ...(slaThresholds                     ? { slaThresholds }                   : {}),
      };
    }
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
}

function getProjectSnGroup(displayName) {
  const proj = (cfg.projects || []).find(p => getDisplayName(p) === displayName || p.name === displayName);
  return proj?.servicenow || null;
}

// Returns one of: 'empty' | 'sn-only' | 'azure' | 'full'
function getAppMode() {
  const hasAzure = !!(cfg.org && cfg.pat && Array.isArray(cfg.projects) && cfg.projects.length);
  const sn = cfg.servicenow;
  const hasSN = !!(sn && sn.instance && sn.user && sn.pass);
  if (hasAzure && hasSN) return 'full';
  if (hasAzure)          return 'azure';
  if (hasSN)             return 'sn-only';
  return 'empty';
}

module.exports = { PORT, CONFIG_PATH, loadConfig, saveConfig, getAuth, getCfg, parseOrgInput, getProjectNames, getProjectConfig, getDisplayName, getAiCfg, saveAiConfig, getGithubCfg, getSnConfig, saveSnConfig, getProjectSnGroup, getAppMode };

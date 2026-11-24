const fs          = require("fs");
const { CONFIG_PATH } = require('./utils/paths');
const { isSnConfigured } = require('./utils/snMode');
const { orgIdFor, orgLabel, getBaseDisplayName, getDisplayName, assignProjectKeys } = require('./utils/orgs');

// Mesma detecção de ambiente usada em utils/paths.js (ELECTRON_DATA_DIR → pkg → dev):
// o app empacotado (Electron ou pkg) sempre usa 3030; rodando via `node server.js`/`npm run dev`
// usa 3031, para não colidir com uma instância do app já instalada na máquina.
const PORT = (process.env.ELECTRON_DATA_DIR || process.pkg) ? 3030 : 3031;

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

// ── Organizações do Azure DevOps ─────────────────────────────────────────────
// config.organizations = [{ id, org, baseUrl, pat, label? }]; a primeira é a principal.
// Os campos do topo (org, baseUrl, pat) são sempre um espelho da principal: o restante
// do app, as checagens de modo e uma eventual volta para versão antiga continuam funcionando.
// Configs antigas (sem organizations) são migradas em memória e gravadas no próximo save.

function _normalizeOrganizations(data) {
  if (!data || typeof data !== 'object') return data;
  let orgs = Array.isArray(data.organizations) ? data.organizations.filter(o => o && typeof o === 'object') : null;
  if (!orgs || !orgs.length) {
    orgs = (data.org || data.baseUrl)
      ? [{ id: orgIdFor(data.org, data.baseUrl), org: data.org || '', baseUrl: data.baseUrl || '', pat: data.pat || '' }]
      : [];
  }
  orgs = orgs.map(o => {
    const baseUrl = o.baseUrl || (o.org ? `https://dev.azure.com/${o.org}` : '');
    return { ...o, baseUrl, id: o.id || orgIdFor(o.org, baseUrl) };
  });
  data.organizations = orgs;
  const primary = orgs[0];
  if (primary) {
    data.org = primary.org;
    data.baseUrl = primary.baseUrl;
    data.pat = primary.pat;
    if (Array.isArray(data.projects)) {
      data.projects = data.projects.map(p => (p && typeof p === 'object' && !p.orgId) ? { ...p, orgId: primary.id } : p);
    }
  }
  return data;
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

    _normalizeOrganizations(raw);

    cfg = raw;
    // Return true only when Azure is fully configured (projects to fetch exist)
    return !!(raw.org && raw.pat && Array.isArray(raw.projects) && raw.projects.length);
  } catch (_) {}
  cfg = {};
  return false;
}

function saveConfig(data) {
  // Sem organizations: grava como antes (callers antigos que só mexem no topo)
  if (Array.isArray(data.organizations)) _normalizeOrganizations(data);
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), "utf8");
  cfg = data;
}

function getAuth() {
  return Buffer.from(`:${cfg.pat}`).toString("base64");
}

function authFor(org) {
  return Buffer.from(`:${(org && org.pat) || ''}`).toString("base64");
}

function getOrganizations() {
  return Array.isArray(cfg.organizations) ? cfg.organizations : [];
}

// Organização pelo id; sem id (ou id desconhecido) devolve a principal.
// Configs sem organizations (ex.: testes, estado parcial) caem nos campos do topo.
function getOrg(orgId) {
  const orgs = getOrganizations();
  const found = orgId ? orgs.find(o => o.id === orgId) : null;
  if (found) return found;
  if (orgs[0]) return orgs[0];
  if (cfg.baseUrl || cfg.org) {
    return { id: orgIdFor(cfg.org, cfg.baseUrl), org: cfg.org || '', baseUrl: cfg.baseUrl || `https://dev.azure.com/${cfg.org}`, pat: cfg.pat || '' };
  }
  return null;
}


function getCfg() {
  return cfg;
}

function getProjectNames() {
  const cfg = loadConfig() ? getCfg() : { projects: [] };
  return cfg.projects.map(p => typeof p === 'string' ? p : p.name);
}

// getDisplayName / getBaseDisplayName / assignProjectKeys: ver utils/orgs.js

function getProjectConfig(identifier) {
  const cfg = getCfg();
  if (!cfg.projects) return null;
  const found = cfg.projects.find(p => getDisplayName(p) === identifier);
  if (!found) return null;
  const name        = typeof found === 'string' ? found : found.name;
  const workItemType = typeof found === 'string' ? 'User Story' : (found.workItemType || 'User Story');
  const team        = typeof found === 'string' ? undefined : (found.team || undefined);
  const out = { name, workItemType, team, displayName: getDisplayName(found) };
  // Perfil de tipos não legados (ver utils/workItemProfile.js) — só quando existir
  if (typeof found !== 'string') {
    if (found.orgId)                       out.orgId         = found.orgId;
    if (found.estimateField !== undefined) out.estimateField = found.estimateField;
    if (found.estimateUnit)                out.estimateUnit  = found.estimateUnit;
    if (found.states)                      out.states        = found.states;
  }
  return out;
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

function saveSnConfig({ instance, user, pass, assignmentGroups, mode, mcp } = {}, projectGroup = null) {
  if (instance !== undefined || user !== undefined || pass !== undefined || assignmentGroups !== undefined || mode !== undefined || mcp !== undefined) {
    const current = cfg.servicenow || {};
    cfg.servicenow = {
      ...current,
      ...(instance         !== undefined ? { instance }         : {}),
      ...(user             !== undefined ? { user }             : {}),
      ...(pass             !== undefined ? { pass }             : {}),
      ...(assignmentGroups !== undefined ? { assignmentGroups } : {}),
      ...(mode             !== undefined ? { mode }             : {}),
      ...(mcp              !== undefined ? { mcp: { ...(current.mcp || {}), ...mcp } } : {}),
    };
  }
  if (projectGroup) {
    const { projectName, assignmentGroup, assignmentGroupName, slaThresholds, slaEnabled } = projectGroup;
    const proj = (cfg.projects || []).find(p => getDisplayName(p) === projectName)
              || (cfg.projects || []).find(p => p.name === projectName);
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
  const proj = (cfg.projects || []).find(p => getDisplayName(p) === displayName)
            || (cfg.projects || []).find(p => p.name === displayName);
  return proj?.servicenow || null;
}

// Returns one of: 'empty' | 'sn-only' | 'azure' | 'full'
function getAppMode() {
  const hasAzure = !!(cfg.org && cfg.pat && Array.isArray(cfg.projects) && cfg.projects.length);
  const sn = cfg.servicenow;
  const hasSN = isSnConfigured(sn);
  if (hasAzure && hasSN) return 'full';
  if (hasAzure)          return 'azure';
  if (hasSN)             return 'sn-only';
  return 'empty';
}

module.exports = { PORT, CONFIG_PATH, loadConfig, saveConfig, getAuth, authFor, getCfg, parseOrgInput, getProjectNames, getProjectConfig, getDisplayName, getBaseDisplayName, assignProjectKeys, orgIdFor, getOrganizations, getOrg, orgLabel, getAiCfg, saveAiConfig, getGithubCfg, getSnConfig, saveSnConfig, getProjectSnGroup, getAppMode };

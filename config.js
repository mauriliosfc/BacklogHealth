const fs          = require("fs");
const { CONFIG_PATH } = require('./utils/paths');
const { isSnConfigured } = require('./utils/snMode');
const { orgIdFor, orgLabel, getBaseDisplayName, getDisplayName, assignProjectKeys } = require('./utils/orgs');
const { normalizeSnInstances, snIdFor, uniqueSnId, snLabel, snPublic } = require('./utils/snInstances');

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
    normalizeSnInstances(raw);

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
  if (Array.isArray(data.snInstances)) normalizeSnInstances(data);
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

// Grava a conexão de uma instância do Service Now e/ou o grupo de um projeto.
// snGlobal.instanceId: instância a alterar (ausente = principal; 'new' = adiciona uma nova).
// projectGroup.instanceId: instância do Service Now do projeto ('' = principal).
// Devolve o id da instância gravada (ou null quando só o grupo do projeto mudou).
function saveSnConfig({ instanceId, label, instance, user, pass, assignmentGroups, mode, mcp } = {}, projectGroup = null) {
  normalizeSnInstances(cfg);
  let savedId = null;
  const hasFields = [label, instance, user, pass, assignmentGroups, mode, mcp].some(v => v !== undefined);
  if (hasFields) {
    const list = cfg.snInstances;
    let idx = instanceId && instanceId !== 'new' ? list.findIndex(s => s.id === instanceId) : 0;
    if (instanceId === 'new' || !list.length) idx = -1;
    if (idx < 0 && instanceId && instanceId !== 'new') idx = 0;   // id desconhecido: principal
    const current = idx >= 0 && list[idx] ? list[idx] : { id: uniqueSnId(instance, list) };
    const next = {
      ...current,
      ...(instance         !== undefined ? { instance }         : {}),
      ...(user             !== undefined ? { user }             : {}),
      ...(pass             !== undefined ? { pass }             : {}),
      ...(assignmentGroups !== undefined ? { assignmentGroups } : {}),
      ...(mode             !== undefined ? { mode }             : {}),
      ...(mcp              !== undefined ? { mcp: { ...(current.mcp || {}), ...mcp } } : {}),
    };
    if (label !== undefined) {
      const clean = String(label || '').trim();
      if (clean) next.label = clean; else delete next.label;
    }
    if (idx >= 0) list[idx] = next; else list.push(next);
    const pos = idx >= 0 ? idx : list.length - 1;
    // `servicenow` é o armazenamento canônico da principal: atualiza junto
    if (pos === 0) {
      const { id, label: _l, ...mirror } = next;
      cfg.servicenow = mirror;
    }
    normalizeSnInstances(cfg);
    savedId = cfg.snInstances[pos] ? cfg.snInstances[pos].id : next.id;
  }
  if (projectGroup) {
    const { projectName, assignmentGroup, assignmentGroupName, slaThresholds, slaEnabled, instanceId: projInstanceId } = projectGroup;
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
      if (projInstanceId !== undefined) {
        if (projInstanceId) proj.servicenow.instanceId = projInstanceId;
        else delete proj.servicenow.instanceId;
      }
    }
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
  return savedId;
}

function getProjectSnGroup(displayName) {
  const proj = (cfg.projects || []).find(p => getDisplayName(p) === displayName)
            || (cfg.projects || []).find(p => p.name === displayName);
  return proj?.servicenow || null;
}

// ── Várias instâncias do Service Now ─────────────────────────────────────────
function getSnInstances() {
  if (Array.isArray(cfg.snInstances) && cfg.snInstances.length) return cfg.snInstances;
  const sn = cfg.servicenow;
  return sn && sn.instance ? [{ id: snIdFor(sn.instance), ...sn }] : [];
}

// Instância pelo id; sem id (ou id desconhecido) devolve a principal
function getSnInstance(id) {
  const list = getSnInstances();
  return (id && list.find(s => s.id === id)) || list[0] || null;
}

// Instância e grupo do Service Now de um projeto. Projeto sem instanceId usa a principal.
// Identificador que não é projeto (card de grupo do dashboard do SN): a instância que lista esse
// grupo, com a principal primeiro (mesmo nome em duas instâncias fica na principal).
function getProjectSnContext(displayName) {
  const isProject = (cfg.projects || []).some(p => getDisplayName(p) === displayName || p.name === displayName);
  const group = getProjectSnGroup(displayName);
  const list = getSnInstances();
  const byGroup = !isProject && displayName
    ? list.find(s => Array.isArray(s.assignmentGroups) && s.assignmentGroups.includes(displayName))
    : null;
  const snCfg = byGroup || getSnInstance(group && group.instanceId);
  const primary = list[0];
  return { snCfg, group, instanceId: snCfg ? snCfg.id : null, isPrimary: !!(snCfg && primary && snCfg.id === primary.id) };
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

module.exports = { PORT, CONFIG_PATH, loadConfig, saveConfig, getAuth, authFor, getCfg, parseOrgInput, getProjectNames, getProjectConfig, getDisplayName, getBaseDisplayName, assignProjectKeys, orgIdFor, getOrganizations, getOrg, orgLabel, getAiCfg, saveAiConfig, getGithubCfg, getSnConfig, saveSnConfig, getProjectSnGroup, getAppMode, getSnInstances, getSnInstance, getProjectSnContext, snLabel, snPublic, uniqueSnId };

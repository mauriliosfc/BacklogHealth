const { getCfg, saveConfig, getDisplayName, parseOrgInput } = require('../config');
const { rawAzureGet } = require('../azureClient');
const { buildAndCache } = require('./dashboard');
const { httpError } = require('./utils');
const state = require('./state');

async function listProjects({ org, pat }) {
  if (!org || !pat) httpError(400, 'org e pat são obrigatórios');
  const auth    = Buffer.from(`:${pat}`).toString('base64');
  const { baseUrl } = parseOrgInput(org);
  const PAGE    = 200;
  let allNames  = [];
  let skip      = 0;
  while (true) {
    const result = await rawAzureGet(
      `${baseUrl}/_apis/projects?api-version=7.0&$top=${PAGE}&$skip=${skip}&stateFilter=wellFormed`,
      auth
    );
    if (skip === 0) {
      if (result.status === 401 || result.status === 203)
        httpError(401, 'PAT inválido ou sem permissão. Verifique o token e as permissões necessárias.');
      if (result.status === 404)
        httpError(404, `Organização não encontrada: "${org}". Verifique o nome na URL do Azure DevOps.`);
      if (result.status !== 200)
        httpError(result.status, `Erro da API Azure DevOps: HTTP ${result.status}`);
    }
    const page = (result.data.value || []).map(p => p.name);
    allNames   = allNames.concat(page);
    if (page.length < PAGE) break;
    skip += PAGE;
  }
  const projectNames = allNames.sort((a, b) => a.localeCompare(b));
  const projects = await Promise.all(projectNames.map(async name => {
    try {
      const tr = await rawAzureGet(
        `${baseUrl}/_apis/projects/${encodeURIComponent(name)}/teams?api-version=7.0`,
        auth
      );
      if (tr.status === 200 && tr.data.value && tr.data.value.length > 1) {
        return { name, teams: tr.data.value.map(t => t.name) };
      }
    } catch (_) {}
    return { name, teams: [] };
  }));
  return { projects };
}

async function setup({ rawOrg, pat, projectsRaw }) {
  const existingForMerge = getCfg();
  const projects = (projectsRaw || '').split(/[\n,]+/)
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => {
      const [name, workItemType, ...teamParts] = p.split(':');
      const team     = teamParts.join(':').trim() || undefined;
      const prevProj = (existingForMerge.projects || []).find(
        ep => ep.name === name.trim() && (ep.team || undefined) === team
      );
      return {
        name:         name.trim(),
        workItemType: (workItemType || 'User Story').trim(),
        ...(team                    ? { team }                            : {}),
        ...(prevProj?.servicenow    ? { servicenow: prevProj.servicenow } : {}),
      };
    });
  if (!rawOrg || !pat || !projects.length)
    httpError(400, 'Preencha todos os campos obrigatórios.');
  const { org, baseUrl } = parseOrgInput(rawOrg);
  const existing = getCfg();
  saveConfig({ ...existing, org, baseUrl, pat, projects, _onboarded: true });
  await buildAndCache();
  return { ok: true };
}

async function removeProject({ project }) {
  const cfg    = getCfg();
  cfg.projects = (cfg.projects || []).filter(p => getDisplayName(p) !== project);
  saveConfig(cfg);
  await buildAndCache();
  return { ok: true };
}

async function disconnect() {
  const existing = getCfg();
  saveConfig({ ...existing, org: '', baseUrl: '', pat: '', projects: [] });
  state.html = '';
  return { ok: true };
}

async function markOnboarded() {
  saveConfig({ ...getCfg(), _onboarded: true });
  return { ok: true };
}

module.exports = { listProjects, setup, removeProject, disconnect, markOnboarded };

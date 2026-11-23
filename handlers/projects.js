const { getCfg, saveConfig, getDisplayName, parseOrgInput } = require('../config');
const { rawAzureGet } = require('../azureClient');
const { buildAndCache } = require('./dashboard');
const { httpError } = require('./utils');
const state = require('./state');
const { isLegacyType, pickEstimateField, statesFromCategories } = require('../utils/workItemProfile');

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

// Categorias cujos tipos não fazem sentido como item principal do backlog
const EXCLUDED_CATEGORIES = new Set([
  'Microsoft.HiddenCategory', 'Microsoft.BugCategory',
  'Microsoft.TestCaseCategory', 'Microsoft.TestPlanCategory', 'Microsoft.TestSuiteCategory',
  'Microsoft.SharedStepCategory', 'Microsoft.SharedParameterCategory',
  'Microsoft.CodeReviewRequestCategory', 'Microsoft.CodeReviewResponseCategory',
  'Microsoft.FeedbackRequestCategory', 'Microsoft.FeedbackResponseCategory',
]);

// Lista os tipos de work item de um projeto para o seletor do setup.
// O recomendado é o tipo padrão da categoria de requisitos do processo
// (User Story no Agile, Product Backlog Item no Scrum, Requirement no CMMI, Issue no Basic).
async function listWorkItemTypes({ org, pat, project }) {
  if (!org || !pat || !project) httpError(400, 'org, pat e project são obrigatórios');
  const auth = Buffer.from(`:${pat}`).toString('base64');
  const { baseUrl } = parseOrgInput(org);
  const base = `${baseUrl}/${encodeURIComponent(project)}/_apis/wit`;

  let catRes, typesRes;
  try {
    [catRes, typesRes] = await Promise.all([
      rawAzureGet(`${base}/workitemtypecategories?api-version=7.0`, auth),
      rawAzureGet(`${base}/workitemtypes?api-version=7.0`, auth),
    ]);
  } catch (e) {
    // rawAzureGet rejeita quando o corpo não é JSON (ex.: 401 com corpo vazio)
    const m = /^HTTP (\d+)/.exec(e.message || '');
    if (m) catRes = { status: Number(m[1]), data: {} };
    else throw e;
  }
  for (const r of [catRes, typesRes]) {
    if (!r) continue;
    if (r.status === 401 || r.status === 203)
      httpError(401, 'PAT inválido ou sem permissão. Verifique o token e as permissões necessárias.');
    if (r.status !== 200)
      httpError(r.status, `Erro da API Azure DevOps: HTTP ${r.status}`);
  }

  const categories = catRes.data.value || [];
  const excluded = new Set();
  let recommended = null;
  categories.forEach(c => {
    if (EXCLUDED_CATEGORIES.has(c.referenceName)) (c.workItemTypes || []).forEach(t => excluded.add(t.name));
    if (c.referenceName === 'Microsoft.RequirementCategory') recommended = c.defaultWorkItemType?.name || null;
  });

  const names = (typesRes.data.value || [])
    .filter(t => t && t.name && !t.isDisabled && !excluded.has(t.name))
    .map(t => t.name);
  const rank = n => (n === recommended ? 0 : n === 'Task' ? 1 : 2);
  const types = [...new Set(names)]
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map(name => ({ name, recommended: name === recommended }));
  return { types, recommended };
}

// Resolve campo de estimativa e estados de um tipo não legado.
// Devolve null se a API falhar — o projeto cai nas listas fixas, sem bloquear o save.
async function resolveTypeProfile({ baseUrl, auth, project, workItemType }) {
  try {
    const base = `${baseUrl}/${encodeURIComponent(project)}/_apis/wit/workitemtypes/${encodeURIComponent(workItemType)}`;
    const [fieldsRes, statesRes] = await Promise.all([
      rawAzureGet(`${base}/fields?api-version=7.0`, auth),
      rawAzureGet(`${base}/states?api-version=7.0`, auth),
    ]);
    if (fieldsRes.status !== 200 || statesRes.status !== 200) return null;
    const { estimateField, estimateUnit } = pickEstimateField(fieldsRes.data.value);
    const states = statesFromCategories(statesRes.data.value);
    return { estimateField, estimateUnit, states };
  } catch (_) {
    return null;
  }
}

// Campos por projeto que dependem do tipo de item (estados) — descartados quando o tipo muda
const TYPE_DEPENDENT_FIELDS = ['healthIndicators', 'burndownDoneStates', 'deliveryStates', 'agingState', 'estimateField', 'estimateUnit', 'states'];

function _parseProjects(projectsRaw, projectsJson) {
  if (projectsJson) {
    let arr;
    try { arr = typeof projectsJson === 'string' ? JSON.parse(projectsJson) : projectsJson; } catch (_) { arr = null; }
    if (!Array.isArray(arr)) httpError(400, 'projectsJson inválido');
    return arr
      .filter(p => p && typeof p.name === 'string' && p.name.trim())
      .map(p => ({
        name:         p.name.trim(),
        workItemType: (typeof p.workItemType === 'string' && p.workItemType.trim()) || 'User Story',
        team:         (typeof p.team === 'string' && p.team.trim()) || undefined,
      }));
  }
  // Formato legado: "Nome:Tipo[:Time]" separado por vírgula ou quebra de linha
  return (projectsRaw || '').split(/[\n,]+/)
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => {
      const [name, workItemType, ...teamParts] = p.split(':');
      return {
        name:         name.trim(),
        workItemType: (workItemType || 'User Story').trim(),
        team:         teamParts.join(':').trim() || undefined,
      };
    });
}

async function setup({ rawOrg, pat, projectsRaw, projectsJson }) {
  const existingForMerge = getCfg();
  const parsed = _parseProjects(projectsRaw, projectsJson);
  if (!rawOrg || !pat || !parsed.length)
    httpError(400, 'Preencha todos os campos obrigatórios.');
  const { org, baseUrl } = parseOrgInput(rawOrg);
  const auth = Buffer.from(`:${pat}`).toString('base64');

  const projects = await Promise.all(parsed.map(async ({ name, workItemType, team }) => {
    const prevProj = (existingForMerge.projects || []).find(
      ep => typeof ep === 'object' && ep.name === name && (ep.team || undefined) === team
    );
    // Preserva as configurações do projeto (ServiceNow, indicadores, report, burndown...)
    const base = prevProj ? { ...prevProj } : {};
    const typeChanged = prevProj && (prevProj.workItemType || 'User Story') !== workItemType;
    if (typeChanged) TYPE_DEPENDENT_FIELDS.forEach(f => { delete base[f]; });
    delete base.team;

    const proj = { ...base, name, workItemType, ...(team ? { team } : {}) };

    if (isLegacyType(workItemType)) {
      delete proj.estimateField; delete proj.estimateUnit; delete proj.states;
    } else {
      const resolved = await resolveTypeProfile({ baseUrl, auth, project: name, workItemType });
      if (resolved) Object.assign(proj, resolved);
    }
    return proj;
  }));

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

module.exports = { listProjects, listWorkItemTypes, resolveTypeProfile, setup, removeProject, disconnect, markOnboarded };

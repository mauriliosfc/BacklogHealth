const { getCfg, saveConfig, getDisplayName, parseOrgInput } = require('../config');
const { rawAzureGet } = require('../azureClient');
const { buildAndCache } = require('./dashboard');
const { httpError } = require('./utils');
const state = require('./state');
const { isLegacyType, pickEstimateField, statesFromCategories } = require('../utils/workItemProfile');
const { orgIdFor, uniqueOrgId, orgLabel, sameBaseUrl, assignProjectKeys } = require('../utils/orgs');

async function listProjects({ org, pat, orgId }) {
  pat = _patFor({ org, pat, orgId });
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
async function listWorkItemTypes({ org, pat, project, orgId }) {
  pat = _patFor({ org, pat, orgId });
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

// addOrg: a tela está adicionando uma organização nova — nunca substitui uma existente
// (sem isso, com uma só organização salva, o fluxo antigo trocaria a existente pela nova)
// e pode salvar sem projetos (eles são escolhidos logo depois, na aba Projetos).
async function setup({ rawOrg, pat, projectsRaw, projectsJson, orgId, label, addOrg = false }) {
  const existingForMerge = getCfg();
  const parsed = _parseProjects(projectsRaw, projectsJson);
  if (!rawOrg || (!parsed.length && !addOrg))
    httpError(400, 'Preencha todos os campos obrigatórios.');
  const { org, baseUrl } = parseOrgInput(rawOrg);

  // Organização alvo: a indicada (orgId), a única existente (fluxo de sempre) ou a de mesma URL
  const orgs   = _orgsOf(existingForMerge);
  const target = addOrg ? null : _findTargetOrg(orgs, { orgId, baseUrl });
  const dup    = orgs.find(o => o !== target && sameBaseUrl(o.baseUrl, baseUrl));
  if (dup) httpError(409, `A organização "${orgLabel(dup)}" já está conectada.`);

  // PAT em branco = manter o salvo da organização (o PAT não volta para a tela)
  const effectivePat = pat || (target && sameBaseUrl(target.baseUrl, baseUrl) ? target.pat : '');
  if (!effectivePat) httpError(400, 'Preencha todos os campos obrigatórios.');
  const auth = Buffer.from(`:${effectivePat}`).toString('base64');

  const newOrg = {
    ...(target || {}),
    id:      target ? target.id : uniqueOrgId(org, baseUrl, orgs),
    org, baseUrl, pat: effectivePat,
  };
  if (label !== undefined) {
    const clean = String(label || '').trim();
    if (clean) newOrg.label = clean; else delete newOrg.label;
  }

  // Sem nenhuma organização salva, projetos sem orgId pertencem à que está sendo criada
  const isTargetProject = ep => typeof ep === 'object' && (target
    ? (ep.orgId || orgs[0]?.id) === target.id
    : (!orgs.length && !ep.orgId));
  const targetProjects  = (existingForMerge.projects || []).filter(isTargetProject);
  const otherProjects   = (existingForMerge.projects || []).filter(ep => !isTargetProject(ep));

  let projects = await Promise.all(parsed.map(async ({ name, workItemType, team }) => {
    const prevProj = targetProjects.find(
      ep => ep.name === name && (ep.team || undefined) === team
    );
    // Preserva as configurações do projeto (ServiceNow, indicadores, report, burndown...)
    const base = prevProj ? { ...prevProj } : {};
    const typeChanged = prevProj && (prevProj.workItemType || 'User Story') !== workItemType;
    if (typeChanged) TYPE_DEPENDENT_FIELDS.forEach(f => { delete base[f]; });
    delete base.team;

    const proj = { ...base, name, workItemType, ...(team ? { team } : {}), orgId: newOrg.id };

    if (isLegacyType(workItemType)) {
      delete proj.estimateField; delete proj.estimateUnit; delete proj.states;
    } else {
      const resolved = await resolveTypeProfile({ baseUrl, auth, project: name, workItemType });
      if (resolved) Object.assign(proj, resolved);
    }
    return proj;
  }));
  // Mesmo nome em outra organização → identificador com o nome da organização
  projects = assignProjectKeys(projects, otherProjects, newOrg);

  const organizations = target ? orgs.map(o => (o === target ? newOrg : o)) : [...orgs, newOrg];
  const primary = organizations[0];
  const existing = getCfg();
  saveConfig({
    ...existing,
    org: primary.org, baseUrl: primary.baseUrl, pat: primary.pat,
    organizations,
    projects: _mergeOrgProjects(existingForMerge.projects || [], isTargetProject, projects),
    _onboarded: true,
  });
  await buildAndCache();
  return { ok: true, orgId: newOrg.id };
}

// Organizações da config; configs antigas (sem organizations) viram uma lista de uma
function _orgsOf(cfg) {
  if (Array.isArray(cfg.organizations) && cfg.organizations.length) return cfg.organizations;
  if (cfg.org || cfg.baseUrl) {
    const baseUrl = cfg.baseUrl || `https://dev.azure.com/${cfg.org}`;
    return [{ id: orgIdFor(cfg.org, baseUrl), org: cfg.org || '', baseUrl, pat: cfg.pat || '' }];
  }
  return [];
}

function _findTargetOrg(orgs, { orgId, baseUrl }) {
  if (orgId) {
    const byId = orgs.find(o => o.id === orgId);
    if (!byId) httpError(404, 'Organização não encontrada.');
    return byId;
  }
  if (orgs.length <= 1) return orgs[0] || null;   // fluxo de uma organização: substitui a existente
  return orgs.find(o => sameBaseUrl(o.baseUrl, baseUrl)) || null;
}

// Substitui os projetos da organização mantendo a posição deles na lista
function _mergeOrgProjects(existing, isTargetProject, newProjects) {
  const out = [];
  let inserted = false;
  for (const p of existing) {
    if (isTargetProject(p)) {
      if (!inserted) { out.push(...newProjects); inserted = true; }
    } else {
      out.push(p);
    }
  }
  if (!inserted) out.push(...newProjects);
  return out;
}

// Organizações para a tela de Configurações — nunca devolve o PAT
function listOrganizations() {
  const cfg  = getCfg();
  const orgs = _orgsOf(cfg);
  const projects = cfg.projects || [];
  return {
    organizations: orgs.map(o => {
      const own = projects.filter(p => typeof p === 'object' && (p.orgId || orgs[0]?.id) === o.id);
      return {
        id: o.id, org: o.org, baseUrl: o.baseUrl, label: o.label || '',
        hasPat: !!o.pat, projectCount: own.length,
        projects: own.map(p => ({ name: p.name, team: p.team || undefined, workItemType: p.workItemType || 'User Story' })),
      };
    }),
  };
}

// Remove uma organização e os projetos dela. A próxima vira a principal.
async function removeOrganization({ orgId } = {}) {
  if (!orgId) httpError(400, 'orgId obrigatório');
  const cfg  = getCfg();
  const orgs = _orgsOf(cfg);
  const target = orgs.find(o => o.id === orgId);
  if (!target) httpError(404, 'Organização não encontrada.');
  const isOwn = p => typeof p === 'object' && (p.orgId || orgs[0]?.id) === orgId;
  const removedProjects = (cfg.projects || []).filter(isOwn).length;
  const organizations = orgs.filter(o => o.id !== orgId);
  const projects = (cfg.projects || []).filter(p => !isOwn(p));
  if (!organizations.length) {
    saveConfig({ ...cfg, org: '', baseUrl: '', pat: '', organizations: [], projects: [] });
    state.html = '';
    return { ok: true, removedProjects };
  }
  const primary = organizations[0];
  saveConfig({ ...cfg, org: primary.org, baseUrl: primary.baseUrl, pat: primary.pat, organizations, projects });
  await buildAndCache();
  return { ok: true, removedProjects };
}

// PAT informado ou, em branco, o salvo da organização (por id ou pela URL)
function _patFor({ org, pat, orgId }) {
  if (pat) return pat;
  const orgs = _orgsOf(getCfg() || {});
  const byId = orgId ? orgs.find(o => o.id === orgId) : null;
  if (byId) return byId.pat || '';
  if (!org || !orgs.length) return '';
  const { baseUrl } = parseOrgInput(org) || {};
  const byUrl = orgs.find(o => sameBaseUrl(o.baseUrl, baseUrl));
  return (byUrl && byUrl.pat) || '';
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
  saveConfig({ ...existing, org: '', baseUrl: '', pat: '', organizations: [], projects: [] });
  state.html = '';
  return { ok: true };
}

async function markOnboarded() {
  saveConfig({ ...getCfg(), _onboarded: true });
  return { ok: true };
}

module.exports = { listProjects, listWorkItemTypes, resolveTypeProfile, setup, removeProject, disconnect, markOnboarded, listOrganizations, removeOrganization };

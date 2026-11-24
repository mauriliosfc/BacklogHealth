const fs       = require('fs');
const nodePath = require('path');
const { getCfg, getAppMode } = require('../config');
const { fetchProject, buildCardHTML } = require('../projectService');
const { getWorkItemProfile, lacksEstimate, statesOr } = require('../utils/workItemProfile');
const { AUTH_ERROR_CODE } = require('../azureClient');
const { orgIdFor, orgLabel } = require('../utils/orgs');
const state = require('./state');

const EMPTY_STATE_HTML = `
<div class="empty-state">
  <div class="empty-state-illus">
    <svg width="210" height="130" viewBox="0 0 210 130" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="6"   y="22" width="58" height="82" rx="8" stroke="var(--bg-el2)" stroke-width="1.5" stroke-dasharray="5 3"/>
      <rect x="76"  y="10" width="58" height="94" rx="8" stroke="var(--bg-el2)" stroke-width="1.5" stroke-dasharray="5 3"/>
      <rect x="146" y="22" width="58" height="82" rx="8" stroke="var(--bg-el2)" stroke-width="1.5" stroke-dasharray="5 3"/>
      <rect x="18"  y="36" width="34" height="5"  rx="2.5" fill="var(--bg-el2)"/>
      <rect x="18"  y="46" width="26" height="4"  rx="2" fill="var(--bg-el2)" opacity=".6"/>
      <rect x="88"  y="24" width="34" height="5"  rx="2.5" fill="var(--bg-el2)"/>
      <rect x="88"  y="34" width="26" height="4"  rx="2" fill="var(--bg-el2)" opacity=".6"/>
      <rect x="158" y="36" width="34" height="5"  rx="2.5" fill="var(--bg-el2)"/>
      <rect x="158" y="46" width="26" height="4"  rx="2" fill="var(--bg-el2)" opacity=".6"/>
      <circle cx="105" cy="82" r="20" stroke="var(--text-faint)" stroke-width="1.5"/>
      <path d="M119 96l9 9" stroke="var(--text-faint)" stroke-width="2" stroke-linecap="round"/>
      <path d="M97 82h16M105 74v16" stroke="var(--text-faint)" stroke-width="1.5" stroke-linecap="round"/>
    </svg>
  </div>
  <h2 class="empty-state-title" data-i18n="empty_title">No projects yet</h2>
  <p class="empty-state-sub" data-i18n="empty_sub">Add your Azure DevOps projects to start monitoring backlog health.</p>
  <div class="empty-state-actions">
    <a href="/settings" class="empty-state-btn" data-i18n="empty_cta">Configure Azure DevOps</a>
  </div>
</div>`;

const APP_VERSION = (() => { try { return require('../package.json').version; } catch { return ''; } })();

const VIEWS_DIR = nodePath.join(__dirname, '..', 'views');
const templates = {
  dashboard:   fs.readFileSync(nodePath.join(VIEWS_DIR, 'dashboard.html'),    'utf8'),
  setup:       fs.readFileSync(nodePath.join(VIEWS_DIR, 'setup.html'),        'utf8'),
  snDashboard: fs.readFileSync(nodePath.join(VIEWS_DIR, 'sn-dashboard.html'), 'utf8'),
};

function escapeHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function renderTemplate(html, vars) {
  return html.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
    const val = vars[key.trim()];
    return val == null ? '' : String(val);
  });
}

function buildSummaryBar(results) {
  const ok = results.filter(r => !r.error);
  if (!ok.length) return '';
  const ACTIVE  = ['Active', 'In Progress', 'New'];
  let totalItems = 0, totalOpen = 0, totalIssues = 0;
  for (const r of ok) {
    const profile = r.profile || getWorkItemProfile({ workItemType: r.workItemType });
    const CLOSED  = statesOr(profile, 'closed', ['Closed', 'Done', 'Resolved', 'Removed']);
    const mains  = (r.items || []).filter(i => profile.mainTypes.includes(i.fields?.['System.WorkItemType']));
    const opens  = mains.filter(i => !CLOSED.includes(i.fields?.['System.State']));
    const semEst = opens.filter(i => lacksEstimate(i.fields, profile)).length;
    const semResp = opens.filter(i => !i.fields?.['System.AssignedTo']).length;
    const bugs    = (r.items || []).filter(i =>
      i.fields?.['System.WorkItemType'] === 'Bug' && ACTIVE.includes(i.fields?.['System.State'])
    ).length;
    totalItems  += mains.length;
    totalOpen   += opens.length;
    totalIssues += semEst + semResp + bugs;
  }
  const issueClass = totalIssues > 0 ? ' sum-val--warn' : '';
  return `<div class="sum-bar" id="sum-bar">
    <div class="sum-stat">
      <div class="sum-lbl" data-i18n="sum_projects">Projects</div>
      <div class="sum-val">${ok.length}</div>
      <div class="sum-sub" data-i18n="sum_monitored">monitored</div>
    </div>
    <div class="sum-stat">
      <div class="sum-lbl" data-i18n="sum_items">Total Itens</div>
      <div class="sum-val" id="sum-workitems">${totalItems}</div>
      <div class="sum-sub" data-i18n="sum_in_backlog">no backlog</div>
    </div>
    <div class="sum-stat">
      <div class="sum-lbl" data-i18n="sum_open">Itens Abertos</div>
      <div class="sum-val" id="sum-open">${totalOpen}</div>
      <div class="sum-sub" data-i18n="sum_open_sub">em aberto</div>
    </div>
    <div class="sum-stat">
      <div class="sum-lbl" data-i18n="sum_issues">Issues</div>
      <div class="sum-val${issueClass}" id="sum-issues">${totalIssues || '—'}</div>
      <div class="sum-sub" data-i18n="sum_need_attention">need attention</div>
    </div>
  </div>`;
}

const SOURCE_TOGGLE_HTML = `<div class="source-switcher">
  <button class="btn-source active" data-source="az" onclick="toggleSource('az')" title="Projetos Azure">AZ</button>
  <button class="btn-source" data-source="sn" onclick="toggleSource('sn')" title="Projetos ServiceNow">SN</button>
</div>`;

// Aviso no topo quando o PAT do Azure DevOps foi recusado (expirado, revogado ou sem permissão)
function buildAuthBanner(results) {
  const failed = results.filter(r => r.errorCode === AUTH_ERROR_CODE);
  if (!failed.length) return '';
  // Multi-org: mostra quais organizações estão com o token recusado
  const orgNames = [...new Set(failed.map(r => r.orgLabel).filter(Boolean))];
  const orgsLine = orgNames.length
    ? `<div class="az-auth-banner-orgs">${orgNames.map(escapeHtml).join(' · ')}</div>`
    : '';
  return `<div class="az-auth-banner" role="alert">
    <svg class="az-auth-banner-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
    <div class="az-auth-banner-text">
      <div class="az-auth-banner-title" data-i18n="err_azure_auth_title">Seu token do Azure DevOps expirou ou é inválido</div>
      <div class="az-auth-banner-sub" data-i18n="err_azure_auth_sub">Gere um novo Personal Access Token no Azure DevOps (permissões Work Items e Project and Team, leitura) e atualize em Configurações para voltar a carregar os projetos.</div>
      ${orgsLine}
    </div>
    <a class="az-auth-banner-btn" href="/settings" data-i18n="err_azure_auth_btn">Atualizar token</a>
  </div>`;
}

// Com mais de uma organização, cada card ganha o nome da sua (chip no cabeçalho)
function withOrgLabels(results, organizations) {
  if (!Array.isArray(organizations) || organizations.length < 2) return results;
  const byId = new Map(organizations.map(o => [o.id, o]));
  return results.map(r => {
    const org = byId.get(r.orgId) || organizations[0];
    return { ...r, orgLabel: orgLabel(org) };
  });
}

function renderDashboard(results) {
  const cfg     = getCfg();
  const isEmpty = !cfg.projects || cfg.projects.length === 0;
  const count   = results.filter(r => !r.error).length;
  const baseUrl = cfg.baseUrl || `https://dev.azure.com/${cfg.org}`;
  const orgSafe = escapeHtml(cfg.org);
  const orgCount = Array.isArray(cfg.organizations) ? cfg.organizations.length : 0;
  const labeled  = withOrgLabels(results, cfg.organizations);
  const orgPart  = orgCount > 1 ? `${orgCount} organizations` : (orgSafe || 'Azure DevOps');
  return renderTemplate(templates.dashboard, {
    ORG:           orgSafe,
    SUBTITLE:      isEmpty
      ? (orgSafe || 'Azure DevOps')
      : `${count} project${count !== 1 ? 's' : ''} · ${orgPart}`,
    LAST_UPDATE:   new Date().toLocaleString('pt-BR'),
    CARDS:         isEmpty ? EMPTY_STATE_HTML : buildCardHTML(labeled, baseUrl),
    EMPTY_CLASS:   isEmpty ? 'cards-grid--empty' : '',
    SUMMARY_BAR:   isEmpty ? '' : buildAuthBanner(labeled) + buildSummaryBar(results),
    SOURCE_TOGGLE: getAppMode() === 'full' ? SOURCE_TOGGLE_HTML : '',
    VERSION:       APP_VERSION,
  });
}

// Texto do campo "organização": URL completa para *.visualstudio.com, senão o nome
function _orgDisplay(org) {
  if (!org) return '';
  return org.baseUrl && org.baseUrl.includes('visualstudio.com') ? org.baseUrl : (org.org || '');
}

// Mapa "projeto[|time]" → tipo de item, como a tela de setup espera
function _projectsMap(projects) {
  const map = {};
  (projects || []).forEach(p => {
    const name         = typeof p === 'string' ? p : p.name;
    const team         = typeof p === 'string' ? undefined : p.team;
    const workItemType = typeof p === 'string' ? 'User Story' : (p.workItemType || 'User Story');
    map[team ? `${name}|${team}` : name] = workItemType;
  });
  return map;
}

function renderSetup(prefill = {}) {
  // Organizações salvas (configs antigas: uma, a partir dos campos do topo)
  const orgs = Array.isArray(prefill.organizations) && prefill.organizations.length
    ? prefill.organizations
    : (prefill.org ? [{ id: orgIdFor(prefill.org, prefill.baseUrl), org: prefill.org, baseUrl: prefill.baseUrl || `https://dev.azure.com/${prefill.org}`, pat: prefill.pat }] : []);
  const current    = orgs[0] || null;
  const isSettings = !!current;
  const ownProjects = o => (prefill.projects || []).filter(p => typeof p === 'string' || (p.orgId || orgs[0]?.id) === o.id);

  // O PAT nunca volta para a página: campo em branco = manter o salvo
  const orgsForPage = orgs.map(o => ({
    id: o.id, org: o.org || '', baseUrl: o.baseUrl || '', label: o.label || '',
    display: _orgDisplay(o), hasPat: !!o.pat,
    projectCount: ownProjects(o).length,
    projects: _projectsMap(ownProjects(o)),
  }));
  const toJson = v => JSON.stringify(v).replace(/</g, '\\u003c');
  const selectedProjectsJson = toJson(current ? _projectsMap(ownProjects(current)) : {});

  return renderTemplate(templates.setup, {
    TITLE:                  isSettings ? 'Settings' : 'Setup',
    SUBTITLE:               isSettings
      ? 'Update your credentials and monitored projects'
      : 'Configure your Azure DevOps credentials to get started',
    ORG_VALUE:              escapeHtml(_orgDisplay(current)),
    ORG_LABEL_VALUE:        escapeHtml(current?.label || ''),
    PAT_VALUE:              '',
    SELECTED_PROJECTS_JSON: selectedProjectsJson,
    ORGS_JSON:              toJson(orgsForPage),
    CURRENT_ORG_JSON:       toJson(current ? current.id : null),
    BACK_LINK:              isSettings
      ? '<a class="su-back-link" href="/" data-i18n="setup_back">\u2190 Back to Dashboard</a>'
      : '',
    AUTO_LOAD_SCRIPT:       isSettings ? "window.addEventListener('load', loadProjects);" : '',
  });
}

// Renders the SN-only dashboard and stores in shared state.
async function buildSNCache() {
  const snDash = require('./sn-dashboard');
  const cfg    = getCfg();
  const sn     = cfg.servicenow || {};
  const host   = (sn.instance || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const { kpi, cardsHtml } = await snDash.fetchAndBuildCards();
  const month  = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  state.html   = renderTemplate(templates.snDashboard, {
    SUBTITLE:      `${kpi.activeGroups} group${kpi.activeGroups !== 1 ? 's' : ''} · ${host}`,
    LAST_UPDATE:   new Date().toLocaleString('en-US'),
    KPI_OPEN:      kpi.totalOpen,
    KPI_P1:        kpi.totalP1,
    KPI_P2:        kpi.totalP2,
    KPI_P3:        kpi.totalP3,
    KPI_P4:        kpi.totalP4,
    KPI_GROUPS:    kpi.activeGroups,
    KPI_RESOLVED:  kpi.resolvedThisMonth,
    KPI_MTTR:      kpi.mttr,
    SECTION_MONTH: `Incidents by Group — ${month}`,
    CARDS:         cardsHtml,
  });
}

// Fetches all projects, renders dashboard HTML and stores in shared state.
async function buildAndCache() {
  if (getAppMode() === 'sn-only') {
    return buildSNCache();
  }
  const cfg     = getCfg();
  const results = await Promise.all(cfg.projects.map(fetchProject));
  state.html    = renderDashboard(results);
}

module.exports = { renderDashboard, renderSetup, buildAndCache, buildSummaryBar, buildAuthBanner, withOrgLabels };

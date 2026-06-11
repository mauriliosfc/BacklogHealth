const fs       = require('fs');
const nodePath = require('path');
const { getCfg, getAppMode } = require('../config');
const { fetchProject, buildCardHTML } = require('../projectService');
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

const VIEWS_DIR = nodePath.join(__dirname, '..', 'views');
const templates = {
  dashboard:   fs.readFileSync(nodePath.join(VIEWS_DIR, 'dashboard.html'),    'utf8'),
  setup:       fs.readFileSync(nodePath.join(VIEWS_DIR, 'setup.html'),        'utf8'),
  snDashboard: fs.readFileSync(nodePath.join(VIEWS_DIR, 'sn-dashboard.html'), 'utf8'),
};

function renderTemplate(html, vars) {
  return html.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
    const val = vars[key.trim()];
    return val == null ? '' : String(val);
  });
}

function buildSummaryBar(results) {
  const ok = results.filter(r => !r.error);
  if (!ok.length) return '';
  const CLOSED = ['Closed', 'Done', 'Resolved', 'Removed'];
  const ACTIVE  = ['Active', 'In Progress', 'New'];
  let totalItems = 0, totalIssues = 0;
  const sprintNames = [];
  for (const r of ok) {
    const isTask = r.workItemType === 'Task';
    const TYPES  = isTask ? ['Task'] : ['User Story', 'Product Backlog Item', 'Requirement'];
    const mains  = (r.items || []).filter(i => TYPES.includes(i.fields?.['System.WorkItemType']));
    const opens  = mains.filter(i => !CLOSED.includes(i.fields?.['System.State']));
    const semEst = opens.filter(i => isTask
      ? (i.fields?.['Microsoft.VSTS.Scheduling.RemainingWork'] == null || i.fields['Microsoft.VSTS.Scheduling.RemainingWork'] === 0) &&
        (i.fields?.['Microsoft.VSTS.Scheduling.OriginalEstimate'] == null || i.fields['Microsoft.VSTS.Scheduling.OriginalEstimate'] === 0)
      : i.fields?.['Microsoft.VSTS.Scheduling.StoryPoints'] == null
    ).length;
    const semResp = opens.filter(i => !i.fields?.['System.AssignedTo']).length;
    const bugs    = (r.items || []).filter(i =>
      i.fields?.['System.WorkItemType'] === 'Bug' && ACTIVE.includes(i.fields?.['System.State'])
    ).length;
    totalItems  += mains.length;
    totalIssues += semEst + semResp + bugs;
    if (r.sprint) sprintNames.push(r.sprint);
  }
  const sprintLabel = sprintNames.length === 0 ? '—'
    : sprintNames.every(s => s === sprintNames[0]) ? sprintNames[0]
    : 'Multiple';
  const issueClass = totalIssues > 0 ? ' sum-val--warn' : '';
  return `<div class="sum-bar" id="sum-bar">
    <div class="sum-stat">
      <div class="sum-lbl" data-i18n="sum_projects">Projects</div>
      <div class="sum-val">${ok.length}</div>
      <div class="sum-sub" data-i18n="sum_monitored">monitored</div>
    </div>
    <div class="sum-stat">
      <div class="sum-lbl">Sprint</div>
      <div class="sum-val sum-val--md">${sprintLabel}</div>
      <div class="sum-sub" data-i18n="sum_current_sprint">current sprint</div>
    </div>
    <div class="sum-stat">
      <div class="sum-lbl" data-i18n="sum_items">Work Items</div>
      <div class="sum-val">${totalItems}</div>
      <div class="sum-sub" data-i18n="sum_in_backlog">in backlog</div>
    </div>
    <div class="sum-stat">
      <div class="sum-lbl" data-i18n="sum_issues">Issues</div>
      <div class="sum-val${issueClass}">${totalIssues || '—'}</div>
      <div class="sum-sub" data-i18n="sum_need_attention">need attention</div>
    </div>
  </div>`;
}

function renderDashboard(results) {
  const cfg     = getCfg();
  const isEmpty = !cfg.projects || cfg.projects.length === 0;
  const count   = results.filter(r => !r.error).length;
  const baseUrl = cfg.baseUrl || `https://dev.azure.com/${cfg.org}`;
  return renderTemplate(templates.dashboard, {
    ORG:         cfg.org,
    SUBTITLE:    isEmpty
      ? (cfg.org || 'Azure DevOps')
      : `${count} project${count !== 1 ? 's' : ''} · ${cfg.org || 'Azure DevOps'}`,
    LAST_UPDATE: new Date().toLocaleString('pt-BR'),
    CARDS:       isEmpty ? EMPTY_STATE_HTML : buildCardHTML(results, baseUrl),
    EMPTY_CLASS: isEmpty ? 'cards-grid--empty' : '',
    SUMMARY_BAR: isEmpty ? '' : buildSummaryBar(results),
  });
}

function renderSetup(prefill = {}) {
  const orgDisplay = prefill.baseUrl && prefill.baseUrl.includes('visualstudio.com')
    ? prefill.baseUrl
    : (prefill.org || '');
  const pat        = (prefill.pat || '').replace(/"/g, '&quot;');
  const isSettings = !!(prefill.org);

  const projectsMap = {};
  if (prefill.projects && Array.isArray(prefill.projects)) {
    prefill.projects.forEach(p => {
      const name         = typeof p === 'string' ? p : p.name;
      const team         = typeof p === 'string' ? undefined : p.team;
      const workItemType = typeof p === 'string' ? 'User Story' : (p.workItemType || 'User Story');
      const key          = team ? `${name}|${team}` : name;
      projectsMap[key]   = workItemType;
    });
  }
  const selectedProjectsJson = JSON.stringify(projectsMap).replace(/</g, '\\u003c');

  return renderTemplate(templates.setup, {
    TITLE:                  isSettings ? 'Settings' : 'Setup',
    SUBTITLE:               isSettings
      ? 'Update your credentials and monitored projects'
      : 'Configure your Azure DevOps credentials to get started',
    ORG_VALUE:              orgDisplay.replace(/"/g, '&quot;'),
    PAT_VALUE:              pat,
    SELECTED_PROJECTS_JSON: selectedProjectsJson,
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
    KPI_GROUPS:    kpi.activeGroups,
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

module.exports = { renderDashboard, renderSetup, buildAndCache, buildSummaryBar };

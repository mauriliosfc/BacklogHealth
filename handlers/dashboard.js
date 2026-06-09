const fs       = require('fs');
const nodePath = require('path');
const { getCfg } = require('../config');
const { fetchProject, buildCardHTML } = require('../projectService');
const state = require('./state');

const VIEWS_DIR = nodePath.join(__dirname, '..', 'views');
const templates = {
  dashboard: fs.readFileSync(nodePath.join(VIEWS_DIR, 'dashboard.html'), 'utf8'),
  setup:     fs.readFileSync(nodePath.join(VIEWS_DIR, 'setup.html'),     'utf8'),
};

function renderTemplate(html, vars) {
  return html.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
    const val = vars[key.trim()];
    return val == null ? '' : String(val);
  });
}

function renderDashboard(results) {
  const cfg = getCfg();
  const count   = results.filter(r => !r.error).length;
  const baseUrl = cfg.baseUrl || `https://dev.azure.com/${cfg.org}`;
  return renderTemplate(templates.dashboard, {
    ORG:         cfg.org,
    SUBTITLE:    `${count} project${count !== 1 ? 's' : ''} · ${cfg.org || 'Azure DevOps'}`,
    LAST_UPDATE: new Date().toLocaleString('pt-BR'),
    CARDS:       buildCardHTML(results, baseUrl),
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
    TITLE:                  isSettings ? 'Configurações' : 'Configuração inicial',
    SUBTITLE:               isSettings
      ? 'Atualize suas credenciais e projetos monitorados'
      : 'Configure suas credenciais do Azure DevOps para começar',
    ORG_VALUE:              orgDisplay.replace(/"/g, '&quot;'),
    PAT_VALUE:              pat,
    SELECTED_PROJECTS_JSON: selectedProjectsJson,
    BACK_LINK:              isSettings
      ? '<a class="su-back-link" href="/" data-i18n="setup_back">\u2190 Back to Dashboard</a>'
      : '',
    AUTO_LOAD_SCRIPT:       isSettings ? "window.addEventListener('load', loadProjects);" : '',
  });
}

// Fetches all projects, renders dashboard HTML and stores in shared state.
async function buildAndCache() {
  const cfg     = getCfg();
  const results = await Promise.all(cfg.projects.map(fetchProject));
  state.html    = renderDashboard(results);
}

module.exports = { renderDashboard, renderSetup, buildAndCache };

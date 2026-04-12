const dns      = require("dns");
const http     = require("http");
const fs       = require("fs");
const nodePath = require("path");
dns.setDefaultResultOrder("ipv4first");

const { PORT, loadConfig, saveConfig, getCfg, parseOrgInput, getDisplayName, getAiCfg, saveAiConfig, getGithubCfg } = require("./config");
const { createIssue } = require("./githubClient");
const { rawAzureGet }                             = require("./azureClient");
const { fetchProject, fetchProjectDetail, buildCardHTML } = require("./projectService");
const { fetchTeamCapacity } = require("./teamCapacityService");
const { chatCompletion, testConnection } = require("./aiClient");

// ── Template rendering ────────────────────────────────────────────────────────

const VIEWS_DIR  = nodePath.join(__dirname, "views");
const PUBLIC_DIR = nodePath.join(__dirname, "public");

const templates = {
  dashboard: fs.readFileSync(nodePath.join(VIEWS_DIR, "dashboard.html"), "utf8"),
  setup:     fs.readFileSync(nodePath.join(VIEWS_DIR, "setup.html"),     "utf8"),
};


function renderTemplate(html, vars) {
  return html.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
    const val = vars[key.trim()];
    return val == null ? "" : String(val);
  });
}

function renderDashboard(results) {
  const cfg = getCfg();
  const cards = buildCardHTML(results);
  const count = results.filter(r => !r.error).length;
  return renderTemplate(templates.dashboard, {
    ORG:         cfg.org,
    SUBTITLE:    `${count} project${count !== 1 ? 's' : ''} · ${cfg.org || 'Azure DevOps'}`,
    LAST_UPDATE: new Date().toLocaleString("pt-BR"),
    CARDS:       cards,
  });
}

function renderSetup(prefill = {}) {
  const orgDisplay = prefill.baseUrl && prefill.baseUrl.includes("visualstudio.com")
    ? prefill.baseUrl
    : (prefill.org || "");
  const pat  = (prefill.pat  || "").replace(/"/g, "&quot;");
  const isSettings = !!(prefill.org);

  // Converter projects para mapa { "ProjectName|TeamName": "User Story", "SimpleProject": "Task", ... }
  const projectsMap = {};
  if (prefill.projects && Array.isArray(prefill.projects)) {
    prefill.projects.forEach(p => {
      const name = typeof p === 'string' ? p : p.name;
      const team = typeof p === 'string' ? undefined : p.team;
      const workItemType = typeof p === 'string' ? 'User Story' : (p.workItemType || 'User Story');
      const key = team ? `${name}|${team}` : name;
      projectsMap[key] = workItemType;
    });
  }
  const selectedProjectsJson = JSON.stringify(projectsMap).replace(/</g, "\\u003c");

  return renderTemplate(templates.setup, {
    TITLE:                  isSettings ? "Configurações" : "Configuração inicial",
    SUBTITLE:               isSettings
      ? "Atualize suas credenciais e projetos monitorados"
      : "Configure suas credenciais do Azure DevOps para começar",
    ORG_VALUE:              orgDisplay.replace(/"/g, "&quot;"),
    PAT_VALUE:              pat,
    SELECTED_PROJECTS_JSON: selectedProjectsJson,
    BACK_LINK:              isSettings
      ? '<a class="su-back-link" href="/" data-i18n="setup_back">← Back to Dashboard</a>'
      : "",
    AUTO_LOAD_SCRIPT:       isSettings ? "window.addEventListener('load', loadProjects);" : "",
  });
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function readBody(req) {
  return new Promise(resolve => {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => resolve(body));
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const configured = loadConfig();
  let cachedHTML = "";

  if (configured) {
    console.log("🔄 Buscando dados do Azure DevOps...");
    const cfg = getCfg();
    const results = await Promise.all(cfg.projects.map(fetchProject));
    cachedHTML = renderDashboard(results);
    console.log("✅ Dados carregados! Iniciando servidor...");
  } else {
    console.log("⚙️  Configuração não encontrada. Iniciando tela de setup...");
  }

  const server = http.createServer(async (req, res) => {
    const url = req.url;

    // ── Arquivos estáticos ─────────────────────────────────────────────────
    const urlPath = url.split("?")[0];
    const staticPath = nodePath.join(PUBLIC_DIR, urlPath);
    if (fs.existsSync(staticPath) && fs.statSync(staticPath).isFile()) {
      const ext = nodePath.extname(staticPath);
      const mimeTypes = { ".css": "text/css", ".js": "application/javascript", ".json": "application/json", ".svg": "image/svg+xml" };
      res.writeHead(200, { "Content-Type": (mimeTypes[ext] || "text/plain") + "; charset=utf-8" });
      res.end(fs.readFileSync(staticPath));
      return;
    }

    // ── GET /api/projects ─────────────────────────────────────────────────
    if (url.startsWith("/api/projects")) {
      const qp = new URLSearchParams(url.split("?")[1] || "");
      const qOrg = qp.get("org")?.trim();
      const qPat = qp.get("pat")?.trim();
      if (!qOrg || !qPat) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "org e pat são obrigatórios" }));
        return;
      }
      try {
        const auth = Buffer.from(`:${qPat}`).toString("base64");
        const { baseUrl } = parseOrgInput(qOrg);
        // Fetch all projects with $skip pagination (API defaults to 100, max $top=200)
        const PAGE = 200;
        let allProjectNames = [];
        let skip = 0;
        while (true) {
          const result = await rawAzureGet(
            `${baseUrl}/_apis/projects?api-version=7.0&$top=${PAGE}&$skip=${skip}&stateFilter=wellFormed`,
            auth
          );
          if (skip === 0) {
            if (result.status === 401 || result.status === 203) {
              res.writeHead(401, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "PAT inválido ou sem permissão. Verifique o token e as permissões necessárias." }));
              return;
            }
            if (result.status === 404) {
              res.writeHead(404, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: `Organização não encontrada: "${qOrg}". Verifique o nome na URL do Azure DevOps.` }));
              return;
            }
            if (result.status !== 200) {
              res.writeHead(result.status, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: `Erro da API Azure DevOps: HTTP ${result.status}` }));
              return;
            }
          }
          const page = (result.data.value || []).map(p => p.name);
          allProjectNames = allProjectNames.concat(page);
          if (page.length < PAGE) break;
          skip += PAGE;
        }
        const projectNames = allProjectNames.sort((a, b) => a.localeCompare(b));
        // Fetch teams for each project in parallel to detect multi-team projects
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
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ projects }));
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Falha ao conectar com o Azure DevOps: " + (e.code || e.message) }));
      }
      return;
    }

    // ── POST /api/remove-project ───────────────────────────────────────────
    if (req.method === "POST" && url === "/api/remove-project") {
      const body = await readBody(req);
      const { project } = JSON.parse(body || '{}');
      const cfg = getCfg();
      cfg.projects = (cfg.projects || []).filter(p => getDisplayName(p) !== project);
      saveConfig(cfg);
      const results = await Promise.all(cfg.projects.map(fetchProject));
      cachedHTML = renderDashboard(results);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // ── POST /setup ────────────────────────────────────────────────────────
    if (req.method === "POST" && url === "/setup") {
      const body = await readBody(req);
      const params = new URLSearchParams(body);
      const rawOrg = params.get("org")?.trim();
      const pat = params.get("pat")?.trim();
      const projectsRaw = params.get("projects") || "";

      // Formato: "Project1:User Story,Project2:Task:TeamName"
      const projects = projectsRaw.split(/[\n,]+/)
        .map(p => p.trim())
        .filter(Boolean)
        .map(p => {
          const [name, workItemType, ...teamParts] = p.split(':');
          const team = teamParts.join(':').trim() || undefined;
          return {
            name: name.trim(),
            workItemType: (workItemType || 'User Story').trim(),
            ...(team ? { team } : {}),
          };
        });

      if (!rawOrg || !pat || !projects.length) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Preencha todos os campos obrigatórios." }));
        return;
      }

      const { org, baseUrl } = parseOrgInput(rawOrg);
      saveConfig({ org, baseUrl, pat, projects });

      try {
        console.log("🔄 Buscando dados dos projetos configurados...");
        const cfg = getCfg();
        const results = await Promise.all(cfg.projects.map(fetchProject));
        cachedHTML = renderDashboard(results);
        console.log("✅ Configuração salva e dados carregados!");
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Erro ao buscar dados: " + e.message }));
        return;
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // ── GET /settings ──────────────────────────────────────────────────────
    if (url === "/settings") {
      const cfg = getCfg();
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(renderSetup({ org: cfg.org || "", pat: cfg.pat || "", projects: cfg.projects || [] }));
      return;
    }

    // ── Sem config → setup ────────────────────────────────────────────────
    const cfg = getCfg();
    if (!cfg.org || !cfg.pat || !cfg.projects?.length) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(renderSetup());
      return;
    }

    // ── GET /refresh ───────────────────────────────────────────────────────
    if (url === "/refresh") {
      const results = await Promise.all(cfg.projects.map(fetchProject));
      cachedHTML = renderDashboard(results);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(cachedHTML);
      return;
    }

    // ── GET /api/team-capacity?project=NAME ───────────────────────────────
    if (url.startsWith('/api/team-capacity')) {
      const qp      = new URLSearchParams(url.split('?')[1] || '');
      const project = qp.get('project') || null;
      try {
        const data = await fetchTeamCapacity(project);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(data));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // ── GET /detail?project=NAME ───────────────────────────────────────────
    if (url.startsWith("/detail?")) {
      const project = new URLSearchParams(url.slice(8)).get("project");
      const displayNames = cfg.projects.map(p => getDisplayName(p));
      if (!project || !displayNames.includes(project)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Projeto não encontrado" }));
        return;
      }
      const data = await fetchProjectDetail(project);
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(data));
      return;
    }

    // ── POST /ai/context ───────────────────────────────────────────────────
    if (req.method === 'POST' && url === '/ai/context') {
      const cfg = getCfg();
      const displayNames = (cfg.projects || []).map(p => getDisplayName(p));
      const body = await readBody(req);
      const { filters = {} } = JSON.parse(body || '{}');
      try {
        const details = await Promise.all(displayNames.map(id => fetchProjectDetail(id)));
        const US_TYPES = ['User Story', 'Product Backlog Item', 'Requirement'];
        const CLOSED   = ['Closed', 'Done', 'Resolved'];
        const ACTIVE   = ['Active', 'In Progress', 'Doing', 'Committed'];
        const r1 = v => Math.round(v * 10) / 10;

        const projects = details.map(data => {
          const { project, items, taskItems, bugItems, iterMap, workItemType } = data;
          const isTaskMode = workItemType === 'Task';

          // normaliza filtro: localStorage guarda path completo, usamos só último segmento
          const activeFilter = (filters[project] || []).map(f => f.split('\\').pop());
          const hasFilter    = activeFilter.length > 0;
          const spName       = iter => (iter || '').split('\\').pop();
          const inFilter     = sp => !hasFilter || activeFilter.includes(sp);

          // filtra itens pelo sprint filter
          const filteredItems = items.filter(i => inFilter(spName(i.iteration)));
          const filteredTasks = taskItems.filter(t => inFilter(spName(t.iteration)));
          const filteredBugs  = bugItems.filter(b => inFilter(spName(b.iteration)));

          // itens principais (US ou Task conforme modo)
          const ITEM_TYPES = isTaskMode ? ['Task'] : US_TYPES;
          const mainItems  = filteredItems.filter(i => ITEM_TYPES.includes(i.type));
          const mainTotal  = mainItems.length;

          // ── Resumo Geral (igual ao detail modal) ──────────────────────────
          const totalPts    = filteredItems.reduce((s, i) => s + (i.pts || 0), 0);
          const donePts     = filteredItems.filter(i => CLOSED.includes(i.state)).reduce((s, i) => s + (i.pts || 0), 0);
          const inProgress  = filteredItems.filter(i => ACTIVE.includes(i.state)).length;
          const newCount    = filteredItems.filter(i => i.state === 'New').length;
          const noEst       = mainItems.filter(i => !i.pts).length;
          const taskHrs     = r1(filteredTasks.reduce((s, t) => s + (t.completedWork || 0), 0));
          const bugHrs      = r1(filteredBugs.reduce((s, b)  => s + (b.completedWork || 0), 0));
          const openBugsCount = items.filter(i => i.type === 'Bug' && ['Active','In Progress','New'].includes(i.state) && inFilter(spName(i.iteration))).length;

          // ── Indicadores de Saúde ──────────────────────────────────────────
          const mainClosed  = mainItems.filter(i => CLOSED.includes(i.state)).length;
          const mainUAT     = mainItems.filter(i => i.state === 'UAT').length;
          const mainNoEst   = mainItems.filter(i => !i.pts).length;
          const totalHrs    = taskHrs + bugHrs;
          const health = {
            completionRate:    mainTotal ? Math.round(mainClosed / mainTotal * 100) : 0,
            inUAT_pct:         mainTotal ? Math.round(mainUAT   / mainTotal * 100) : 0,
            inUAT_count:       mainUAT,
            bugRate_pct:       totalHrs  ? Math.round(bugHrs    / totalHrs  * 100) : 0,
            estimateCoverage:  mainTotal ? Math.round((mainTotal - mainNoEst) / mainTotal * 100) : 0,
          };

          // ── US por Status ─────────────────────────────────────────────────
          const byStatus = {};
          mainItems.forEach(i => { byStatus[i.state] = (byStatus[i.state] || 0) + 1; });
          const byStatusArr = Object.entries(byStatus).sort((a, b) => b[1] - a[1]).map(([status, count]) => ({ status, count }));

          // ── US por Responsável ────────────────────────────────────────────
          const byAssignee = {};
          mainItems.forEach(i => { const n = i.assigned || 'Sem responsável'; byAssignee[n] = (byAssignee[n] || 0) + 1; });
          const byAssigneeArr = Object.entries(byAssignee).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([assignee, count]) => ({ assignee, count }));

          // ── Distribuição por Sprint ───────────────────────────────────────
          const sprintMap = {};
          filteredItems.forEach(i => {
            const sp = spName(i.iteration) || 'Sem Sprint';
            if (!sprintMap[sp]) sprintMap[sp] = { us: 0, usClosed: 0, pts: 0, taskHrs: 0, bugHrs: 0 };
            if (ITEM_TYPES.includes(i.type)) {
              sprintMap[sp].us++;
              if (CLOSED.includes(i.state)) sprintMap[sp].usClosed++;
            }
            sprintMap[sp].pts += i.pts || 0;
          });
          filteredTasks.forEach(t => { const sp = spName(t.iteration) || 'Sem Sprint'; if (sprintMap[sp]) sprintMap[sp].taskHrs += t.completedWork || 0; });
          filteredBugs.forEach(b  => { const sp = spName(b.iteration)  || 'Sem Sprint'; if (sprintMap[sp]) sprintMap[sp].bugHrs  += b.completedWork || 0; });

          const currentEntry      = Object.entries(iterMap).find(([, v]) => v.isCurrent);
          const currentSprintName = currentEntry?.[0] ? spName(currentEntry[0]) : null;

          const sprintDistribution = Object.entries(sprintMap)
            .map(([sprint, s]) => {
              const meta = Object.entries(iterMap).find(([k]) => spName(k) === sprint);
              return {
                sprint,
                isCurrent: meta?.[1]?.isCurrent || false,
                start: meta?.[1]?.start || null,
                end:   meta?.[1]?.end   || null,
                totalUS:       s.us,
                completedUS:   s.usClosed,
                completionPct: s.us ? Math.round(s.usClosed / s.us * 100) : 0,
                storyPoints:   r1(s.pts),
                taskHrs:       r1(s.taskHrs),
                bugHrs:        r1(s.bugHrs),
              };
            })
            .sort((a, b) => (a.start || '').localeCompare(b.start || ''));

          // ── Sprint atual — itens detalhados ───────────────────────────────
          const effectiveSprint = hasFilter
            ? (activeFilter.includes(currentSprintName) ? currentSprintName : activeFilter[activeFilter.length - 1])
            : currentSprintName;
          const currentSprintItems = effectiveSprint
            ? mainItems.filter(i => spName(i.iteration) === effectiveSprint)
                       .map(i => ({ title: i.title, state: i.state, pts: i.pts, assignee: i.assigned }))
            : [];

          // ── Itens problemáticos ───────────────────────────────────────────
          const openMain    = mainItems.filter(i => !CLOSED.includes(i.state));
          const noEstItems  = openMain.filter(i => !i.pts) .map(i => ({ title: i.title, sprint: spName(i.iteration), assignee: i.assigned }));
          const noRespItems = openMain.filter(i => !i.assigned).map(i => ({ title: i.title, sprint: spName(i.iteration), pts: i.pts }));
          const openBugs    = items.filter(i => i.type === 'Bug' && ['Active','In Progress','New'].includes(i.state) && inFilter(spName(i.iteration)))
                                   .map(i => ({ title: i.title, state: i.state, sprint: spName(i.iteration) }));

          return {
            name: project,
            workItemType,
            activeSprintFilter: hasFilter ? activeFilter : null,
            summary: {
              totalItems:   filteredItems.length,
              userStories:  mainTotal,
              storyPoints:  r1(totalPts),
              deliveredPts: r1(donePts),
              inProgress,
              new:          newCount,
              noEstimate:   noEst,
              taskHrs,
              bugHrs,
              openBugs:     openBugsCount,
            },
            healthIndicators: health,
            byStatus:     byStatusArr,
            byAssignee:   byAssigneeArr,
            sprintDistribution,
            currentSprint: effectiveSprint ? {
              name:  effectiveSprint,
              start: currentEntry?.[1]?.start || null,
              end:   currentEntry?.[1]?.end   || null,
              items: currentSprintItems,
            } : null,
            noEstimateItems:  noEstItems.slice(0, 30),
            noAssigneeItems:  noRespItems.slice(0, 30),
            openBugs:         openBugs.slice(0, 30),
          };
        });

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ projects }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // ── GET /ai/config ─────────────────────────────────────────────────────
    if (req.method === 'GET' && url === '/ai/config') {
      const ai = getAiCfg();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        configured:  !!(ai?.endpoint && ai?.apiKey && ai?.model),
        endpoint:    ai?.endpoint    || '',
        apiKey:      ai?.apiKey      || '',
        model:       ai?.model       || '',
        apiVersion:  ai?.apiVersion  || '',
      }));
      return;
    }

    // ── POST /ai/config ────────────────────────────────────────────────────
    if (req.method === 'POST' && url === '/ai/config') {
      const body = await readBody(req);
      const p = JSON.parse(body);
      if (!p.endpoint || !p.apiKey || !p.model) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'endpoint, apiKey e model são obrigatórios.' }));
        return;
      }
      saveAiConfig({ endpoint: p.endpoint.trim(), apiKey: p.apiKey.trim(), model: p.model.trim(), apiVersion: (p.apiVersion || '').trim() });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // ── POST /ai/test ──────────────────────────────────────────────────────
    if (req.method === 'POST' && url === '/ai/test') {
      const body = await readBody(req);
      const p = JSON.parse(body);
      if (!p.endpoint || !p.apiKey || !p.model) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Preencha todos os campos obrigatórios.' }));
        return;
      }
      try {
        await testConnection({ endpoint: p.endpoint.trim(), apiKey: p.apiKey.trim(), model: p.model.trim(), apiVersion: (p.apiVersion || '').trim() });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // ── POST /ai/chat ──────────────────────────────────────────────────────
    if (req.method === 'POST' && url === '/ai/chat') {
      const ai = getAiCfg();
      if (!ai?.endpoint || !ai?.apiKey || !ai?.model) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'IA não configurada.' }));
        return;
      }
      const body = await readBody(req);
      const { message, history = [], context = '' } = JSON.parse(body);
      const systemPrompt = `You are Copilot Project, an AI assistant specialized in technology project management using Agile/Scrum methodology.

Your role is to help the team and project managers to:
- Analyze backlog health and identify risks (items without estimate, without assignee, excess open bugs)
- Monitor sprint progress and delivery capacity
- Suggest concrete and prioritized actions to improve project health
- Answer questions about sprints, User Stories, bugs and metrics from Azure DevOps
- Support daily standups, retrospectives and sprint planning with data-driven insights

Behavior guidelines:
- Always respond in the same language the user writes (Portuguese, English or Spanish)
- Be direct and objective — avoid long introductions
- When identifying a problem, always suggest a concrete action
- Use the dashboard data to support your answers with real numbers
- When data is insufficient to answer, say so clearly and suggest what information would be needed
- Do not invent data — only use what is provided in the context below

Current dashboard data:
${context || 'No project data available at this moment.'}`;

      const messages = [
        { role: 'system', content: systemPrompt },
        ...history,
        { role: 'user', content: message }
      ];
      try {
        const reply = await chatCompletion(ai, messages);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ reply }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // ── POST /api/feedback ─────────────────────────────────────────────────
    if (req.method === 'POST' && url === '/api/feedback') {
      const gh = getGithubCfg();
      if (!gh?.token || !gh?.repo) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'GitHub feedback not configured. Ask the administrator to configure it in Settings.' }));
        return;
      }
      const body = await readBody(req);
      const { type, title, description } = JSON.parse(body);
      if (!title?.trim() || !description?.trim()) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Title and description are required.' }));
        return;
      }
      const labelMap = { bug: 'bug', suggestion: 'enhancement', help: 'question' };
      const labels = labelMap[type] ? [labelMap[type]] : [];
      const typeEmoji = { bug: '🐛', suggestion: '💡', help: '❓', other: '📝' }[type] || '📝';
      const typeLabel = { bug: 'Bug Report', suggestion: 'Suggestion', help: 'Help Request', other: 'Other' }[type] || 'Feedback';
      const cfg = getCfg();
      const issueTitle = `${typeEmoji} [${typeLabel}] ${title.trim()}`;
      const issueBody = `## ${typeEmoji} ${typeLabel}\n\n${description.trim()}\n\n---\n*Sent via **Backlog Health Dashboard** · ${new Date().toISOString().split('T')[0]} · Org: \`${cfg.org || 'N/A'}\`*`;
      try {
        const issue = await createIssue({ token: gh.token, repo: gh.repo, title: issueTitle, body: issueBody, labels });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, url: issue.html_url }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // ── GET / — dashboard ──────────────────────────────────────────────────
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(cachedHTML);
  });

  server.listen(PORT, () => {
    console.log(`\n🚀 Dashboard rodando em: http://localhost:${PORT}\n`);
  });
}

main().catch(console.error);

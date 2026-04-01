const dns      = require("dns");
const http     = require("http");
const fs       = require("fs");
const nodePath = require("path");
const { exec } = require("child_process");

dns.setDefaultResultOrder("ipv4first");

const { PORT, loadConfig, saveConfig, getCfg }   = require("./config");
const { rawAzureGet }                             = require("./azureClient");
const { fetchProject, fetchProjectDetail, buildCardHTML } = require("./projectService");

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
  return renderTemplate(templates.dashboard, {
    ORG:         cfg.org,
    LAST_UPDATE: new Date().toLocaleString("pt-BR"),
    CARDS:       cards,
  });
}

function renderSetup(prefill = {}) {
  const org  = (prefill.org  || "").replace(/"/g, "&quot;");
  const pat  = (prefill.pat  || "").replace(/"/g, "&quot;");
  const isSettings = !!(prefill.org);
  const selectedProjectsJson = JSON.stringify(prefill.projects || []).replace(/</g, "\\u003c");

  return renderTemplate(templates.setup, {
    TITLE:                  isSettings ? "Configurações" : "Configuração inicial",
    SUBTITLE:               isSettings
      ? "Atualize suas credenciais e projetos monitorados"
      : "Configure suas credenciais do Azure DevOps para começar",
    ORG_VALUE:              org,
    PAT_VALUE:              pat,
    SELECTED_PROJECTS_JSON: selectedProjectsJson,
    BACK_LINK:              isSettings
      ? '<div style="text-align:center"><a class="btn-back" href="/">← Voltar ao dashboard</a></div>'
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
        const result = await rawAzureGet(
          `https://dev.azure.com/${encodeURIComponent(qOrg)}/_apis/projects?api-version=7.0&$top=200&stateFilter=wellFormed`,
          auth
        );
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
        const projects = (result.data.value || []).map(p => p.name).sort((a, b) => a.localeCompare(b));
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ projects }));
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Falha ao conectar com o Azure DevOps: " + (e.code || e.message) }));
      }
      return;
    }

    // ── POST /setup ────────────────────────────────────────────────────────
    if (req.method === "POST" && url === "/setup") {
      const body = await readBody(req);
      const params = new URLSearchParams(body);
      const org = params.get("org")?.trim();
      const pat = params.get("pat")?.trim();
      const projectsRaw = params.get("projects") || "";
      const projects = projectsRaw.split(/[\n,]+/).map(p => p.trim()).filter(Boolean);

      if (!org || !pat || !projects.length) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Preencha todos os campos obrigatórios." }));
        return;
      }

      saveConfig({ org, pat, projects });

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

    // ── GET /detail?project=NAME ───────────────────────────────────────────
    if (url.startsWith("/detail?")) {
      const project = new URLSearchParams(url.slice(8)).get("project");
      if (!project || !cfg.projects.includes(project)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Projeto não encontrado" }));
        return;
      }
      const data = await fetchProjectDetail(project);
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(data));
      return;
    }

    // ── GET / — dashboard ──────────────────────────────────────────────────
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(cachedHTML);
  });

  server.listen(PORT, () => {
    const serverUrl = `http://localhost:${PORT}`;
    console.log(`\n🚀 Dashboard rodando em: ${serverUrl}\n`);
    if (!process.env.NO_OPEN_BROWSER) {
      if (process.platform === "win32") {
        // Abre Edge em modo app (sem barra de endereços, como app nativo)
        exec(`start msedge --app=${serverUrl} --window-size=1440,900`, err => {
          if (err) exec(`start ${serverUrl}`); // fallback para browser padrão
        });
      } else if (process.platform === "darwin") {
        exec(`open -a "Microsoft Edge" --args --app=${serverUrl}`, err => {
          if (err) exec(`open ${serverUrl}`);
        });
      } else {
        exec(`xdg-open ${serverUrl}`);
      }
    }
  });
}

main().catch(console.error);

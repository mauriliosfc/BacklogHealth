const http = require("http");
const https = require("https");
const { exec } = require("child_process");
const fs = require("fs");
const nodePath = require("path");

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const PORT = 3030;
const CONFIG_PATH = nodePath.join(__dirname, "config.json");
let cfg = {};

function loadConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    if (raw.org && raw.pat && Array.isArray(raw.projects) && raw.projects.length) {
      cfg = raw;
      return true;
    }
  } catch (_) {}
  cfg = {};
  return false;
}

function saveConfig(data) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), "utf8");
  cfg = data;
}

function getAuth() {
  return Buffer.from(`:${cfg.pat}`).toString("base64");
}
// ─────────────────────────────────────────────────────────────────────────────

function azureGet(url, redirectCount = 0) {
  if (!url.startsWith("http")) url = `https://dev.azure.com/${cfg.org}/${url}`;
  return new Promise((resolve, reject) => {
    const opts = { headers: { Authorization: `Basic ${getAuth()}`, "Content-Type": "application/json" } };
    https.get(url, opts, res => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && redirectCount < 5) {
        return resolve(azureGet(res.headers.location, redirectCount + 1));
      }
      let body = "";
      res.on("data", d => body += d);
      res.on("end", () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error("Parse error: " + body.slice(0, 200))); }
      });
    }).on("error", reject);
  });
}

function azurePost(path, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const opts = {
      hostname: "dev.azure.com",
      path: `/${cfg.org}/${path}`,
      method: "POST",
      headers: {
        Authorization: `Basic ${getAuth()}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
      },
    };
    const req = https.request(opts, res => {
      let body = "";
      res.on("data", d => body += d);
      res.on("end", () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error("Parse error: " + body.slice(0, 200))); }
      });
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

// GET autenticado com org/pat explícitos (não usa cfg) — usado no setup
function rawAzureGet(url, auth, redirectCount = 0) {
  if (!url.startsWith("http")) url = `https://dev.azure.com/${url}`;
  return new Promise((resolve, reject) => {
    const opts = { headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" } };
    https.get(url, opts, res => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && redirectCount < 5) {
        return resolve(rawAzureGet(res.headers.location, auth, redirectCount + 1));
      }
      let body = "";
      res.on("data", d => body += d);
      res.on("end", () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch (e) { reject(new Error("HTTP " + res.statusCode + ": " + body.slice(0, 200))); }
      });
    }).on("error", reject);
  });
}

async function fetchProject(project) {
  try {
    // WIQL - busca items ativos
    const wiql = await azurePost(
      `${encodeURIComponent(project)}/_apis/wit/wiql?api-version=7.0`,
      { query: `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${project}' AND [System.WorkItemType] IN ('User Story','Bug','Task','Feature','Epic','Product Backlog Item') AND [System.State] NOT IN ('Closed','Done','Removed') ORDER BY [System.ChangedDate] DESC` }
    );

    const ids = (wiql.workItems || []).slice(0, 100).map(w => w.id);
    if (!ids.length) return { project, items: [], sprint: null, error: null };

    // Detalhes dos items
    const details = await azureGet(
      `${encodeURIComponent(project)}/_apis/wit/workitems?ids=${ids.join(",")}&fields=System.Id,System.Title,System.State,System.WorkItemType,System.AssignedTo,Microsoft.VSTS.Scheduling.StoryPoints,System.IterationPath&api-version=7.0`
    );

    // Todas as iterações com datas — tenta variações do nome do time padrão
    let sprint = null;
    let iterMap = {};
    const teamCandidates = [`${project} Team`, project];
    for (const teamName of teamCandidates) {
      try {
        const sprintData = await azureGet(
          `${encodeURIComponent(project)}/${encodeURIComponent(teamName)}/_apis/work/teamsettings/iterations?api-version=7.0`
        );
        if (sprintData.value?.length) {
          (sprintData.value || []).forEach(it => {
            iterMap[it.path] = {
              start: it.attributes?.startDate ? new Date(it.attributes.startDate) : null,
              end:   it.attributes?.finishDate ? new Date(it.attributes.finishDate) : null,
              isCurrent: it.attributes?.timeFrame === "current",
            };
            if (it.attributes?.timeFrame === "current") sprint = it.name;
          });
          break;
        }
      } catch (_) {}
    }

    return { project, items: details.value || [], sprint, iterMap, error: null };
  } catch (e) {
    return { project, items: [], sprint: null, error: e.message };
  }
}

async function fetchProjectDetail(project) {
  try {
    const wiql = await azurePost(
      `${encodeURIComponent(project)}/_apis/wit/wiql?api-version=7.0`,
      { query: `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${project}' AND [System.WorkItemType] IN ('User Story','Bug','Task','Feature','Epic','Product Backlog Item') ORDER BY [System.ChangedDate] DESC` }
    );
    const allIds = (wiql.workItems || []).slice(0, 500).map(w => w.id);

    let items = [];
    for (let i = 0; i < allIds.length; i += 200) {
      const batch = allIds.slice(i, i + 200);
      const details = await azureGet(
        `${encodeURIComponent(project)}/_apis/wit/workitems?ids=${batch.join(",")}&fields=System.Id,System.Title,System.State,System.WorkItemType,System.AssignedTo,Microsoft.VSTS.Scheduling.StoryPoints,System.IterationPath&api-version=7.0`
      );
      items = items.concat(details.value || []);
    }

    let iterMap = {};
    for (const teamName of [`${project} Team`, project]) {
      try {
        const sd = await azureGet(`${encodeURIComponent(project)}/${encodeURIComponent(teamName)}/_apis/work/teamsettings/iterations?api-version=7.0`);
        if (sd.value?.length) {
          sd.value.forEach(it => {
            iterMap[it.path] = { start: it.attributes?.startDate || null, end: it.attributes?.finishDate || null, isCurrent: it.attributes?.timeFrame === "current" };
          });
          break;
        }
      } catch (_) {}
    }

    return {
      project,
      iterMap,
      items: items.map(i => ({
        state:    i.fields?.["System.State"] || "",
        type:     i.fields?.["System.WorkItemType"] || "",
        pts:      i.fields?.["Microsoft.VSTS.Scheduling.StoryPoints"] ?? null,
        assigned: i.fields?.["System.AssignedTo"]?.displayName || null,
        iteration: i.fields?.["System.IterationPath"] || "",
        title:    i.fields?.["System.Title"] || "",
      })),
    };
  } catch (e) {
    return { project, items: [], iterMap: {}, error: e.message };
  }
}

function calcHealth(total, semEst, semResp, bugs) {
  return bugs > 10 || semEst > total * 0.5 ? ["🔴 Crítico", "red"]
    : semEst > total * 0.3 || semResp > total * 0.2 || bugs > 5 ? ["🟡 Atenção", "yellow"]
    : ["🟢 Saudável", "green"];
}

function fmtDate(d) {
  if (!d) return "";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function fmtRange(iter) {
  if (!iter?.start && !iter?.end) return "";
  return `${fmtDate(iter.start)} – ${fmtDate(iter.end)}`;
}

function buildSetupHTML({ prefill = {} } = {}) {
  const org = (prefill.org || "").replace(/"/g, "&quot;");
  const pat = (prefill.pat || "").replace(/"/g, "&quot;");
  const selectedProjects = JSON.stringify(prefill.projects || []);
  const isSettings = !!(prefill.org);
  const title = isSettings ? "Configurações" : "Configuração inicial";
  const subtitle = isSettings
    ? "Atualize suas credenciais e projetos monitorados"
    : "Configure suas credenciais do Azure DevOps para começar";

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Backlog Health — ${title}</title>
<script>(function(){var t=localStorage.getItem('theme')||'dark';document.documentElement.setAttribute('data-theme',t);})();</script>
<style>
  :root {
    --bg-page:#020617; --bg-card:#0f172a; --bg-border:#1e293b;
    --bg-el:#1e293b; --bg-el2:#334155;
    --text-1:#f1f5f9; --text-2:#e2e8f0; --text-muted:#94a3b8; --text-faint:#64748b;
    --c-blue:#60a5fa; --c-blue-bg:#1e3a5f; --c-blue-bd:#2d5a8e;
    --c-green:#22c55e; --c-green-bg:#052e16; --c-green-bd:#14532d;
    --c-red:#ef4444; --c-red-bg:#450a0a; --c-red2:#f87171;
    --shadow:#00000066;
  }
  [data-theme="light"] {
    --bg-page:#f1f5f9; --bg-card:#ffffff; --bg-border:#e2e8f0;
    --bg-el:#f8fafc; --bg-el2:#e2e8f0;
    --text-1:#0f172a; --text-2:#1e293b; --text-muted:#475569; --text-faint:#94a3b8;
    --c-blue:#2563eb; --c-blue-bg:#dbeafe; --c-blue-bd:#93c5fd;
    --c-green:#16a34a; --c-green-bg:#dcfce7; --c-green-bd:#86efac;
    --c-red:#dc2626; --c-red-bg:#fee2e2; --c-red2:#b91c1c;
    --shadow:#00000022;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', system-ui, sans-serif; background: var(--bg-page); color: var(--text-1); min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; }
  .wrap { width: 100%; max-width: 540px; }
  .logo { font-size: 32px; margin-bottom: 8px; }
  .pg-title { font-size: 22px; font-weight: 700; }
  .pg-sub { color: var(--text-muted); font-size: 14px; margin-top: 4px; margin-bottom: 28px; }
  .card { background: var(--bg-card); border: 1px solid var(--bg-border); border-radius: 16px; padding: 28px; box-shadow: 0 8px 32px var(--shadow); }
  .field { margin-bottom: 18px; }
  .field label { display: block; font-size: 13px; font-weight: 600; color: var(--text-muted); margin-bottom: 6px; letter-spacing:.3px; }
  .field input { width: 100%; background: var(--bg-el); border: 1px solid var(--bg-border); color: var(--text-1); border-radius: 8px; padding: 10px 14px; font-size: 14px; font-family: inherit; outline: none; transition: border .2s; }
  .field input:focus { border-color: var(--c-blue); }
  .hint { font-size: 12px; color: var(--text-faint); margin-top: 5px; }
  .info-box { background: var(--c-blue-bg); border: 1px solid var(--c-blue-bd); border-radius: 10px; padding: 14px 16px; margin-bottom: 20px; }
  .info-box h4 { font-size: 13px; font-weight: 600; color: var(--c-blue); margin-bottom: 8px; }
  .info-box li { font-size: 13px; color: var(--text-2); line-height: 1.8; list-style: none; }
  .info-box li::before { content: "•  "; color: var(--c-blue); }
  .info-box code { background: var(--bg-el); border-radius: 4px; padding: 1px 5px; font-size: 11px; color: var(--c-blue); }
  .info-box .pat-link { font-size: 12px; color: var(--text-faint); margin-top: 8px; }
  .err-box { background: var(--c-red-bg); border: 1px solid var(--c-red); border-radius: 10px; padding: 12px 16px; margin-bottom: 18px; color: var(--c-red2); font-size: 13px; display: none; }
  .ok-box { background: var(--c-green-bg); border: 1px solid var(--c-green-bd); border-radius: 10px; padding: 12px 16px; margin-bottom: 18px; color: var(--c-green); font-size: 13px; font-weight: 600; }
  .btn-test { width: 100%; padding: 11px; background: var(--bg-el); border: 1px solid var(--bg-border); color: var(--text-1); font-size: 14px; font-weight: 600; border-radius: 10px; cursor: pointer; transition: all .2s; }
  .btn-test:hover:not(:disabled) { background: var(--bg-el2); }
  .btn-test:disabled { opacity: .5; cursor: not-allowed; }
  .divider { border: none; border-top: 1px solid var(--bg-border); margin: 22px 0; }
  /* Step 2 */
  .step2 { display: none; }
  .proj-label { display: block; font-size: 13px; font-weight: 600; color: var(--text-muted); margin-bottom: 8px; letter-spacing:.3px; }
  .proj-trigger { width: 100%; background: var(--bg-el); border: 1px solid var(--bg-border); color: var(--text-1); border-radius: 8px; padding: 10px 14px; font-size: 14px; text-align: left; cursor: pointer; display: flex; justify-content: space-between; align-items: center; font-family: inherit; transition: border .2s; }
  .proj-trigger:hover { border-color: var(--c-blue); }
  .proj-panel { border: 1px solid var(--bg-border); border-radius: 8px; margin-top: 4px; background: var(--bg-card); max-height: 220px; overflow-y: auto; display: none; }
  .proj-panel.open { display: block; }
  .proj-option { display: flex; align-items: center; gap: 10px; padding: 10px 14px; cursor: pointer; transition: background .15s; font-size: 13px; color: var(--text-2); }
  .proj-option:hover { background: var(--bg-el); }
  .proj-option input[type=checkbox] { width: 15px; height: 15px; accent-color: var(--c-blue); cursor: pointer; flex-shrink: 0; }
  .proj-footer { padding: 8px 14px; border-top: 1px solid var(--bg-border); }
  .proj-footer button { background: none; border: none; color: var(--text-faint); font-size: 12px; cursor: pointer; }
  .proj-footer button:hover { color: var(--c-red2); }
  .proj-count { font-size: 12px; color: var(--text-faint); margin-top: 6px; }
  .btn-save { width: 100%; padding: 12px; background: var(--c-blue); border: none; color: #fff; font-size: 15px; font-weight: 600; border-radius: 10px; cursor: pointer; transition: opacity .2s; margin-top: 20px; }
  .btn-save:hover:not(:disabled) { opacity: .85; }
  .btn-save:disabled { opacity: .5; cursor: not-allowed; }
  .btn-back { display: inline-flex; align-items: center; gap: 6px; color: var(--text-muted); font-size: 13px; text-decoration: none; margin-top: 16px; transition: color .2s; }
  .btn-back:hover { color: var(--text-1); }
  .btn-theme-top { position: fixed; top: 16px; right: 16px; background: var(--bg-el); border: 1px solid var(--bg-border); color: var(--text-muted); width: 34px; height: 34px; border-radius: 8px; font-size: 16px; cursor: pointer; display: flex; align-items: center; justify-content: center; }
  .spinner { display: inline-block; width: 13px; height: 13px; border: 2px solid var(--bg-el2); border-top-color: var(--c-blue); border-radius: 50%; animation: spin .7s linear infinite; margin-right: 6px; vertical-align: middle; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
<button class="btn-theme-top" id="btnTheme" onclick="toggleTheme()">☀️</button>
<div class="wrap">
  <div class="logo">📋</div>
  <div class="pg-title">Backlog Health Dashboard</div>
  <div class="pg-sub">${subtitle}</div>
  <div class="card">

    <div class="info-box">
      <h4>🔑 Permissões necessárias para o PAT</h4>
      <ul>
        <li><code>Work Items (Read)</code> — leitura de work items e backlogs</li>
        <li><code>Project and Team (Read)</code> — listagem de projetos e sprints</li>
      </ul>
      <div class="pat-link">Gere em: Azure DevOps → User Settings → Personal Access Tokens</div>
    </div>

    <div class="err-box" id="err-box"></div>

    <!-- Passo 1: Credenciais -->
    <div class="field">
      <label>Organização do Azure DevOps</label>
      <input type="text" id="inp-org" placeholder="Ex: MinhaEmpresa" value="${org}" autocomplete="off">
      <div class="hint">Nome na URL: dev.azure.com/<strong>organização</strong></div>
    </div>
    <div class="field">
      <label>Personal Access Token (PAT)</label>
      <input type="password" id="inp-pat" placeholder="Cole seu PAT aqui" value="${pat}" autocomplete="off">
    </div>
    <button class="btn-test" id="btn-test" onclick="loadProjects()">🔌 Testar conexão e carregar projetos</button>

    <!-- Passo 2: Seleção de projetos -->
    <div class="step2" id="step2">
      <hr class="divider">
      <div class="ok-box" id="ok-box"></div>
      <label class="proj-label">Projetos a monitorar</label>
      <button type="button" class="proj-trigger" id="proj-trigger" onclick="toggleProjPanel()">
        <span id="proj-trigger-text">Selecione os projetos…</span>
        <span>▾</span>
      </button>
      <div class="proj-panel" id="proj-panel"></div>
      <div class="proj-count" id="proj-count"></div>
      <button class="btn-save" id="btn-save" onclick="doSave()">💾 Salvar e abrir dashboard</button>
    </div>

    ${isSettings ? '<div style="text-align:center"><a class="btn-back" href="/">← Voltar ao dashboard</a></div>' : ""}
  </div>
</div>
<script>
  const PREFILL = ${selectedProjects};

  function setTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    localStorage.setItem('theme', t);
    const btn = document.getElementById('btnTheme');
    if (btn) { btn.textContent = t === 'dark' ? '☀️' : '🌙'; btn.title = t === 'dark' ? 'Tema claro' : 'Tema escuro'; }
  }
  function toggleTheme() { setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'); }
  setTheme(localStorage.getItem('theme') || 'dark');

  function showErr(msg) { const el = document.getElementById('err-box'); el.textContent = '❌ ' + msg; el.style.display = 'block'; }
  function hideErr() { document.getElementById('err-box').style.display = 'none'; }

  async function loadProjects() {
    const org = document.getElementById('inp-org').value.trim();
    const pat = document.getElementById('inp-pat').value.trim();
    if (!org || !pat) { showErr('Preencha a organização e o PAT antes de continuar.'); return; }
    hideErr();
    const btn = document.getElementById('btn-test');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>Testando conexão…';
    try {
      const r = await fetch('/api/projects?org=' + encodeURIComponent(org) + '&pat=' + encodeURIComponent(pat));
      const data = await r.json();
      if (data.error) { showErr(data.error); btn.disabled = false; btn.textContent = '🔌 Testar conexão e carregar projetos'; return; }
      renderProjects(data.projects || []);
      document.getElementById('ok-box').textContent = '✅ Conexão OK — ' + (data.projects || []).length + ' projeto(s) disponível(is).';
      document.getElementById('step2').style.display = 'block';
      btn.innerHTML = '🔄 Recarregar lista de projetos';
      btn.disabled = false;
    } catch(e) {
      showErr('Falha de rede: ' + e.message);
      btn.disabled = false;
      btn.textContent = '🔌 Testar conexão e carregar projetos';
    }
  }

  function renderProjects(projects) {
    const panel = document.getElementById('proj-panel');
    panel.innerHTML = projects.map(p => {
      const esc = p.replace(/"/g, '&quot;');
      const checked = PREFILL.includes(p) ? ' checked' : '';
      return '<label class="proj-option"><input type="checkbox" value="' + esc + '" onchange="updateCount()"' + checked + '><span>' + p + '</span></label>';
    }).join('') + '<div class="proj-footer"><button type="button" onclick="clearProjs()">✕ Limpar seleção</button></div>';
    updateCount();
  }

  function toggleProjPanel() {
    document.getElementById('proj-panel').classList.toggle('open');
  }

  function updateCount() {
    const checked = [...document.querySelectorAll('#proj-panel input:checked')];
    const names = checked.map(c => c.value);
    document.getElementById('proj-trigger-text').textContent = names.length ? names.join(', ') : 'Selecione os projetos…';
    document.getElementById('proj-count').textContent = names.length ? names.length + ' projeto(s) selecionado(s)' : '';
  }

  function clearProjs() {
    document.querySelectorAll('#proj-panel input').forEach(c => c.checked = false);
    updateCount();
  }

  document.addEventListener('click', e => {
    if (!e.target.closest('#proj-trigger') && !e.target.closest('#proj-panel'))
      document.getElementById('proj-panel')?.classList.remove('open');
  });

  async function doSave() {
    const org = document.getElementById('inp-org').value.trim();
    const pat = document.getElementById('inp-pat').value.trim();
    const selected = [...document.querySelectorAll('#proj-panel input:checked')].map(c => c.value);
    if (!selected.length) { showErr('Selecione ao menos um projeto para monitorar.'); return; }
    hideErr();
    const btn = document.getElementById('btn-save');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>Salvando…';
    try {
      const body = 'org=' + encodeURIComponent(org) + '&pat=' + encodeURIComponent(pat) + '&projects=' + encodeURIComponent(selected.join(','));
      const r = await fetch('/setup', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
      const data = await r.json().catch(() => ({}));
      if (r.ok && data.ok) { location.href = '/'; return; }
      showErr(data.error || 'Erro ao salvar configurações.');
    } catch(e) { showErr(e.message); }
    btn.disabled = false;
    btn.textContent = '💾 Salvar e abrir dashboard';
  }

  ${isSettings ? "window.addEventListener('load', loadProjects);" : ""}
</script>
</body></html>`;
}

function buildHTML(results) {
  const cards = results.map(({ project, items, sprint, iterMap = {}, error }) => {
    if (error) return `
      <div class="card error">
        <h2>❌ ${project}</h2>
        <p style="color:#f87171">${error}</p>
      </div>`;

    const total = items.length;
    const semEst = items.filter(i => i.fields?.["Microsoft.VSTS.Scheduling.StoryPoints"] == null).length;
    const semResp = items.filter(i => !i.fields?.["System.AssignedTo"]).length;
    const bugs = items.filter(i => i.fields?.["System.WorkItemType"] === "Bug").length;
    const health = calcHealth(total, semEst, semResp, bugs);

    // Coleta iteration paths únicos e ordena
    const iterations = [...new Set(
      items.map(i => i.fields?.["System.IterationPath"]).filter(Boolean)
    )].sort();

    // Monta checkboxes do dropdown customizado
    const options = iterations.map(it => {
      const label = it.includes("\\") ? it.split("\\").slice(1).join(" › ") : it;
      const isCurrent = sprint && (it === sprint || it.endsWith("\\" + sprint));
      const val = it.replace(/'/g, "&#39;").replace(/"/g, "&quot;");
      const iter = iterMap[it] || {};
      const dateRange = fmtRange(iter);
      return `
        <label class="option-row${isCurrent ? " is-current" : ""}">
          <input type="checkbox" value="${val}" onchange="onCheckChange(this)">
          <span class="option-text">
            <span class="option-name">${label}${isCurrent ? " 📅 atual" : ""}</span>
            ${dateRange ? `<span class="option-date">${dateRange}</span>` : ""}
          </span>
        </label>`;
    }).join("");

    // JSON compacto dos items para recálculo de stats no cliente
    const itemsJson = JSON.stringify(items.map(i => ({
      iteration: i.fields?.["System.IterationPath"] || "",
      type: i.fields?.["System.WorkItemType"] || "",
      pts: i.fields?.["Microsoft.VSTS.Scheduling.StoryPoints"] ?? null,
      assigned: !!i.fields?.["System.AssignedTo"],
    }))).replace(/</g, "\\u003c");

    // Agrupa items por iteration path, sprint atual primeiro
    const grouped = {};
    items.forEach(i => {
      const key = i.fields?.["System.IterationPath"] || "Sem Sprint";
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(i);
    });
    const sortedGroups = Object.keys(grouped).sort((a, b) => {
      const aC = sprint && (a === sprint || a.endsWith("\\" + sprint));
      const bC = sprint && (b === sprint || b.endsWith("\\" + sprint));
      if (aC && !bC) return -1;
      if (!aC && bC) return 1;
      return a.localeCompare(b);
    });

    const rows = sortedGroups.map(groupKey => {
      const groupItems = grouped[groupKey];
      const groupLabel = groupKey.includes("\\") ? groupKey.split("\\").slice(1).join(" › ") : groupKey;
      const isCurrent = sprint && (groupKey === sprint || groupKey.endsWith("\\" + sprint));
      const safeGroup = groupKey.replace(/"/g, "&quot;");

      const iter = iterMap[groupKey] || {};
      const dateRange = fmtRange(iter);
      const header = `<tr class="group-header${isCurrent ? " current-group" : ""}" data-group="${safeGroup}">
        <td colspan="5">
          <span class="group-label">${groupLabel}${isCurrent ? " 📅 atual" : ""}</span>
          ${dateRange ? `<span class="group-date">${dateRange}</span>` : ""}
          <span class="group-count">${groupItems.length} item${groupItems.length !== 1 ? "s" : ""}</span>
        </td>
      </tr>`;

      const itemRows = groupItems.map(i => {
        const state = i.fields?.["System.State"] || "?";
        const title = i.fields?.["System.Title"] || "";
        const assigned = i.fields?.["System.AssignedTo"]?.displayName || "—";
        const pts = i.fields?.["Microsoft.VSTS.Scheduling.StoryPoints"];
        const type = i.fields?.["System.WorkItemType"] || "";
        const iteration = groupKey.replace(/"/g, "&quot;");
        const stateClass = ["Active","In Progress","Doing"].includes(state) ? "blue"
          : ["Closed","Done","Resolved"].includes(state) ? "green"
          : ["Blocked","Impediment"].includes(state) ? "red" : "gray";
        return `
          <tr data-iteration="${iteration}">
            <td>${type}</td>
            <td>${title}</td>
            <td><span class="badge ${stateClass}">${state}</span></td>
            <td>${pts != null ? pts + " pts" : '<span class="badge yellow">Sem estimativa</span>'}</td>
            <td>${assigned === "—" ? '<span class="badge red">Sem responsável</span>' : assigned}</td>
          </tr>`;
      }).join("");

      return header + itemRows;
    }).join("");

    return `
      <div class="card" data-project="${project.replace(/"/g, "&quot;")}" data-items='${itemsJson}'>
        <div class="card-header">
          <div>
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
              <h2>${project}</h2>
              <button class="btn-detail" type="button" onclick="openDetails(this)">📊 Detalhes do projeto</button>
            </div>
            ${sprint ? `<span class="sprint">📅 ${sprint}</span>` : ""}
          </div>
          <span class="badge ${health[1]} big card-health">${health[0]}</span>
        </div>
        <div class="filter-bar">
          <label class="filter-label">🔍 Sprint</label>
          <div class="custom-select">
            <button class="select-trigger" type="button" onclick="toggleDropdown(this)">
              <span class="select-value">Todas as sprints</span>
              <span class="select-arrow">▾</span>
            </button>
            <div class="select-panel">
              <div class="select-options">${options}</div>
              <div class="select-footer">
                <button type="button" onclick="clearFilter(this)">✕ Limpar seleção</button>
              </div>
            </div>
          </div>
        </div>
        <div class="stats">
          <div class="stat"><div class="stat-label">Total Abertos</div><div class="stat-val card-total">${total}</div></div>
          <div class="stat"><div class="stat-label">Sem Estimativa</div><div class="stat-val ${semEst > 2 ? "warn" : ""} card-semest">${semEst}</div></div>
          <div class="stat"><div class="stat-label">Sem Responsável</div><div class="stat-val ${semResp > 2 ? "warn" : ""} card-semresp">${semResp}</div></div>
          <div class="stat"><div class="stat-label">Bugs Abertos</div><div class="stat-val ${bugs > 3 ? "crit" : ""} card-bugs">${bugs}</div></div>
        </div>
        <details>
          <summary class="card-summary">▼ Ver todos os ${total} items</summary>
          <table>
            <thead><tr><th>Tipo</th><th>Título</th><th>Status</th><th>Estimativa</th><th>Responsável</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </details>
      </div>`;
  }).join("");

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Backlog Health Dashboard</title>
<script>
  (function(){var t=localStorage.getItem('theme')||'dark';document.documentElement.setAttribute('data-theme',t);})();
</script>
<style>
  /* ── Tema Escuro (padrão) ── */
  :root {
    --bg-page:    #020617; --bg-card:    #0f172a; --bg-border:  #1e293b;
    --bg-el:      #1e293b; --bg-el2:     #334155; --bg-deep:    #020617;
    --text-1:     #f1f5f9; --text-2:     #e2e8f0; --text-muted: #94a3b8;
    --text-faint: #64748b; --text-faintr:#475569;
    --c-blue:     #60a5fa; --c-blue-bg:  #1e3a5f; --c-blue-bd:  #2d5a8e; --c-blue-lt:  #93c5fd;
    --c-green:    #22c55e; --c-green2:   #4ade80; --c-green-bg: #14532d; --c-green-sb: #0a1f14; --c-green-bd: #14532d;
    --c-yellow:   #f59e0b; --c-yellow2:  #fbbf24; --c-yellow-bg:#422006;
    --c-red:      #ef4444; --c-red2:     #f87171; --c-red-bg:   #450a0a;
    --c-purple:   #a78bfa;
    --bg-group:   #0d1f35; --bg-gcur:    #0a1f14; --bd-gcur:    #14532d;
    --hover-bg:   #1e293b33; --shadow:   #00000066; --modal-bg:  #000000bb;
  }
  /* ── Tema Claro ── */
  [data-theme="light"] {
    --bg-page:    #f1f5f9; --bg-card:    #ffffff; --bg-border:  #e2e8f0;
    --bg-el:      #f8fafc; --bg-el2:     #e2e8f0; --bg-deep:    #e8eef5;
    --text-1:     #0f172a; --text-2:     #1e293b; --text-muted: #475569;
    --text-faint: #64748b; --text-faintr:#94a3b8;
    --c-blue:     #2563eb; --c-blue-bg:  #dbeafe; --c-blue-bd:  #93c5fd; --c-blue-lt:  #1d4ed8;
    --c-green:    #16a34a; --c-green2:   #15803d; --c-green-bg: #dcfce7; --c-green-sb: #f0fdf4; --c-green-bd: #86efac;
    --c-yellow:   #d97706; --c-yellow2:  #b45309; --c-yellow-bg:#fef3c7;
    --c-red:      #dc2626; --c-red2:     #b91c1c; --c-red-bg:   #fee2e2;
    --c-purple:   #7c3aed;
    --bg-group:   #eff6ff; --bg-gcur:    #f0fdf4; --bd-gcur:    #86efac;
    --hover-bg:   #0000000a; --shadow:   #00000022; --modal-bg:  #00000066;
  }
  /* ── Base ── */
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', sans-serif; background: var(--bg-page); color: var(--text-1); padding: 32px 24px; transition: background .2s, color .2s; }
  h1 { font-size: 24px; font-weight: 800; }
  .subtitle { color: var(--text-faint); font-size: 13px; margin-top: 4px; margin-bottom: 28px; }
  /* ── Cards ── */
  .card { background: var(--bg-card); border: 1px solid var(--bg-border); border-radius: 14px; padding: 24px; margin-bottom: 20px; }
  .card.error { border-color: var(--c-red-bg); }
  .card-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 18px; }
  h2 { font-size: 20px; font-weight: 700; }
  .sprint { color: var(--text-faint); font-size: 13px; margin-top: 4px; display: block; }
  .stats { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 18px; }
  .stat { background: var(--bg-el); border-radius: 10px; padding: 14px 18px; flex: 1; min-width: 110px; }
  .stat-label { font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px; }
  .stat-val { font-size: 28px; font-weight: 700; color: var(--c-green); }
  .stat-val.warn { color: var(--c-yellow); }
  .stat-val.crit { color: var(--c-red); }
  /* ── Badges ── */
  .badge { border-radius: 6px; padding: 2px 10px; font-size: 12px; font-weight: 600; }
  .badge.big { font-size: 14px; padding: 4px 14px; }
  .badge.green  { background: var(--c-green-bg);  color: var(--c-green2); }
  .badge.yellow { background: var(--c-yellow-bg); color: var(--c-yellow2); }
  .badge.red    { background: var(--c-red-bg);    color: var(--c-red2); }
  .badge.blue   { background: var(--c-blue-bg);   color: var(--c-blue); }
  .badge.gray   { background: var(--bg-el);       color: var(--text-muted); }
  /* ── Table ── */
  details summary { cursor: pointer; color: var(--c-blue); font-size: 13px; margin-bottom: 12px; user-select: none; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; color: var(--text-faint); font-size: 11px; text-transform: uppercase; letter-spacing: 1px; padding: 6px 8px; border-bottom: 1px solid var(--bg-border); }
  td { padding: 8px; border-bottom: 1px solid var(--bg-card); color: var(--text-2); }
  tr:hover td { background: var(--hover-bg); }
  /* ── Header ── */
  .header { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 28px; }
  .update { color: var(--text-faintr); font-size: 12px; }
  .refresh-bar { display: flex; align-items: center; gap: 12px; }
  .btn-refresh { background: var(--bg-el); border: 1px solid var(--bg-el2); color: var(--text-muted); padding: 6px 16px; border-radius: 8px; font-size: 13px; cursor: pointer; transition: all .2s; }
  .btn-refresh:hover { background: var(--bg-el2); color: var(--text-1); }
  .btn-refresh.loading { opacity: .5; cursor: not-allowed; }
  .btn-theme { background: var(--bg-el); border: 1px solid var(--bg-el2); color: var(--text-muted); width: 34px; height: 34px; border-radius: 8px; font-size: 16px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all .2s; }
  .btn-theme:hover { background: var(--bg-el2); color: var(--text-1); }
  .timer { font-size: 12px; color: var(--text-faintr); min-width: 110px; text-align: right; }
  #content { transition: opacity .3s; }
  #content.loading { opacity: .4; pointer-events: none; }
  /* ── Filtro dropdown ── */
  .filter-bar { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
  .filter-label { font-size: 12px; color: var(--text-faint); white-space: nowrap; }
  .custom-select { position: relative; flex: 1; max-width: 380px; }
  .select-trigger { width: 100%; background: var(--bg-el); border: 1px solid var(--bg-el2); color: var(--text-2); padding: 7px 12px; border-radius: 8px; font-size: 13px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; gap: 8px; text-align: left; }
  .select-trigger:hover { border-color: var(--text-faintr); }
  .select-trigger.open { border-color: var(--c-blue); border-radius: 8px 8px 0 0; }
  .select-value { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .select-arrow { font-size: 10px; color: var(--text-faint); transition: transform .2s; flex-shrink: 0; }
  .select-trigger.open .select-arrow { transform: rotate(180deg); }
  .select-panel { display: none; position: absolute; top: 100%; left: 0; right: 0; background: var(--bg-el); border: 1px solid var(--c-blue); border-top: none; border-radius: 0 0 8px 8px; z-index: 200; box-shadow: 0 8px 24px var(--shadow); }
  .select-panel.open { display: block; }
  .select-options { max-height: 220px; overflow-y: auto; padding: 4px 0; }
  .option-row { display: flex; align-items: center; gap: 10px; padding: 8px 14px; cursor: pointer; font-size: 13px; color: var(--text-2); user-select: none; }
  .option-row:hover { background: var(--bg-el2); }
  .option-row input[type="checkbox"] { accent-color: var(--c-blue); width: 15px; height: 15px; cursor: pointer; flex-shrink: 0; }
  .option-text { display: flex; flex-direction: column; gap: 1px; }
  .option-name { font-size: 13px; }
  .option-date { font-size: 11px; color: var(--text-faint); }
  .option-row.is-current .option-name { color: var(--c-green); font-weight: 600; }
  .option-row.is-current .option-date { color: var(--text-faint); }
  .select-footer { border-top: 1px solid var(--bg-el2); padding: 6px 14px; }
  .select-footer button { background: transparent; border: none; color: var(--text-faint); font-size: 12px; cursor: pointer; padding: 0; }
  .select-footer button:hover { color: var(--c-red); }
  /* ── Grupos sprint ── */
  .group-header td { background: var(--bg-group); color: var(--c-blue); font-size: 11px; font-weight: 700; padding: 8px 8px 6px; border-top: 2px solid var(--bg-border); letter-spacing: 0.5px; text-transform: uppercase; }
  .group-header.current-group td { color: var(--c-green); background: var(--bg-gcur); border-top-color: var(--bd-gcur); }
  .group-date { font-size: 10px; font-weight: 400; opacity: .7; margin-left: 10px; letter-spacing: 0; text-transform: none; }
  .group-count { float: right; font-weight: 400; opacity: .7; }
  /* ── Botão detalhes ── */
  .btn-detail { background: var(--c-blue-bg); border: 1px solid var(--c-blue-bd); color: var(--c-blue); padding: 4px 12px; border-radius: 7px; font-size: 12px; cursor: pointer; white-space: nowrap; }
  .btn-detail:hover { background: var(--c-blue-bd); color: var(--c-blue-lt); }
  /* ── Modal ── */
  .modal-overlay { display: none; position: fixed; inset: 0; background: var(--modal-bg); z-index: 500; overflow-y: auto; padding: 32px 16px; }
  .modal-overlay.open { display: flex; align-items: flex-start; justify-content: center; }
  .modal-box { background: var(--bg-card); border: 1px solid var(--bg-border); border-radius: 16px; width: 100%; max-width: 1000px; margin: auto; transition: max-width .2s, border-radius .2s; }
  .modal-overlay.maximized { padding: 0; align-items: stretch; }
  .modal-overlay.maximized .modal-box { max-width: 100%; border-radius: 0; margin: 0; min-height: 100vh; display: flex; flex-direction: column; }
  .modal-overlay.maximized .modal-body { flex: 1; overflow-y: auto; }
  .modal-head { display: flex; justify-content: space-between; align-items: flex-start; padding: 24px 28px 18px; border-bottom: 1px solid var(--bg-border); }
  .modal-title { font-size: 18px; font-weight: 700; }
  .modal-sub { font-size: 12px; color: var(--text-faint); margin-top: 4px; }
  .modal-actions { display: flex; gap: 8px; flex-shrink: 0; }
  .modal-close, .modal-maximize { background: var(--bg-el); border: none; color: var(--text-muted); width: 32px; height: 32px; border-radius: 8px; cursor: pointer; font-size: 15px; line-height: 1; }
  .modal-maximize:hover { background: var(--bg-el2); color: var(--text-1); }
  .modal-close:hover { background: var(--c-red-bg); color: var(--c-red2); }
  .modal-body { padding: 24px 28px; }
  .modal-loading { color: var(--text-faint); font-size: 14px; padding: 40px 0; text-align: center; }
  /* ── Detail dashboard ── */
  .d-section { margin-bottom: 28px; }
  .d-section-title { font-size: 11px; color: var(--text-faint); text-transform: uppercase; letter-spacing: 1px; font-weight: 700; margin-bottom: 14px; padding-bottom: 8px; border-bottom: 1px solid var(--bg-border); }
  .d-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; }
  .d-card { background: var(--bg-el); border-radius: 10px; padding: 16px 18px; }
  .d-label { font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px; }
  .d-val { font-size: 30px; font-weight: 700; color: var(--text-1); }
  .d-val.blue { color: var(--c-blue); } .d-val.green { color: var(--c-green); } .d-val.red { color: var(--c-red); } .d-val.yellow { color: var(--c-yellow); } .d-val.purple { color: var(--c-purple); }
  .d-sub { font-size: 12px; color: var(--text-faint); margin-top: 2px; }
  .d-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 28px; }
  .bar-list { display: flex; flex-direction: column; gap: 7px; }
  .bar-row { display: flex; align-items: center; gap: 8px; font-size: 12px; }
  .bar-label { width: 140px; color: var(--text-muted); text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex-shrink: 0; }
  .bar-track { flex: 1; background: var(--bg-deep); border-radius: 4px; height: 18px; overflow: hidden; }
  .bar-fill { height: 100%; border-radius: 4px; }
  .bar-num { width: 36px; color: var(--text-2); font-weight: 600; text-align: right; }
  .bar-pct { width: 36px; color: var(--text-faintr); font-size: 11px; }
  .d-table { width: 100%; border-collapse: collapse; font-size: 12px; }
  .d-table th { text-align: left; color: var(--text-faint); font-size: 10px; text-transform: uppercase; letter-spacing: 1px; padding: 6px 8px; border-bottom: 1px solid var(--bg-border); }
  .d-table td { padding: 7px 8px; border-bottom: 1px solid var(--bg-card); color: var(--text-2); }
  .d-table tr:hover td { background: var(--hover-bg); }
  .d-table tr.is-current td { color: var(--c-green); }
  .progress-ring { display: flex; align-items: center; gap: 16px; }
  .ring-wrap { position: relative; width: 80px; height: 80px; flex-shrink: 0; }
  .ring-wrap svg { transform: rotate(-90deg); }
  .ring-pct { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 700; }
  /* ── Timeline / Gantt ── */
  .tl-wrap { overflow-x: auto; padding-bottom: 8px; }
  .tl-months { position: relative; height: 20px; margin-bottom: 4px; min-width: 600px; }
  .tl-month { position: absolute; font-size: 10px; color: var(--text-faintr); transform: translateX(-50%); white-space: nowrap; }
  .tl-track { position: relative; height: 110px; min-width: 600px; background: var(--bg-deep); border-radius: 8px; border: 1px solid var(--bg-border); overflow: hidden; }
  .tl-block { position: absolute; top: 0; bottom: 0; border: 1px solid; border-radius: 4px; display: flex; flex-direction: column; justify-content: flex-end; overflow: hidden; cursor: default; transition: filter .15s; }
  .tl-block:hover { filter: brightness(1.1); z-index: 2; }
  .tl-bar-inner { width: 100%; margin-top: auto; flex-shrink: 0; }
  .tl-block-foot { padding: 3px 5px; flex-shrink: 0; }
  .tl-block-name { font-size: 10px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tl-block-us { font-size: 10px; opacity: .8; }
  .tl-today { position: absolute; top: 0; bottom: 0; width: 2px; z-index: 3; }
  .tl-today-line { width: 2px; height: 100%; background: #f87171; opacity: .8; }
  .tl-today-label { position: absolute; top: 4px; left: 4px; font-size: 9px; color: #f87171; white-space: nowrap; }
  .tl-legend { display: flex; gap: 16px; margin-top: 10px; flex-wrap: wrap; }
  .tl-leg { font-size: 11px; }
</style>
</head>
<body>
<div class="header">
  <div>
    <h1>📋 Backlog Health</h1>
    <div class="subtitle">Azure DevOps · ${cfg.org}</div>
  </div>
  <div class="refresh-bar">
    <button class="btn-theme" id="btnTheme" onclick="toggleTheme()" title="Tema claro">☀️</button>
    <button class="btn-theme" onclick="location.href='/settings'" title="Configurações">⚙️</button>
    <button class="btn-refresh" id="btnRefresh" onclick="doRefresh()">↻ Atualizar</button>
    <div class="timer" id="timer">Próximo refresh em 5:00</div>
    <div class="update" id="lastUpdate">Atualizado em ${new Date().toLocaleString("pt-BR")}</div>
  </div>
</div>
<div id="content">
${cards}
</div>
<script>
  const INTERVAL = 300; // 5 minutos em segundos
  let remaining = INTERVAL;
  let countdown;

  function pad(n) { return String(n).padStart(2, '0'); }

  function startTimer() {
    clearInterval(countdown);
    remaining = INTERVAL;
    countdown = setInterval(() => {
      remaining--;
      const m = Math.floor(remaining / 60);
      const s = remaining % 60;
      document.getElementById('timer').textContent = 'Próximo refresh em ' + m + ':' + pad(s);
      if (remaining <= 0) doRefresh();
    }, 1000);
  }

  async function doRefresh() {
    const btn = document.getElementById('btnRefresh');
    const content = document.getElementById('content');
    btn.classList.add('loading');
    btn.textContent = '↻ Atualizando...';
    content.classList.add('loading');
    document.getElementById('timer').textContent = 'Atualizando...';
    try {
      const resp = await fetch('/refresh');
      const html = await resp.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      document.getElementById('content').innerHTML = doc.getElementById('content').innerHTML;
      document.getElementById('lastUpdate').textContent = doc.getElementById('lastUpdate').textContent;
      initFilters();
    } catch(e) {
      console.error('Erro ao atualizar:', e);
    }
    btn.classList.remove('loading');
    btn.textContent = '↻ Atualizar';
    content.classList.remove('loading');
    startTimer();
  }

  function toggleDropdown(trigger) {
    const panel = trigger.nextElementSibling;
    const isOpen = panel.classList.contains('open');
    // fecha todos os outros dropdowns abertos
    document.querySelectorAll('.select-panel.open').forEach(p => {
      p.classList.remove('open');
      p.previousElementSibling.classList.remove('open');
    });
    if (!isOpen) {
      panel.classList.add('open');
      trigger.classList.add('open');
    }
  }

  document.addEventListener('click', e => {
    if (!e.target.closest('.custom-select')) {
      document.querySelectorAll('.select-panel.open').forEach(p => {
        p.classList.remove('open');
        p.previousElementSibling.classList.remove('open');
      });
    }
  });

  function onCheckChange(checkbox) {
    const customSelect = checkbox.closest('.custom-select');
    const card = checkbox.closest('.card');
    const checked = Array.from(customSelect.querySelectorAll('input[type="checkbox"]:checked'));
    const selected = checked.map(c => c.value);

    // Atualiza label do trigger
    const valueEl = customSelect.querySelector('.select-value');
    if (selected.length === 0) valueEl.textContent = 'Todas as sprints';
    else if (selected.length === 1) valueEl.textContent = checked[0].closest('.option-row').querySelector('span').textContent;
    else valueEl.textContent = selected.length + ' sprints selecionadas';

    applyFilter(card, selected);
    saveFilter(card, selected);
  }

  function clearFilter(btn) {
    const customSelect = btn.closest('.custom-select');
    customSelect.querySelectorAll('input[type="checkbox"]').forEach(c => c.checked = false);
    customSelect.querySelector('.select-value').textContent = 'Todas as sprints';
    const card = btn.closest('.card');
    applyFilter(card, []);
    saveFilter(card, []);
  }

  function saveFilter(card, selected) {
    const project = card.dataset.project;
    if (selected.length === 0) localStorage.removeItem('filter_' + project);
    else localStorage.setItem('filter_' + project, JSON.stringify(selected));
  }

  function applyFilter(card, selected) {
    const allItems = JSON.parse(card.dataset.items);

    // Mostra/esconde rows de items
    card.querySelectorAll('tbody tr[data-iteration]').forEach(row => {
      row.style.display = (selected.length === 0 || selected.includes(row.dataset.iteration)) ? '' : 'none';
    });

    // Mostra/esconde cabeçalhos de grupo
    card.querySelectorAll('tbody tr.group-header').forEach(header => {
      const group = header.dataset.group;
      const hasVisible = selected.length === 0 || selected.includes(group);
      header.style.display = hasVisible ? '' : 'none';
    });

    const filtered = selected.length === 0 ? allItems : allItems.filter(i => selected.includes(i.iteration));
    const total = filtered.length;
    const semEst = filtered.filter(i => i.pts == null).length;
    const semResp = filtered.filter(i => !i.assigned).length;
    const bugs = filtered.filter(i => i.type === 'Bug').length;

    card.querySelector('.card-total').textContent = total;

    const semEstEl = card.querySelector('.card-semest');
    semEstEl.textContent = semEst;
    semEstEl.className = 'stat-val card-semest' + (semEst > 2 ? ' warn' : '');

    const semRespEl = card.querySelector('.card-semresp');
    semRespEl.textContent = semResp;
    semRespEl.className = 'stat-val card-semresp' + (semResp > 2 ? ' warn' : '');

    const bugsEl = card.querySelector('.card-bugs');
    bugsEl.textContent = bugs;
    bugsEl.className = 'stat-val card-bugs' + (bugs > 3 ? ' crit' : '');

    const h = bugs > 10 || semEst > total * 0.5 ? ['🔴 Crítico','red']
      : semEst > total * 0.3 || semResp > total * 0.2 || bugs > 5 ? ['🟡 Atenção','yellow']
      : ['🟢 Saudável','green'];
    const healthEl = card.querySelector('.card-health');
    healthEl.textContent = h[0];
    healthEl.className = 'badge big card-health ' + h[1];

    card.querySelector('.card-summary').textContent = '▼ Ver todos os ' + total + ' items';
  }

  function initFilters() {
    document.querySelectorAll('.card[data-project]').forEach(card => {
      const project = card.dataset.project;
      const saved = localStorage.getItem('filter_' + project);
      if (!saved) return;
      const selected = JSON.parse(saved);
      if (!selected.length) return;

      const customSelect = card.querySelector('.custom-select');
      customSelect.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.checked = selected.includes(cb.value);
      });

      const checked = Array.from(customSelect.querySelectorAll('input[type="checkbox"]:checked'));
      const valueEl = customSelect.querySelector('.select-value');
      if (checked.length === 1) valueEl.textContent = checked[0].closest('.option-row').querySelector('span').textContent;
      else valueEl.textContent = checked.length + ' sprints selecionadas';

      applyFilter(card, selected);
    });
  }

  initFilters();
  startTimer();

  // ── Theme ───────────────────────────────────────────────────────
  function setTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    localStorage.setItem('theme', t);
    const btn = document.getElementById('btnTheme');
    if (btn) { btn.textContent = t === 'dark' ? '☀️' : '🌙'; btn.title = t === 'dark' ? 'Tema claro' : 'Tema escuro'; }
  }
  function toggleTheme() {
    setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  }
  setTheme(localStorage.getItem('theme') || 'dark');

  // ── Detail Modal ───────────────────────────────────────────────
  async function openDetails(btn) {
    const card = btn.closest('.card');
    const project = card.dataset.project;

    // Lê sprints selecionados no filtro da tela inicial
    const selectedSprints = Array.from(
      card.querySelectorAll('.custom-select input[type="checkbox"]:checked')
    ).map(c => c.value);

    const modal = document.getElementById('detail-modal');
    document.getElementById('modal-title').textContent = project;
    document.getElementById('modal-sub').textContent = 'Carregando dados completos...';
    document.getElementById('modal-body').innerHTML = '<div class="modal-loading">⏳ Buscando todos os itens do projeto...</div>';
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
    try {
      const resp = await fetch('/detail?' + new URLSearchParams({ project }));
      const data = await resp.json();
      if (data.error) throw new Error(data.error);

      const filtered = selectedSprints.length > 0
        ? data.items.filter(i => selectedSprints.includes(i.iteration))
        : data.items;

      const filterLabel = selectedSprints.length === 0
        ? 'Todos os sprints · ' + data.items.length + ' itens'
        : selectedSprints.length + ' sprint(s) filtrada(s) · ' + filtered.length + ' de ' + data.items.length + ' itens';

      document.getElementById('modal-sub').textContent = filterLabel;
      document.getElementById('modal-body').innerHTML = buildDetailHTML(filtered, data.iterMap, selectedSprints);
    } catch(e) {
      document.getElementById('modal-body').innerHTML = '<p style="color:#f87171;padding:20px">Erro: ' + e.message + '</p>';
    }
  }

  function closeDetails(e) {
    if (e && e.target !== document.getElementById('detail-modal')) return;
    document.getElementById('detail-modal').classList.remove('open');
    document.body.style.overflow = '';
  }

  function closeDetailsBtn() {
    const modal = document.getElementById('detail-modal');
    modal.classList.remove('open', 'maximized');
    document.body.style.overflow = '';
    document.getElementById('btnMaximize').textContent = '⤢';
  }

  function toggleMaximize() {
    const modal = document.getElementById('detail-modal');
    const btn = document.getElementById('btnMaximize');
    const isMax = modal.classList.toggle('maximized');
    btn.textContent = isMax ? '⤡' : '⤢';
    btn.title = isMax ? 'Restaurar' : 'Maximizar';
  }

  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDetailsBtn(); });

  function fmtD(s) {
    if (!s) return '';
    return new Date(s).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  function statusColor(s) {
    if (['Active','In Progress','Doing','Committed'].includes(s)) return '#60a5fa';
    if (['Closed','Done'].includes(s)) return '#22c55e';
    if (['Resolved'].includes(s)) return '#a78bfa';
    if (['Removed'].includes(s)) return '#ef4444';
    if (['Blocked','Impediment'].includes(s)) return '#f87171';
    return '#64748b';
  }

  function typeColor(t) {
    const m = { 'Bug':'#ef4444','User Story':'#60a5fa','Product Backlog Item':'#60a5fa','Task':'#f59e0b','Feature':'#a78bfa','Epic':'#ec4899' };
    return m[t] || '#64748b';
  }

  function barList(entries, total) {
    const max = Math.max(...entries.map(e => e[1]), 1);
    return entries.map(([label, val, color]) => {
      const pct = Math.round(val / max * 100);
      const ofTotal = total ? Math.round(val / total * 100) : 0;
      const short = label.includes('\\\\') ? label.split('\\\\').slice(1).join(' › ') : label;
      return '<div class="bar-row">' +
        '<div class="bar-label" title="' + label + '">' + short + '</div>' +
        '<div class="bar-track"><div class="bar-fill" style="width:' + pct + '%;background:' + (color||'#60a5fa') + '"></div></div>' +
        '<div class="bar-num">' + val + '</div>' +
        '<div class="bar-pct">' + ofTotal + '%</div>' +
        '</div>';
    }).join('');
  }

  function ring(pct, color) {
    const r = 34, circ = 2 * Math.PI * r;
    const dash = circ * pct / 100;
    return '<div class="ring-wrap"><svg width="80" height="80" viewBox="0 0 80 80">' +
      '<circle cx="40" cy="40" r="' + r + '" fill="none" stroke="#1e293b" stroke-width="8"/>' +
      '<circle cx="40" cy="40" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="8" stroke-dasharray="' + dash + ' ' + circ + '" stroke-linecap="round"/>' +
      '</svg><div class="ring-pct" style="color:' + color + '">' + pct + '%</div></div>';
  }

  function buildDetailHTML(items, iterMap, selectedSprints) {
    const total = items.length;
    if (!total) return '<p style="color:#64748b;padding:20px">Nenhum item encontrado.</p>';

    const filterBanner = selectedSprints && selectedSprints.length > 0
      ? '<div style="background:#1e3a5f;border:1px solid #2d5a8e;border-radius:8px;padding:10px 14px;margin-bottom:20px;font-size:12px;color:#93c5fd">' +
        '🔍 Filtrado por ' + selectedSprints.length + ' sprint(s): ' +
        selectedSprints.map(function(s) { var p = s.split('\\u005c'); return '<strong>' + (p.length > 1 ? p.slice(1).join(' \u203a ') : s) + '</strong>'; }).join(', ') +
        '</div>'
      : '';

    const totalPts = items.reduce((s, i) => s + (i.pts || 0), 0);
    const closed   = items.filter(i => ['Closed','Done'].includes(i.state)).length;
    const resolved = items.filter(i => i.state === 'Resolved').length;
    const active   = items.filter(i => ['Active','In Progress','Doing','Committed'].includes(i.state)).length;
    const newItems = items.filter(i => i.state === 'New').length;
    const bugs     = items.filter(i => i.type === 'Bug').length;
    const us       = items.filter(i => ['User Story','Product Backlog Item'].includes(i.type)).length;
    const noEst    = items.filter(i => i.pts == null).length;
    const noAsgn   = items.filter(i => !i.assigned).length;
    const donePts  = items.filter(i => ['Closed','Done','Resolved'].includes(i.state)).reduce((s,i)=>s+(i.pts||0),0);
    const closedPct = total ? Math.round((closed + resolved) / total * 100) : 0;
    const bugRate   = total ? Math.round(bugs / total * 100) : 0;
    const estPct    = total ? Math.round((total - noEst) / total * 100) : 0;

    // By status
    const byStatus = {};
    items.forEach(i => { byStatus[i.state] = (byStatus[i.state]||0) + 1; });
    const statusEntries = Object.entries(byStatus).sort((a,b)=>b[1]-a[1]).map(([k,v])=>[k,v,statusColor(k)]);

    // By type
    const byType = {};
    items.forEach(i => { byType[i.type] = (byType[i.type]||0)+1; });
    const typeEntries = Object.entries(byType).sort((a,b)=>b[1]-a[1]).map(([k,v])=>[k,v,typeColor(k)]);

    // By assignee (top 12)
    const byAsgn = {};
    items.forEach(i => { const n = i.assigned||'Sem responsável'; byAsgn[n]=(byAsgn[n]||0)+1; });
    const asgnEntries = Object.entries(byAsgn).sort((a,b)=>b[1]-a[1]).slice(0,12).map(([k,v])=>[k,v,'#60a5fa']);

    // By sprint
    const bySprint = {};
    items.forEach(i => {
      const k = i.iteration||'Sem Sprint';
      if (!bySprint[k]) bySprint[k] = { total:0, pts:0, closed:0, us:0 };
      bySprint[k].total++;
      bySprint[k].pts += i.pts||0;
      if (['Closed','Done','Resolved'].includes(i.state)) bySprint[k].closed++;
      if (['User Story','Product Backlog Item'].includes(i.type)) bySprint[k].us++;
    });

    const sprintRows = Object.entries(bySprint).sort((a,b) => {
      const aC = iterMap[a[0]]?.isCurrent, bC = iterMap[b[0]]?.isCurrent;
      if (aC && !bC) return -1; if (!aC && bC) return 1;
      const aS = iterMap[a[0]]?.start, bS = iterMap[b[0]]?.start;
      if (aS && bS) return new Date(bS) - new Date(aS);
      return a[0].localeCompare(b[0]);
    }).map(([key, d]) => {
      const iter = iterMap[key]||{};
      const label = key.includes('\\\\') ? key.split('\\\\').slice(1).join(' › ') : key;
      const dateR = (iter.start && iter.end) ? fmtD(iter.start) + ' – ' + fmtD(iter.end) : '—';
      const pct = d.total ? Math.round(d.closed/d.total*100) : 0;
      const isCurr = iter.isCurrent;
      return '<tr' + (isCurr?' class="is-current"':'') + '>' +
        '<td>' + label + (isCurr?' <span class="badge green" style="font-size:10px;padding:1px 6px">atual</span>':'') + '</td>' +
        '<td>' + dateR + '</td>' +
        '<td>' + d.total + '</td>' +
        '<td>' + d.pts + '</td>' +
        '<td>' + d.closed + ' <span style="color:#475569">(' + pct + '%)</span></td>' +
        '</tr>';
    }).join('');

    const tlSection = buildTimeline(bySprint, iterMap);

    return filterBanner + '<div class="d-section"><div class="d-section-title">Resumo Geral</div>' +
      '<div class="d-grid">' +
        '<div class="d-card"><div class="d-label">Total Itens</div><div class="d-val blue">' + total + '</div></div>' +
        '<div class="d-card"><div class="d-label">User Stories</div><div class="d-val blue">' + us + '</div></div>' +
        '<div class="d-card"><div class="d-label">Story Points</div><div class="d-val purple">' + totalPts + '</div></div>' +
        '<div class="d-card"><div class="d-label">Pts Entregues</div><div class="d-val green">' + donePts + '</div></div>' +
        '<div class="d-card"><div class="d-label">Em Andamento</div><div class="d-val blue">' + active + '</div></div>' +
        '<div class="d-card"><div class="d-label">Novos</div><div class="d-val">' + newItems + '</div></div>' +
        '<div class="d-card"><div class="d-label">Bugs</div><div class="d-val ' + (bugs>10?'red':bugs>5?'yellow':'') + '">' + bugs + ' <span class="d-sub">' + bugRate + '%</span></div></div>' +
        '<div class="d-card"><div class="d-label">Sem Estimativa</div><div class="d-val ' + (noEst>total*0.3?'yellow':'') + '">' + noEst + '</div></div>' +
      '</div></div>' +

      '<div class="d-section"><div class="d-section-title">Indicadores de Saúde</div>' +
        '<div style="display:flex;gap:32px;flex-wrap:wrap">' +
          '<div class="progress-ring">' + ring(closedPct,'#22c55e') + '<div><div class="d-label">Taxa de Conclusão</div><div class="d-val green" style="font-size:22px">' + closedPct + '%</div><div class="d-sub">' + (closed+resolved) + ' de ' + total + ' concluídos</div></div></div>' +
          '<div class="progress-ring">' + ring(estPct,'#60a5fa') + '<div><div class="d-label">Cobertura de Estimativas</div><div class="d-val blue" style="font-size:22px">' + estPct + '%</div><div class="d-sub">' + (total-noEst) + ' de ' + total + ' estimados</div></div></div>' +
          '<div class="progress-ring">' + ring(bugRate,'#ef4444') + '<div><div class="d-label">Taxa de Bugs</div><div class="d-val ' + (bugRate>20?'red':bugRate>10?'yellow':'') + '" style="font-size:22px">' + bugRate + '%</div><div class="d-sub">' + bugs + ' bugs no total</div></div></div>' +
        '</div>' +
      '</div>' +

      '<div class="d-cols">' +
        '<div class="d-section" style="margin:0"><div class="d-section-title">Itens por Status</div><div class="bar-list">' + barList(statusEntries, total) + '</div></div>' +
        '<div class="d-section" style="margin:0"><div class="d-section-title">Itens por Tipo</div><div class="bar-list">' + barList(typeEntries, total) + '</div></div>' +
      '</div>' +

      '<div class="d-section"><div class="d-section-title">Carga por Responsável (top 12)</div><div class="bar-list">' + barList(asgnEntries, total) + '</div></div>' +

      '<div class="d-section"><div class="d-section-title">Distribuição por Sprint</div>' +
        '<table class="d-table"><thead><tr><th>Sprint</th><th>Período</th><th>Itens</th><th>Story Points</th><th>Concluídos</th></tr></thead>' +
        '<tbody>' + sprintRows + '</tbody></table>' +
      '</div>' +
      tlSection;
  }

  function buildTimeline(bySprint, iterMap) {
    const now = new Date();
    const items = Object.entries(bySprint)
      .filter(([key]) => iterMap[key] && iterMap[key].start && iterMap[key].end)
      .map(([key, d]) => {
        const it = iterMap[key];
        const start = new Date(it.start), end = new Date(it.end);
        const label = key.split('\\u005c').pop();
        return { key, label, start, end, us: d.us, total: d.total, pts: d.pts, closed: d.closed, isCurrent: !!it.isCurrent, isPast: end < now };
      })
      .sort((a, b) => a.start - b.start);

    if (items.length < 2) return '';

    const minDate = items[0].start;
    const maxDate = items[items.length - 1].end;
    const totalMs  = maxDate - minDate || 1;
    const maxUS    = Math.max(...items.map(t => t.us), 1);

    function pct(d) { return ((d - minDate) / totalMs * 100).toFixed(2); }

    // Month axis
    const months = [];
    const mc = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
    while (mc <= maxDate) {
      const lp = Math.max(0, parseFloat(pct(mc)));
      if (lp <= 100) months.push('<div class="tl-month" style="left:' + lp + '%">' + mc.toLocaleDateString('pt-BR', {month:'short', year:'2-digit'}) + '</div>');
      mc.setMonth(mc.getMonth() + 1);
    }

    // Sprint blocks
    const blocks = items.map(t => {
      const l = pct(t.start), w = ((t.end - t.start) / totalMs * 100).toFixed(2);
      const barH = Math.max(8, Math.round(t.us / maxUS * 100));
      const color = t.isCurrent ? '#22c55e' : t.isPast ? '#475569' : '#60a5fa';
      const bg    = t.isCurrent ? '#22c55e18' : t.isPast ? '#1e293b' : '#1e3a5f44';
      return '<div class="tl-block" style="left:' + l + '%;width:' + w + '%;background:' + bg + ';border-color:' + color + '55" title="' + t.label + ' | ' + fmtD(t.start.toISOString()) + ' – ' + fmtD(t.end.toISOString()) + ' | ' + t.us + ' US">' +
        '<div class="tl-bar-inner" style="height:' + barH + '%;background:' + color + (t.isCurrent ? '' : '99') + '"></div>' +
        '<div class="tl-block-foot" style="color:' + color + '">' +
          '<div class="tl-block-name">' + t.label + (t.isCurrent ? ' 📅' : '') + '</div>' +
          '<div class="tl-block-us">' + t.us + ' US</div>' +
        '</div>' +
      '</div>';
    }).join('');

    // Today marker
    const todayPct = Math.min(100, Math.max(0, parseFloat(pct(now))));
    const todayMarker = now >= minDate && now <= maxDate
      ? '<div class="tl-today" style="left:' + todayPct + '%"><div class="tl-today-line"></div><div class="tl-today-label">hoje</div></div>'
      : '';

    return '<div class="d-section"><div class="d-section-title">Cronograma de Sprints</div>' +
      '<div class="tl-wrap">' +
        '<div class="tl-months">' + months.join('') + '</div>' +
        '<div class="tl-track">' + blocks + todayMarker + '</div>' +
      '</div>' +
      '<div class="tl-legend">' +
        '<span class="tl-leg" style="color:#475569">● Encerrada</span>' +
        '<span class="tl-leg" style="color:#60a5fa">● Futura</span>' +
        '<span class="tl-leg" style="color:#22c55e">● Sprint atual</span>' +
        '<span class="tl-leg" style="color:#f87171">┃ Hoje</span>' +
      '</div>' +
    '</div>';
  }
</script>

<div id="detail-modal" class="modal-overlay" onclick="closeDetails(event)">
  <div class="modal-box">
    <div class="modal-head">
      <div>
        <div class="modal-title" id="modal-title"></div>
        <div class="modal-sub" id="modal-sub"></div>
      </div>
      <div class="modal-actions">
        <button class="modal-maximize" type="button" id="btnMaximize" onclick="toggleMaximize()" title="Maximizar">⤢</button>
        <button class="modal-close" type="button" onclick="closeDetailsBtn()">✕</button>
      </div>
    </div>
    <div class="modal-body" id="modal-body"></div>
  </div>
</div>
</body></html>`;
}

function readBody(req) {
  return new Promise(resolve => {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => resolve(body));
  });
}

async function main() {
  const configured = loadConfig();
  let cachedHTML = "";

  if (configured) {
    console.log("🔄 Buscando dados do Azure DevOps...");
    const results = await Promise.all(cfg.projects.map(fetchProject));
    cachedHTML = buildHTML(results);
    console.log("✅ Dados carregados! Iniciando servidor...");
  } else {
    console.log("⚙️  Configuração não encontrada. Iniciando tela de setup...");
  }

  const server = http.createServer(async (req, res) => {
    const url = req.url;

    // ── GET /api/projects — lista projetos disponíveis para o PAT ─────────
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
        res.end(JSON.stringify({ error: "Falha ao conectar com o Azure DevOps: " + e.message }));
      }
      return;
    }

    // ── POST /setup — salva credenciais ────────────────────────────────────
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
        const results = await Promise.all(cfg.projects.map(fetchProject));
        cachedHTML = buildHTML(results);
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

    // ── GET /settings — tela de configurações ──────────────────────────────
    if (url === "/settings") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(buildSetupHTML({ prefill: { org: cfg.org || "", pat: cfg.pat || "", projects: cfg.projects || [] } }));
      return;
    }

    // ── Sem config → sempre setup ──────────────────────────────────────────
    if (!cfg.org || !cfg.pat || !cfg.projects?.length) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(buildSetupHTML());
      return;
    }

    // ── GET /refresh ────────────────────────────────────────────────────────
    if (url === "/refresh") {
      const r = await Promise.all(cfg.projects.map(fetchProject));
      cachedHTML = buildHTML(r);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(cachedHTML);
      return;
    }

    // ── GET /detail?project=NAME ────────────────────────────────────────────
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

    // ── GET / — dashboard principal ─────────────────────────────────────────
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(cachedHTML);
  });

  server.listen(PORT, () => {
    const serverUrl = `http://localhost:${PORT}`;
    console.log(`\n🚀 Dashboard rodando em: ${serverUrl}\n`);
    const cmd = process.platform === "win32" ? `start ${serverUrl}`
      : process.platform === "darwin" ? `open ${serverUrl}`
      : `xdg-open ${serverUrl}`;
    exec(cmd);
  });
}

main().catch(console.error);

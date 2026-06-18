const dns      = require('dns');
const http     = require('http');
const fs       = require('fs');
const nodePath = require('path');
dns.setDefaultResultOrder('ipv4first');

const { PORT, loadConfig, getCfg, getDisplayName, getAppMode } = require('./config');
const { HttpError, readBody } = require('./handlers/utils');
const state     = require('./handlers/state');
const dashH     = require('./handlers/dashboard');
const projH     = require('./handlers/projects');
const azureH    = require('./handlers/azure');
const aiH       = require('./handlers/ai');
const reportH   = require('./handlers/report');
const snH       = require('./handlers/sn');
const feedbackH    = require('./handlers/feedback');
const healthCfgH   = require('./handlers/healthConfig');

const PUBLIC_DIR = nodePath.join(__dirname, 'public');

// ── Response helpers ──────────────────────────────────────────────────────────

async function json(res, fn) {
  try {
    const data = await fn();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error('[server] 500 error:', e);
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message }));
  }
}

async function page(res, fn) {
  try {
    const html = await fn();
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end(e.message);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const configured = loadConfig();

  if (configured) {
    console.log('🔄 Buscando dados do Azure DevOps...');
    await dashH.buildAndCache();
    console.log('✅ Dados carregados! Iniciando servidor...');
  } else {
    const partialCfg = getCfg();
    if (partialCfg.org && partialCfg.pat) {
      // Credenciais existem mas sem projetos → gera dashboard com empty state
      await dashH.buildAndCache();
      console.log('⚙️  Sem projetos configurados. Iniciando dashboard em modo vazio...');
    } else if (getAppMode() === 'sn-only') {
      console.log('🟣 Modo ServiceNow-only. Carregando incidentes...');
      await dashH.buildAndCache();
      console.log('✅ Dados SN carregados! Iniciando servidor...');
    } else {
      console.log('⚙️  Configuração não encontrada. Iniciando tela de setup...');
    }
  }

  const server = http.createServer(async (req, res) => {
    const url = req.url;

    // ── Static files ──────────────────────────────────────────────────────
    const urlPath    = url.split('?')[0];
    const staticPath = nodePath.join(PUBLIC_DIR, urlPath);
    const staticSafe = staticPath.startsWith(PUBLIC_DIR + nodePath.sep) || staticPath === PUBLIC_DIR;
    if (staticSafe && fs.existsSync(staticPath) && fs.statSync(staticPath).isFile()) {
      const ext       = nodePath.extname(staticPath);
      const mimeTypes = { '.css': 'text/css', '.js': 'application/javascript', '.json': 'application/json', '.svg': 'image/svg+xml' };
      res.writeHead(200, { 'Content-Type': (mimeTypes[ext] || 'text/plain') + '; charset=utf-8' });
      res.end(fs.readFileSync(staticPath));
      return;
    }

    // ── GET /api/projects ─────────────────────────────────────────────────
    if (url.startsWith('/api/projects')) {
      const qp = new URLSearchParams(url.split('?')[1] || '');
      return json(res, () => projH.listProjects({ org: qp.get('org')?.trim(), pat: qp.get('pat')?.trim() }));
    }

    // ── POST /api/disconnect ──────────────────────────────────────────────
    if (req.method === 'POST' && url === '/api/disconnect') {
      return json(res, () => projH.disconnect());
    }

    // ── POST /api/complete-onboarding ─────────────────────────────────────
    if (req.method === 'POST' && url === '/api/complete-onboarding') {
      return json(res, () => projH.markOnboarded());
    }

    // ── POST /api/remove-project ───────────────────────────────────────────
    if (req.method === 'POST' && url === '/api/remove-project') {
      const body = await readBody(req);
      const { project } = JSON.parse(body || '{}');
      return json(res, () => projH.removeProject({ project }));
    }

    // ── POST /setup ────────────────────────────────────────────────────────
    if (req.method === 'POST' && url === '/setup') {
      const body   = await readBody(req);
      const params = new URLSearchParams(body);
      return json(res, () => projH.setup({
        rawOrg:      params.get('org')?.trim(),
        pat:         params.get('pat')?.trim(),
        projectsRaw: params.get('projects') || '',
      }));
    }

    // ── GET /onboarding ────────────────────────────────────────────────────
    if (url === '/onboarding') {
      const onboardingPath = nodePath.join(__dirname, 'views', 'onboarding.html');
      return page(res, () => fs.readFileSync(onboardingPath, 'utf8'));
    }

    // ── GET /settings ──────────────────────────────────────────────────────
    if (urlPath === '/settings') {
      const cfg = getCfg();
      return page(res, () => dashH.renderSetup({ org: cfg.org || '', pat: cfg.pat || '', projects: cfg.projects || [] }));
    }

    // ── No config → onboarding (first time) | SN-only | settings (returning) ─
    // API calls from the onboarding flow must still work even without a config,
    // so only redirect page-level requests (not /api/* or /ai/* routes).
    const cfg = getCfg();
    if ((!cfg.org || !cfg.pat) && !url.startsWith('/api/') && !url.startsWith('/ai/')) {
      if (!cfg._onboarded) {
        res.writeHead(302, { Location: '/onboarding' });
        return res.end();
      }
      // SN-only mode: serve the SN dashboard (rebuild if state is empty)
      if (getAppMode() === 'sn-only') {
        if (!state.html) {
          try { await dashH.buildAndCache(); } catch (_) {}
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(state.html || '<p>Loading ServiceNow dashboard...</p>');
      }
      return page(res, () => dashH.renderSetup());
    }
    // org + pat configurados mas sem projetos → dashboard com empty state

    // ── GET /refresh ───────────────────────────────────────────────────────
    if (url === '/refresh') {
      return page(res, async () => { await dashH.buildAndCache(); return state.html; });
    }

    // ── GET /api/team-capacity ─────────────────────────────────────────────
    if (url.startsWith('/api/team-capacity')) {
      const qp = new URLSearchParams(url.split('?')[1] || '');
      return json(res, () => azureH.getTeamCapacity({ project: qp.get('project') }));
    }

    // ── GET /api/uat ───────────────────────────────────────────────────────
    if (url.startsWith('/api/uat')) {
      const qp = new URLSearchParams(url.split('?')[1] || '');
      return json(res, () => azureH.getUAT({ project: qp.get('project') }));
    }

    // ── GET /detail ────────────────────────────────────────────────────────
    if (url.startsWith('/detail?')) {
      const project = new URLSearchParams(url.slice(8)).get('project');
      const displayNames = (cfg.projects || []).map(p => getDisplayName(p));
      if (!project || !displayNames.includes(project)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Projeto não encontrado' }));
        return;
      }
      return json(res, () => azureH.getDetail({ project }));
    }

    // ── POST /ai/context ───────────────────────────────────────────────────
    if (req.method === 'POST' && url === '/ai/context') {
      const body = await readBody(req);
      const { filters = {} } = JSON.parse(body || '{}');
      return json(res, () => azureH.getContext({ filters }));
    }

    // ── GET /ai/config ─────────────────────────────────────────────────────
    if (req.method === 'GET' && url === '/ai/config') {
      return json(res, () => aiH.getAiConfig());
    }

    // ── POST /ai/config ────────────────────────────────────────────────────
    if (req.method === 'POST' && url === '/ai/config') {
      const body = await readBody(req);
      return json(res, () => aiH.saveAiCfg(JSON.parse(body)));
    }

    // ── POST /ai/test ──────────────────────────────────────────────────────
    if (req.method === 'POST' && url === '/ai/test') {
      const body = await readBody(req);
      return json(res, () => aiH.testAiConnection(JSON.parse(body)));
    }

    // ── POST /ai/chat ──────────────────────────────────────────────────────
    if (req.method === 'POST' && url === '/ai/chat') {
      const body = await readBody(req);
      return json(res, () => aiH.chat(JSON.parse(body)));
    }

    // ── POST /api/feedback ─────────────────────────────────────────────────
    if (req.method === 'POST' && url === '/api/feedback') {
      const body = await readBody(req);
      return json(res, () => feedbackH.submitFeedback(JSON.parse(body)));
    }

    // ── GET/POST /api/health-config ───────────────────────────────────────
    if (url === '/api/health-config') {
      if (req.method === 'GET')
        return json(res, () => healthCfgH.getHealthConfig());
      if (req.method === 'POST') {
        const body = await readBody(req);
        return json(res, () => healthCfgH.saveHealthConfig(JSON.parse(body || '{}')));
      }
    }

    // ── GET /api/report-config (must precede /api/report) ─────────────────
    if (url.startsWith('/api/report-config')) {
      if (req.method === 'GET') {
        const qp = new URLSearchParams(url.split('?')[1] || '');
        return json(res, () => reportH.getReportConfig({ project: qp.get('project') || '' }));
      }
      if (req.method === 'POST') {
        const body = await readBody(req);
        return json(res, () => reportH.saveReportConfig(JSON.parse(body || '{}')));
      }
    }

    // ── GET /api/report-fields ─────────────────────────────────────────────
    if (req.method === 'GET' && url.startsWith('/api/report-fields')) {
      const qp = new URLSearchParams(url.split('?')[1] || '');
      return json(res, () => azureH.getReportFields({ project: qp.get('project') || '' }));
    }

    // ── GET /api/us-states ─────────────────────────────────────────────────
    if (req.method === 'GET' && url.startsWith('/api/us-states')) {
      const qp = new URLSearchParams(url.split('?')[1] || '');
      return json(res, () => azureH.getUSStates({ project: qp.get('project') || '' }));
    }

    // ── GET /api/report ────────────────────────────────────────────────────
    if (req.method === 'GET' && url.startsWith('/api/report')) {
      const qp = new URLSearchParams(url.split('?')[1] || '');
      return json(res, () => reportH.getReport({
        project:        qp.get('project') || '',
        month:          qp.get('month')   || '',
        groupFields:    (qp.get('groupFields') || '').split(',').filter(f => f),
        agingState:     qp.get('agingState') || 'In Review',
        incidentMonths: qp.get('incidentMonths'),
        deliveryStates: qp.get('deliveryStates') ? qp.get('deliveryStates').split(',').filter(s => s) : null,
        refresh:        qp.get('refresh') === '1',
      }));
    }

    // ── GET /api/sn-incidents ──────────────────────────────────────────────
    if (req.method === 'GET' && url.startsWith('/api/sn-incidents')) {
      const qp = new URLSearchParams(url.split('?')[1] || '');
      return json(res, () => reportH.getIncidents({
        project:     qp.get('project')     || '',
        month:       qp.get('month')       || new Date().toISOString().slice(0, 7),
        mode:        qp.get('mode')        || 'backlog',
        filterField: qp.get('filterField') || '',
        filterValue: qp.get('filterValue') || '',
        group:       qp.get('group')       || '',
      }));
    }

    // ── GET /api/sn-projects ──────────────────────────────────────────────
    if (req.method === 'GET' && url === '/api/sn-projects') {
      return json(res, () => snH.getAllProjectsSnCfg());
    }

    // ── GET/POST /api/sn-config ────────────────────────────────────────────
    if (url.startsWith('/api/sn-config')) {
      if (req.method === 'GET') {
        const qp = new URLSearchParams(url.split('?')[1] || '');
        return json(res, () => snH.getSnCfg({ project: qp.get('project') || '' }));
      }
      if (req.method === 'POST') {
        const body = await readBody(req);
        return json(res, async () => {
          const result = await snH.saveSnCfg(JSON.parse(body || '{}'));
          // Rebuild dashboard when in SN-only mode so the groups filter takes effect immediately
          if (getAppMode() === 'sn-only') {
            await dashH.buildAndCache();
          }
          return result;
        });
      }
    }

    // ── POST /api/sn-test ──────────────────────────────────────────────────
    if (req.method === 'POST' && url === '/api/sn-test') {
      const body = await readBody(req);
      return json(res, () => snH.testSn(JSON.parse(body || '{}')));
    }

    // ── GET /api/sn-groups (uses saved config credentials) ────────────────
    if (req.method === 'GET' && url === '/api/sn-groups') {
      return json(res, () => snH.fetchGroupsFromConfig());
    }

    // ── POST /api/sn-groups (raw credentials — onboarding) ────────────────
    if (req.method === 'POST' && url === '/api/sn-groups') {
      const body = await readBody(req);
      return json(res, () => snH.fetchGroups(JSON.parse(body || '{}')));
    }

    // ── GET / — dashboard ──────────────────────────────────────────────────
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(state.html);
  });

  server.listen(PORT, () => {
    console.log(`\n🚀 Dashboard rodando em: http://localhost:${PORT}\n`);
  });
}

main().catch(console.error);

const fs       = require('fs');
const nodePath = require('path');
const { getCfg, getProjectConfig, getSnConfig, getProjectSnGroup } = require('./config');
const { azurePost } = require('./azureClient');
const { paginatedItems } = require('./utils/paginate');
const { snGet } = require('./servicenowClient');

const CACHE_DIR = nodePath.join(
  process.pkg ? nodePath.dirname(process.execPath) : __dirname,
  'cache'
);

function _ensureCache() {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function _cacheFile(type, project, month) {
  const safe = project.replace(/[^a-zA-Z0-9_-]/g, '_');
  return nodePath.join(CACHE_DIR, `${type}_${safe}_${month}.json`);
}

function _readCache(type, project, month) {
  try {
    const raw = JSON.parse(fs.readFileSync(_cacheFile(type, project, month), 'utf8'));
    if (Date.now() - raw.ts < 6 * 60 * 60 * 1000) return raw.data; // 6h TTL
  } catch (_) {}
  return null;
}

function _writeCache(type, project, month, data) {
  _ensureCache();
  fs.writeFileSync(_cacheFile(type, project, month), JSON.stringify({ ts: Date.now(), data }), 'utf8');
}

function cacheInvalidate(project, month) {
  ['azure', 'sn'].forEach(type => {
    try { fs.unlinkSync(_cacheFile(type, project, month)); } catch (_) {}
  });
}

// ── Period helpers ─────────────────────────────────────────────────────────────

function buildPeriod(month) {
  const [y, m] = month.split('-').map(Number);
  const start = new Date(y, m - 1, 1);
  const end   = new Date(y, m, 0);
  const fmt   = d => d.toISOString().slice(0, 10);
  const label = start.toLocaleString('pt-BR', { month: 'long', year: 'numeric' });
  const history = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(y, m - 1 - i, 1);
    history.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return { month, label, start: fmt(start), end: fmt(end), history };
}

function getLast6Months() {
  const result = [];
  const now = new Date();
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    result.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return result;
}

// ── Azure data ─────────────────────────────────────────────────────────────────

async function fetchAzureReport(displayName, period) {
  const cached = _readCache('azure', displayName, period.month);
  if (cached) return cached;

  const pcfg = getProjectConfig(displayName);
  const proj  = pcfg?.name || displayName;

  const US_TYPES = "('User Story','Product Backlog Item','Requirement')";

  const [delivRes, bugsRes] = await Promise.all([
    azurePost(`${proj}/_apis/wit/wiql?api-version=7.0`, {
      query: `SELECT [System.Id] FROM WorkItems
              WHERE [System.TeamProject] = '${proj}'
                AND [System.WorkItemType] IN ${US_TYPES}
                AND [System.State] IN ('Closed','Done','Resolved')
                AND [Microsoft.VSTS.Common.ClosedDate] >= '${period.start}'
                AND [Microsoft.VSTS.Common.ClosedDate] <= '${period.end}T23:59:59Z'`
    }),
    azurePost(`${proj}/_apis/wit/wiql?api-version=7.0`, {
      query: `SELECT [System.Id],[System.State] FROM WorkItems
              WHERE [System.TeamProject] = '${proj}'
                AND [System.WorkItemType] = 'Bug'`
    }),
  ]);

  const delivIds = (delivRes.workItems || []).map(i => i.id);
  const bugIds   = (bugsRes.workItems  || []).map(i => i.id);

  const fields = 'System.Id,System.Title,System.State,System.IterationPath,Microsoft.VSTS.Scheduling.StoryPoints';
  const bugFields = 'System.Id,System.State';

  const [delivItems, bugItems] = await Promise.all([
    delivIds.length ? paginatedItems(proj, delivIds, fields)    : Promise.resolve([]),
    bugIds.length   ? paginatedItems(proj, bugIds, bugFields)   : Promise.resolve([]),
  ]);

  const OPEN_BUG = ['Active', 'In Progress', 'New'];

  const sprintMap = {};
  delivItems.forEach(i => {
    const sp = (i.fields['System.IterationPath'] || '').split('\\').pop() || 'Sem Sprint';
    if (!sprintMap[sp]) sprintMap[sp] = { name: sp, delivered: 0, points: 0 };
    sprintMap[sp].delivered++;
    sprintMap[sp].points += i.fields['Microsoft.VSTS.Scheduling.StoryPoints'] || 0;
  });

  const data = {
    totalDelivered: delivItems.length,
    sprints: Object.values(sprintMap),
    bugsTotal: bugIds.length,
    bugsOpen: bugItems.filter(i => OPEN_BUG.includes(i.fields['System.State'])).length,
  };

  _writeCache('azure', displayName, period.month, data);
  return data;
}

// ── Service Now data ───────────────────────────────────────────────────────────

async function fetchSnReport(displayName, period) {
  const snCfg  = getSnConfig();
  const snGrp  = getProjectSnGroup(displayName);
  if (!snCfg?.instance || !snCfg?.user || !snCfg?.pass || !snGrp?.assignmentGroup) return null;

  const cached = _readCache('sn', displayName, period.month);
  if (cached) return cached;

  const grp   = snGrp.assignmentGroup;
  const start = period.start;
  const end   = period.end + 'T23:59:59Z';

  const incQuery  = `assignment_group=${grp}^opened_at>=${start}^opened_at<=${end}`;
  const prbQuery  = `assignment_group=${grp}^state!=6`;

  const [incRes, prbRes] = await Promise.all([
    snGet(snCfg, `table/incident?sysparm_query=${encodeURIComponent(incQuery)}&sysparm_fields=sys_id,number,priority,category,state&sysparm_limit=1000`).catch(() => ({ result: [] })),
    snGet(snCfg, `table/problem?sysparm_query=${encodeURIComponent(prbQuery)}&sysparm_fields=sys_id,number,short_description,priority,category,state,opened_at&sysparm_limit=200`).catch(() => ({ result: [] })),
  ]);

  const incidents = incRes.result || [];
  const prbs      = prbRes.result || [];

  // Historical trend: last 6 months
  const monthly = await Promise.all(period.history.map(async m => {
    const [hy, hm] = m.split('-').map(Number);
    const hs = new Date(hy, hm - 1, 1).toISOString().slice(0, 10);
    const he = new Date(hy, hm, 0).toISOString().slice(0, 10) + 'T23:59:59Z';
    const q  = `assignment_group=${grp}^opened_at>=${hs}^opened_at<=${he}`;
    const r  = await snGet(snCfg, `table/incident?sysparm_query=${encodeURIComponent(q)}&sysparm_fields=sys_id,state&sysparm_limit=1000`).catch(() => ({ result: [] }));
    const items = r.result || [];
    return { label: m, opened: items.length, closed: items.filter(i => i.state === '7').length };
  }));

  const byPriority = { p1: 0, p2: 0, p3: 0 };
  incidents.forEach(i => {
    if (i.priority === '1') byPriority.p1++;
    else if (i.priority === '2') byPriority.p2++;
    else if (i.priority === '3') byPriority.p3++;
  });

  const catMap = {};
  incidents.forEach(i => { const c = i.category || 'Other'; catMap[c] = (catMap[c] || 0) + 1; });
  const bySystem = Object.entries(catMap).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, count]) => ({ name, count }));

  const now = Date.now();
  const prbList = prbs.map(p => {
    const agingDays = p.opened_at ? Math.floor((now - new Date(p.opened_at).getTime()) / 86400000) : 0;
    return { id: p.number, title: p.short_description, priority: p.priority, category: p.category, agingDays, state: p.state };
  });

  const data = {
    incidents: {
      total: incidents.length,
      target: 24,
      byPriority,
      bySystem,
      monthly,
    },
    prbs: {
      open: prbs.length,
      avgAging: prbList.length ? Math.round(prbList.reduce((s, p) => s + p.agingDays, 0) / prbList.length) : 0,
      list: prbList.slice(0, 50),
    },
  };

  _writeCache('sn', displayName, period.month, data);
  return data;
}

// ── Main entry ─────────────────────────────────────────────────────────────────

async function buildReport(displayName, month) {
  const period = buildPeriod(month);
  const [azure, sn] = await Promise.all([
    fetchAzureReport(displayName, period),
    fetchSnReport(displayName, period),
  ]);
  return {
    metadata:  { project: displayName, period: period.label, generatedAt: new Date().toLocaleString('pt-BR') },
    hasSn:     !!sn,
    delivery:  { totalDelivered: azure.totalDelivered, sprints: azure.sprints },
    quality:   { bugsTotal: azure.bugsTotal, bugsOpen: azure.bugsOpen },
    incidents: sn?.incidents || null,
    prbs:      sn?.prbs      || null,
  };
}

module.exports = { buildReport, buildPeriod, getLast6Months, cacheInvalidate };

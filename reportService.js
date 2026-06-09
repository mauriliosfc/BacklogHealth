const fs       = require('fs');
const nodePath = require('path');
const { getCfg, getProjectConfig, getSnConfig, getProjectSnGroup } = require('./config');
const { azureGet, azurePost } = require('./azureClient');
const { paginatedItems } = require('./utils/paginate');
const { snGet } = require('./servicenowClient');

const { CACHE_DIR } = require('./utils/paths');

function _ensureCache() {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function _cacheFile(type, project, month, extra) {
  const safe = project.replace(/[^a-zA-Z0-9_-]/g, '_');
  const sfx  = extra ? `_${extra.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 40)}` : '';
  return nodePath.join(CACHE_DIR, `${type}_${safe}_${month}${sfx}.json`);
}

function _readCache(type, project, month, extra) {
  try {
    const raw = JSON.parse(fs.readFileSync(_cacheFile(type, project, month, extra), 'utf8'));
    if (Date.now() - raw.ts < 6 * 60 * 60 * 1000) return raw.data; // 6h TTL
  } catch (_) {}
  return null;
}

function _writeCache(type, project, month, data, extra) {
  _ensureCache();
  fs.writeFileSync(_cacheFile(type, project, month, extra), JSON.stringify({ ts: Date.now(), data }), 'utf8');
}

function cacheInvalidate(project, month, groupField, snExtra) {
  try { fs.unlinkSync(_cacheFile('azure', project, month, groupField)); } catch (_) {}
  try { fs.unlinkSync(_cacheFile('sn',    project, month, snExtra));   } catch (_) {}
}

// Retorna Set com IterationPaths das sprints do time que se sobrepõem ao período
// Se team não informado, retorna null (sem filtro de sprint)
async function _fetchTeamSprintsForPeriod(proj, team, period) {
  if (!team) return { paths: null, allPaths: null, iterations: [] };
  try {
    const sd = await azureGet(
      `${encodeURIComponent(proj)}/${encodeURIComponent(team)}/_apis/work/teamsettings/iterations?api-version=7.0`
    );
    if (sd.value && sd.value.length) {
      const all      = sd.value;
      const filtered = all.filter(it => {
        const start = it.attributes?.startDate?.slice(0, 10);
        const end   = it.attributes?.finishDate?.slice(0, 10);
        if (!start || !end) return false;
        // Midpoint within period — each sprint counted in exactly one month
        const mid = new Date((new Date(start).getTime() + new Date(end).getTime()) / 2)
          .toISOString().slice(0, 10);
        return mid >= period.start && mid <= period.end;
      });
      return {
        paths:    new Set(filtered.map(it => it.path)), // period sprints (delivery filter)
        allPaths: new Set(all.map(it => it.path)),       // all team sprints (aging filter)
        iterations: filtered.map(it => ({
          name: it.name,
          path: it.path,
          start: it.attributes?.startDate?.slice(0, 10),
        })),
      };
    }
  } catch (e) {
    console.error(`[reportService] _fetchTeamSprintsForPeriod failed for team "${team}":`, e.message);
  }
  // Team is configured but API failed or returned no iterations.
  // Return empty Sets (not null) so filters are always applied and prevent
  // showing items from other teams in the same project.
  return { paths: new Set(), allPaths: new Set(), iterations: [] };
}

// ── Period helpers ─────────────────────────────────────────────────────────────

function buildPeriod(month, historyMonths = 13) {
  const [y, m] = month.split('-').map(Number);
  const start = new Date(y, m - 1, 1);
  const end   = new Date(y, m, 0);
  const fmt   = d => d.toISOString().slice(0, 10);
  const label = start.toLocaleString('pt-BR', { month: 'long', year: 'numeric' });
  const history = [];
  for (let i = historyMonths - 1; i >= 0; i--) {
    const d = new Date(y, m - 1 - i, 1);
    history.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return { month, label, start: fmt(start), end: fmt(end), history };
}

function getLast6Months(n = 6) {
  const result = [];
  const now = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    result.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return result;
}

// ── Azure data ─────────────────────────────────────────────────────────────────

const _DEFAULT_DONE_STATES = ['Closed', 'Done', 'Resolved'];

async function fetchAzureReport(displayName, period, groupFields = [], agingState = '', deliveryStates = null) {
  const pcfg = getProjectConfig(displayName);
  const proj  = pcfg?.name || displayName;

  const DONE_STATES      = (Array.isArray(deliveryStates) && deliveryStates.length) ? deliveryStates : _DEFAULT_DONE_STATES;
  const usAgingState     = agingState || '';
  const cleanGroupFields = (groupFields || []).filter(f => f);
  // Only extend cache key when delivery states differ from default (backward compat)
  const isDefaultDelivery = DONE_STATES.length === _DEFAULT_DONE_STATES.length && DONE_STATES.every(s => _DEFAULT_DONE_STATES.includes(s));
  const cacheKey = [...cleanGroupFields.slice().sort(), usAgingState, ...(isDefaultDelivery ? [] : [DONE_STATES.slice().sort().join(',')])].join('|');
  const cached = _readCache('azure', displayName, period.month, cacheKey);
  if (cached) return cached;

  const US_TYPES = "('User Story','Product Backlog Item','Requirement')";

  const projEnc = encodeURIComponent(proj);
  const [delivRes, bugsRes, bugsNewRes, bugsFixRes, teamIterData, agingRes] = await Promise.all([
    azurePost(`${projEnc}/_apis/wit/wiql?api-version=7.0`, {
      query: `SELECT [System.Id] FROM WorkItems
              WHERE [System.TeamProject] = '${proj}'
                AND [System.WorkItemType] IN ${US_TYPES}`
    }),
    azurePost(`${projEnc}/_apis/wit/wiql?api-version=7.0`, {
      query: `SELECT [System.Id] FROM WorkItems
              WHERE [System.TeamProject] = '${proj}'
                AND [System.WorkItemType] = 'Bug'
                AND [System.State] NOT IN ('Closed','Done','Resolved','Removed')`
    }),
    azurePost(`${projEnc}/_apis/wit/wiql?api-version=7.0`, {
      query: `SELECT [System.Id] FROM WorkItems
              WHERE [System.TeamProject] = '${proj}'
                AND [System.WorkItemType] = 'Bug'
                AND [System.CreatedDate] >= '${period.start}'
                AND [System.CreatedDate] <= '${period.end}'`
    }),
    azurePost(`${projEnc}/_apis/wit/wiql?api-version=7.0`, {
      query: `SELECT [System.Id] FROM WorkItems
              WHERE [System.TeamProject] = '${proj}'
                AND [System.WorkItemType] = 'Bug'
                AND [System.State] IN ('Closed','Done','Resolved')
                AND [Microsoft.VSTS.Common.StateChangeDate] >= '${period.start}'
                AND [Microsoft.VSTS.Common.StateChangeDate] <= '${period.end}'`
    }),
    _fetchTeamSprintsForPeriod(proj, pcfg?.team, period),
    usAgingState
      ? azurePost(`${projEnc}/_apis/wit/wiql?api-version=7.0`, {
          query: `SELECT [System.Id] FROM WorkItems
                  WHERE [System.TeamProject] = '${proj}'
                    AND [System.WorkItemType] IN ${US_TYPES}
                    AND [System.State] = '${usAgingState}'`
        }).catch(() => null)
      : Promise.resolve(null),
  ]);

  const { paths: teamIterPaths, allPaths: teamAllPaths, iterations: teamIterations } = teamIterData;

  const delivIds   = (delivRes.workItems || []).map(i => i.id);
  const bugOpenIds = (bugsRes.workItems  || []).map(i => i.id);
  const bugNewIds  = (bugsNewRes.workItems  || []).map(i => i.id);
  const bugFixIds  = (bugsFixRes.workItems  || []).map(i => i.id);
  const agingIds   = (agingRes?.workItems  || []).map(i => i.id);

  const baseFields   = 'System.Id,System.State,System.IterationPath,Microsoft.VSTS.Scheduling.StoryPoints,System.WorkItemType,System.CreatedDate';
  const extraFields  = cleanGroupFields.filter(r => !baseFields.includes(r));
  const fields       = extraFields.length ? `${baseFields},${extraFields.join(',')}` : baseFields;
  const bugFields    = 'System.Id,System.State,System.IterationPath';
  const agingFields  = 'System.Id,System.Title,System.State,System.AssignedTo,Microsoft.VSTS.Common.StateChangeDate,System.IterationPath';

  const [delivItems, bugOpenItems, bugNewItems, bugFixItems, agingItems] = await Promise.all([
    delivIds.length   ? paginatedItems(proj, delivIds,   fields)      : Promise.resolve([]),
    bugOpenIds.length ? paginatedItems(proj, bugOpenIds, bugFields)    : Promise.resolve([]),
    bugNewIds.length  ? paginatedItems(proj, bugNewIds,  bugFields)    : Promise.resolve([]),
    bugFixIds.length  ? paginatedItems(proj, bugFixIds,  bugFields)    : Promise.resolve([]),
    agingIds.length   ? paginatedItems(proj, agingIds,   agingFields)  : Promise.resolve([]),
  ]);


  // Se o projeto tem time configurado, filtra itens pelas sprints do mês
  const filteredDelivItems = teamIterPaths
    ? delivItems.filter(i => teamIterPaths.has(i.fields['System.IterationPath'] || ''))
    : delivItems;

  // Filtra bugs pelo time se configurado (bugs sem IterationPath são incluídos — backlog)
  const filterBugs = items => teamIterPaths
    ? items.filter(i => {
        const ip = i.fields['System.IterationPath'] || '';
        return !ip || teamIterPaths.has(ip);
      })
    : items;

  const openBugs = filterBugs(bugOpenItems);
  const newBugs  = filterBugs(bugNewItems);
  const fixBugs  = filterBugs(bugFixItems);

  // Sprint start date map for volatility calculation
  const sprintStartMap = {};
  teamIterations.forEach(it => { if (it.name && it.start) sprintStartMap[it.name] = it.start; });

  const sprintMap = {};
  filteredDelivItems.forEach(i => {
    const sp          = (i.fields['System.IterationPath'] || '').split('\\').pop() || 'Sem Sprint';
    const pts         = i.fields['Microsoft.VSTS.Scheduling.StoryPoints'] || 0;
    const done        = DONE_STATES.includes(i.fields['System.State']);
    const createdDate = (i.fields['System.CreatedDate'] || '').slice(0, 10);
    const sprintStart = sprintStartMap[sp];
    const addedLate   = createdDate && sprintStart && createdDate > sprintStart ? 1 : 0;
    const removed = i.fields['System.State'] === 'Removed' ? 1 : 0;
    if (!sprintMap[sp]) sprintMap[sp] = { name: sp, total: 0, delivered: 0, points: 0, pointsDelivered: 0, addedMidSprint: 0, removedFromSprint: 0 };
    sprintMap[sp].total++;
    sprintMap[sp].points += pts;
    sprintMap[sp].addedMidSprint   += addedLate;
    sprintMap[sp].removedFromSprint += removed;
    if (done) {
      sprintMap[sp].delivered++;
      sprintMap[sp].pointsDelivered += pts;
    }
  });

  // Detecta itens movidos para fora da sprint (IterationPath alterado — movidos ao backlog ou outra sprint).
  // Complementa a detecção de state='Removed' já feita acima.
  // Requer teamIterations com paths completos; projetos sem time configurado ficam sem esse dado.
  if (teamIterations.length > 0) {
    const movedOutResults = await Promise.all(
      teamIterations.map(it =>
        it.path
          ? azurePost(`${projEnc}/_apis/wit/wiql?api-version=7.0`, {
              query: `SELECT [System.Id] FROM WorkItems
                      WHERE [System.TeamProject] = '${proj}'
                        AND [System.WorkItemType] IN ${US_TYPES}
                        AND [System.IterationPath] Was Ever '${it.path}'
                        AND [System.IterationPath] <> '${it.path}'`,
            }).catch(() => ({ workItems: [] }))
          : Promise.resolve({ workItems: [] })
      )
    );
    teamIterations.forEach((it, idx) => {
      const count = (movedOutResults[idx]?.workItems || []).length;
      if (count > 0 && sprintMap[it.name]) {
        sprintMap[it.name].removedFromSprint += count;
      }
    });
  }

  // Delivered items grouped by each requested field (one pass)
  const refs       = cleanGroupFields.length ? cleanGroupFields : [''];
  const rawMaps    = {};
  const rawPtsMaps = {};
  refs.forEach(r => { rawMaps[r] = {}; rawPtsMaps[r] = {}; });

  filteredDelivItems.forEach(i => {
    refs.forEach(r => {
      const t   = (r ? i.fields[r] : null) || i.fields['System.WorkItemType'] || '(sem tipo)';
      const pts = i.fields['Microsoft.VSTS.Scheduling.StoryPoints'] || 0;
      rawMaps[r][t]    = (rawMaps[r][t]    || 0) + 1;
      rawPtsMaps[r][t] = (rawPtsMaps[r][t] || 0) + pts;
    });
  });

  const byTypes    = {};
  const byTypesPts = {};
  Object.entries(rawMaps).forEach(([r, map]) => {
    byTypes[r] = Object.entries(map).sort((a, b) => b[1] - a[1]).map(([type, count]) => ({ type, count }));
  });
  Object.entries(rawPtsMaps).forEach(([r, map]) => {
    byTypesPts[r] = Object.entries(map).sort((a, b) => b[1] - a[1]).map(([type, count]) => ({ type, count }));
  });

  // Filter aging items by all team iteration paths (not just period — item may be in an old sprint)
  const filteredAgingItems = teamAllPaths
    ? agingItems.filter(i => {
        const ip = i.fields['System.IterationPath'] || '';
        return !ip || teamAllPaths.has(ip);
      })
    : agingItems;

  // US Aging
  let usAging = null;
  if (usAgingState && filteredAgingItems.length >= 0) {
    const today = new Date();
    const BUCKETS = [
      { label: '< 7 dias',   max: 7          },
      { label: '7–14 dias',  max: 14         },
      { label: '15–30 dias', max: 30         },
      { label: '31–60 dias', max: 60         },
      { label: '> 60 dias',  max: Infinity   },
    ];
    const counts = BUCKETS.map(() => 0);

    const list = filteredAgingItems.map(i => {
      const sd         = i.fields['Microsoft.VSTS.Common.StateChangeDate'];
      const agingDays  = sd ? Math.max(0, Math.floor((today - new Date(sd)) / 86400000)) : 0;
      const sprint     = (i.fields['System.IterationPath'] || '').split('\\').pop() || '—';
      const assignee   = i.fields['System.AssignedTo']?.displayName || i.fields['System.AssignedTo'] || '—';
      const bucketIdx  = BUCKETS.findIndex(b => agingDays < b.max);
      if (bucketIdx >= 0) counts[bucketIdx]++;
      const baseUrl = getCfg().baseUrl || '';
      return { id: i.id, url: `${baseUrl}/_workitems/edit/${i.id}`, title: i.fields['System.Title'] || '', assignee, sprint, agingDays };
    }).sort((a, b) => b.agingDays - a.agingDays);

    usAging = {
      state: usAgingState,
      total: list.length,
      list,   // full sorted list — frontend computes buckets with configurable thresholds
    };
  }

  const allSprints = Object.values(sprintMap);
  const data = {
    totalDelivered: allSprints.reduce((s, sp) => s + sp.delivered, 0),
    totalUS:        allSprints.reduce((s, sp) => s + sp.total, 0),
    sprints:        allSprints,
    byTypes,
    byTypesPts,
    bugsOpen:   openBugs.length,
    bugsNew:    newBugs.length,
    bugsClosed: fixBugs.length,
    usAging,
  };

  _writeCache('azure', displayName, period.month, data, cacheKey);
  return data;
}

// ── Service Now data ───────────────────────────────────────────────────────────

// Normaliza campo SN — display label (u_additional_res_code, cmdb_ci.name, etc.)
function _snVal(v) {
  if (!v && v !== 0) return null;
  if (typeof v === 'object') return v.display_value || v.value || null;
  return String(v) || null;
}
// Normaliza campo SN — valor interno (priority code, state code, etc.)
function _snRaw(v) {
  if (!v && v !== 0) return null;
  if (typeof v === 'object') return v.value || null;
  return String(v) || null;
}

async function fetchSnReport(displayName, period) {
  const snCfg  = getSnConfig();
  const snGrp  = getProjectSnGroup(displayName);
  if (!snCfg?.instance || !snCfg?.user || !snCfg?.pass || !snGrp?.assignmentGroup) return null;

  const snCacheKey = String(period.history.length);
  const cached = _readCache('sn', displayName, period.month, snCacheKey);
  if (cached) return cached;

  const grp = snGrp.assignmentGroup.trim();
  // ServiceNow assignment_group field accepts sys_id (32-char hex) directly.
  // If user provided a display name, use dot-notation: assignment_group.name=
  const isSysId   = /^[0-9a-f]{32}$/i.test(grp);
  const grpFilter = isSysId ? `assignment_group=${grp}` : `assignment_group.name=${grp}`;

  const start = period.start + 'T00:00:00Z';
  const end   = period.end   + 'T23:59:59Z';

  const incQuery              = `${grpFilter}^opened_at>=${start}^opened_at<=${end}`;
  const incClosedQuery        = `${grpFilter}^resolved_at>=${start}^resolved_at<=${end}^NQ${grpFilter}^closed_at>=${start}^closed_at<=${end}^resolved_atISEMPTY`;
  // Mês atual → backlog ativo agora (active=true exclui cancelados e encerrados).
  // Mês passado → ponto-no-tempo (3 partes via ^NQ):
  //   1. Abertos ainda hoje e não cancelados (resolved_atISEMPTY^state!=8)
  //   2. Cancelados DEPOIS do fim do mês — estavam no backlog (state=8^closed_at>end)
  //   3. Resolvidos DEPOIS do fim do mês — estavam no backlog (resolved_at>end)
  // A regressão do gráfico depende deste valor como âncora correta.
  const curMonth        = new Date().toISOString().slice(0, 7);
  const incBacklogQuery = period.month === curMonth
    ? `${grpFilter}^active=true^state!=6^state!=7`
    : `${grpFilter}^opened_at<=${end}^resolved_atISEMPTY^state!=8^NQ${grpFilter}^opened_at<=${end}^state=8^closed_at>${end}^NQ${grpFilter}^opened_at<=${end}^resolved_at>${end}`;
  const prbQuery              = `${grpFilter}^state!=106^state!=107`;
  const prbResolvedQuery      = `${grpFilter}^resolved_at>=${start}^resolved_at<=${end}`;
  const prbOpenedThisMonthQuery = `${grpFilter}^opened_at>=${start}^opened_at<=${end}`;
  // task_sla: usa business_elapsed_percentage nativo do ServiceNow (calendário útil)
  const taskSlaGrpFilter = isSysId ? `task.assignment_group=${grp}` : `task.assignment_group.name=${grp}`;
  const taskSlaQuery     = `${taskSlaGrpFilter}^task.resolved_at>=${start}^task.resolved_at<=${end}`;

  console.log(`[SN] project="${displayName}" group="${grp}" isSysId=${isSysId}`);
  console.log(`[SN] incQuery: ${incQuery}`);

  const [incRes, incClosedRes, incBacklogRes, prbRes, prbResolvedRes, prbOpenedThisMonthRes, taskSlaRes] = await Promise.all([
    snGet(snCfg, `table/incident?sysparm_query=${encodeURIComponent(incQuery)}&sysparm_fields=sys_id,priority,cmdb_ci.name,u_additional_res_code,location.name,state&sysparm_display_value=all&sysparm_limit=1000`).catch(e => { console.error('[SN incidents error]', e.message); return { result: [] }; }),
    snGet(snCfg, `table/incident?sysparm_query=${encodeURIComponent(incClosedQuery)}&sysparm_fields=sys_id,opened_at,resolved_at,closed_at&sysparm_limit=1000`).catch(() => ({ result: [] })),
    snGet(snCfg, `table/incident?sysparm_query=${encodeURIComponent(incBacklogQuery)}&sysparm_fields=sys_id&sysparm_limit=1000`).catch(() => ({ result: [] })),
    snGet(snCfg, `table/problem?sysparm_query=${encodeURIComponent(prbQuery)}&sysparm_fields=sys_id,number,short_description,priority,category,state,opened_at&sysparm_limit=200`).catch(e => { console.error('[SN problems error]', e.message); return { result: [] }; }),
    snGet(snCfg, `table/problem?sysparm_query=${encodeURIComponent(prbResolvedQuery)}&sysparm_fields=sys_id,opened_at,resolved_at&sysparm_limit=200`).catch(() => ({ result: [] })),
    snGet(snCfg, `table/problem?sysparm_query=${encodeURIComponent(prbOpenedThisMonthQuery)}&sysparm_fields=sys_id&sysparm_limit=200`).catch(() => ({ result: [] })),
    snGet(snCfg, `table/task_sla?sysparm_query=${encodeURIComponent(taskSlaQuery)}&sysparm_fields=task,task.priority,business_elapsed_percentage&sysparm_limit=2000`).catch(() => ({ result: [] })),
  ]);

  const incidents              = incRes.result || [];
  const incClosedRaw           = incClosedRes.result || [];
  const incClosedInPeriod      = [...new Map(incClosedRaw.map(i => [i.sys_id, i])).values()];
  const incBacklog             = (incBacklogRes.result || []).length;
  const prbs                   = prbRes.result || [];
  const prbsResolvedInPeriod   = prbResolvedRes.result || [];
  const prbsOpenedInPeriod     = prbOpenedThisMonthRes.result || [];
  console.log(`[SN] incidents returned: ${incidents.length}, problems: ${prbs.length}`);

  let incAvgResolutionDays = 0;
  if (incClosedInPeriod.length > 0) {
    let validCount = 0;
    const total = incClosedInPeriod.reduce((s, i) => {
      const closedAt = i.resolved_at || i.closed_at;
      if (i.opened_at && closedAt) {
        validCount++;
        return s + Math.max(0, (new Date(closedAt) - new Date(i.opened_at)) / 86400000);
      }
      return s;
    }, 0);
    incAvgResolutionDays = validCount > 0 ? Math.round(total / validCount) : 0;
  }

  // SLA compliance via task_sla (business_elapsed_percentage nativo do ServiceNow)
  // Agrupa por incidente (task.sys_id) e toma o maior % — se > 100 o incidente violou o SLA
  const taskSlaItems = taskSlaRes.result || [];
  const taskSlaMap   = {};
  taskSlaItems.forEach(r => {
    const taskRef = r.task;
    const taskId  = typeof taskRef === 'object' ? taskRef.value : String(taskRef || '');
    const pct     = parseFloat(r.business_elapsed_percentage) || 0;
    const prioRaw = r['task.priority'];
    const prio    = typeof prioRaw === 'object' ? String(prioRaw.value || '') : String(prioRaw || '');
    if (!taskId) return;
    if (!taskSlaMap[taskId] || pct > taskSlaMap[taskId].pct) {
      taskSlaMap[taskId] = { pct, prio };
    }
  });

  const slaByPriority = {
    p1: { total: 0, breached: 0, withinSla: 0, pct: null },
    p2: { total: 0, breached: 0, withinSla: 0, pct: null },
    p3: { total: 0, breached: 0, withinSla: 0, pct: null },
  };
  Object.values(taskSlaMap).forEach(({ pct, prio }) => {
    const key = prio === '1' ? 'p1' : prio === '2' ? 'p2' : prio === '3' ? 'p3' : null;
    if (!key) return;
    slaByPriority[key].total++;
    if (pct > 100) slaByPriority[key].breached++;
  });
  ['p1', 'p2', 'p3'].forEach(k => {
    const s   = slaByPriority[k];
    s.withinSla = s.total - s.breached;
    s.pct       = s.total > 0 ? Math.round(s.withinSla / s.total * 100) : null;
  });

  // Histórico mensal — processado em lotes de 4 meses em paralelo (16 req/lote).
  // Reduz de 13 round-trips sequenciais para ~4, sem sobrecarregar o SN.
  const HISTORY_BATCH = 4;
  const monthly      = [];
  const prbMonthly   = [];
  const sysMonthData = {}; // { ciName: [count per history index] }
  const altMonthData  = {}; // { resCode: [count per history index] }
  const altRawValues  = {}; // { displayValue: rawValue } — mapeamento para filtro SN
  const locMonthData  = {}; // { locationName: [count per history index] }

  const allHistoryResults = [];
  for (let bStart = 0; bStart < period.history.length; bStart += HISTORY_BATCH) {
    const batch = await Promise.all(
      period.history.slice(bStart, bStart + HISTORY_BATCH).map(async m => {
        const [hy, hm] = m.split('-').map(Number);
        const hs = new Date(hy, hm - 1, 1).toISOString().slice(0, 19) + 'Z';
        const he = new Date(hy, hm, 0, 23, 59, 59).toISOString().slice(0, 19) + 'Z';
        const incOpenedQ    = `${grpFilter}^opened_at>=${hs}^opened_at<=${he}`;
        const incClosedQ    = `${grpFilter}^resolved_at>=${hs}^resolved_at<=${he}^NQ${grpFilter}^closed_at>=${hs}^closed_at<=${he}^resolved_atISEMPTY^state!=8`;
        const incCancelledQ = `${grpFilter}^state=8^closed_at>=${hs}^closed_at<=${he}`;
        const prbOpenedQ    = `${grpFilter}^opened_at>=${hs}^opened_at<=${he}`;
        const prbResolvedQ  = `${grpFilter}^resolved_at>=${hs}^resolved_at<=${he}`;
        const [rIncO, rIncC, rIncCanc, rPrbO, rPrbR] = await Promise.all([
          snGet(snCfg, `table/incident?sysparm_query=${encodeURIComponent(incOpenedQ)}&sysparm_fields=sys_id,cmdb_ci.name,u_additional_res_code,location.name&sysparm_display_value=all&sysparm_limit=1000`).catch(() => ({ result: [] })),
          snGet(snCfg, `table/incident?sysparm_query=${encodeURIComponent(incClosedQ)}&sysparm_fields=sys_id&sysparm_limit=1000`).catch(() => ({ result: [] })),
          snGet(snCfg, `table/incident?sysparm_query=${encodeURIComponent(incCancelledQ)}&sysparm_fields=sys_id&sysparm_limit=1000`).catch(() => ({ result: [] })),
          snGet(snCfg, `table/problem?sysparm_query=${encodeURIComponent(prbOpenedQ)}&sysparm_fields=sys_id&sysparm_limit=200`).catch(() => ({ result: [] })),
          snGet(snCfg, `table/problem?sysparm_query=${encodeURIComponent(prbResolvedQ)}&sysparm_fields=sys_id&sysparm_limit=200`).catch(() => ({ result: [] })),
        ]);
        return { m, rIncO, rIncC, rIncCanc, rPrbO, rPrbR };
      })
    );
    allHistoryResults.push(...batch);
  }

  allHistoryResults.forEach(({ m, rIncO, rIncC, rIncCanc, rPrbO, rPrbR }, mIdx) => {
    const incOpened    = rIncO.result || [];
    const incClosed    = (rIncC.result || []).length;
    const incCancelled = (rIncCanc.result || []).length;
    incOpened.forEach(i => {
      const name = _snVal(i['cmdb_ci.name']) || 'Outros';
      if (!sysMonthData[name]) sysMonthData[name] = new Array(period.history.length).fill(0);
      sysMonthData[name][mIdx]++;
      const alt    = _snVal(i['u_additional_res_code']) || 'N/A';
      const altRaw = _snRaw(i['u_additional_res_code']) || alt;
      if (!altMonthData[alt]) altMonthData[alt] = new Array(period.history.length).fill(0);
      altMonthData[alt][mIdx]++;
      altRawValues[alt] = altRaw;
      const loc = _snVal(i['location.name']) || 'Não informado';
      if (!locMonthData[loc]) locMonthData[loc] = new Array(period.history.length).fill(0);
      locMonthData[loc][mIdx]++;
    });
    monthly.push({
      label:     m,
      opened:    incOpened.length,
      closed:    incClosed,
      cancelled: incCancelled,
    });
    prbMonthly.push({
      label:    m,
      opened:   (rPrbO.result || []).length,
      resolved: (rPrbR.result || []).length,
    });
  });

  // Backlog histórico de Incidentes — regressão a partir do backlog atual (sem clamp na cadeia)
  // Cancelados saem do backlog assim como fechados: backlog[prev] = backlog[curr] − opened[curr] + closed[curr] + cancelled[curr]
  // Math.abs() só é aplicado na renderização do gráfico para não corromper meses anteriores
  monthly[monthly.length - 1].openBacklog = incBacklog;
  for (let i = monthly.length - 2; i >= 0; i--) {
    const next = monthly[i + 1];
    monthly[i].openBacklog = next.openBacklog - next.opened + next.closed + (next.cancelled || 0);
  }

  // Backlog histórico de PRBs — calculado de trás para frente a partir do backlog atual
  prbMonthly[prbMonthly.length - 1].openBacklog = prbs.length;
  for (let i = prbMonthly.length - 2; i >= 0; i--) {
    const next = prbMonthly[i + 1];
    prbMonthly[i].openBacklog = Math.max(0, next.openBacklog - next.opened + next.resolved);
  }


  const byPriority = { p1: 0, p2: 0, p3: 0 };
  incidents.forEach(i => {
    const p = _snRaw(i.priority);
    if (p === '1') byPriority.p1++;
    else if (p === '2') byPriority.p2++;
    else if (p === '3') byPriority.p3++;
  });

  const sysMap = {};
  incidents.forEach(i => {
    const name = _snVal(i['cmdb_ci.name']) || 'Outros';
    const p    = _snRaw(i.priority);
    if (!sysMap[name]) sysMap[name] = { name, total: 0, p1: 0, p2: 0, p3: 0 };
    sysMap[name].total++;
    if (p === '1') sysMap[name].p1++;
    else if (p === '2') sysMap[name].p2++;
    else if (p === '3') sysMap[name].p3++;
  });
  const bySystem = Object.values(sysMap).sort((a, b) => b.total - a.total);
  const bySystemMonthly = Object.entries(sysMonthData)
    .map(([name, counts]) => ({ name, monthly: counts, total: counts.reduce((s, c) => s + c, 0) }))
    .sort((a, b) => b.total - a.total);

  const altSysMap = {};
  incidents.forEach(i => {
    const name    = _snVal(i['u_additional_res_code']) || 'N/A';
    const rawName = _snRaw(i['u_additional_res_code']) || name;
    if (!altSysMap[name]) altSysMap[name] = { name, rawValue: rawName, total: 0, p1: 0, p2: 0, p3: 0 };
    const p = _snRaw(i.priority);
    altSysMap[name].total++;
    if (p === '1') altSysMap[name].p1++;
    else if (p === '2') altSysMap[name].p2++;
    else if (p === '3') altSysMap[name].p3++;
  });
  const byGroupAlt = Object.values(altSysMap).sort((a, b) => b.total - a.total);
  const byGroupAltMonthly = Object.entries(altMonthData)
    .map(([name, counts]) => ({ name, rawValue: altRawValues[name] || name, monthly: counts, total: counts.reduce((s, c) => s + c, 0) }))
    .sort((a, b) => b.total - a.total);

  const byLocationMonthly = Object.entries(locMonthData)
    .map(([name, counts]) => ({ name, monthly: counts, total: counts.reduce((s, c) => s + c, 0) }))
    .sort((a, b) => b.total - a.total);

  const now = Date.now();
  const prbList = prbs.map(p => {
    const agingDays = p.opened_at ? Math.floor((now - new Date(p.opened_at).getTime()) / 86400000) : 0;
    return { id: p.number, title: p.short_description, priority: p.priority, category: p.category, agingDays, state: p.state };
  });

  // Avg resolution days for PRBs resolved this period
  let avgResolutionDays = 0;
  if (prbsResolvedInPeriod.length > 0) {
    const total = prbsResolvedInPeriod.reduce((s, p) => {
      if (p.opened_at && p.resolved_at) {
        return s + Math.max(0, (new Date(p.resolved_at) - new Date(p.opened_at)) / 86400000);
      }
      return s;
    }, 0);
    avgResolutionDays = Math.round(total / prbsResolvedInPeriod.length);
  }

  const resolvedThisMonth = prbsResolvedInPeriod.length;
  const openedThisMonth   = prbsOpenedInPeriod.length;

  const data = {
    incidents: {
      total:             incidents.length,
      closedThisMonth:   incClosedInPeriod.length,
      openBacklog:       incBacklog,
      avgResolutionDays: incAvgResolutionDays,
      byPriority,
      slaEnabled:    snGrp.slaEnabled === true,
      slaByPriority,
      bySystem,
      bySystemMonthly,
      byGroupAlt,
      byGroupAltMonthly,
      byLocationMonthly,
      monthly,
    },
    prbs: {
      open:               prbs.length,
      resolvedThisMonth,
      openedThisMonth,
      delta:              openedThisMonth - resolvedThisMonth,
      avgAging:           prbList.length ? Math.round(prbList.reduce((s, p) => s + p.agingDays, 0) / prbList.length) : 0,
      avgResolutionDays,
      list:               prbList.slice(0, 50),
      monthly:            prbMonthly,
    },
  };

  _writeCache('sn', displayName, period.month, data, snCacheKey);
  return data;
}

// ── Main entry ─────────────────────────────────────────────────────────────────

async function buildReport(displayName, month, groupFields = [], agingState = 'In Review', historyMonths = 13, deliveryStates = null) {
  const period = buildPeriod(month, Math.min(24, Math.max(1, historyMonths)));

  // Previous month period (for delta comparison)
  const [y, m] = month.split('-').map(Number);
  const prevDate      = new Date(y, m - 2, 1);
  const prevMonthStr  = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
  const prevPeriod    = buildPeriod(prevMonthStr, 1);

  const [azure, sn, prevAzure] = await Promise.all([
    fetchAzureReport(displayName, period, groupFields, agingState, deliveryStates),
    fetchSnReport(displayName, period),
    fetchAzureReport(displayName, prevPeriod, [], '', deliveryStates).catch(() => null),
  ]);

  return {
    metadata:     { project: displayName, period: period.label, generatedAt: new Date().toLocaleString('pt-BR'), generatedAtTs: Date.now() },
    hasSn:        !!sn,
    delivery:     { totalUS: azure.totalUS, totalDelivered: azure.totalDelivered, sprints: azure.sprints, byTypes: azure.byTypes, byTypesPts: azure.byTypesPts, usAging: azure.usAging },
    quality:      { bugsOpen: azure.bugsOpen, bugsNew: azure.bugsNew, bugsClosed: azure.bugsClosed },
    prevDelivery: prevAzure ? { totalUS: prevAzure.totalUS, totalDelivered: prevAzure.totalDelivered } : null,
    prevQuality:  prevAzure ? { bugsOpen: prevAzure.bugsOpen, bugsNew: prevAzure.bugsNew } : null,
    incidents:    sn?.incidents || null,
    prbs:         sn?.prbs      || null,
  };
}

// ── Incident backlog list (for modal) ──────────────────────────────────────────

async function fetchSnIncidentBacklog(displayName, month, { mode = 'backlog', filterField = '', filterValue = '' } = {}) {
  const snCfg = getSnConfig();
  const snGrp = getProjectSnGroup(displayName);
  if (!snCfg?.instance || !snCfg?.user || !snCfg?.pass || !snGrp?.assignmentGroup) return null;

  const grp       = snGrp.assignmentGroup.trim();
  const isSysId   = /^[0-9a-f]{32}$/i.test(grp);
  const grpFilter = isSysId ? `assignment_group=${grp}` : `assignment_group.name=${grp}`;

  const [y, m] = month.split('-').map(Number);
  const start    = new Date(y, m - 1, 1).toISOString().slice(0, 19) + 'Z';
  const endDate  = new Date(y, m, 0, 23, 59, 59);
  const end      = endDate.toISOString().slice(0, 19) + 'Z';
  const curMonth = new Date().toISOString().slice(0, 7);

  // Optional extra filter by system/location field
  const fieldFrag = filterField === 'cmdb_ci'         ? `^cmdb_ci.name=${filterValue}`
                  : filterField === 'resolution_code' ? `^u_additional_res_code=${filterValue}`
                  : filterField === 'location'        ? `^location.name=${filterValue}`
                  : '';

  let query;
  if (mode === 'opened') {
    query = `${grpFilter}^opened_at>=${start}^opened_at<=${end}${fieldFrag}`;
  } else if (mode === 'closed') {
    query = `${grpFilter}^resolved_at>=${start}^resolved_at<=${end}${fieldFrag}^NQ${grpFilter}^closed_at>=${start}^closed_at<=${end}^resolved_atISEMPTY^state!=8${fieldFrag}`;
  } else if (mode === 'cancelled') {
    query = `${grpFilter}^state=8^closed_at>=${start}^closed_at<=${end}${fieldFrag}`;
  } else {
    // backlog — active at end of month
    const openStates = `^state!=6^state!=7`;
    query = month === curMonth
      ? `${grpFilter}^active=true${openStates}${fieldFrag}`
      : `${grpFilter}^opened_at<=${end}^resolved_atISEMPTY${openStates}${fieldFrag}^NQ${grpFilter}^opened_at<=${end}^resolved_at>${end}${openStates}${fieldFrag}`;
  }

  try {
    const res = await snGet(snCfg,
      `table/incident?sysparm_query=${encodeURIComponent(query)}` +
      `&sysparm_fields=number,short_description,priority,state,opened_at,assigned_to,u_additional_res_code,cmdb_ci.name,location.name,sys_id` +
      `&sysparm_display_value=all&sysparm_limit=500`
    );
    return (res.result || []).map(i => ({
      number:         _snRaw(i.number) || _snVal(i.number) || '',
      description:    _snVal(i.short_description)         || '',
      priority:       _snRaw(i.priority)                  || '',
      state:          _snVal(i.state)                     || '',
      openedAt:       _snRaw(i.opened_at)                 || String(i.opened_at || ''),
      assignedTo:     _snVal(i['assigned_to'])            || '—',
      resolutionCode: _snVal(i['u_additional_res_code'])  || '—',
      affectedIC:     _snVal(i['cmdb_ci.name'])           || '—',
      impactedPlants: _snVal(i['location.name'])          || '—',
      url:            `https://${snCfg.instance}/incident.do?sys_id=${_snRaw(i.sys_id) || i.sys_id}`,
    }));
  } catch (e) {
    console.error('[SN incident backlog error]', e.message);
    return null;
  }
}

module.exports = { buildReport, buildPeriod, getLast6Months, cacheInvalidate, fetchSnIncidentBacklog };

const fs       = require('fs');
const nodePath = require('path');
const { getCfg, getProjectConfig, getSnConfig, getProjectSnGroup } = require('./config');
const { azureGet, azurePost } = require('./azureClient');
const { paginatedItems } = require('./utils/paginate');
const { snGet } = require('./servicenowClient');

const { CACHE_DIR } = require('./utils/paths');
const { calcMttrByPriority, calcReopenRate, calcIncidentAgingBuckets, calcPrbKpis, calcRequestLeadTime, calcRequestAgingBuckets } = require('./utils/itilMetrics');

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
  try { fs.unlinkSync(_cacheFile('sn', project, month, snExtra));         } catch (_) {}
  try { fs.unlinkSync(_cacheFile('sn', project, month, snExtra + '_v2')); } catch (_) {}
  try { fs.unlinkSync(_cacheFile('sn', project, month, snExtra + '_v3')); } catch (_) {}
  try { fs.unlinkSync(_cacheFile('sn', project, month, snExtra + '_v4')); } catch (_) {}
  try { fs.unlinkSync(_cacheFile('sn', project, month, snExtra + '_v5')); } catch (_) {}
  try { fs.unlinkSync(_cacheFile('sn', project, month, snExtra + '_v6')); } catch (_) {}
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

async function fetchAzureReport(displayName, period, groupFields = [], agingState = '', deliveryStates = null, usAgingColumns = null) {
  const pcfg = getProjectConfig(displayName);
  const proj  = pcfg?.name || displayName;

  const DONE_STATES      = (Array.isArray(deliveryStates) && deliveryStates.length) ? deliveryStates : _DEFAULT_DONE_STATES;
  const usAgingState     = agingState || '';
  const cleanGroupFields = (groupFields || []).filter(f => f);
  // Only extend cache key when delivery states differ from default (backward compat)
  const isDefaultDelivery = DONE_STATES.length === _DEFAULT_DONE_STATES.length && DONE_STATES.every(s => _DEFAULT_DONE_STATES.includes(s));
  const extraAgingKeys = (usAgingColumns || []).filter(c => c.key.startsWith('az:')).map(c => c.key.slice(3)).sort();
  const cacheKey = [
    ...cleanGroupFields.slice().sort(),
    usAgingState,
    ...(isDefaultDelivery ? [] : [DONE_STATES.slice().sort().join(',')]),
    ...(extraAgingKeys.length ? ['agCols:' + extraAgingKeys.join(',')] : []),
  ].join('|');
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
  const agingBaseFields = 'System.Id,System.Title,System.State,System.AssignedTo,Microsoft.VSTS.Common.StateChangeDate,System.IterationPath';
  const agingFields  = extraAgingKeys.length
    ? `${agingBaseFields},${extraAgingKeys.filter(f => !agingBaseFields.includes(f)).join(',')}`
    : agingBaseFields;

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
      const extra = {};
      extraAgingKeys.forEach(f => {
        const v = i.fields[f];
        extra[f] = (v && typeof v === 'object') ? (v.displayName || v.display_value || v.value || String(v)) : (v ?? '');
      });
      return { id: i.id, url: `${baseUrl}/_workitems/edit/${i.id}`, title: i.fields['System.Title'] || '', assignee, sprint, agingDays, extra };
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

// Campos de agrupamento clicáveis (drill-down) — espelha _INC_GROUPBY_FIELDS/_REQ_GROUPBY_FIELDS do frontend.
// Mantido como whitelist explícita porque filterField chega via query string do cliente.
const _INC_GROUPBY_WHITELIST = new Set([
  'cmdb_ci.name', 'u_additional_res_code', 'assignment_group', 'assigned_to', 'priority',
  'impact', 'urgency', 'state', 'category', 'subcategory', 'location.name', 'close_code', 'contact_type',
]);
const _REQ_GROUPBY_WHITELIST = new Set([
  'request_item.cat_item.name', 'priority', 'assignment_group', 'assigned_to', 'state',
  'request_item.request.requested_for.name',
]);
const _PRB_GROUPBY_WHITELIST = new Set([
  'category', 'state', 'priority', 'assignment_group', 'assigned_to', 'known_error', 'rca_complete',
]);

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

async function fetchSnReport(displayName, period, prbAgingColumns = null, ciFilter = '') {
  const snCfg  = getSnConfig();
  if (!snCfg?.instance || !snCfg?.user || !snCfg?.pass) return null;

  const snGrp  = getProjectSnGroup(displayName);
  let grp, isSysId;
  if (snGrp?.assignmentGroup) {
    // Normal path: project has a linked SN assignment group config
    grp     = snGrp.assignmentGroup.trim();
    isSysId = /^[0-9a-f]{32}$/i.test(grp);
  } else {
    // SN-only mode: displayName IS the group display name from the SN dashboard card
    const allowed = snCfg.assignmentGroups;
    if (Array.isArray(allowed) && allowed.length > 0 && !allowed.includes(displayName)) return null;
    grp     = displayName;
    isSysId = false;
  }

  const extraPrbKeys = (prbAgingColumns || []).filter(c => c.key.startsWith('sn:')).map(c => c.key.slice(3)).sort();
  const snCacheKey = String(period.history.length) + '_v6' + (extraPrbKeys.length ? '_prb:' + extraPrbKeys.join(',') : '') + (ciFilter ? '_ci:' + ciFilter : '');
  const cached = _readCache('sn', displayName, period.month, snCacheKey);
  if (cached) return cached;

  // ServiceNow assignment_group field accepts sys_id (32-char hex) directly.
  // If user provided a display name, use dot-notation: assignment_group.name=
  const grpFilter = isSysId ? `assignment_group=${grp}` : `assignment_group.name=${grp}`;
  // Filtro opcional por Configuration Item — mesmo campo (cmdb_ci.name) nas três entidades,
  // validado contra a instância real (incident/problem/sc_task todos populam cmdb_ci diretamente).
  const ciFrag = ciFilter ? `^cmdb_ci.name=${ciFilter}` : '';
  const taskCiFrag = ciFilter ? `^task.cmdb_ci.name=${ciFilter}` : '';

  const [sy, sm, sd] = period.start.split('-').map(Number);
  const [ey, em, ed] = period.end.split('-').map(Number);
  const start = new Date(sy, sm - 1, sd, 0, 0, 0).toISOString().slice(0, 19) + 'Z';
  const end   = new Date(ey, em - 1, ed, 23, 59, 59).toISOString().slice(0, 19) + 'Z';

  const incQuery              = `${grpFilter}^opened_at>=${start}^opened_at<=${end}${ciFrag}`;
  const incClosedQuery        = `${grpFilter}^resolved_at>=${start}^resolved_at<=${end}${ciFrag}`;
  // Mês atual → backlog ativo agora (active=true exclui cancelados e encerrados).
  // Mês passado → ponto-no-tempo (3 partes via ^NQ):
  //   1. Abertos ainda hoje e não cancelados (resolved_atISEMPTY^state!=8)
  //   2. Cancelados DEPOIS do fim do mês — estavam no backlog (state=8^closed_at>end)
  //   3. Resolvidos DEPOIS do fim do mês — estavam no backlog (resolved_at>end)
  // A regressão do gráfico depende deste valor como âncora correta.
  const curMonth        = new Date().toISOString().slice(0, 7);
  const incBacklogQuery = period.month === curMonth
    ? `${grpFilter}^active=true^state!=6^state!=7${ciFrag}`
    : `${grpFilter}^opened_at<=${end}^resolved_atISEMPTY^state!=8${ciFrag}^NQ${grpFilter}^opened_at<=${end}^state=8^closed_at>${end}${ciFrag}^NQ${grpFilter}^opened_at<=${end}^resolved_at>${end}${ciFrag}`;
  const prbQuery              = `${grpFilter}^state!=106^state!=107${ciFrag}`;
  const prbResolvedQuery      = `${grpFilter}^resolved_at>=${start}^resolved_at<=${end}${ciFrag}`;
  const prbOpenedThisMonthQuery = `${grpFilter}^opened_at>=${start}^opened_at<=${end}${ciFrag}`;
  // reopened_time: incidentes reabertos no período (campo nativo do SN)
  const incReopenedQuery      = `${grpFilter}^reopened_time>=${start}^reopened_time<=${end}${ciFrag}`;
  // task_sla: usa business_elapsed_percentage nativo do ServiceNow (calendário útil)
  // Filtra por task.opened_at (mesma âncora usada nos demais gráficos) para garantir
  // que apenas incidentes abertos no período entrem no cálculo.
  const taskSlaGrpFilter = isSysId ? `task.assignment_group=${grp}` : `task.assignment_group.name=${grp}`;
  const taskSlaQuery     = `${taskSlaGrpFilter}^task.opened_at>=${start}^task.opened_at<=${end}${taskCiFrag}`;
  // Requests: assignment_group NÃO é populado em sc_req_item nesta instância — o roteamento
  // por equipe acontece na catalog task (sc_task), com request_item.* via dot-walk até o RITM/pedido pai
  // (validado com consulta exploratória real — ver decisões #173-176 em docs/decisions.md).
  // cmdb_ci já vem direto em sc_task (não precisa de dot-walk via request_item — validado).
  // Sem estado "cancelado" separado — closed_at cobre qualquer encerramento (completo/incompleto/cancelado).
  const reqQuery        = `${grpFilter}^opened_at>=${start}^opened_at<=${end}${ciFrag}`;
  const reqClosedQuery  = `${grpFilter}^closed_at>=${start}^closed_at<=${end}${ciFrag}`;
  const reqBacklogQuery = period.month === curMonth
    ? `${grpFilter}^active=true${ciFrag}`
    : `${grpFilter}^opened_at<=${end}^closed_atISEMPTY${ciFrag}^NQ${grpFilter}^opened_at<=${end}^closed_at>${end}${ciFrag}`;

  console.log(`[SN] project="${displayName}" group="${grp}" isSysId=${isSysId}`);
  console.log(`[SN] incQuery: ${incQuery}`);

  const [incRes, incClosedRes, incBacklogRes, prbRes, prbResolvedRes, prbOpenedThisMonthRes, taskSlaRes, incReopenedRes, reqRes, reqClosedRes, reqBacklogRes] = await Promise.all([
    snGet(snCfg, `table/incident?sysparm_query=${encodeURIComponent(incQuery)}&sysparm_fields=sys_id,priority,impact,urgency,cmdb_ci.name,u_additional_res_code,location.name,state,assigned_to,assignment_group,category,subcategory,close_code,contact_type&sysparm_display_value=all&sysparm_limit=1000`).catch(e => { console.error('[SN incidents error]', e.message); return { result: [] }; }),
    snGet(snCfg, `table/incident?sysparm_query=${encodeURIComponent(incClosedQuery)}&sysparm_fields=sys_id,opened_at,resolved_at,closed_at,priority&sysparm_limit=1000`).catch(() => ({ result: [] })),
    snGet(snCfg, `table/incident?sysparm_query=${encodeURIComponent(incBacklogQuery)}&sysparm_fields=sys_id,opened_at&sysparm_limit=1000`).catch(() => ({ result: [] })),
    snGet(snCfg, `table/problem?sysparm_query=${encodeURIComponent(prbQuery)}&sysparm_fields=sys_id,number,short_description,priority,impact,urgency,category,state,assignment_group.name,assigned_to.name,opened_at,known_error,workaround_instructions,rca_complete,cmdb_ci.name${extraPrbKeys.length ? ',' + extraPrbKeys.join(',') : ''}&sysparm_display_value=all&sysparm_limit=200`).catch(e => { console.error('[SN problems error]', e.message); return { result: [] }; }),
    snGet(snCfg, `table/problem?sysparm_query=${encodeURIComponent(prbResolvedQuery)}&sysparm_fields=sys_id,opened_at,resolved_at&sysparm_limit=200`).catch(() => ({ result: [] })),
    snGet(snCfg, `table/problem?sysparm_query=${encodeURIComponent(prbOpenedThisMonthQuery)}&sysparm_fields=sys_id&sysparm_limit=200`).catch(() => ({ result: [] })),
    snGet(snCfg, `table/task_sla?sysparm_query=${encodeURIComponent(taskSlaQuery)}&sysparm_fields=task,task.priority,business_elapsed_percentage&sysparm_limit=2000`).catch(() => ({ result: [] })),
    snGet(snCfg, `table/incident?sysparm_query=${encodeURIComponent(incReopenedQuery)}&sysparm_fields=sys_id&sysparm_limit=1000`).catch(() => ({ result: [] })),
    snGet(snCfg, `table/sc_task?sysparm_query=${encodeURIComponent(reqQuery)}&sysparm_fields=sys_id,priority,state,assignment_group,request_item.cat_item.name,opened_at,closed_at,assigned_to,request_item.number,request_item.request.requested_for.name,cmdb_ci.name&sysparm_display_value=all&sysparm_limit=1000`).catch(e => { console.error('[SN requests error]', e.message); return { result: [] }; }),
    snGet(snCfg, `table/sc_task?sysparm_query=${encodeURIComponent(reqClosedQuery)}&sysparm_fields=sys_id,opened_at,closed_at,priority&sysparm_limit=1000`).catch(() => ({ result: [] })),
    snGet(snCfg, `table/sc_task?sysparm_query=${encodeURIComponent(reqBacklogQuery)}&sysparm_fields=sys_id,number,request_item.cat_item.name,priority,assigned_to.name,opened_at&sysparm_display_value=all&sysparm_limit=1000`).catch(() => ({ result: [] })),
  ]);

  const incidents              = incRes.result || [];
  const incClosedRaw           = incClosedRes.result || [];
  const incClosedInPeriod      = [...new Map(incClosedRaw.map(i => [i.sys_id, i])).values()];
  const incBacklogItems        = incBacklogRes.result || [];
  const incBacklog             = incBacklogItems.length;
  const incReopenedCount       = (incReopenedRes.result || []).length;
  const prbs                   = prbRes.result || [];
  const prbsResolvedInPeriod   = prbResolvedRes.result || [];
  const prbsOpenedInPeriod     = prbOpenedThisMonthRes.result || [];
  const requests                = reqRes.result || [];
  const reqClosedRaw            = reqClosedRes.result || [];
  const reqClosedInPeriod       = [...new Map(reqClosedRaw.map(i => [i.sys_id, i])).values()];
  const reqBacklogItems         = reqBacklogRes.result || [];
  const reqBacklog              = reqBacklogItems.length;
  console.log(`[SN] incidents returned: ${incidents.length}, problems: ${prbs.length}, requests: ${requests.length}`);

  let incAvgResolutionDays = 0;
  if (incClosedInPeriod.length > 0) {
    let validCount = 0;
    const total = incClosedInPeriod.reduce((s, i) => {
      const closedAt = i.resolved_at;
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

  // ITIL metrics — calculated from already-fetched data, no extra API calls
  const mttrByPriority  = calcMttrByPriority(incClosedInPeriod);
  const reopenRate      = calcReopenRate(incReopenedCount, incClosedInPeriod.length);
  const incAgingBuckets = calcIncidentAgingBuckets(incBacklogItems);
  const reqLeadTime     = calcRequestLeadTime(reqClosedInPeriod);

  // Histórico mensal — processado em lotes de 4 meses em paralelo (16 req/lote).
  // Reduz de 13 round-trips sequenciais para ~4, sem sobrecarregar o SN.
  const HISTORY_BATCH = 4;
  const monthly      = [];
  const prbMonthly   = [];
  const reqMonthly    = [];
  const sysMonthData = {}; // { ciName: [count per history index] }
  const altMonthData  = {}; // { resCode: [count per history index] }
  const altRawValues  = {}; // { displayValue: rawValue } — mapeamento para filtro SN
  const locMonthData  = {}; // { locationName: [count per history index] }
  const catMonthData  = {}; // { catalogItemName: [count per history index] }

  const allHistoryResults = [];
  for (let bStart = 0; bStart < period.history.length; bStart += HISTORY_BATCH) {
    const batch = await Promise.all(
      period.history.slice(bStart, bStart + HISTORY_BATCH).map(async m => {
        const [hy, hm] = m.split('-').map(Number);
        const hs = new Date(hy, hm - 1, 1).toISOString().slice(0, 19) + 'Z';
        const he = new Date(hy, hm, 0, 23, 59, 59).toISOString().slice(0, 19) + 'Z';
        const incOpenedQ    = `${grpFilter}^opened_at>=${hs}^opened_at<=${he}${ciFrag}`;
        const incClosedQ    = `${grpFilter}^resolved_at>=${hs}^resolved_at<=${he}${ciFrag}`;
        const incCancelledQ = `${grpFilter}^state=8^closed_at>=${hs}^closed_at<=${he}${ciFrag}`;
        const prbOpenedQ    = `${grpFilter}^opened_at>=${hs}^opened_at<=${he}${ciFrag}`;
        const prbResolvedQ  = `${grpFilter}^resolved_at>=${hs}^resolved_at<=${he}${ciFrag}`;
        const reqOpenedQ    = `${grpFilter}^opened_at>=${hs}^opened_at<=${he}${ciFrag}`;
        const reqClosedQ    = `${grpFilter}^closed_at>=${hs}^closed_at<=${he}${ciFrag}`;
        const [rIncO, rIncC, rIncCanc, rPrbO, rPrbR, rReqO, rReqC] = await Promise.all([
          snGet(snCfg, `table/incident?sysparm_query=${encodeURIComponent(incOpenedQ)}&sysparm_fields=sys_id,cmdb_ci.name,u_additional_res_code,location.name,priority&sysparm_display_value=all&sysparm_limit=1000`).catch(() => ({ result: [] })),
          snGet(snCfg, `table/incident?sysparm_query=${encodeURIComponent(incClosedQ)}&sysparm_fields=sys_id&sysparm_limit=1000`).catch(() => ({ result: [] })),
          snGet(snCfg, `table/incident?sysparm_query=${encodeURIComponent(incCancelledQ)}&sysparm_fields=sys_id&sysparm_limit=1000`).catch(() => ({ result: [] })),
          snGet(snCfg, `table/problem?sysparm_query=${encodeURIComponent(prbOpenedQ)}&sysparm_fields=sys_id&sysparm_limit=200`).catch(() => ({ result: [] })),
          snGet(snCfg, `table/problem?sysparm_query=${encodeURIComponent(prbResolvedQ)}&sysparm_fields=sys_id&sysparm_limit=200`).catch(() => ({ result: [] })),
          snGet(snCfg, `table/sc_task?sysparm_query=${encodeURIComponent(reqOpenedQ)}&sysparm_fields=sys_id,request_item.cat_item.name,priority&sysparm_display_value=all&sysparm_limit=1000`).catch(() => ({ result: [] })),
          snGet(snCfg, `table/sc_task?sysparm_query=${encodeURIComponent(reqClosedQ)}&sysparm_fields=sys_id,opened_at,closed_at&sysparm_limit=1000`).catch(() => ({ result: [] })),
        ]);
        return { m, rIncO, rIncC, rIncCanc, rPrbO, rPrbR, rReqO, rReqC };
      })
    );
    allHistoryResults.push(...batch);
  }

  allHistoryResults.forEach(({ m, rIncO, rIncC, rIncCanc, rPrbO, rPrbR, rReqO, rReqC }, mIdx) => {
    const incOpened    = rIncO.result || [];
    const incClosed    = (rIncC.result || []).length;
    const incCancelled = (rIncCanc.result || []).length;
    let mP1 = 0, mP2 = 0, mP3 = 0;
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
      const prio = _snRaw(i.priority) || '';
      if (prio === '1') mP1++;
      else if (prio === '2') mP2++;
      else if (prio === '3') mP3++;
    });
    monthly.push({
      label:     m,
      opened:    incOpened.length,
      closed:    incClosed,
      cancelled: incCancelled,
      p1:        mP1,
      p2:        mP2,
      p3:        mP3,
    });
    prbMonthly.push({
      label:    m,
      opened:   (rPrbO.result || []).length,
      resolved: (rPrbR.result || []).length,
    });

    const reqOpened = rReqO.result || [];
    reqOpened.forEach(i => {
      const cat = _snVal(i['request_item.cat_item.name']) || 'Outros';
      if (!catMonthData[cat]) catMonthData[cat] = new Array(period.history.length).fill(0);
      catMonthData[cat][mIdx]++;
    });
    const reqClosedMonth = rReqC.result || [];
    reqMonthly.push({
      label:          m,
      opened:         reqOpened.length,
      closed:         reqClosedMonth.length,
      avgLeadTimeDays: calcRequestLeadTime(reqClosedMonth).avgDays,
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

  // Backlog histórico de Requests — calculado de trás para frente a partir do backlog atual
  reqMonthly[reqMonthly.length - 1].openBacklog = reqBacklog;
  for (let i = reqMonthly.length - 2; i >= 0; i--) {
    const next = reqMonthly[i + 1];
    reqMonthly[i].openBacklog = Math.max(0, next.openBacklog - next.opened + next.closed);
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

  // Generic flat groupby — reuses o array `incidents` já carregado.
  // rawValue preserva o valor interno (sys_id de referência ou código) para permitir
  // drill-down por clique — a query de filtro precisa do valor bruto, não do display_value.
  const _snGroupby = (field, val = v => _snVal(v) || 'N/A', raw = v => _snRaw(v)) => {
    const m = {};
    incidents.forEach(i => {
      const k = val(i[field]);
      if (!m[k]) m[k] = { name: k, total: 0, rawValue: raw(i[field]) ?? k };
      m[k].total++;
    });
    return Object.values(m).sort((a, b) => b.total - a.total);
  };
  const byState           = _snGroupby('state');
  const byAssignedTo      = _snGroupby('assigned_to');
  const byAssignmentGroup = _snGroupby('assignment_group');
  const byCategory        = _snGroupby('category');
  const bySubcategory     = _snGroupby('subcategory');
  const byImpact          = _snGroupby('impact');
  const byUrgency         = _snGroupby('urgency');
  const byCloseCode       = _snGroupby('close_code');
  const byContactType     = _snGroupby('contact_type');

  // Requests (RITM) — breakdown por item de catálogo (top-N + Outros aplicado no frontend)
  const catMap = {};
  requests.forEach(i => {
    const name = _snVal(i['request_item.cat_item.name']) || 'Outros';
    if (!catMap[name]) catMap[name] = { name, total: 0 };
    catMap[name].total++;
  });
  const byCatalogItem = Object.values(catMap).sort((a, b) => b.total - a.total);
  const byCatalogItemMonthly = Object.entries(catMonthData)
    .map(([name, counts]) => ({ name, monthly: counts, total: counts.reduce((s, c) => s + c, 0) }))
    .sort((a, b) => b.total - a.total);

  // Generic flat groupby para Requests — reusa o array `requests` já carregado.
  // rawValue preserva o valor interno para permitir drill-down por clique (mesma lógica de _snGroupby).
  const _reqGroupby = (field, val = v => _snVal(v) || 'N/A', raw = v => _snRaw(v)) => {
    const m = {};
    requests.forEach(i => {
      const k = val(i[field]);
      if (!m[k]) m[k] = { name: k, total: 0, rawValue: raw(i[field]) ?? k };
      m[k].total++;
    });
    return Object.values(m).sort((a, b) => b.total - a.total);
  };
  const reqByPriority = { p1: 0, p2: 0, p3: 0, p4: 0 };
  requests.forEach(i => {
    const p = _snRaw(i.priority);
    if (p === '1') reqByPriority.p1++;
    else if (p === '2') reqByPriority.p2++;
    else if (p === '3') reqByPriority.p3++;
    else if (p === '4') reqByPriority.p4++;
  });
  const reqByState           = _reqGroupby('state');
  const reqByAssignmentGroup = _reqGroupby('assignment_group');
  const reqByAssignedTo      = _reqGroupby('assigned_to');
  const reqByRequestedFor    = _reqGroupby('request_item.request.requested_for.name');
  const reqByCI              = _reqGroupby('cmdb_ci.name');

  const now = Date.now();
  const prbList = prbs.map(p => {
    // opened_at pode ser {value, display_value} com sysparm_display_value=all
    const openedAtRaw = _snRaw(p.opened_at) || (typeof p.opened_at === 'string' ? p.opened_at : null);
    const agingDays   = openedAtRaw ? Math.floor((now - new Date(openedAtRaw).getTime()) / 86400000) : 0;
    const extra = {};
    extraPrbKeys.forEach(f => {
      const v = p[f];
      extra[f] = v != null ? (_snVal(v) ?? '') : '';
    });
    return {
      id:                      _snRaw(p.number) || String(p.number || ''),
      title:                   _snVal(p.short_description) || String(p.short_description || ''),
      priority:                _snRaw(p.priority) || '',
      impact:                  _snVal(p.impact)   || '',
      urgency:                 _snVal(p.urgency)  || '',
      category:                _snVal(p.category) || '',
      cmdb_ci:                 _snVal(p['cmdb_ci.name']) || '',
      agingDays,
      state:                   _snRaw(p.state)    || '',
      assignment_group:        _snVal(p['assignment_group.name']) || '',
      assigned_to:             _snVal(p['assigned_to.name'])      || '',
      known_error:             _snRaw(p.known_error) === 'true' || p.known_error === true,
      workaround_instructions: _snVal(p.workaround_instructions) || '',
      rca_complete:            _snRaw(p.rca_complete) === 'true' || p.rca_complete === true,
      url:                     `https://${snCfg.instance}/problem.do?sys_id=${_snRaw(p.sys_id) || p.sys_id}`,
      extra,
    };
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

  const prbKpis = calcPrbKpis(prbList);

  // Lista de requests em backlog (aging list) — mirror de prbList, ordenada por mais antiga
  const reqList = reqBacklogItems.map(i => {
    const openedAtRaw = _snRaw(i.opened_at) || (typeof i.opened_at === 'string' ? i.opened_at : null);
    const agingDays   = openedAtRaw ? Math.floor((now - new Date(openedAtRaw).getTime()) / 86400000) : 0;
    return {
      id:          _snRaw(i.number) || String(i.number || ''),
      title:       _snVal(i['request_item.cat_item.name']) || '',
      priority:    _snRaw(i.priority) || '',
      assigned_to: _snVal(i['assigned_to.name']) || '',
      agingDays,
    };
  }).sort((a, b) => b.agingDays - a.agingDays);
  const reqAgingBuckets = calcRequestAgingBuckets(reqList);

  const data = {
    incidents: {
      total:             incidents.length,
      closedThisMonth:   incClosedInPeriod.length,
      openBacklog:       incBacklog,
      avgResolutionDays: incAvgResolutionDays,
      byPriority,
      slaEnabled:    snGrp?.slaEnabled === true,
      slaByPriority,
      bySystem,
      bySystemMonthly,
      byGroupAlt,
      byGroupAltMonthly,
      byLocationMonthly,
      byState,
      byAssignedTo,
      byAssignmentGroup,
      byCategory,
      bySubcategory,
      byImpact,
      byUrgency,
      byCloseCode,
      byContactType,
      monthly,
      // ITIL
      mttrByPriority,
      reopenedCount:  incReopenedCount,
      reopenRate,
      agingBuckets:   incAgingBuckets,
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
      // ITIL
      knownErrorCount:    prbKpis.knownErrorCount,
      knownErrorPct:      prbKpis.knownErrorPct,
      withWorkaroundCount: prbKpis.withWorkaroundCount,
      withWorkaroundPct:  prbKpis.withWorkaroundPct,
      withRcaCount:       prbKpis.withRcaCount,
      withRcaPct:         prbKpis.withRcaPct,
      agingBuckets:       prbKpis.agingBuckets,
    },
    requests: {
      total:             requests.length,
      closedThisMonth:   reqClosedInPeriod.length,
      openBacklog:       reqBacklog,
      avgLeadTimeDays:   reqLeadTime.avgDays,
      byPriority:        reqByPriority,
      byCatalogItem,
      byCatalogItemMonthly,
      byState:           reqByState,
      byAssignmentGroup: reqByAssignmentGroup,
      byAssignedTo:      reqByAssignedTo,
      byRequestedFor:    reqByRequestedFor,
      byCI:              reqByCI,
      monthly:           reqMonthly,
      list:              reqList.slice(0, 50),
      agingBuckets:      reqAgingBuckets,
    },
  };

  _writeCache('sn', displayName, period.month, data, snCacheKey);
  return data;
}

// ── Main entry ─────────────────────────────────────────────────────────────────

async function buildReport(displayName, month, groupFields = [], agingState = 'In Review', historyMonths = 13, deliveryStates = null, usAgingColumns = null, prbAgingColumns = null, ciFilter = '') {
  const period = buildPeriod(month, Math.min(24, Math.max(1, historyMonths)));

  // Previous month period (for delta comparison)
  const [y, m] = month.split('-').map(Number);
  const prevDate      = new Date(y, m - 2, 1);
  const prevMonthStr  = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
  const prevPeriod    = buildPeriod(prevMonthStr, 1);

  const _EMPTY_AZURE = { totalUS: 0, totalDelivered: 0, sprints: [], byTypes: {}, byTypesPts: {}, usAging: {}, bugsOpen: 0, bugsNew: 0, bugsClosed: 0 };

  const [azure, sn, prevAzure] = await Promise.all([
    fetchAzureReport(displayName, period, groupFields, agingState, deliveryStates, usAgingColumns).catch(() => _EMPTY_AZURE),
    fetchSnReport(displayName, period, prbAgingColumns, ciFilter),
    fetchAzureReport(displayName, prevPeriod, [], '', deliveryStates).catch(() => null),
  ]);

  return {
    metadata:        { project: displayName, period: period.label, generatedAt: new Date().toLocaleString('pt-BR'), generatedAtTs: Date.now() },
    hasSn:           !!sn,
    hasAzure:        !!(azure.sprints?.length || azure.totalUS > 0),
    delivery:        { totalUS: azure.totalUS, totalDelivered: azure.totalDelivered, sprints: azure.sprints, byTypes: azure.byTypes, byTypesPts: azure.byTypesPts, usAging: azure.usAging },
    quality:         { bugsOpen: azure.bugsOpen, bugsNew: azure.bugsNew, bugsClosed: azure.bugsClosed },
    prevDelivery:    prevAzure ? { totalUS: prevAzure.totalUS, totalDelivered: prevAzure.totalDelivered } : null,
    prevQuality:     prevAzure ? { bugsOpen: prevAzure.bugsOpen, bugsNew: prevAzure.bugsNew } : null,
    incidents:       sn?.incidents || null,
    prbs:            sn?.prbs      || null,
    requests:        sn?.requests  || null,
    usAgingColumns,
    prbAgingColumns,
  };
}

// ── Incident backlog list (for modal) ──────────────────────────────────────────

async function fetchSnIncidentBacklog(displayName, month, { mode = 'backlog', filterField = '', filterValue = '', ciFilter = '', group = '' } = {}) {
  const snCfg = getSnConfig();
  if (!snCfg?.instance || !snCfg?.user || !snCfg?.pass) return null;

  let grpFilter;
  if (group) {
    grpFilter = `assignment_group.name=${group}`;
  } else {
    const snGrp = getProjectSnGroup(displayName);
    if (snGrp?.assignmentGroup) {
      const grp     = snGrp.assignmentGroup.trim();
      const isSysId = /^[0-9a-f]{32}$/i.test(grp);
      grpFilter     = isSysId ? `assignment_group=${grp}` : `assignment_group.name=${grp}`;
    } else {
      // SN-only mode: displayName é o nome do grupo SN diretamente
      const allowed = snCfg.assignmentGroups;
      if (Array.isArray(allowed) && allowed.length > 0 && !allowed.includes(displayName)) return null;
      if (!displayName) return null;
      grpFilter = `assignment_group.name=${displayName}`;
    }
  }

  const [y, m] = month.split('-').map(Number);
  const start    = new Date(y, m - 1, 1).toISOString().slice(0, 19) + 'Z';
  const endDate  = new Date(y, m, 0, 23, 59, 59);
  const end      = endDate.toISOString().slice(0, 19) + 'Z';
  const curMonth = new Date().toISOString().slice(0, 7);

  // Optional extra filter — aliases curtos (usados pelos gráficos de volume/heatmap/bars)
  // + whitelist de campos de agrupamento (usados pelo clique nas barras/donut do gráfico "Agrupamento por campo")
  const fieldFrag = filterField === 'cmdb_ci'         ? `^cmdb_ci.name=${filterValue}`
                  : filterField === 'resolution_code' ? `^u_additional_res_code=${filterValue}`
                  : filterField === 'location'        ? `^location.name=${filterValue}`
                  : _INC_GROUPBY_WHITELIST.has(filterField) ? `^${filterField}=${filterValue}`
                  : '';
  const ciFrag = ciFilter ? `^cmdb_ci.name=${ciFilter}` : '';

  let query;
  if (mode === 'opened') {
    query = `${grpFilter}^opened_at>=${start}^opened_at<=${end}${fieldFrag}${ciFrag}`;
  } else if (mode === 'closed') {
    query = `${grpFilter}^resolved_at>=${start}^resolved_at<=${end}${fieldFrag}${ciFrag}`;
  } else if (mode === 'cancelled') {
    query = `${grpFilter}^state=8^closed_at>=${start}^closed_at<=${end}${fieldFrag}${ciFrag}`;
  } else {
    // backlog — active at end of month
    const openStates = `^state!=6^state!=7`;
    query = month === curMonth
      ? `${grpFilter}^active=true${openStates}${fieldFrag}${ciFrag}`
      : `${grpFilter}^opened_at<=${end}^resolved_atISEMPTY${openStates}${fieldFrag}${ciFrag}^NQ${grpFilter}^opened_at<=${end}^resolved_at>${end}${openStates}${fieldFrag}${ciFrag}`;
  }

  try {
    const res = await snGet(snCfg,
      `table/incident?sysparm_query=${encodeURIComponent(query)}` +
      `&sysparm_fields=number,short_description,priority,state,opened_at,assigned_to,close_code,u_resolution,u_causal_code,u_additional_res_code,work_notes,cmdb_ci.name,location.name,sys_id` +
      `&sysparm_display_value=all&sysparm_limit=500`
    );
    return (res.result || []).map(i => ({
      number:           _snRaw(i.number) || _snVal(i.number) || '',
      description:      _snVal(i.short_description)           || '',
      priority:         _snRaw(i.priority)                    || '',
      state:            _snVal(i.state)                       || '',
      openedAt:         _snRaw(i.opened_at)                   || String(i.opened_at || ''),
      assignedTo:       _snVal(i['assigned_to'])              || '—',
      resolutionCode:   _snVal(i['close_code'])               || '',
      resolution:       _snVal(i['u_resolution'])              || '',
      causalCode:       _snVal(i['u_causal_code'])            || '',
      additionalResCode:  _snVal(i['u_additional_res_code'])   || '',
      resolutionNotes:    _snVal(i['work_notes'])             || '',
      affectedIC:       _snVal(i['cmdb_ci.name'])             || '—',
      impactedPlants:   _snVal(i['location.name'])            || '—',
      url:              `https://${snCfg.instance}/incident.do?sys_id=${_snRaw(i.sys_id) || i.sys_id}`,
    }));
  } catch (e) {
    console.error('[SN incident backlog error]', e.message);
    return null;
  }
}

// ── Request backlog list (for modal) ───────────────────────────────────────────

// Constrói fragmento de query para filtrar por faixa de dias em aberto (aging), relativo a agora.
// dayMin/dayMax vêm dos limites do bucket clicado no gráfico de aging — não são campos nativos do SN,
// então convertemos para uma janela absoluta de `opened_at`.
function _agingRangeFrag(dayMin, dayMax) {
  if (dayMin == null && dayMax == null) return '';
  const now = Date.now();
  const parts = [];
  if (dayMin != null) parts.push(`opened_at<=${new Date(now - dayMin * 86400000).toISOString().slice(0, 19)}Z`);
  if (dayMax != null && Number.isFinite(dayMax)) parts.push(`opened_at>=${new Date(now - dayMax * 86400000).toISOString().slice(0, 19)}Z`);
  return parts.length ? '^' + parts.join('^') : '';
}

async function fetchSnRequestBacklog(displayName, month, { mode = 'backlog', filterField = '', filterValue = '', ciFilter = '', dayMin, dayMax, group = '' } = {}) {
  const snCfg = getSnConfig();
  if (!snCfg?.instance || !snCfg?.user || !snCfg?.pass) return null;

  let grpFilter;
  if (group) {
    grpFilter = `assignment_group.name=${group}`;
  } else {
    const snGrp = getProjectSnGroup(displayName);
    if (snGrp?.assignmentGroup) {
      const grp     = snGrp.assignmentGroup.trim();
      const isSysId = /^[0-9a-f]{32}$/i.test(grp);
      grpFilter     = isSysId ? `assignment_group=${grp}` : `assignment_group.name=${grp}`;
    } else {
      // SN-only mode: displayName é o nome do grupo SN diretamente
      const allowed = snCfg.assignmentGroups;
      if (Array.isArray(allowed) && allowed.length > 0 && !allowed.includes(displayName)) return null;
      if (!displayName) return null;
      grpFilter = `assignment_group.name=${displayName}`;
    }
  }

  const [y, m] = month.split('-').map(Number);
  const start    = new Date(y, m - 1, 1).toISOString().slice(0, 19) + 'Z';
  const endDate  = new Date(y, m, 0, 23, 59, 59);
  const end      = endDate.toISOString().slice(0, 19) + 'Z';
  const curMonth = new Date().toISOString().slice(0, 7);

  // Optional extra filter — alias curto para item de catálogo (usado pelo gráfico de backlog por catálogo)
  // + whitelist de campos de agrupamento (usados pelo clique nas barras/donut do gráfico "Agrupamento por campo")
  const fieldFrag = filterField === 'cat_item' ? `^request_item.cat_item.name=${filterValue}`
                  : _REQ_GROUPBY_WHITELIST.has(filterField) ? `^${filterField}=${filterValue}`
                  : '';
  const ciFrag = ciFilter ? `^cmdb_ci.name=${ciFilter}` : '';

  const dayFrag = _agingRangeFrag(dayMin, dayMax);

  let query;
  if (mode === 'opened') {
    query = `${grpFilter}^opened_at>=${start}^opened_at<=${end}${fieldFrag}${ciFrag}`;
  } else if (mode === 'closed') {
    query = `${grpFilter}^closed_at>=${start}^closed_at<=${end}${fieldFrag}${ciFrag}`;
  } else {
    // backlog — aberto ao fim do mês (mesma lógica ponto-no-tempo dos incidentes, sem estado "cancelado" separado)
    query = month === curMonth
      ? `${grpFilter}^active=true${fieldFrag}${ciFrag}${dayFrag}`
      : `${grpFilter}^opened_at<=${end}^closed_atISEMPTY${fieldFrag}${ciFrag}^NQ${grpFilter}^opened_at<=${end}^closed_at>${end}${fieldFrag}${ciFrag}${dayFrag}`;
  }

  try {
    const res = await snGet(snCfg,
      `table/sc_task?sysparm_query=${encodeURIComponent(query)}` +
      `&sysparm_fields=number,short_description,priority,state,opened_at,closed_at,assigned_to,assignment_group,request_item.cat_item.name,request_item.number,request_item.request.requested_for.name,sys_id` +
      `&sysparm_display_value=all&sysparm_limit=500`
    );
    return (res.result || []).map(i => ({
      number:          _snRaw(i.number) || _snVal(i.number) || '',
      description:     _snVal(i.short_description) || '',
      priority:        _snRaw(i.priority)           || '',
      state:           _snVal(i.state)              || '',
      openedAt:        _snRaw(i.opened_at)          || String(i.opened_at || ''),
      closedAt:        _snRaw(i.closed_at)          || '',
      assignedTo:      _snVal(i.assigned_to)        || '—',
      assignmentGroup: _snVal(i.assignment_group)   || '—',
      catalogItem:     _snVal(i['request_item.cat_item.name'])  || '—',
      requestNumber:   _snVal(i['request_item.number'])         || '—',
      requestedFor:    _snVal(i['request_item.request.requested_for.name']) || '—',
      url:             `https://${snCfg.instance}/nav_to.do?uri=sc_task.do?sys_id=${_snRaw(i.sys_id) || i.sys_id}`,
    }));
  } catch (e) {
    console.error('[SN request backlog error]', e.message);
    return null;
  }
}

// ── PRB backlog list (for modal) ───────────────────────────────────────────────
// PRBs não são recortados por mês (a seção sempre mostra o backlog aberto atual —
// mesma regra de `prbQuery` em fetchSnReport: state!=106^state!=107).

async function fetchSnPrbBacklog(displayName, { filterField = '', filterValue = '', ciFilter = '', dayMin, dayMax, group = '' } = {}) {
  const snCfg = getSnConfig();
  if (!snCfg?.instance || !snCfg?.user || !snCfg?.pass) return null;

  let grpFilter;
  if (group) {
    grpFilter = `assignment_group.name=${group}`;
  } else {
    const snGrp = getProjectSnGroup(displayName);
    if (snGrp?.assignmentGroup) {
      const grp     = snGrp.assignmentGroup.trim();
      const isSysId = /^[0-9a-f]{32}$/i.test(grp);
      grpFilter     = isSysId ? `assignment_group=${grp}` : `assignment_group.name=${grp}`;
    } else {
      // SN-only mode: displayName é o nome do grupo SN diretamente
      const allowed = snCfg.assignmentGroups;
      if (Array.isArray(allowed) && allowed.length > 0 && !allowed.includes(displayName)) return null;
      if (!displayName) return null;
      grpFilter = `assignment_group.name=${displayName}`;
    }
  }

  const fieldFrag = _PRB_GROUPBY_WHITELIST.has(filterField) ? `^${filterField}=${filterValue}` : '';
  const ciFrag    = ciFilter ? `^cmdb_ci.name=${ciFilter}` : '';
  const dayFrag   = _agingRangeFrag(dayMin, dayMax);
  const query     = `${grpFilter}^state!=106^state!=107${fieldFrag}${ciFrag}${dayFrag}`;

  try {
    const res = await snGet(snCfg,
      `table/problem?sysparm_query=${encodeURIComponent(query)}` +
      `&sysparm_fields=number,short_description,priority,impact,urgency,category,state,assignment_group.name,assigned_to.name,opened_at,sys_id` +
      `&sysparm_display_value=all&sysparm_limit=500`
    );
    return (res.result || []).map(p => ({
      number:          _snRaw(p.number) || _snVal(p.number) || '',
      description:     _snVal(p.short_description) || '',
      priority:        _snRaw(p.priority)  || '',
      impact:          _snVal(p.impact)    || '',
      urgency:         _snVal(p.urgency)   || '',
      category:        _snVal(p.category)  || '—',
      state:           _snVal(p.state)     || '',
      openedAt:        _snRaw(p.opened_at) || String(p.opened_at || ''),
      assignedTo:      _snVal(p['assigned_to.name'])      || '—',
      assignmentGroup: _snVal(p['assignment_group.name']) || '—',
      url:             `https://${snCfg.instance}/problem.do?sys_id=${_snRaw(p.sys_id) || p.sys_id}`,
    }));
  } catch (e) {
    console.error('[SN PRB backlog error]', e.message);
    return null;
  }
}

// ── Volume incidents CSV export ────────────────────────────────────────────────
// Fetches all incidents opened OR closed in the month (union, deduplicated by sys_id)
// with the full set of fields needed for CSV export.
async function fetchSnVolumeIncidents(displayName, month, nMonths = 1) {
  const snCfg = getSnConfig();
  if (!snCfg?.instance || !snCfg?.user || !snCfg?.pass) return null;

  let grpFilter;
  const snGrp = getProjectSnGroup(displayName);
  if (snGrp?.assignmentGroup) {
    const grp     = snGrp.assignmentGroup.trim();
    const isSysId = /^[0-9a-f]{32}$/i.test(grp);
    grpFilter     = isSysId ? `assignment_group=${grp}` : `assignment_group.name=${grp}`;
  } else {
    const allowed = snCfg.assignmentGroups;
    if (Array.isArray(allowed) && allowed.length > 0 && !allowed.includes(displayName)) return null;
    if (!displayName) return null;
    grpFilter = `assignment_group.name=${displayName}`;
  }

  const [y, m] = month.split('-').map(Number);
  // start = first day of (month - nMonths + 1), JS handles negative month indices automatically
  const start  = new Date(y, m - nMonths, 1).toISOString().slice(0, 19) + 'Z';
  const end    = new Date(y, m, 0, 23, 59, 59).toISOString().slice(0, 19) + 'Z';

  const fields = [
    'sys_id', 'assignment_group', 'number', 'sys_tags', 'opened_at', 'opened_by',
    'short_description', 'description', 'caller_id', 'u_requested_by',
    'priority', 'hold_reason', 'state', 'assigned_to', 'business_service',
    'cmdb_ci', 'sys_updated_on', 'u_resolution', 'close_code', 'u_causal_code',
    'u_additional_res_code', 'work_notes', 'business_stc', 'business_pause_duration',
  ].join(',');
  const base = `table/incident?sysparm_fields=${fields}&sysparm_display_value=all&sysparm_limit=2000`;

  const openedQuery = `${grpFilter}^opened_at>=${start}^opened_at<=${end}`;
  const closedQuery = `${grpFilter}^resolved_at>=${start}^resolved_at<=${end}`;

  try {
    const [openedRes, closedRes] = await Promise.all([
      snGet(snCfg, `${base}&sysparm_query=${encodeURIComponent(openedQuery)}`).catch(() => ({ result: [] })),
      snGet(snCfg, `${base}&sysparm_query=${encodeURIComponent(closedQuery)}`).catch(() => ({ result: [] })),
    ]);

    const seen = new Set();
    const all  = [];
    for (const r of [...(openedRes.result || []), ...(closedRes.result || [])]) {
      const id = _snRaw(r.sys_id) || _snRaw(r.number) || _snVal(r.number);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      all.push({
        assignmentGroup:  _snVal(r.assignment_group)    || '',
        number:           _snRaw(r.number)              || _snVal(r.number) || '',
        tags:             _snVal(r.sys_tags)             || '',
        opened:           (() => {
          const s = String(_snRaw(r.opened_at) || '');
          if (!s) return '';
          const d = new Date(s.replace(' ', 'T') + 'Z');
          if (isNaN(d.getTime())) return 'DATE:' + s.slice(0, 10);
          const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
          return 'DATE:' + local.toISOString().slice(0, 10);
        })(),
        openedBy:         _snVal(r.opened_by)           || '',
        shortDescription: _snVal(r.short_description)   || '',
        description:      _snVal(r.description)         || '',
        caller:           _snVal(r.caller_id)           || '',
        requestedBy:      _snVal(r.u_requested_by)      || '',
        priority:         _snVal(r.priority)            || '',
        onHoldReason:     _snVal(r.hold_reason)         || '',
        state:            _snVal(r.state)               || '',
        assignedTo:       _snVal(r.assigned_to)         || '',
        service:          _snVal(r.business_service)    || '',
        configItem:          _snVal(r.cmdb_ci)               || '',
        updated:             _snRaw(r.sys_updated_on)        || '',
        resolution:          _snVal(r.u_resolution)          || '',
        resolutionCode:      _snVal(r.close_code)            || '',
        causalCode:          _snVal(r.u_causal_code)         || '',
        additionalResCode:   _snVal(r.u_additional_res_code) || '',
        resolutionNotes:     _snVal(r.work_notes)            || '',
        resolutionHours:     (() => {
          const stc   = parseFloat(_snRaw(r.business_stc)              || 0);
          const pause = parseFloat(_snRaw(r.business_pause_duration)   || 0);
          if (!stc) return null;
          return Math.round((stc - pause) / 3600 * 100) / 100;
        })(),
      });
    }
    return all;
  } catch (e) {
    console.error('[SN volume incidents error]', e.message);
    return null;
  }
}

module.exports = { buildReport, buildPeriod, getLast6Months, cacheInvalidate, fetchSnIncidentBacklog, fetchSnVolumeIncidents, fetchSnRequestBacklog, fetchSnPrbBacklog };

const { getCfg, getDisplayName, saveConfig } = require('../config');
const { buildReport, getLast6Months, cacheInvalidate, fetchSnIncidentBacklog } = require('../reportService');

function getReportConfig({ project }) {
  const cfg  = getCfg();
  const pcfg = (cfg.projects || []).find(p => getDisplayName(p) === project)
            || (cfg.snGroupConfigs || {})[project]
            || null;
  return {
    reportCharts:         pcfg?.reportCharts         || null,
    groupFields:          pcfg?.reportGroupFields    || null,
    incidentMonths:       pcfg?.incidentMonths       || 5,
    incidentTarget:       pcfg?.incidentTarget       ?? null,
    incidentGroupBy:      pcfg?.incidentGroupBy      || 'cmdb_ci',
    heatmapMax:           pcfg?.heatmapMax           ?? 0,
    heatmapTopN:          pcfg?.heatmapTopN          ?? 9,
    locationMonths:       pcfg?.locationMonths       ?? 6,
    agingState:           pcfg?.agingState           || 'In Review',
    agingCharts:          pcfg?.agingCharts          || null,
    agingBuckets:         pcfg?.agingBuckets         || null,
    deliveryStates:       pcfg?.deliveryStates       || null,
    indicatorCards:        pcfg?.indicatorCards        || null,
    indicatorCardsPerRow:  pcfg?.indicatorCardsPerRow  || null,
    incidentCharts:        pcfg?.incidentCharts        || null,
    prbCharts:             pcfg?.prbCharts             || null,
    slaTargets:            pcfg?.slaTargets            || null,
  };
}

function saveReportConfig({ project, reportCharts, incidentMonths, incidentTarget, incidentGroupBy, heatmapMax, heatmapTopN, locationMonths, agingState, agingCharts, agingBuckets, deliveryStates, indicatorCards, indicatorCardsPerRow, incidentCharts, prbCharts, slaTargets } = {}) {
  const cfg  = getCfg();
  let pcfg = (cfg.projects || []).find(p => getDisplayName(p) === project);
  if (!pcfg) {
    // Identificador não é um projeto Azure (ex: grupo SN) — salva em snGroupConfigs
    if (!cfg.snGroupConfigs) cfg.snGroupConfigs = {};
    if (!cfg.snGroupConfigs[project]) cfg.snGroupConfigs[project] = {};
    pcfg = cfg.snGroupConfigs[project];
  }
  if (Array.isArray(reportCharts))  { pcfg.reportCharts = reportCharts; delete pcfg.reportGroupFields; }
  if (incidentMonths  !== undefined) { const m = parseInt(incidentMonths); pcfg.incidentMonths = Math.min(24, Math.max(1, Number.isNaN(m) ? 5 : m)); }
  if (incidentTarget  !== undefined) pcfg.incidentTarget  = incidentTarget === null ? null : Math.max(0, parseInt(incidentTarget) || 0);
  if (incidentGroupBy !== undefined) pcfg.incidentGroupBy = incidentGroupBy;
  if (heatmapMax      !== undefined) pcfg.heatmapMax      = Math.max(0, parseInt(heatmapMax) || 0);
  if (heatmapTopN     !== undefined) pcfg.heatmapTopN     = Math.max(0, parseInt(heatmapTopN) || 0);
  if (locationMonths  !== undefined) { const lm = parseInt(locationMonths); pcfg.locationMonths = [1, 3, 6].includes(lm) ? lm : 6; }
  if (agingState      !== undefined) pcfg.agingState      = agingState;
  if (Array.isArray(agingCharts))   pcfg.agingCharts      = agingCharts;
  if (Array.isArray(agingBuckets))  pcfg.agingBuckets     = agingBuckets.map(v => Math.max(1, parseInt(v) || 1));
  if (Array.isArray(deliveryStates) && deliveryStates.length) pcfg.deliveryStates = deliveryStates;
  if (indicatorCards       !== undefined) pcfg.indicatorCards       = indicatorCards;
  if (indicatorCardsPerRow !== undefined) pcfg.indicatorCardsPerRow = indicatorCardsPerRow;
  if (Array.isArray(incidentCharts)) pcfg.incidentCharts = incidentCharts;
  if (Array.isArray(prbCharts))      pcfg.prbCharts      = prbCharts;
  if (slaTargets !== undefined && typeof slaTargets === 'object') {
    const t = {};
    if (slaTargets.p1 !== undefined) t.p1 = Math.min(100, Math.max(0, parseInt(slaTargets.p1) || 0));
    if (slaTargets.p2 !== undefined) t.p2 = Math.min(100, Math.max(0, parseInt(slaTargets.p2) || 0));
    if (slaTargets.p3 !== undefined) t.p3 = Math.min(100, Math.max(0, parseInt(slaTargets.p3) || 0));
    if (Object.keys(t).length) pcfg.slaTargets = { ...(pcfg.slaTargets || {}), ...t };
  }
  saveConfig(cfg);
  return { ok: true };
}

async function getReport({ project, month, groupFields = [], agingState = 'In Review', incidentMonths, deliveryStates, refresh: doRefresh = false }) {
  const cfg         = getCfg();
  const projects    = cfg.projects || [];
  const pcfgReport  = projects.find(p => getDisplayName(p) === project)
    || (projects[0] ? { ...projects[0] } : null);
  const resolvedProject = project || (projects[0] ? getDisplayName(projects[0]) : '');
  const nMonths     = Math.max(6, Math.min(24, Math.max(1, parseInt(incidentMonths || pcfgReport?.incidentMonths) || 13)));
  const months      = getLast6Months(nMonths);
  const resolvedMonth = months.includes(month) ? month : months[0];

  if (doRefresh) {
    const DEFAULT_DONE     = ['Closed', 'Done', 'Resolved'];
    const isDefaultDelivery = !deliveryStates || (
      deliveryStates.length === DEFAULT_DONE.length &&
      deliveryStates.every(s => DEFAULT_DONE.includes(s))
    );
    cacheInvalidate(
      resolvedProject, resolvedMonth,
      [...groupFields.slice().sort(), agingState, ...(isDefaultDelivery ? [] : [deliveryStates.slice().sort().join(',')])].join('|'),
      String(nMonths)
    );
  }

  const payload = await buildReport(resolvedProject, resolvedMonth, groupFields, agingState, nMonths, deliveryStates);
  return { payload, months, month: resolvedMonth };
}

async function getIncidents({ project, month, mode = 'backlog', filterField = '', filterValue = '', group = '' }) {
  const incidents = await fetchSnIncidentBacklog(project, month, { mode, filterField, filterValue, group });
  return { incidents };
}

module.exports = { getReportConfig, saveReportConfig, getReport, getIncidents };

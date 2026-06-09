const { getCfg, getDisplayName, saveConfig } = require('../config');
const { buildReport, getLast6Months, cacheInvalidate, fetchSnIncidentBacklog } = require('../reportService');

function getReportConfig({ project }) {
  const cfg  = getCfg();
  const pcfg = (cfg.projects || []).find(p => getDisplayName(p) === project);
  return {
    reportCharts:    pcfg?.reportCharts    || null,
    groupFields:     pcfg?.reportGroupFields || null,
    incidentMonths:  pcfg?.incidentMonths  || 5,
    incidentTarget:  pcfg?.incidentTarget  ?? 24,
    incidentGroupBy: pcfg?.incidentGroupBy || 'cmdb_ci',
    heatmapMax:      pcfg?.heatmapMax      ?? 0,
    agingState:      pcfg?.agingState      || 'In Review',
    agingCharts:     pcfg?.agingCharts     || null,
    agingBuckets:    pcfg?.agingBuckets    || null,
    deliveryStates:  pcfg?.deliveryStates  || null,
  };
}

function saveReportConfig({ project, reportCharts, incidentMonths, incidentTarget, incidentGroupBy, heatmapMax, agingState, agingCharts, agingBuckets, deliveryStates } = {}) {
  const cfg  = getCfg();
  const pcfg = (cfg.projects || []).find(p => getDisplayName(p) === project);
  if (pcfg) {
    if (Array.isArray(reportCharts))  { pcfg.reportCharts = reportCharts; delete pcfg.reportGroupFields; }
    if (incidentMonths  !== undefined) pcfg.incidentMonths  = Math.min(24, Math.max(1, parseInt(incidentMonths) || 5));
    if (incidentTarget  !== undefined) pcfg.incidentTarget  = Math.max(0, parseInt(incidentTarget) || 0);
    if (incidentGroupBy !== undefined) pcfg.incidentGroupBy = incidentGroupBy;
    if (heatmapMax      !== undefined) pcfg.heatmapMax      = Math.max(0, parseInt(heatmapMax) || 0);
    if (agingState      !== undefined) pcfg.agingState      = agingState;
    if (Array.isArray(agingCharts))   pcfg.agingCharts      = agingCharts;
    if (Array.isArray(agingBuckets))  pcfg.agingBuckets     = agingBuckets.map(v => Math.max(1, parseInt(v) || 1));
    if (Array.isArray(deliveryStates) && deliveryStates.length) pcfg.deliveryStates = deliveryStates;
    saveConfig(cfg);
  }
  return { ok: true };
}

async function getReport({ project, month, groupFields = [], agingState = 'In Review', incidentMonths, deliveryStates, refresh: doRefresh = false }) {
  const cfg         = getCfg();
  const pcfgReport  = (cfg.projects || []).find(p => getDisplayName(p) === project)
    || (cfg.projects[0] ? { ...cfg.projects[0] } : null);
  const resolvedProject = project || (cfg.projects[0] ? getDisplayName(cfg.projects[0]) : '');
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

async function getIncidents({ project, month, mode = 'backlog', filterField = '', filterValue = '' }) {
  const incidents = await fetchSnIncidentBacklog(project, month, { mode, filterField, filterValue });
  return { incidents };
}

module.exports = { getReportConfig, saveReportConfig, getReport, getIncidents };

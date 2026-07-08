// ── Monthly Review — modal ES module ─────────────────────────────────────────
import { openCopilotWithContext } from './copilot.js';
import { S } from './report-state.js';
import {
  _esc, _metric, _legendHtml, _barChart,
  _renderSprintChart, _renderVolatilityChart,
  _renderTypeDonut, _donutChart,
  _renderTypeBar, _renderTypeBarVertical,
  _renderIncPriorityDonut,
  _renderIncidentsVolumeChart, _renderIncidentSystemBars, _renderIncidentHeatmap,
  _renderUsAgingBuckets, _renderUsTop10,
  _renderIncidentLocationChart,
  _renderPrbStatusDonut, _renderPrbEvolutionChart, _renderPrbAgingChart,
  _renderPrbOldestList, _renderIncPriorityTrend, _renderIncSlaBars,
  _renderPrbCategoryChart,
} from './report-charts.js';
import {
  initPickerCallbacks,
  reportOpenFieldPicker,
  reportOpenIncChartPicker,
  reportOpenPrbChartPicker,
  reportOpenIncidentVolumePicker,
  reportOpenIncidentGroupByPicker,
  reportOpenHeatmapPicker,
  reportOpenLocationPicker,
  reportOpenAgingPicker,
  reportOpenDeliveryStatesPicker,
  reportOpenSlaPicker,
  reportCloseIncidentsModal,
  reportExportIncidentsCSV,
  reportOpenIncidentFilter,
  reportOpenIncidentsModal,
  toggleReportIncMax,
  reportOpenTargetModal,
  reportSaveTargetModal,
  exportReportHtml,
  openIncidentsForGroup,
} from './report-pickers.js';
import { t } from './i18n.js';
export {
  reportOpenFieldPicker,
  reportOpenIncChartPicker,
  reportOpenPrbChartPicker,
  reportOpenIncidentVolumePicker,
  reportOpenIncidentGroupByPicker,
  reportOpenHeatmapPicker,
  reportOpenLocationPicker,
  reportOpenAgingPicker,
  reportOpenDeliveryStatesPicker,
  reportOpenSlaPicker,
  reportCloseIncidentsModal,
  reportExportIncidentsCSV,
  reportOpenIncidentFilter,
  reportOpenIncidentsModal,
  toggleReportIncMax,
  reportOpenTargetModal,
  reportSaveTargetModal,
  exportReportHtml,
  openIncidentsForGroup,
};

// ── Drag & drop factory ───────────────────────────────────────────────────────
// Returns 5 event handlers (start/over/leave/drop/end) for a sortable list.
// Each call creates an independent drag state, enabling multiple drag systems
// to coexist without shared mutable variables at module level.
function _makeDraggable({ guardSelector, getList, setList, afterDrop }) {
  let _srcIdx = -1;
  return {
    start(e, idx) {
      if (guardSelector && e.target.closest(guardSelector)) { e.preventDefault(); return; }
      _srcIdx = idx;
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      setTimeout(() => e.currentTarget?.classList.add('report-dragging'), 0);
    },
    over(e) {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      e.currentTarget.classList.add('report-drag-over');
    },
    leave(e) { e.currentTarget.classList.remove('report-drag-over'); },
    drop(e, targetIdx) {
      e.preventDefault();
      e.currentTarget.classList.remove('report-drag-over');
      if (_srcIdx < 0 || _srcIdx === targetIdx) { _srcIdx = -1; return; }
      const list  = getList();
      const moved = list.splice(_srcIdx, 1)[0];
      list.splice(targetIdx, 0, moved);
      setList(list);
      _srcIdx = -1;
      afterDrop();
    },
    end(e) {
      e?.currentTarget?.classList.remove('report-dragging');
      document.querySelectorAll('.report-drag-over').forEach(el => el.classList.remove('report-drag-over'));
      _srcIdx = -1;
    },
  };
}

const _DRAG_GUARD = '.report-field-chart-actions, button, a, select, input';

const _chartDrag = _makeDraggable({
  guardSelector: _DRAG_GUARD,
  getList:   () => S.reportCharts,
  setList:   list => { S.reportCharts = list; },
  afterDrop: () => { _saveReportConfig(); _rerender(); },
});

const _incChartDrag = _makeDraggable({
  guardSelector: _DRAG_GUARD,
  getList:   () => S.incidentCharts,
  setList:   list => { S.incidentCharts = list; },
  afterDrop: () => { _saveReportConfig(); _rerender(); },
});

const _prbChartDrag = _makeDraggable({
  guardSelector: _DRAG_GUARD,
  getList:   () => S.prbCharts,
  setList:   list => { S.prbCharts = list; },
  afterDrop: () => { _saveReportConfig(); _rerender(); },
});

const _DEFAULT_CHARTS = [
  { type: 'sprint',     size: 'lg' },
  { type: 'volatility', size: 'md' },
  { type: 'donut',      size: 'md', ref: '', label: 'Tipo de Item' },
];

const _DEFAULT_INCIDENT_CHARTS = [
  { type: 'inc-volume',   size: 'lg' },
  { type: 'inc-bars',     size: 'lg' },
  { type: 'inc-heatmap',  size: 'lg' },
  { type: 'inc-location', size: 'lg' },
];

const _DEFAULT_PRB_CHARTS = [
  { type: 'prb-evolution', size: 'lg' },
  { type: 'prb-donut',     size: 'md' },
  { type: 'prb-aging',     size: 'md' },
  { type: 'prb-oldest',    size: 'lg' },
];

// Catalog of all configurable indicator cards — source of truth for both sections.
// defaultVisible: true = shown by default; false = opt-in (new ITIL indicators).
const _INDICATOR_CATALOG = [
  // ── Incidents — existing ──
  { id: 'inc_total',   section: 'incidents', get label() { return t('rpt_ind_inc_total'); },   get desc() { return t('rpt_ind_inc_total_desc'); },   defaultVisible: true  },
  { id: 'inc_closed',  section: 'incidents', get label() { return t('rpt_ind_inc_closed'); },  get desc() { return t('rpt_ind_inc_closed_desc'); },  defaultVisible: true  },
  { id: 'inc_backlog', section: 'incidents', get label() { return t('rpt_ind_inc_backlog'); }, get desc() { return t('rpt_ind_inc_backlog_desc'); }, defaultVisible: true  },
  { id: 'inc_mttr',    section: 'incidents', get label() { return t('rpt_ind_inc_mttr'); },    get desc() { return t('rpt_ind_inc_mttr_desc'); },    defaultVisible: true  },
  { id: 'inc_p1',      section: 'incidents', get label() { return t('rpt_ind_inc_p1'); },      get desc() { return t('rpt_ind_inc_p1_desc'); },      defaultVisible: true  },
  { id: 'inc_p2',      section: 'incidents', get label() { return t('rpt_ind_inc_p2'); },      get desc() { return t('rpt_ind_inc_p2_desc'); },      defaultVisible: true  },
  { id: 'inc_p3',      section: 'incidents', get label() { return t('rpt_ind_inc_p3'); },      get desc() { return t('rpt_ind_inc_p3_desc'); },      defaultVisible: true  },
  { id: 'inc_target',  section: 'incidents', get label() { return t('rpt_ind_inc_target'); },  get desc() { return t('rpt_ind_inc_target_desc'); },  defaultVisible: true  },
  // ── Incidents — novos ITIL ──
  { id: 'inc_mttr_p1', section: 'incidents', get label() { return t('rpt_ind_inc_mttr_p1'); }, get desc() { return t('rpt_ind_inc_mttr_p1_desc'); }, defaultVisible: false },
  { id: 'inc_mttr_p2', section: 'incidents', get label() { return t('rpt_ind_inc_mttr_p2'); }, get desc() { return t('rpt_ind_inc_mttr_p2_desc'); }, defaultVisible: false },
  { id: 'inc_reopen',  section: 'incidents', get label() { return t('rpt_ind_inc_reopen'); },  get desc() { return t('rpt_ind_inc_reopen_desc'); },  defaultVisible: false },
  // ── PRBs — existing ──
  { id: 'prb_opened',  section: 'prbs', get label() { return t('rpt_ind_prb_opened'); },  get desc() { return t('rpt_ind_prb_opened_desc'); },  defaultVisible: true  },
  { id: 'prb_resolved',section: 'prbs', get label() { return t('rpt_ind_prb_resolved'); },get desc() { return t('rpt_ind_prb_resolved_desc'); },defaultVisible: true  },
  { id: 'prb_backlog', section: 'prbs', get label() { return t('rpt_ind_prb_backlog'); }, get desc() { return t('rpt_ind_prb_backlog_desc'); }, defaultVisible: true  },
  { id: 'prb_mttr',    section: 'prbs', get label() { return t('rpt_ind_prb_mttr'); },    get desc() { return t('rpt_ind_prb_mttr_desc'); },    defaultVisible: true  },
  // ── PRBs — novos ITIL ──
  { id: 'prb_ke',      section: 'prbs', get label() { return t('rpt_ind_prb_ke'); },  get desc() { return t('rpt_ind_prb_ke_desc'); },  defaultVisible: false },
  { id: 'prb_wa',      section: 'prbs', get label() { return t('rpt_ind_prb_wa'); },  get desc() { return t('rpt_ind_prb_wa_desc'); },  defaultVisible: false },
  { id: 'prb_rca',     section: 'prbs', get label() { return t('rpt_ind_prb_rca'); }, get desc() { return t('rpt_ind_prb_rca_desc'); }, defaultVisible: false },
];

async function _loadReportConfig() {
  let charts    = null;
  let needsSave = false;

  // Reset state so trocar de projeto não carrega dados do projeto anterior
  S.indicatorCards        = {};
  S.indicatorCardsPerRow  = {};
  S.incidentCharts = [];
  S.prbCharts      = [];
  S.slaTargets     = { p1: 95, p2: 90, p3: 85 };

  // 0. Load SLA config from sn-config (parallel, non-blocking)
  fetch('/api/sn-config?' + new URLSearchParams({ project: S.reportProject }))
    .then(r => r.json())
    .then(d => {
      S.slaEnabled    = d.slaEnabled    === true;
      S.slaThresholds = d.slaThresholds || { p1: 4, p2: 8, p3: 72 };
    })
    .catch(() => {});

  // 1. Try server (config.json) — prefer new format, migrate old format
  try {
    const r    = await fetch('/api/report-config?' + new URLSearchParams({ project: S.reportProject }));
    const data = await r.json();
    if (data.incidentMonths)          S.incidentMonths  = data.incidentMonths;
    if (data.incidentGroupBy)         S.incidentGroupBy = data.incidentGroupBy;
    if (data.incidentTarget != null)  S.incidentTarget  = data.incidentTarget;
    if (data.heatmapMax     != null)  S.heatmapMax      = data.heatmapMax;
    if (data.heatmapTopN    != null)  S.heatmapTopN     = data.heatmapTopN;
    if (data.locationMonths != null)  S.locationMonths  = data.locationMonths;
    if (Array.isArray(data.agingBuckets) && data.agingBuckets.length === 4) S.agingBuckets = data.agingBuckets;
    if (data.prbMonths    != null)  S.prbMonths    = data.prbMonths;
    if (Array.isArray(data.prbAgingBuckets) && data.prbAgingBuckets.length === 4) S.prbAgingBuckets = data.prbAgingBuckets;
    if (Array.isArray(data.deliveryStates) && data.deliveryStates.length)  S.deliveryStates = data.deliveryStates;
    if (data.agingState)              S.agingState      = data.agingState;
    if (data.agingCharts?.length) S.agingCharts    = data.agingCharts;
    if (data.indicatorCards       != null) S.indicatorCards       = data.indicatorCards;
    if (data.indicatorCardsPerRow != null) S.indicatorCardsPerRow = data.indicatorCardsPerRow;
    if (Array.isArray(data.incidentCharts) && data.incidentCharts.length) S.incidentCharts = data.incidentCharts;
    if (Array.isArray(data.prbCharts)      && data.prbCharts.length)      S.prbCharts      = data.prbCharts;
    if (data.slaTargets != null && typeof data.slaTargets === 'object') S.slaTargets = { p1: 95, p2: 90, p3: 85, ...data.slaTargets };
    if (data.reportCharts?.length) {
      charts = data.reportCharts;
    } else if (data.groupFields?.length) {
      // Migrate old groupFields key → new reportCharts format and persist
      charts = [
        { type: 'sprint',     size: 'lg' },
        { type: 'volatility', size: 'md' },
        ...data.groupFields.map(f => ({ type: 'donut', size: f.size || 'md', ref: f.ref || '', label: f.label || 'Tipo de Item' })),
      ];
      needsSave = true;
    }
  } catch (_) {}

  // 2. Migrate from old localStorage format (one-time, then remove)
  if (!charts) {
    try {
      const saved = localStorage.getItem('reportGroupFields::' + S.reportProject);
      if (saved) {
        const old = JSON.parse(saved);
        charts = [
          { type: 'sprint',     size: 'lg' },
          { type: 'volatility', size: 'md' },
          ...old.map(f => ({ type: 'donut', size: f.size || 'md', ref: f.ref || '', label: f.label || 'Tipo de Item' })),
        ];
        localStorage.removeItem('reportGroupFields::' + S.reportProject);
        needsSave = true;
      }
    } catch (_) {}
  }

  // 3. Default — marcar needsSave quando novos campos precisam ser inicializados
  S.reportCharts = charts || _DEFAULT_CHARTS.map(c => ({ ...c }));
  if (!S.incidentCharts.length) { S.incidentCharts = _DEFAULT_INCIDENT_CHARTS.map(c => ({ ...c })); needsSave = true; }
  if (!S.prbCharts.length)      { S.prbCharts      = _DEFAULT_PRB_CHARTS.map(c => ({ ...c }));      needsSave = true; }
  if (!charts || needsSave) _saveReportConfig(); // persist to config.json
}

function _saveReportConfig() {
  fetch('/api/report-config', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ project: S.reportProject, reportCharts: S.reportCharts, incidentMonths: S.incidentMonths, incidentTarget: S.incidentTarget, incidentGroupBy: S.incidentGroupBy, heatmapMax: S.heatmapMax, heatmapTopN: S.heatmapTopN, locationMonths: S.locationMonths, agingState: S.agingState, agingCharts: S.agingCharts, agingBuckets: S.agingBuckets, deliveryStates: S.deliveryStates, indicatorCards: S.indicatorCards, indicatorCardsPerRow: S.indicatorCardsPerRow, incidentCharts: S.incidentCharts, prbCharts: S.prbCharts, slaTargets: S.slaTargets, prbMonths: S.prbMonths, prbAgingBuckets: S.prbAgingBuckets }),
  })
  .then(r => r.json())
  .then(d => { if (!d.ok) console.error('[report] save failed:', d); })
  .catch(e => console.error('[report] save error:', e));
}

// ── Unified chart cell (draggable, resizable) ─────────────────────────────────

function _renderChartCell(chart, delivery, idx, sprints, incidents) {
  const size      = chart.size || 'md';
  const canRemove = S.reportCharts.length > 1;

  let title, content;
  if (chart.type === 'sprint') {
    title   = t('rpt_sp_planned_delivered');
    content = _renderSprintChart(sprints);
  } else if (chart.type === 'volatility') {
    title   = t('rpt_volatility_backlog');
    content = _renderVolatilityChart(sprints);
  } else if (chart.type === 'incidents') {
    const monthsLabel = chart.months || 5;
    title   = `${t('rpt_inc_vs_target')} · ${monthsLabel} ${t('rpt_months')}`;
    content = incidents
      ? _renderIncidentsVolumeChart(incidents.monthly, monthsLabel, S.incidentTarget)
      : '<div class="report-empty-hint">Service Now not configured for this project</div>';
  } else if (chart.type === 'incident-location') {
    const monthsLabel = chart.months || 6;
    title   = `${t('rpt_inc_location_title')} · ${monthsLabel} ${t(monthsLabel === 1 ? 'rpt_month' : 'rpt_months')}`;
    content = incidents
      ? _renderIncidentLocationChart(incidents.byLocationMonthly, incidents.monthly, monthsLabel)
      : '<div class="report-empty-hint">Service Now not configured for this project</div>';
  } else {
    const usePts      = chart.countBy === 'pts';
    const metricLabel = usePts ? 'Story Points' : 'User Stories';
    const bySource    = usePts ? (delivery.byTypesPts || {}) : (delivery.byTypes || {});
    title   = `${metricLabel} ${t('rpt_by')} ${_esc(chart.label || t('rpt_item_type'))}`;
    const data = bySource[chart.ref || ''] || [];
    content = chart.chartStyle === 'bar'          ? _renderTypeBar(data, chart.barColor, metricLabel, size)
            : chart.chartStyle === 'bar-vertical' ? _renderTypeBarVertical(data, chart.barColor, metricLabel, size)
            : _renderTypeDonut(data, metricLabel);
  }

  const header = `<div class="report-field-picker-header">
    <div class="report-donut-title-row">
      <span class="report-drag-handle" title="${t('rpt_drag_reorder')}"><svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" style="opacity:0.45;vertical-align:middle"><circle cx="3" cy="2" r="1.5"/><circle cx="7" cy="2" r="1.5"/><circle cx="3" cy="7" r="1.5"/><circle cx="7" cy="7" r="1.5"/><circle cx="3" cy="12" r="1.5"/><circle cx="7" cy="12" r="1.5"/></svg></span>
      <div class="report-subsection-title">${title}</div>
    </div>
    <div class="report-field-chart-actions" draggable="false">
      <button class="report-field-picker-btn" title="${t('rpt_configure_chart')}" onclick="reportOpenFieldPicker(${idx})" draggable="false">⚙</button>
      ${canRemove ? `<button class="report-field-remove-btn" title="${t('rpt_remove_chart')}" onclick="reportRemoveChart(${idx})" draggable="false">×</button>` : ''}
    </div>
  </div>`;

  return `<div class="report-section report-donut-cell report-donut-cell-${size}"
    draggable="true"
    ondragstart="reportDragStart(event,${idx})"
    ondragover="reportDragOver(event)"
    ondragleave="reportDragLeave(event)"
    ondrop="reportDrop(event,${idx})"
    ondragend="reportDragEnd(event)">
    ${header}
    ${content}
  </div>`;
}

// ── Incident chart cell (draggable) ───────────────────────────────────────────

function _renderIncidentChartCell(chart, idx, inc) {
  const size      = chart.size || 'lg';
  const canRemove = S.incidentCharts.length > 1;
  const useAlt     = S.incidentGroupBy === 'resolution_code';
  const barData    = useAlt ? (inc.byGroupAlt || [])        : (inc.bySystem || []);
  const heatData   = useAlt ? (inc.byGroupAltMonthly || []) : (inc.bySystemMonthly || []);
  const groupLabel = useAlt ? t('rpt_groupby_res_code') : t('rpt_inc_cfg_groupby_ic');

  let title, subtitle, content;
  switch (chart.type) {
    case 'inc-volume': {
      const chartMonths = chart.months || S.incidentMonths;
      title     = t('rpt_inc_volume_title');
      subtitle  = `${t('rpt_inc_history_sub')}${S.incidentTarget > 0 ? ` — target: ${S.incidentTarget}` : ''} · ${chartMonths} ${t('rpt_months')}`;
      content   = _renderIncidentsVolumeChart(inc.monthly, chartMonths, S.incidentTarget, S.reportMonth);
      break;
    }
    case 'inc-bars':
      title     = `${groupLabel} — ${t('rpt_inc_bars_top9')}`;
      subtitle  = t('rpt_inc_bars_sub');
      content   = _renderIncidentSystemBars(barData, S.reportMonth, useAlt ? 'resolution_code' : 'cmdb_ci');
      break;
    case 'inc-heatmap': {
      const chartMonths = chart.months || S.incidentMonths;
      title     = `Heatmap: ${groupLabel} × ${t('rpt_month')}`;
      subtitle  = `${t('rpt_heatmap_freq_sub')}${S.heatmapTopN > 0 ? ` — ${t('rpt_heatmap_top')} ${S.heatmapTopN}` : ` — ${t('rpt_heatmap_all_sys')}`}${S.heatmapMax > 0 ? ` — ${t('rpt_heatmap_fixed_scale')} ${S.heatmapMax}` : ''} · ${chartMonths} ${t('rpt_months')}`;
      content   = _renderIncidentHeatmap(heatData, inc.monthly, groupLabel, useAlt ? 'resolution_code' : 'cmdb_ci', chartMonths);
      break;
    }
    case 'inc-location':
      title     = t('rpt_inc_location_title');
      subtitle  = `${t('rpt_inc_loc_sub')} · ${S.locationMonths} ${t(S.locationMonths === 1 ? 'rpt_month' : 'rpt_months')}`;
      content   = _renderIncidentLocationChart(inc.byLocationMonthly, inc.monthly, S.locationMonths);
      break;
    case 'inc-priority-trend': {
      const chartMonths = chart.months || S.incidentMonths;
      title     = t('rpt_priority_trend_title');
      subtitle  = `${t('rpt_priority_trend_sub')} · ${chartMonths} ${t('rpt_months')}`;
      content   = _renderIncPriorityTrend(inc.monthly, chartMonths);
      break;
    }
    case 'inc-sla-bars':
      title     = t('rpt_sla_bars_title');
      subtitle  = t('rpt_sla_bars_sub');
      content   = _renderIncSlaBars(inc.slaByPriority);
      break;
    case 'inc-priority-donut':
      title     = t('rpt_priority_donut_title');
      subtitle  = t('rpt_priority_donut_sub');
      content   = _renderIncPriorityDonut(inc);
      break;
    case 'inc-groupby': {
      const _flat = arr => (arr || []).map(d => ({ type: d.name, count: d.total }));
      const _incGroupbyFields = {
        'cmdb_ci.name':          { get label() { return t('rpt_groupby_ic'); },           data: () => _flat(inc.bySystem) },
        'u_additional_res_code': { get label() { return t('rpt_groupby_res_code'); },     data: () => _flat(inc.byGroupAlt) },
        'assignment_group':      { get label() { return t('rpt_groupby_assignment'); },   data: () => _flat(inc.byAssignmentGroup) },
        'assigned_to':           { get label() { return t('rpt_groupby_assignee'); },     data: () => _flat(inc.byAssignedTo) },
        'priority':              { get label() { return t('rpt_groupby_priority'); },     data: () => { const p = inc.byPriority || {}; return [{ type: 'P1', count: p.p1||0 }, { type: 'P2', count: p.p2||0 }, { type: 'P3', count: p.p3||0 }].filter(x => x.count > 0); } },
        'impact':                { get label() { return t('rpt_groupby_impact'); },       data: () => _flat(inc.byImpact) },
        'urgency':               { get label() { return t('rpt_groupby_urgency'); },      data: () => _flat(inc.byUrgency) },
        'state':                 { get label() { return t('rpt_groupby_state'); },        data: () => _flat(inc.byState) },
        'category':              { get label() { return t('rpt_groupby_category'); },     data: () => _flat(inc.byCategory) },
        'subcategory':           { get label() { return t('rpt_groupby_subcategory'); },  data: () => _flat(inc.bySubcategory) },
        'location.name':         { get label() { return t('rpt_groupby_location'); },     data: () => _flat(inc.byLocationMonthly) },
        'close_code':            { get label() { return t('rpt_groupby_close_code'); },   data: () => _flat(inc.byCloseCode) },
        'contact_type':          { get label() { return t('rpt_groupby_contact_type'); }, data: () => _flat(inc.byContactType) },
      };
      const _gf  = _incGroupbyFields[chart.ref] || _incGroupbyFields['cmdb_ci.name'];
      const _gd  = _gf.data();
      title   = `${t('rpt_inc_by')} ${_gf.label}`;
      subtitle = '';
      content = chart.chartStyle === 'bar'          ? _renderTypeBar(        _gd, chart.barColor, t('rpt_filter_incidents'), size)
              : chart.chartStyle === 'bar-vertical' ? _renderTypeBarVertical( _gd, chart.barColor, t('rpt_filter_incidents'), size)
              : _renderTypeDonut(_gd, t('rpt_filter_incidents'));
      break;
    }
    default: return '';
  }

  return `<div class="report-section report-donut-cell report-donut-cell-${size}"
    draggable="true"
    ondragstart="reportIncChartDragStart(event,${idx})"
    ondragover="reportIncChartDragOver(event)"
    ondragleave="reportIncChartDragLeave(event)"
    ondrop="reportIncChartDrop(event,${idx})"
    ondragend="reportIncChartDragEnd(event)">
    <div class="report-field-picker-header">
      <div class="report-donut-title-row">
        <span class="report-drag-handle" title="${t('rpt_drag_reorder')}"><svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" style="opacity:0.45;vertical-align:middle"><circle cx="3" cy="2" r="1.5"/><circle cx="7" cy="2" r="1.5"/><circle cx="3" cy="7" r="1.5"/><circle cx="7" cy="7" r="1.5"/><circle cx="3" cy="12" r="1.5"/><circle cx="7" cy="12" r="1.5"/></svg></span>
        <div class="report-subsection-title">${title}</div>
      </div>
      <div class="report-field-chart-actions" draggable="false">
        <button class="report-field-picker-btn" title="${t('rpt_configure_chart')}" onclick="reportOpenIncChartPicker(${idx})" draggable="false">&#9881;</button>
        ${canRemove ? `<button class="report-field-remove-btn" title="${t('rpt_remove_chart')}" onclick="reportRemoveIncChart(${idx})" draggable="false">×</button>` : ''}
      </div>
    </div>
    <div class="report-prb-chart-sub">${subtitle}</div>
    ${content}
  </div>`;
}

// ── PRB chart cell (draggable) ─────────────────────────────────────────────────

function _renderPrbChartCell(chart, idx, prbs) {
  const size      = chart.size || 'lg';
  const canRemove = S.prbCharts.length > 1;
  let title, subtitle, content;
  switch (chart.type) {
    case 'prb-evolution': { const prbChartMonths = chart.months || S.prbMonths; title = t('rpt_prb_evolution'); subtitle = `${prbChartMonths} ${t('rpt_months')}`; content = _renderPrbEvolutionChart(prbs.monthly, prbChartMonths); break; }
    case 'prb-donut':     title = t('rpt_prb_status_title'); subtitle = t('rpt_prb_status_sub'); content = _renderPrbStatusDonut(prbs.list); break;
    case 'prb-aging':     title = t('rpt_aging_backlog'); subtitle = t('rpt_prb_aging_sub'); content = _renderPrbAgingChart(prbs.list, S.prbAgingBuckets); break;
    case 'prb-oldest':    title = t('rpt_prb_oldest_title'); subtitle = t('rpt_prb_oldest_sub'); content = _renderPrbOldestList(prbs.list); break;
    case 'prb-category':  title = 'Distribuição por Categoria'; subtitle = 'Root cause por categoria'; content = _renderPrbCategoryChart(prbs.list); break;
    case 'prb-groupby': {
      const _prbGroupbyFields = {
        get category() { return t('rpt_groupby_category'); },
        get state()    { return t('rpt_groupby_state'); },
        get priority() { return t('rpt_groupby_priority'); },
      };
      const _pgKey   = chart.ref || 'category';
      const _pgLabel = _prbGroupbyFields[_pgKey] || _pgKey;
      const _pgData  = _computePrbGroupby(prbs.list, _pgKey);
      title   = `${t('rpt_prbs_by')} ${_pgLabel}`;
      subtitle = '';
      content = chart.chartStyle === 'bar'          ? _renderTypeBar(        _pgData, chart.barColor, 'PRBs', size)
              : chart.chartStyle === 'bar-vertical' ? _renderTypeBarVertical( _pgData, chart.barColor, 'PRBs', size)
              : _renderTypeDonut(_pgData, 'PRBs');
      break;
    }
    default: return '';
  }

  return `<div class="report-section report-donut-cell report-donut-cell-${size}"
    draggable="true"
    ondragstart="reportPrbChartDragStart(event,${idx})"
    ondragover="reportPrbChartDragOver(event)"
    ondragleave="reportPrbChartDragLeave(event)"
    ondrop="reportPrbChartDrop(event,${idx})"
    ondragend="reportPrbChartDragEnd(event)">
    <div class="report-field-picker-header">
      <div class="report-donut-title-row">
        <span class="report-drag-handle" title="${t('rpt_drag_reorder')}"><svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" style="opacity:0.45;vertical-align:middle"><circle cx="3" cy="2" r="1.5"/><circle cx="7" cy="2" r="1.5"/><circle cx="3" cy="7" r="1.5"/><circle cx="7" cy="7" r="1.5"/><circle cx="3" cy="12" r="1.5"/><circle cx="7" cy="12" r="1.5"/></svg></span>
        <div class="report-subsection-title">${title}</div>
      </div>
      <div class="report-field-chart-actions" draggable="false">
        <button class="report-field-picker-btn" title="${t('rpt_configure_chart')}" onclick="reportOpenPrbChartPicker(${idx})" draggable="false">&#9881;</button>
        ${canRemove ? `<button class="report-field-remove-btn" title="${t('rpt_remove_chart')}" onclick="reportRemovePrbChart(${idx})" draggable="false">×</button>` : ''}
      </div>
    </div>
    ${subtitle ? `<div class="report-prb-chart-sub">${subtitle}</div>` : ''}
    ${content}
  </div>`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _computePrbGroupby(list, field) {
  const counts = {};
  (list || []).forEach(item => {
    let v = item[field];
    if (typeof v === 'boolean') v = v ? t('rpt_yes') : t('rpt_no');
    const k = (v !== null && v !== undefined && v !== '') ? String(v) : t('rpt_no_value');
    counts[k] = (counts[k] || 0) + 1;
  });
  return Object.entries(counts)
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);
}

function _deltaHtml(curr, prev, lowerIsBetter = false) {
  if (prev == null || curr == null) return '';
  const diff = curr - prev;
  if (diff === 0) return '<span class="report-delta report-delta--neutral">= 0</span>';
  const good = lowerIsBetter ? diff < 0 : diff > 0;
  const cls  = good ? 'report-delta--good' : 'report-delta--bad';
  return `<span class="report-delta ${cls}">${diff > 0 ? '+' : ''}${diff}</span>`;
}

function _slaBadge(sla) {
  if (!sla || sla.total === 0) return `<div class="report-prb-card-sub">${t('rpt_sla_no_data')}</div>`;
  const cls = sla.pct >= 90 ? 'sla-ok' : sla.pct >= 70 ? 'sla-warn' : 'sla-bad';
  const breachLabel = sla.breached > 0
    ? `<span class="report-sla-threshold">(${sla.breached} ${t(sla.breached !== 1 ? 'rpt_sla_breached_p' : 'rpt_sla_breached_s')})</span>`
    : '';
  return `<div class="report-sla-badge ${cls}">${sla.pct}% ${t('rpt_sla_within')} ${breachLabel}</div>`;
}

// ── Sections ──────────────────────────────────────────────────────────────────

function _renderDelivery(delivery, quality, incidents, prevDelivery, prevQuality) {
  const sprints  = (delivery.sprints || []).sort((a, b) => a.name.localeCompare(b.name));
  const usAging  = delivery.usAging || null;
  const totalSP          = sprints.reduce((s, sp) => s + (sp.points || 0), 0);
  const totalSPDelivered = sprints.reduce((s, sp) => s + (sp.pointsDelivered || 0), 0);

  const totalUS = delivery.totalUS ?? delivery.totalDelivered;
  const delRate = totalUS  > 0 ? Math.round(delivery.totalDelivered / totalUS  * 100) : 0;
  const spRate  = totalSP  > 0 ? Math.round(totalSPDelivered        / totalSP  * 100) : 0;
  const delCls  = delRate >= 70 ? 'green' : delRate >= 40 ? 'yellow' : totalUS > 0 ? 'red' : '';
  const spCls   = spRate  >= 70 ? 'green' : spRate  >= 40 ? 'yellow' : totalSP > 0 ? 'red' : '';

  const openCls   = quality.bugsOpen   > 10 ? 'red' : quality.bugsOpen   > 5 ? 'yellow' : 'green';
  const newCls    = quality.bugsNew    > 5  ? 'red' : quality.bugsNew    > 2 ? 'yellow' : '';
  const closedCls = quality.bugsClosed > 0  ? 'green' : '';
  const net       = (quality.bugsNew || 0) - (quality.bugsClosed || 0);
  const saldoCls  = net < 0 ? 'green' : net > 0 ? 'red' : '';
  const saldoSub  = net < 0 ? t('rpt_improving') : net > 0 ? t('rpt_worsening') : t('rpt_stable');

  const sprintRows = sprints.length
    ? sprints.map(s => {
        const pct    = s.total  > 0 ? Math.round(s.delivered           / s.total  * 100) : 0;
        const ptsPct = s.points > 0 ? Math.round((s.pointsDelivered || 0) / s.points * 100) : 0;
        return `<tr>
          <td>${_esc(s.name)}</td>
          <td class="num">${s.total}</td>
          <td class="num">${s.delivered} (${pct}%)</td>
          <td class="num">${s.points || 0}</td>
          <td class="num">${s.pointsDelivered || 0} (${ptsPct}%)</td>
        </tr>`;
      }).join('')
    : '<tr><td colspan="5" class="report-empty-row">No sprints found for this period</td></tr>';

  const chartCells = S.reportCharts.map((chart, idx) =>
    _renderChartCell(chart, delivery, idx, sprints, incidents)
  ).join('');

  const DEFAULT_DONE = ['Closed', 'Done', 'Resolved'];
  const isCustomDelivery = S.deliveryStates.length !== DEFAULT_DONE.length || S.deliveryStates.some(s => !DEFAULT_DONE.includes(s));
  const deliveryStatesSub = isCustomDelivery
    ? `<div class="report-prb-chart-sub" style="margin-top:2px">Contando como entregue: <strong>${S.deliveryStates.join(', ')}</strong></div>`
    : '';

  return `<div class="report-section" data-section="sprint">
    <div class="report-section-header-row">
      <div class="report-section-title">${t('rpt_section_delivery')}</div>
      <button class="report-field-picker-btn" onclick="reportOpenDeliveryStatesPicker()" title="${t('rpt_cfg_delivery_states')}">⚙</button>
    </div>
    ${deliveryStatesSub}
    <div class="report-prb-cards">
      <div class="report-prb-card">
        <div class="report-prb-card-val">${totalUS} ${_deltaHtml(totalUS, prevDelivery?.totalUS, false)}</div>
        <div class="report-prb-card-label">User Stories</div>
        <div class="report-prb-card-sub">${t('rpt_in_period')}</div>
      </div>
      <div class="report-prb-card">
        <div class="report-prb-card-val ${delCls}">${delivery.totalDelivered} ${_deltaHtml(delivery.totalDelivered, prevDelivery?.totalDelivered, false)}</div>
        <div class="report-prb-card-label">Entregues</div>
        <div class="report-prb-card-sub">${delRate}% do total</div>
      </div>
      <div class="report-prb-card">
        <div class="report-prb-card-val">${totalSP}</div>
        <div class="report-prb-card-label">Story Points</div>
        <div class="report-prb-card-sub">comprometidos</div>
      </div>
      <div class="report-prb-card">
        <div class="report-prb-card-val ${spCls}">${totalSPDelivered}</div>
        <div class="report-prb-card-label">SP Entregues</div>
        <div class="report-prb-card-sub">${spRate}% do total</div>
      </div>
      <div class="report-prb-card">
        <div class="report-prb-card-val ${openCls}">${quality.bugsOpen} ${_deltaHtml(quality.bugsOpen, prevQuality?.bugsOpen, true)}</div>
        <div class="report-prb-card-label">${t('rpt_bugs_open')}</div>
        <div class="report-prb-card-sub">ativos no momento</div>
      </div>
      <div class="report-prb-card">
        <div class="report-prb-card-val ${newCls}">${quality.bugsNew} ${_deltaHtml(quality.bugsNew, prevQuality?.bugsNew, true)}</div>
        <div class="report-prb-card-label">${t('rpt_bugs_new')}</div>
        <div class="report-prb-card-sub">${t('rpt_opened_period')}</div>
      </div>
      <div class="report-prb-card">
        <div class="report-prb-card-val ${closedCls}">${quality.bugsClosed}</div>
        <div class="report-prb-card-label">${t('rpt_bugs_resolved')}</div>
        <div class="report-prb-card-sub">${t('rpt_closed_period')}</div>
      </div>
      <div class="report-prb-card">
        <div class="report-prb-card-val ${saldoCls}">${net > 0 ? '+' : ''}${net}</div>
        <div class="report-prb-card-label">${t('rpt_bug_balance')}</div>
        <div class="report-prb-card-sub">${saldoSub}</div>
      </div>
    </div>
    <div class="report-subsection-title" style="margin-top:4px">${t('rpt_sprint_dist_title')}</div>
    <div class="report-prb-chart-sub">${t('rpt_sprint_dist_sub')}</div>
    <table class="report-table">
      <thead><tr><th>${t('rpt_th_sprint')}</th><th class="num">${t('rpt_th_total_us')}</th><th class="num">${t('rpt_th_delivered')}</th><th class="num">${t('rpt_th_sp_total')}</th><th class="num">${t('rpt_th_sp_delivered')}</th></tr></thead>
      <tbody>${sprintRows}</tbody>
    </table>
    <div class="report-donuts-grid">
      ${chartCells}
      <div class="report-add-chart-section">
        <button class="report-add-chart-btn" onclick="reportAddChart()">+ ${t('rpt_add_chart')}</button>
      </div>
    </div>
    <div class="report-subsection-title" style="margin-top:20px">US Aging — ${_esc(usAging?.state || S.agingState)}</div>
    <div class="report-prb-chart-sub">${usAging ? `${usAging.total} US em "${_esc(usAging.state)}" · sem filtro de sprint` : `Aguardando dados para "${_esc(S.agingState)}"`}</div>
    <div class="report-donuts-grid">
      <div class="report-donut-cell report-donut-cell-${S.agingCharts[0]?.size || 'md'}">
        <div class="report-field-picker-header">
          <div class="report-donut-title-row"><div class="report-subsection-title">${t('rpt_aging_backlog')}</div></div>
          <div class="report-field-chart-actions"><button class="report-field-picker-btn" title="${t('rpt_configure_chart')}" onclick="reportOpenAgingPicker(0)" draggable="false">⚙</button></div>
        </div>
        ${_renderUsAgingBuckets(usAging)}
      </div>
      <div class="report-donut-cell report-donut-cell-${S.agingCharts[1]?.size || 'md'}">
        <div class="report-field-picker-header">
          <div class="report-donut-title-row"><div class="report-subsection-title">${t('rpt_aging_top10')} "${_esc(usAging?.state || S.agingState)}"</div></div>
          <div class="report-field-chart-actions"><button class="report-field-picker-btn" title="${t('rpt_configure_chart')}" onclick="reportOpenAgingPicker(1)" draggable="false">⚙</button></div>
        </div>
        ${_renderUsTop10(usAging)}
      </div>
    </div>
  </div>`;
}

function _renderIncidents(inc) {
  if (!inc) return '';

  return `<div class="report-section" data-section="incidents">
    <div class="report-section-header-row">
      <div class="report-section-title">${t('rpt_section_incidents')}</div>
      <div class="report-field-chart-actions">
        <button class="report-field-picker-btn" title="${t('rpt_cfg_indicators')}" onclick="reportOpenIndicatorConfig('incidents')" draggable="false">&#9881;</button>
        <button class="report-field-picker-btn" title="${t('rpt_cfg_sla')}" onclick="reportOpenSlaPicker()" draggable="false">SLA</button>
      </div>
    </div>
    ${S.indConfigSection === 'incidents' ? _renderIndicatorConfigPanel('incidents') : ''}
    ${_renderIndicatorCards('incidents', inc, null)}
    <div class="report-donuts-grid">
      ${S.incidentCharts.map((chart, idx) => _renderIncidentChartCell(chart, idx, inc)).join('')}
      <div class="report-add-chart-section" style="flex-basis:100%">
        <button class="report-add-chart-btn" onclick="reportAddIncChart()">+ ${t('rpt_add_chart')}</button>
      </div>
    </div>
  </div>`;
}

// ── Indicator card helpers ─────────────────────────────────────────────────────

function _getResolvedCards(section) {
  const catalog  = _INDICATOR_CATALOG.filter(c => c.section === section);
  const saved    = S.indicatorCards[section] || [];
  const savedMap = Object.fromEntries(saved.map(c => [c.id, c]));
  return catalog
    .map((def, idx) => {
      const s = savedMap[def.id];
      return { ...def, visible: s ? s.visible : def.defaultVisible, order: s?.order ?? idx };
    })
    .sort((a, b) => a.order - b.order);
}

function _renderCardValue(id, inc, prbs) {
  const curMonth = new Date().toISOString().slice(0, 7);
  const monthly  = inc?.monthly || [];
  const prev     = monthly.length >= 2 ? monthly[monthly.length - 2] : null;

  switch (id) {
    case 'inc_total': {
      const riskCls = S.incidentTarget !== null
        ? ((inc?.total ?? 0) > S.incidentTarget * 1.2 ? 'red' : (inc?.total ?? 0) > S.incidentTarget ? 'yellow' : '')
        : '';
      const sub = S.incidentTarget !== null ? `Target: ${S.incidentTarget}` : t('rpt_sub_no_target');
      return { val: `${inc?.total ?? 0} ${_deltaHtml(inc?.total ?? 0, prev?.opened, true)}`, label: t('rpt_ind_inc_total'), sub, cls: riskCls };
    }
    case 'inc_closed': {
      const closedCls = (inc?.closedThisMonth ?? 0) >= (inc?.total ?? 0) * 0.9 && (inc?.total ?? 0) > 0 ? 'green' : '';
      return { val: `${inc?.closedThisMonth ?? 0} ${_deltaHtml(inc?.closedThisMonth ?? 0, prev?.closed, false)}`, label: t('rpt_ind_inc_closed'), sub: t('rpt_sub_resolved_period'), cls: closedCls };
    }
    case 'inc_backlog': {
      const backlogCls = (inc?.openBacklog ?? 0) > 30 ? 'red' : (inc?.openBacklog ?? 0) > 15 ? 'yellow' : 'green';
      return { val: String(inc?.openBacklog ?? 0), label: t('rpt_ind_inc_backlog'), sub: t('rpt_sub_click_list'), cls: backlogCls, clickable: true, onclick: 'reportOpenIncidentsModal()' };
    }
    case 'inc_mttr': {
      const avgCls = (inc?.avgResolutionDays ?? 0) > 5 ? 'red' : (inc?.avgResolutionDays ?? 0) > 2 ? 'yellow' : 'green';
      return { val: `${inc?.avgResolutionDays ?? 0}d`, label: t('rpt_ind_inc_mttr'), sub: t('rpt_sub_avg_days'), cls: avgCls };
    }
    case 'inc_p1': {
      const cls = (inc?.byPriority?.p1 ?? 0) > 0 ? 'red' : 'green';
      const subHtml = S.slaEnabled ? _slaBadge(inc?.slaByPriority?.p1) : `<div class="report-prb-card-sub">${t('rpt_sub_max_priority')}</div>`;
      return { val: String(inc?.byPriority?.p1 ?? 0), label: t('rpt_ind_inc_p1'), subHtml, cls };
    }
    case 'inc_p2': {
      const cls = (inc?.byPriority?.p2 ?? 0) > 3 ? 'yellow' : '';
      const subHtml = S.slaEnabled ? _slaBadge(inc?.slaByPriority?.p2) : `<div class="report-prb-card-sub">${t('rpt_sub_high_priority')}</div>`;
      return { val: String(inc?.byPriority?.p2 ?? 0), label: t('rpt_ind_inc_p2'), subHtml, cls };
    }
    case 'inc_p3': {
      const subHtml = S.slaEnabled ? _slaBadge(inc?.slaByPriority?.p3) : `<div class="report-prb-card-sub">${t('rpt_sub_medium_priority')}</div>`;
      return { val: String(inc?.byPriority?.p3 ?? 0), label: t('rpt_ind_inc_p3'), subHtml, cls: '' };
    }
    case 'inc_target': {
      if (S.incidentTarget === null) {
        return { val: '<span style="font-size:20px;line-height:1;opacity:.55">&#9881;</span>', label: t('rpt_ind_inc_target'), sub: t('rpt_sub_click_configure'), cls: '', clickable: true, onclick: 'reportOpenTargetModal()' };
      }
      const pct = S.incidentTarget > 0 ? Math.round((inc?.total ?? 0) / S.incidentTarget * 100) : null;
      return { val: pct !== null ? `${pct}%` : '—', label: t('rpt_ind_inc_target'), sub: pct !== null ? (pct > 100 ? t('rpt_sub_above_target') : t('rpt_sub_within_target')) : t('rpt_sub_no_target'), cls: pct !== null && pct > 100 ? 'red' : '' };
    }
    case 'inc_mttr_p1': {
      const v = inc?.mttrByPriority?.p1 ?? null;
      return { val: v !== null ? `${v}h` : '—', label: t('rpt_ind_inc_mttr_p1'), sub: t('rpt_sub_goal_2h'), cls: v === null ? '' : v > 4 ? 'red' : v > 2 ? 'yellow' : 'green' };
    }
    case 'inc_mttr_p2': {
      const v = inc?.mttrByPriority?.p2 ?? null;
      return { val: v !== null ? `${v}h` : '—', label: t('rpt_ind_inc_mttr_p2'), sub: t('rpt_sub_goal_8h'), cls: v === null ? '' : v > 12 ? 'red' : v > 8 ? 'yellow' : 'green' };
    }
    case 'inc_reopen': {
      const v = inc?.reopenRate ?? null;
      return { val: v !== null ? `${v}%` : '—', label: t('rpt_ind_inc_reopen'), sub: t('rpt_sub_goal_5pct'), cls: v === null ? '' : v > 8 ? 'red' : v > 4 ? 'yellow' : 'green' };
    }
    case 'prb_opened': {
      const cls = (prbs?.openedThisMonth || 0) > 5 ? 'red' : (prbs?.openedThisMonth || 0) > 0 ? 'yellow' : 'green';
      return { val: String(prbs?.openedThisMonth ?? 0), label: t('rpt_ind_prb_opened'), sub: t('rpt_sub_new_period'), cls };
    }
    case 'prb_resolved':
      return { val: String(prbs?.resolvedThisMonth ?? 0), label: t('rpt_ind_prb_resolved'), sub: t('rpt_sub_in_period'), cls: (prbs?.resolvedThisMonth || 0) > 0 ? 'green' : '' };
    case 'prb_backlog': {
      const cls = (prbs?.open ?? 0) > 10 ? 'red' : (prbs?.open ?? 0) > 3 ? 'yellow' : 'green';
      return { val: String(prbs?.open ?? 0), label: t('rpt_ind_prb_backlog'), sub: t('rpt_sub_total_open'), cls };
    }
    case 'prb_mttr': {
      const cls = (prbs?.avgResolutionDays || 0) > 30 ? 'red' : (prbs?.avgResolutionDays || 0) > 14 ? 'yellow' : 'green';
      return { val: `${prbs?.avgResolutionDays ?? 0}d`, label: t('rpt_ind_prb_mttr'), sub: t('rpt_sub_avg_days'), cls };
    }
    case 'prb_ke': {
      const v = prbs?.knownErrorCount ?? null;
      return { val: v !== null ? String(v) : '—', label: t('rpt_ind_prb_ke'), sub: `${prbs?.knownErrorPct ?? '—'}${t('rpt_sub_pct_backlog')}`, cls: v === null ? '' : v > 5 ? 'yellow' : 'green' };
    }
    case 'prb_wa': {
      const v = prbs?.withWorkaroundPct ?? null;
      return { val: v !== null ? `${v}%` : '—', label: t('rpt_ind_prb_wa'), sub: `${prbs?.withWorkaroundCount ?? '—'} PRBs`, cls: v === null ? '' : v < 50 ? 'red' : v < 80 ? 'yellow' : 'green' };
    }
    case 'prb_rca': {
      const v = prbs?.withRcaPct ?? null;
      return { val: v !== null ? `${v}%` : '—', label: t('rpt_ind_prb_rca'), sub: `${prbs?.withRcaCount ?? '—'} de ${prbs?.open ?? '—'}`, cls: v === null ? '' : v < 60 ? 'red' : v < 80 ? 'yellow' : 'green' };
    }
    default: return null;
  }
}

function _renderIndicatorCards(section, inc, prbs) {
  const cards   = _getResolvedCards(section);
  const visible = cards.filter(c => c.visible);
  if (!visible.length) return '';
  const perRow  = S.indicatorCardsPerRow[section] || 4;
  const html    = visible.map(c => {
    const d = _renderCardValue(c.id, inc, prbs);
    if (!d) return '';
    const inner = `<div class="report-prb-card-val ${d.cls || ''}">${d.val}</div>
      <div class="report-prb-card-label">${_esc(d.label)}</div>
      ${d.subHtml || `<div class="report-prb-card-sub">${_esc(d.sub || '')}</div>`}`;
    return d.clickable
      ? `<div class="report-prb-card report-prb-card--clickable" onclick="${d.onclick}" title="Ver lista">${inner}</div>`
      : `<div class="report-prb-card">${inner}</div>`;
  }).join('');
  return `<div class="report-prb-cards" style="grid-template-columns:repeat(${perRow},1fr)">${html}</div>`;
}

function _renderIndicatorConfigPanel(section) {
  const cards  = _getResolvedCards(section);
  const perRow = S.indicatorCardsPerRow[section] || 4;
  const label  = section === 'incidents' ? 'Incidents' : 'PRBs';
  const items  = cards.map(c => `
    <div class="report-ind-cfg-item"
      draggable="true"
      ondragstart="reportIndDragStart(event,'${section}','${_esc(c.id)}')"
      ondragover="reportIndDragOver(event)"
      ondragleave="reportIndDragLeave(event)"
      ondrop="reportIndDrop(event,'${section}','${_esc(c.id)}')"
      ondragend="reportIndDragEnd()">
      <span class="report-drag-handle" aria-hidden="true"><svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" style="opacity:0.45;vertical-align:middle"><circle cx="3" cy="2" r="1.5"/><circle cx="7" cy="2" r="1.5"/><circle cx="3" cy="7" r="1.5"/><circle cx="7" cy="7" r="1.5"/><circle cx="3" cy="12" r="1.5"/><circle cx="7" cy="12" r="1.5"/></svg></span>
      <label class="report-ind-cfg-label">
        <input type="checkbox" ${c.visible ? 'checked' : ''} onchange="reportToggleIndicator('${section}','${_esc(c.id)}')">
        <span class="report-ind-cfg-name">${_esc(c.label)}</span>
      </label>
      <span class="report-ind-cfg-desc">${_esc(c.desc)}</span>
    </div>`).join('');
  const perRowBtns = [2, 3, 4, 6, 8].map(n =>
    `<button class="report-ind-cfg-perrow-btn${perRow === n ? ' active' : ''}" onclick="reportSetCardsPerRow('${section}',${n})">${n}</button>`
  ).join('');
  return `<div class="report-ind-cfg-panel">
    <div class="report-ind-cfg-header">
      <span class="report-ind-cfg-title">Indicadores — ${_esc(label)}</span>
      <div class="report-ind-cfg-perrow"><span>Por linha:</span>${perRowBtns}</div>
      <button class="report-ind-cfg-close" onclick="reportCloseIndicatorConfig()">&#10005;</button>
    </div>
    <div class="report-ind-cfg-list">${items}</div>
  </div>`;
}

function _renderPRBs(prbs, incidents) {
  if (!prbs) return '';

  return `<div class="report-section" data-section="prbs">
    <div class="report-section-header-row">
      <div class="report-section-title">${t('rpt_section_prbs')}</div>
      <div class="report-field-chart-actions">
        <button class="report-field-picker-btn" title="${t('rpt_cfg_indicators')}" onclick="reportOpenIndicatorConfig('prbs')" draggable="false">&#9881;</button>
      </div>
    </div>
    ${S.indConfigSection === 'prbs' ? _renderIndicatorConfigPanel('prbs') : ''}
    ${_renderIndicatorCards('prbs', null, prbs)}
    <div class="report-donuts-grid">
      ${S.prbCharts.map((chart, idx) => _renderPrbChartCell(chart, idx, prbs)).join('')}
      <div class="report-add-chart-section" style="flex-basis:100%">
        <button class="report-add-chart-btn" onclick="reportAddPrbChart()">+ ${t('rpt_add_chart')}</button>
      </div>
    </div>
  </div>`;
}

function _buildHTML(payload) {
  const { metadata, hasSn, hasAzure, delivery, quality, incidents, prbs, prevDelivery, prevQuality } = payload;

  // Cache age indicator
  const ageMs  = metadata.generatedAtTs ? Date.now() - metadata.generatedAtTs : 0;
  const ageH   = Math.floor(ageMs / 3600000);
  const ageMin = Math.floor((ageMs % 3600000) / 60000);
  const ageCls = ageH >= 5 ? 'red' : ageH >= 3 ? 'yellow' : 'green';
  const ageStr = ageMs > 0
    ? (ageH > 0 ? `${ageH}h${ageMin > 0 ? ` ${ageMin}min` : ''} atrás` : ageMin > 0 ? `${ageMin}min atrás` : 'agora mesmo')
    : '';

  const snWarning = !hasSn && hasAzure
    ? `<div class="report-sn-notice">
        <span>Service Now não configurado para este projeto. Exibindo apenas dados do Azure DevOps.</span>
        <button class="report-sn-notice-btn" onclick="openReportSnConfig()">Configurar</button>
       </div>`
    : '';

  const savedNotes = localStorage.getItem(`reportNotes::${S.reportProject}::${S.reportMonth}`) || '';
  const notesBar = `<div class="report-notes-bar">
    <textarea class="report-notes-input" placeholder="${t('rpt_notes_placeholder')}" onchange="reportSaveNotes(this.value)">${_esc(savedNotes)}</textarea>
    <button class="report-print-btn" onclick="exportReportHtml()" title="${t('rpt_export_html')}">
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M13 10v3a1 1 0 01-1 1H4a1 1 0 01-1-1v-3"/><polyline points="10 6 8 8 6 6"/><line x1="8" y1="8" x2="8" y2="2"/></svg>
      ${t('rpt_export_html')}</button>
  </div>`;

  const _af = S.activeSectionFilter;
  const filterBar = `<div class="report-filter-bar">
    ${hasAzure ? `<button class="report-filter-btn${_af === 'sprint' ? ' report-filter-btn--active' : ''}" data-filter="sprint" onclick="reportSetSectionFilter('sprint')">${t('rpt_filter_azure')}</button>` : ''}
    <button class="report-filter-btn${_af === 'incidents' ? ' report-filter-btn--active' : ''}" data-filter="incidents" onclick="reportSetSectionFilter('incidents')">${t('rpt_filter_incidents')}</button>
    <button class="report-filter-btn${_af === 'prbs' ? ' report-filter-btn--active' : ''}" data-filter="prbs" onclick="reportSetSectionFilter('prbs')">${t('rpt_filter_prbs')}</button>
    <button class="report-filter-btn${_af === 'all' ? ' report-filter-btn--active' : ''}" data-filter="all" onclick="reportSetSectionFilter('all')">${t('rpt_filter_all')}</button>
  </div>`;

  const sectionFilterAttr = S.activeSectionFilter !== 'all' ? ` data-section-filter="${S.activeSectionFilter}"` : '';

  return `
    <div class="report-content"${sectionFilterAttr}>
      <div class="report-header-card">
        <div class="report-header-title">${_esc(metadata.project)}</div>
        <div class="report-header-period">${_esc(metadata.period)}</div>
        <div class="report-header-gen">
          Coletado: ${_esc(metadata.generatedAt)}
          ${ageStr ? `<span class="report-age-badge report-age-badge--${ageCls}">${ageStr}</span>` : ''}
        </div>
      </div>
      ${snWarning}
      ${notesBar}
      ${filterBar}
      ${hasAzure ? _renderDelivery(delivery, quality, incidents, prevDelivery, prevQuality) : ''}
      ${incidents ? _renderIncidents(incidents) : ''}
      ${prbs      ? _renderPRBs(prbs, incidents) : ''}
    </div>
  `;
}

function _populateMonths(months, selected) {
  const sel = document.getElementById('report-month-sel');
  if (!sel) return;
  sel.innerHTML = months.map(m => {
    const [y, mo] = m.split('-');
    const label = new Date(+y, +mo - 1, 1).toLocaleString('pt-BR', { month: 'short', year: 'numeric' });
    return `<option value="${m}"${m === selected ? ' selected' : ''}>${label}</option>`;
  }).join('');
}

// ── Public API ────────────────────────────────────────────────────────────────

initPickerCallbacks({ saveConfig: _saveReportConfig, rerender: _rerender, load: (refresh) => _load(refresh, true) });

export async function openReport(btn) {
  const card = btn.closest('[data-project]');
  S.reportProject = card ? card.dataset.project : '';
  S.reportMonth   = null;
  await _loadReportConfig();

  document.getElementById('report-modal-title').textContent = S.reportProject;
  const modal = document.getElementById('report-modal');
  modal.classList.add('open', 'maximized');
  document.getElementById('report-modal-max').textContent = '\u2921';
  document.body.style.overflow = 'hidden';
  _load(true);
}

export function closeReport() {
  const modal = document.getElementById('report-modal');
  modal.classList.remove('open', 'maximized');
  document.getElementById('report-modal-max').textContent = '\u2922';
  document.body.style.overflow = '';
}

export function reportSaveNotes(value) {
  const key = `reportNotes::${S.reportProject}::${S.reportMonth}`;
  if (value && value.trim()) localStorage.setItem(key, value);
  else localStorage.removeItem(key);
}

export function reportSetSectionFilter(filter) {
  S.activeSectionFilter = filter;
  const wrap = document.getElementById('report-modal-body') || document.getElementById('report-content');
  if (!wrap) return;
  const content = wrap.querySelector('.report-content') || wrap;
  if (filter === 'all') content.removeAttribute('data-section-filter');
  else content.dataset.sectionFilter = filter;
  wrap.querySelectorAll('.report-filter-btn').forEach(b => {
    b.classList.toggle('report-filter-btn--active', b.dataset.filter === filter);
  });
}

export function openReportSnConfig() {
  window.openSnConfig?.(S.reportProject);
}

export function closeReportOverlay(event) {
  if (event.target === document.getElementById('report-modal')) closeReport();
}

export function toggleReportMax() {
  const modal = document.getElementById('report-modal');
  const btn   = document.getElementById('report-modal-max');
  const isMax = modal.classList.toggle('maximized');
  btn.textContent = isMax ? '\u2921' : '\u2922';
}

export function reportChangeMonth(month) {
  S.reportMonth = month;
  _load();
}

export function reportRefresh() {
  _load(true);
}

// ── Indicator config panel ─────────────────────────────────────────────────────

export function reportOpenIndicatorConfig(section) {
  S.indConfigSection = section;
  _rerender();
}

export function reportCloseIndicatorConfig() {
  S.indConfigSection = null;
  _rerender();
}

export function reportToggleIndicator(section, id) {
  const cards = _getResolvedCards(section);
  S.indicatorCards[section] = cards.map(c => ({ id: c.id, visible: c.id === id ? !c.visible : c.visible, order: c.order }));
  _saveReportConfig();
  _rerender();
}

export function reportSetCardsPerRow(section, n) {
  S.indicatorCardsPerRow = { ...S.indicatorCardsPerRow, [section]: n };
  _saveReportConfig();
  _rerender();
}

export function reportIndDragStart(event, section, id) {
  S.indDragSrcId      = id;
  S.indDragSrcSection = section;
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
}

export function reportIndDragOver(event) {
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  event.currentTarget.classList.add('report-ind-cfg-dragover');
}

export function reportIndDragLeave(event) {
  event.currentTarget.classList.remove('report-ind-cfg-dragover');
}

export function reportIndDrop(event, section, targetId) {
  event.preventDefault();
  event.currentTarget.classList.remove('report-ind-cfg-dragover');
  if (S.indDragSrcId === targetId || S.indDragSrcSection !== section) return;
  const cards  = _getResolvedCards(section);
  const srcIdx = cards.findIndex(c => c.id === S.indDragSrcId);
  const tgtIdx = cards.findIndex(c => c.id === targetId);
  if (srcIdx < 0 || tgtIdx < 0) return;
  const reordered = [...cards];
  const [moved]   = reordered.splice(srcIdx, 1);
  reordered.splice(tgtIdx, 0, moved);
  S.indicatorCards[section] = reordered.map((c, i) => ({ id: c.id, visible: c.visible, order: i }));
  _saveReportConfig();
  _rerender();
}

export function reportIndDragEnd() {
  S.indDragSrcId      = null;
  S.indDragSrcSection = null;
}

// ── Copilot integration ────────────────────────────────────────────────────────

function _buildReportContext(payload) {
  const { metadata, delivery, quality, incidents, prbs } = payload;

  const ctx = {
    fonte:    'Monthly Review Report',
    projeto:  metadata?.project,
    periodo:  metadata?.period,
    geradoEm: metadata?.generatedAt,
  };

  if (delivery) {
    const rate = delivery.totalUS > 0
      ? Math.round(delivery.totalDelivered / delivery.totalUS * 100) + '%'
      : 'N/A';
    ctx.entrega = {
      userStoriesNoPeriodo:  delivery.totalUS,
      entregues:             delivery.totalDelivered,
      taxaEntrega:           rate,
      storyPoints:           delivery.totalSP           ?? null,
      storyPointsEntregues:  delivery.totalSPDelivered  ?? null,
      sprints: (delivery.sprints || []).map(s => ({
        nome:             s.name,
        entregues:        s.delivered,
        pontos:           s.points,
        pontosEntregues:  s.pointsDelivered,
      })),
    };
  }

  if (quality) {
    ctx.qualidade = {
      bugsAbertos:  quality.bugsOpen,
      bugsNovos:    quality.bugsNew,
      bugsFechados: quality.bugsClosed,
    };
  }

  if (incidents) {
    ctx.incidentes = {
      totalNoPeriodo:     incidents.total,
      target:             S.incidentTarget > 0 ? S.incidentTarget : null,
      vsTarget:           S.incidentTarget > 0
        ? (incidents.total > S.incidentTarget
            ? `+${incidents.total - S.incidentTarget} acima do target`
            : `${S.incidentTarget - incidents.total} abaixo do target`)
        : null,
      backlogAtual:         incidents.openBacklog,
      mediaResolucaoDias:   incidents.avgResolutionDays,
      porPrioridade:        incidents.byPriority,
      sla: incidents.slaEnabled ? {
        p1_pct: incidents.slaByPriority?.p1?.pct ?? null,
        p2_pct: incidents.slaByPriority?.p2?.pct ?? null,
        p3_pct: incidents.slaByPriority?.p3?.pct ?? null,
      } : null,
      topSistemas: (incidents.bySystem || []).slice(0, 5).map(s => ({
        sistema: s.name, total: s.total, p1: s.p1, p2: s.p2,
      })),
      tendenciaMensal: (incidents.monthly || []).slice(-6).map(m => ({
        mes:        m.label,
        abertos:    m.opened,
        fechados:   m.closed,
        cancelados: m.cancelled || 0,
        backlog:    m.openBacklog ?? null,
      })),
    };
  }

  if (prbs) {
    ctx.problemas = {
      abertos:             prbs.open,
      abertosNoPeriodo:    prbs.openedThisMonth,
      resolvidosNoPeriodo: prbs.resolvedThisMonth,
      delta:               prbs.delta,
      mediaIdadeDias:      prbs.avgAging,
      lista: (prbs.list || []).slice(0, 10).map(p => ({
        id:        p.id,
        titulo:    p.title,
        prioridade: p.priority,
        idadeDias: p.agingDays,
        estado:    p.state,
      })),
    };
  }

  const systemPrompt =
    `Você é um analista sênior de operações de TI. Os dados abaixo são do Service Delivery Report do projeto "${ctx.projeto}" referente ao período "${ctx.periodo}". ` +
    `Com base nesses dados, ajude a identificar riscos, tendências negativas e ações concretas a serem tomadas. ` +
    `Seja objetivo, prático e responda sempre em português.`;

  return `${systemPrompt}\n\n${JSON.stringify(ctx, null, 2)}`;
}

export async function reportOpenCopilot() {
  if (!S.lastPayload) return;
  const contextStr = _buildReportContext(S.lastPayload);
  await openCopilotWithContext(contextStr);
}

export function reportAddChart() {
  reportOpenFieldPicker(-1);
}

export function reportRemoveChart(idx) {
  S.reportCharts.splice(idx, 1);
  _saveReportConfig();
  _rerender();
}

export function reportResizeChart(idx, size) {
  S.reportCharts[idx] = { ...S.reportCharts[idx], size };
  _saveReportConfig();
  _rerender();
}

export function reportDragStart(e, idx)    { _chartDrag.start(e, idx); }
export function reportDragOver(e)          { _chartDrag.over(e); }
export function reportDragLeave(e)         { _chartDrag.leave(e); }
export function reportDrop(e, targetIdx)   { _chartDrag.drop(e, targetIdx); }
export function reportDragEnd(e)           { _chartDrag.end(e); }

// ── Incident chart drag / remove / add ────────────────────────────────────────

export function reportRemoveIncChart(idx) {
  S.incidentCharts.splice(idx, 1);
  _saveReportConfig();
  _rerender();
}

export function reportIncChartDragStart(e, idx)  { _incChartDrag.start(e, idx); }
export function reportIncChartDragOver(e)        { _incChartDrag.over(e); }
export function reportIncChartDragLeave(e)       { _incChartDrag.leave(e); }
export function reportIncChartDrop(e, targetIdx) { _incChartDrag.drop(e, targetIdx); }
export function reportIncChartDragEnd(e)         { _incChartDrag.end(e); }

export function reportAddIncChart() {
  reportOpenIncChartPicker(-1);
}

// ── PRB chart drag / remove / add ─────────────────────────────────────────────

export function reportRemovePrbChart(idx) {
  S.prbCharts.splice(idx, 1);
  _saveReportConfig();
  _rerender();
}

export function reportPrbChartDragStart(e, idx)  { _prbChartDrag.start(e, idx); }
export function reportPrbChartDragOver(e)        { _prbChartDrag.over(e); }
export function reportPrbChartDragLeave(e)       { _prbChartDrag.leave(e); }
export function reportPrbChartDrop(e, targetIdx) { _prbChartDrag.drop(e, targetIdx); }
export function reportPrbChartDragEnd(e)         { _prbChartDrag.end(e); }

export function reportAddPrbChart() {
  reportOpenPrbChartPicker(-1);
}

function _rerender() {
  if (!S.lastPayload) { _load(true, true); return; }
  const body = document.getElementById('report-modal-body');
  if (body) {
    const top = body.scrollTop;
    body.innerHTML = _buildHTML(S.lastPayload);
    body.scrollTop = top;
  }
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (document.getElementById('report-inc-modal-overlay')) { reportCloseIncidentsModal(); return; }
    if (document.getElementById('report-modal')?.classList.contains('open')) closeReport();
  }
});

async function _load(refresh = false, preserveScroll = false) {
  S.activeSectionFilter = 'all';
  const body       = document.getElementById('report-modal-body');
  const refreshBtn = document.getElementById('report-refresh-btn');
  const savedScroll = preserveScroll ? (body?.scrollTop ?? 0) : 0;
  body.innerHTML = '<div class="report-loading">Loading...</div>';
  if (refreshBtn) refreshBtn.disabled = true;

  // Extract unique field refs from donut charts only
  const donutRefs = [...new Set(S.reportCharts.filter(c => c.type === 'donut').map(c => c.ref))];

  const q = new URLSearchParams({ project: S.reportProject });
  if (S.reportMonth) q.set('month', S.reportMonth);
  if (refresh)      q.set('refresh', '1');
  q.set('groupFields', donutRefs.join(','));
  q.set('agingState', S.agingState);
  const _allMonths = [
    S.incidentMonths, S.prbMonths,
    ...S.incidentCharts.map(c => c.months || 0),
    ...S.prbCharts.map(c => c.months || 0),
  ];
  q.set('incidentMonths', String(Math.max(..._allMonths)));
  q.set('deliveryStates', S.deliveryStates.join(','));

  try {
    const r = await fetch('/api/report?' + q);
    if (!r.ok) { const errBody = await r.json().catch(() => ({})); throw new Error(errBody.error || `HTTP ${r.status}`); }
    const data = await r.json();
    S.lastPayload = data.payload;
    S.reportMonth = data.month;
    _populateMonths(data.months, data.month);
    body.innerHTML = _buildHTML(data.payload);
    if (preserveScroll && savedScroll) body.scrollTop = savedScroll;
  } catch (e) {
    body.innerHTML = `<div class="report-error">Error: ${_esc(e.message)}</div>`;
  } finally {
    if (refreshBtn) refreshBtn.disabled = false;
  }
}

// ── Monthly Review — modal ES module ─────────────────────────────────────────
import { openCopilotWithContext } from './copilot.js';
import { t } from './i18n.js';

let _reportProject   = null;
let _reportMonth     = null;
let _reportCharts    = []; // [{type:'sprint'|'volatility'|'donut'|'incidents', size:'sm'|'md'|'lg', ref?:'', label?:'', chartStyle?:'donut'|'bar'|'bar-vertical', barColor?:'', months?:number}]
let _agingState      = 'In Review'; // estado monitorado nos gráficos de aging (compartilhado)
let _agingCharts     = [{ size: 'md' }, { size: 'md' }]; // tamanho por gráfico de aging
let _incidentMonths  = 5;        // months to show in the incidents section
let _incidentTarget  = null;     // target mensal de incidentes (null = não configurado)
let _incidentGroupBy = 'cmdb_ci'; // 'cmdb_ci' | 'resolution_code'
let _heatmapMax      = 0;        // 0 = escala automática (relativa ao max dos dados)
let _heatmapTopN     = 9;        // 0 = mostrar todos; N = top N + "Outros"
let _locationMonths  = 6;        // 1 | 3 | 6 — meses exibidos no gráfico de location
let _agingBuckets    = [7, 14, 30, 60]; // thresholds for US aging buckets (days)
let _deliveryStates  = ['Closed', 'Done', 'Resolved']; // states counted as delivered
let _slaEnabled      = false;
let _slaThresholds   = { p1: 4, p2: 8, p3: 72 };
let _slaTargets      = { p1: 95, p2: 90, p3: 85 };
let _pickerIdx       = -1; // -1 = add new, >=0 = edit existing chart
let _lastPayload       = null;
let _dragSrcIdx        = -1;
let _activeSectionFilter = 'all';
let _indicatorCards       = {};   // { incidents: [{id,visible,order}], prbs: [...] }
let _indicatorCardsPerRow = {};   // { incidents: 4, prbs: 4 }
let _indConfigSection     = null; // section with open config panel ('incidents'|'prbs'|null)
let _indDragSrcId         = null;
let _indDragSrcSection    = null;
let _incidentCharts  = [];  // [{type:'inc-volume'|'inc-bars'|'inc-heatmap'|'inc-location'|'inc-priority-trend'|'inc-sla-bars', size:'sm'|'md'|'lg'}]
let _prbCharts       = [];  // [{type:'prb-evolution'|'prb-donut'|'prb-aging'|'prb-oldest'|'prb-category', size:'sm'|'md'|'lg'}]
let _incPickerIdx    = -1;  // -1 = add new, >=0 = edit existing incident chart
let _prbPickerIdx    = -1;  // -1 = add new, >=0 = edit existing PRB chart
let _incChartDragIdx = -1;
let _prbChartDragIdx = -1;

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

const _PRB_STATES = {
  '101': { label: 'New',                 color: '#0d9488' },
  '102': { label: 'Assess',              color: '#f97316' },
  '103': { label: 'Root Cause Analysis', color: '#eab308' },
  '104': { label: 'Fix in Progress',     color: '#3b82f6' },
  '106': { label: 'Resolved',            color: '#8b5cf6' },
  '107': { label: 'Closed',              color: '#374151' },
};

async function _loadReportConfig() {
  let charts    = null;
  let needsSave = false;

  // Reset state so trocar de projeto não carrega dados do projeto anterior
  _indicatorCards        = {};
  _indicatorCardsPerRow  = {};
  _incidentCharts = [];
  _prbCharts      = [];
  _slaTargets     = { p1: 95, p2: 90, p3: 85 };

  // 0. Load SLA config from sn-config (parallel, non-blocking)
  fetch('/api/sn-config?' + new URLSearchParams({ project: _reportProject }))
    .then(r => r.json())
    .then(d => {
      _slaEnabled    = d.slaEnabled    === true;
      _slaThresholds = d.slaThresholds || { p1: 4, p2: 8, p3: 72 };
    })
    .catch(() => {});

  // 1. Try server (config.json) — prefer new format, migrate old format
  try {
    const r    = await fetch('/api/report-config?' + new URLSearchParams({ project: _reportProject }));
    const data = await r.json();
    if (data.incidentMonths)          _incidentMonths  = data.incidentMonths;
    if (data.incidentGroupBy)         _incidentGroupBy = data.incidentGroupBy;
    if (data.incidentTarget != null)  _incidentTarget  = data.incidentTarget;
    if (data.heatmapMax     != null)  _heatmapMax      = data.heatmapMax;
    if (data.heatmapTopN    != null)  _heatmapTopN     = data.heatmapTopN;
    if (data.locationMonths != null)  _locationMonths  = data.locationMonths;
    if (Array.isArray(data.agingBuckets) && data.agingBuckets.length === 4) _agingBuckets = data.agingBuckets;
    if (Array.isArray(data.deliveryStates) && data.deliveryStates.length)  _deliveryStates = data.deliveryStates;
    if (data.agingState)              _agingState      = data.agingState;
    if (data.agingCharts?.length) _agingCharts    = data.agingCharts;
    if (data.indicatorCards       != null) _indicatorCards       = data.indicatorCards;
    if (data.indicatorCardsPerRow != null) _indicatorCardsPerRow = data.indicatorCardsPerRow;
    if (Array.isArray(data.incidentCharts) && data.incidentCharts.length) _incidentCharts = data.incidentCharts;
    if (Array.isArray(data.prbCharts)      && data.prbCharts.length)      _prbCharts      = data.prbCharts;
    if (data.slaTargets != null && typeof data.slaTargets === 'object') _slaTargets = { p1: 95, p2: 90, p3: 85, ...data.slaTargets };
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
      const saved = localStorage.getItem('reportGroupFields::' + _reportProject);
      if (saved) {
        const old = JSON.parse(saved);
        charts = [
          { type: 'sprint',     size: 'lg' },
          { type: 'volatility', size: 'md' },
          ...old.map(f => ({ type: 'donut', size: f.size || 'md', ref: f.ref || '', label: f.label || 'Tipo de Item' })),
        ];
        localStorage.removeItem('reportGroupFields::' + _reportProject);
        needsSave = true;
      }
    } catch (_) {}
  }

  // 3. Default — marcar needsSave quando novos campos precisam ser inicializados
  _reportCharts = charts || _DEFAULT_CHARTS.map(c => ({ ...c }));
  if (!_incidentCharts.length) { _incidentCharts = _DEFAULT_INCIDENT_CHARTS.map(c => ({ ...c })); needsSave = true; }
  if (!_prbCharts.length)      { _prbCharts      = _DEFAULT_PRB_CHARTS.map(c => ({ ...c }));      needsSave = true; }
  if (!charts || needsSave) _saveReportConfig(); // persist to config.json
}

function _saveReportConfig() {
  fetch('/api/report-config', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ project: _reportProject, reportCharts: _reportCharts, incidentMonths: _incidentMonths, incidentTarget: _incidentTarget, incidentGroupBy: _incidentGroupBy, heatmapMax: _heatmapMax, heatmapTopN: _heatmapTopN, locationMonths: _locationMonths, agingState: _agingState, agingCharts: _agingCharts, agingBuckets: _agingBuckets, deliveryStates: _deliveryStates, indicatorCards: _indicatorCards, indicatorCardsPerRow: _indicatorCardsPerRow, incidentCharts: _incidentCharts, prbCharts: _prbCharts, slaTargets: _slaTargets }),
  })
  .then(r => r.json())
  .then(d => { if (!d.ok) console.error('[report] save failed:', d); })
  .catch(e => console.error('[report] save error:', e));
}

function _esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function _metric(label, value, sub, colorClass) {
  return `<div class="report-metric">
    <div class="report-metric-val${colorClass ? ' ' + colorClass : ''}">${value}</div>
    <div class="report-metric-label">${label}</div>
    ${sub ? `<div class="report-metric-sub">${sub}</div>` : ''}
  </div>`;
}

// ── Bar chart (CSS div-based, zero deps) ─────────────────────────────────────

function _barChart(items, maxVal) {
  const max = maxVal || Math.max(...items.map(i => i.value), 1);
  return '<div class="report-bar-chart">'
    + items.map(item => {
      const pct = Math.round((item.value / max) * 100);
      return `<div class="report-bar-row">
        <div class="report-bar-label">${_esc(item.label)}</div>
        <div class="report-bar-track">
          <div class="report-bar-fill${item.cls ? ' ' + item.cls : ''}" style="width:${pct}%"></div>
          <span class="report-bar-val">${item.value}</span>
        </div>
      </div>`;
    }).join('')
    + '</div>';
}

// ── SVG Charts (zero deps) ────────────────────────────────────────────────────

// Renders a centered HTML legend row below a chart.
// items: [{ type: 'rect'|'line', color, label, dashed?, dot? }]
function _legendHtml(items) {
  if (!items || !items.length) return '';
  const parts = items.map(({ type, color, label, dashed, dot }) => {
    let icon;
    if (type === 'line') {
      const dd    = dashed ? ' stroke-dasharray="4,3"' : '';
      const dotEl = dot    ? `<circle cx="9" cy="6" r="2.5" fill="${color}"/>` : '';
      icon = `<svg width="18" height="12" style="flex-shrink:0;overflow:visible"><line x1="1" y1="6" x2="17" y2="6" stroke="${color}" stroke-width="1.5"${dd}/>${dotEl}</svg>`;
    } else {
      icon = `<span style="width:10px;height:10px;border-radius:2px;background:${color};display:inline-block;flex-shrink:0"></span>`;
    }
    return `<span style="display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--text-faint)">${icon}${_esc(label)}</span>`;
  });
  return `<div style="display:flex;justify-content:center;flex-wrap:wrap;gap:6px 16px;padding:8px 0 4px">${parts.join('')}</div>`;
}

// Converts "YYYY-MM" → "Mon/YY" (e.g. "2026-05" → "Mai/26")
function _fmtMonth(label) {
  const p = (label || '').split('-');
  if (p.length === 2) {
    try {
      const raw = new Date(+p[0], +p[1] - 1, 1).toLocaleString('pt-BR', { month: 'short' });
      return raw.charAt(0).toUpperCase() + raw.slice(1, 3).replace('.', '') + '/' + p[0].slice(2);
    } catch (_) {}
  }
  return label || '';
}

function _renderSprintChart(sprints) {
  if (!sprints.length) return `<div class="report-empty-hint">${t('rpt_chart_no_sprint')}</div>`;
  const W = 600, H = 184;
  const pad = { t: 20, r: 16, b: 20, l: 36 };
  const cW = W - pad.l - pad.r;
  const cH = H - pad.t - pad.b;

  const maxPts = Math.max(...sprints.map(s => s.points || 0), 1);
  const grpW   = cW / sprints.length;
  const barW   = Math.min(grpW * 0.32, 22);

  let rects = '', labels = '', lineCoords = '';

  sprints.forEach((s, idx) => {
    const cx      = pad.l + idx * grpW + grpW / 2;
    const planned = s.points || 0;
    const deliv   = s.pointsDelivered || 0;
    const pct     = planned > 0 ? deliv / planned : 0;

    const h1 = (planned / maxPts) * cH;
    const h2 = (deliv   / maxPts) * cH;
    const y1 = pad.t + cH - h1;
    const y2 = pad.t + cH - h2;

    rects += `<rect x="${(cx - barW - 2).toFixed(1)}" y="${y1.toFixed(1)}" width="${barW}" height="${h1.toFixed(1)}" fill="var(--c-blue)" opacity=".75" rx="2"/>`;
    rects += `<rect x="${(cx + 2).toFixed(1)}" y="${y2.toFixed(1)}" width="${barW}" height="${h2.toFixed(1)}" fill="var(--c-green)" opacity=".85" rx="2"/>`;
    if (planned > 0) rects += `<text x="${(cx - barW/2 - 2).toFixed(1)}" y="${(y1 - 4).toFixed(1)}" text-anchor="middle" font-size="9" fill="var(--c-blue)">${planned}</text>`;
    if (deliv   > 0) rects += `<text x="${(cx + barW/2 + 2).toFixed(1)}" y="${(y2 - 4).toFixed(1)}" text-anchor="middle" font-size="9" fill="var(--c-green)">${deliv}</text>`;

    const shortName = s.name.split(' ').pop();
    labels += `<text x="${cx.toFixed(1)}" y="${(H - pad.b + 14).toFixed(1)}" text-anchor="middle" font-size="9" fill="var(--text-faint)">${_esc(shortName)}</text>`;

    const lineY = pad.t + cH - pct * cH;
    lineCoords += `${cx.toFixed(1)},${lineY.toFixed(1)} `;
  });

  const axes  = `<line x1="${pad.l}" y1="${pad.t}" x2="${pad.l}" y2="${pad.t + cH}" stroke="var(--bg-border)" stroke-width="1"/>
    <line x1="${pad.l}" y1="${pad.t + cH}" x2="${W - pad.r}" y2="${pad.t + cH}" stroke="var(--bg-border)" stroke-width="1"/>`;
  const line  = lineCoords.trim()
    ? `<polyline points="${lineCoords.trim()}" fill="none" stroke="#f59e0b" stroke-width="2" stroke-dasharray="5,3" stroke-linecap="round"/>`
    : '';
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:${W}px;display:block" xmlns="http://www.w3.org/2000/svg">
      ${axes}${rects}${labels}${line}
    </svg>` + _legendHtml([
    { type: 'rect', color: 'var(--c-blue)',  get label() { return t('rpt_sp_planned'); } },
    { type: 'rect', color: 'var(--c-green)', get label() { return t('rpt_sp_delivered'); } },
    { type: 'line', color: '#f59e0b', get label() { return t('rpt_delivery_rate'); }, dashed: true },
  ]);
}

function _renderVolatilityChart(sprints) {
  if (!sprints.length) return `<div class="report-empty-hint">${t('rpt_chart_no_sprint')}</div>`;
  const W = 560, H = 164;
  const pad = { t: 20, r: 16, b: 20, l: 36 };
  const cW  = W - pad.l - pad.r;
  const cH  = H - pad.t - pad.b;
  const halfH = cH / 2;
  const midY  = pad.t + halfH;

  const maxAdded   = Math.max(...sprints.map(s => s.addedMidSprint    || 0), 0);
  const maxRemoved = Math.max(...sprints.map(s => s.removedFromSprint || 0), 0);
  const maxVal     = Math.max(maxAdded, maxRemoved, 1);

  const grpW = cW / sprints.length;
  const barW = Math.min(grpW * 0.45, 26);

  let bars = '', labels = '';
  sprints.forEach((s, idx) => {
    const cx      = pad.l + idx * grpW + grpW / 2;
    const added   = s.addedMidSprint    || 0;
    const removed = s.removedFromSprint || 0;

    if (added > 0) {
      const bH = (added / maxVal) * halfH;
      bars += `<rect x="${(cx - barW/2).toFixed(1)}" y="${(midY - bH).toFixed(1)}" width="${barW}" height="${bH.toFixed(1)}" fill="#f59e0b" opacity=".85" rx="2"/>`;
      bars += `<text x="${cx.toFixed(1)}" y="${(midY - bH - 4).toFixed(1)}" text-anchor="middle" font-size="9" fill="#f59e0b">+${added}</text>`;
    }
    if (removed > 0) {
      const bH = (removed / maxVal) * halfH;
      bars += `<rect x="${(cx - barW/2).toFixed(1)}" y="${midY.toFixed(1)}" width="${barW}" height="${bH.toFixed(1)}" fill="#ef4444" opacity=".75" rx="2"/>`;
      bars += `<text x="${cx.toFixed(1)}" y="${(midY + bH + 12).toFixed(1)}" text-anchor="middle" font-size="9" fill="#ef4444">-${removed}</text>`;
    }
    const shortName = s.name.split(' ').pop();
    labels += `<text x="${cx.toFixed(1)}" y="${(H - pad.b + 14).toFixed(1)}" text-anchor="middle" font-size="9" fill="var(--text-faint)">${_esc(shortName)}</text>`;
  });

  const axes = `<line x1="${pad.l}" y1="${pad.t}" x2="${pad.l}" y2="${pad.t + cH}" stroke="var(--bg-border)" stroke-width="1"/>
    <line x1="${pad.l}" y1="${midY.toFixed(1)}" x2="${W - pad.r}" y2="${midY.toFixed(1)}" stroke="var(--bg-border)" stroke-width="1"/>`;

  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:${W}px;display:block" xmlns="http://www.w3.org/2000/svg">
      ${axes}${bars}${labels}
    </svg>` + _legendHtml([
    { type: 'rect', color: '#f59e0b', get label() { return t('rpt_volatility_added'); } },
    { type: 'rect', color: '#ef4444', get label() { return t('rpt_volatility_removed'); } },
  ]);
}

function _renderTypeDonut(byType, metricLabel) {
  const emptyHint = metricLabel === 'Story Points' ? t('rpt_chart_no_sp') : t('rpt_chart_no_us');
  if (!byType || !byType.length) return `<div class="report-empty-hint">${emptyHint}</div>`;
  const total = byType.reduce((s, t) => s + t.count, 0);
  if (!total) return `<div class="report-empty-hint">${emptyHint}</div>`;

  const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899'];
  const r = 62, cx = 80, cy = 78;
  const circ = 2 * Math.PI * r;

  let segs = '', accumulated = 0;
  byType.forEach((t, i) => {
    const arc    = (t.count / total) * circ;
    const offset = circ - accumulated;
    const pct    = Math.round(t.count / total * 100);
    segs += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none"
      stroke="${COLORS[i % COLORS.length]}" stroke-width="26"
      stroke-dasharray="${arc.toFixed(2)} ${(circ - arc).toFixed(2)}"
      stroke-dashoffset="${offset.toFixed(2)}"
      transform="rotate(-90 ${cx} ${cy})"
      style="cursor:default;transition:opacity .15s"
      onmouseenter="this.style.opacity='.7'" onmouseleave="this.style.opacity='1'">
      <title>${_esc(t.type)}: ${t.count} (${pct}%)</title>
    </circle>`;
    accumulated += arc;
  });
  segs += `<text x="${cx}" y="${cy - 5}" text-anchor="middle" font-size="18" font-weight="800" fill="var(--text-1)">${total}</text>`;
  segs += `<text x="${cx}" y="${cy + 13}" text-anchor="middle" font-size="10" fill="var(--text-faint)">${metricLabel || 'User Stories'}</text>`;

  const legendItems = byType.map((t, i) => {
    const pct = Math.round(t.count / total * 100);
    return `<span style="display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--text-faint)">` +
      `<span style="width:10px;height:10px;border-radius:2px;background:${COLORS[i % COLORS.length]};display:inline-block;flex-shrink:0"></span>` +
      `${_esc(t.type)}: <strong style="color:var(--text-1)">${t.count} (${pct}%)</strong></span>`;
  }).join('');

  return `<div style="display:flex;flex-direction:column;align-items:center;height:100%">` +
    `<svg viewBox="0 0 160 158" style="width:100%;max-width:200px;display:block;margin:0 auto" xmlns="http://www.w3.org/2000/svg">${segs}</svg>` +
    `<div style="margin-top:auto;display:flex;justify-content:center;flex-wrap:wrap;gap:6px 16px;padding:10px 0 2px">${legendItems}</div>` +
    `</div>`;
}

// Shared donut renderer — same visual style as _renderTypeDonut (Azure).
// items: [{ type: string, count: number, color?: string }]
function _donutChart(items, centerLabel) {
  const total = items.reduce((s, i) => s + i.count, 0);
  if (!total) return `<div class="report-empty-hint">${t('rpt_chart_no_data')}</div>`;
  const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899'];
  const r = 62, cx = 80, cy = 78;
  const circ = 2 * Math.PI * r;
  let segs = '', accumulated = 0;
  items.forEach((item, i) => {
    const arc    = (item.count / total) * circ;
    const offset = circ - accumulated;
    const pct    = Math.round(item.count / total * 100);
    const color  = item.color || COLORS[i % COLORS.length];
    segs += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none"
      stroke="${color}" stroke-width="26"
      stroke-dasharray="${arc.toFixed(2)} ${(circ - arc).toFixed(2)}"
      stroke-dashoffset="${offset.toFixed(2)}"
      transform="rotate(-90 ${cx} ${cy})"
      style="cursor:default;transition:opacity .15s"
      onmouseenter="this.style.opacity='.7'" onmouseleave="this.style.opacity='1'">
      <title>${_esc(item.type)}: ${item.count} (${pct}%)</title>
    </circle>`;
    accumulated += arc;
  });
  segs += `<text x="${cx}" y="${cy - 5}" text-anchor="middle" font-size="18" font-weight="800" fill="var(--text-1)">${total}</text>`;
  segs += `<text x="${cx}" y="${cy + 13}" text-anchor="middle" font-size="10" fill="var(--text-faint)">${_esc(centerLabel)}</text>`;
  const legendItems = items.map((item, i) => {
    const pct   = Math.round(item.count / total * 100);
    const color = item.color || COLORS[i % COLORS.length];
    return `<span style="display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--text-faint)">` +
      `<span style="width:10px;height:10px;border-radius:2px;background:${color};display:inline-block;flex-shrink:0"></span>` +
      `${_esc(item.type)}: <strong style="color:var(--text-1)">${item.count} (${pct}%)</strong></span>`;
  }).join('');
  return `<div style="display:flex;flex-direction:column;align-items:center;height:100%">` +
    `<svg viewBox="0 0 160 158" style="width:100%;max-width:200px;display:block;margin:0 auto" xmlns="http://www.w3.org/2000/svg">${segs}</svg>` +
    `<div style="margin-top:auto;display:flex;justify-content:center;flex-wrap:wrap;gap:6px 16px;padding:10px 0 2px">${legendItems}</div>` +
    `</div>`;
}

function _renderTypeBar(byType, barColor, metricLabel, size) {
  const emptyHint = metricLabel === 'Story Points' ? t('rpt_chart_no_sp') : t('rpt_chart_no_us');
  if (!byType || !byType.length) return `<div class="report-empty-hint">${emptyHint}</div>`;
  const total = byType.reduce((s, t) => s + t.count, 0);
  if (!total) return `<div class="report-empty-hint">${emptyHint}</div>`;

  const COLORS  = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899'];
  const maxVal  = Math.max(...byType.map(t => t.count), 1);
  const barH    = 28;
  const gap     = 10;
  const padL    = 110; // label column
  const padR    = 40;  // value label space
  const padT    = 10;
  const padB    = 28;  // axis labels
  const W       = size === 'lg' ? 800 : size === 'md' ? 460 : 420;
  const innerH  = byType.length * (barH + gap) - gap;
  const H       = padT + innerH + padB;
  const trackW  = W - padL - padR;

  // Axis ticks: pick a nice step
  const rawStep = maxVal / 5;
  const step    = Math.max(1, Math.ceil(rawStep));
  const ticks   = [];
  for (let v = 0; v <= maxVal; v += step) ticks.push(v);
  if (ticks[ticks.length - 1] < maxVal) ticks.push(maxVal);

  let gridLines = '', bars = '', labels = '';

  ticks.forEach(v => {
    const x = padL + (v / maxVal) * trackW;
    gridLines += `<line x1="${x.toFixed(1)}" y1="${padT}" x2="${x.toFixed(1)}" y2="${padT + innerH}" stroke="var(--bg-border)" stroke-width="1" stroke-dasharray="3,3"/>`;
    gridLines += `<text x="${x.toFixed(1)}" y="${H - 4}" text-anchor="middle" font-size="9" fill="var(--text-faint)">${v}</text>`;
  });

  byType.forEach((t, i) => {
    const y     = padT + i * (barH + gap);
    const bW    = (t.count / maxVal) * trackW;
    const color = barColor || COLORS[i % COLORS.length];
    bars   += `<rect x="${padL}" y="${y}" width="${bW.toFixed(1)}" height="${barH}" fill="${color}" opacity=".8" rx="3"/>`;
    bars   += `<text x="${(padL + bW + 6).toFixed(1)}" y="${(y + barH / 2 + 4).toFixed(1)}" font-size="10" font-weight="700" fill="var(--text-1)">${t.count}</text>`;
    const lbl = t.type.length > 15 ? t.type.slice(0, 14) + '…' : t.type;
    labels += `<text x="${padL - 8}" y="${(y + barH / 2 + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="var(--text-faint)">${_esc(lbl)}</text>`;
  });

  const axes = `<line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + innerH}" stroke="var(--bg-border)" stroke-width="1"/>
    <line x1="${padL}" y1="${padT + innerH}" x2="${W - padR}" y2="${padT + innerH}" stroke="var(--bg-border)" stroke-width="1"/>`;

  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:${W}px;display:block" xmlns="http://www.w3.org/2000/svg">
    ${gridLines}${axes}${bars}${labels}
  </svg>`;
}

function _renderTypeBarVertical(byType, barColor, metricLabel, size) {
  const emptyHint = metricLabel === 'Story Points' ? t('rpt_chart_no_sp') : t('rpt_chart_no_us');
  if (!byType || !byType.length) return `<div class="report-empty-hint">${emptyHint}</div>`;
  const total = byType.reduce((s, t) => s + t.count, 0);
  if (!total) return `<div class="report-empty-hint">${emptyHint}</div>`;

  const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899'];
  const W = size === 'lg' ? 800 : size === 'md' ? 480 : 400;
  const padT = 20, padB = 56, padL = 36, padR = 16;
  const maxVal = Math.max(...byType.map(t => t.count), 1);
  const cW     = W - padL - padR;
  const cH     = 160;
  const H      = padT + cH + padB;
  const barW   = Math.min(cW / byType.length * 0.6, 40);

  const rawStep = maxVal / 4;
  const step    = Math.max(1, Math.ceil(rawStep));
  const ticks   = [];
  for (let v = 0; v <= maxVal; v += step) ticks.push(v);
  if (ticks[ticks.length - 1] < maxVal) ticks.push(maxVal);

  let grid = '', bars = '', xlabels = '';

  ticks.forEach(v => {
    const y = padT + cH - (v / maxVal) * cH;
    grid += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="var(--bg-border)" stroke-width="1" stroke-dasharray="3,3"/>`;
    grid += `<text x="${padL - 4}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="var(--text-faint)">${v}</text>`;
  });

  byType.forEach((t, i) => {
    const cx    = padL + (i + 0.5) * (cW / byType.length);
    const bH    = (t.count / maxVal) * cH;
    const y     = padT + cH - bH;
    const color = barColor || COLORS[i % COLORS.length];
    bars += `<rect x="${(cx - barW / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${bH.toFixed(1)}" fill="${color}" opacity=".8" rx="3"/>`;
    if (bH > 14) {
      bars += `<text x="${cx.toFixed(1)}" y="${(y + bH / 2 + 4).toFixed(1)}" text-anchor="middle" font-size="9" fill="var(--text-muted)">${t.count}</text>`;
    } else {
      bars += `<text x="${cx.toFixed(1)}" y="${(y - 4).toFixed(1)}" text-anchor="middle" font-size="9" fill="var(--text-faint)">${t.count}</text>`;
    }
    const lbl = t.type.length > 12 ? t.type.slice(0, 11) + '…' : t.type;
    xlabels += `<text x="${cx.toFixed(1)}" y="${padT + cH + 14}" text-anchor="end" transform="rotate(-42,${cx.toFixed(1)},${padT + cH + 14})" font-size="9" fill="var(--text-faint)">${_esc(lbl)}</text>`;
  });

  const axes = `<line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + cH}" stroke="var(--bg-border)" stroke-width="1"/>
    <line x1="${padL}" y1="${padT + cH}" x2="${W - padR}" y2="${padT + cH}" stroke="var(--bg-border)" stroke-width="1"/>`;

  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:${W}px;display:block" xmlns="http://www.w3.org/2000/svg">
    ${grid}${axes}${bars}${xlabels}
  </svg>`;
}

function _renderIncPriorityDonut(inc) {
  const p1     = inc?.p1    || 0;
  const p2     = inc?.p2    || 0;
  const p3     = inc?.p3    || 0;
  const outros = Math.max(0, (inc?.total || 0) - p1 - p2 - p3);
  const items  = [
    { get type() { return t('rpt_priority_p1'); }, count: p1,     color: '#ef4444' },
    { get type() { return t('rpt_priority_p2'); }, count: p2,     color: '#f97316' },
    { get type() { return t('rpt_priority_p3'); }, count: p3,     color: '#eab308' },
    ...(outros > 0 ? [{ get type() { return t('rpt_others'); }, count: outros, color: '#6b7280' }] : []),
  ].filter(item => item.count > 0);
  if (!items.length) return `<div class="report-empty-hint">${t('rpt_chart_no_incidents')}</div>`;
  return _donutChart(items, t('rpt_filter_incidents'));
}

function _renderIncidentsVolumeChart(monthly, months, target, selectedMonth) {
  const data = (monthly || []).slice(-months);
  if (!data.length) return `<div class="report-empty-hint">${t('rpt_chart_no_inc_data')}</div>`;

  const W = 600, H = 214;
  const pad = { t: 20, r: 20, b: 20, l: 44 };
  const cW = W - pad.l - pad.r;
  const cH = H - pad.t - pad.b;

  const maxVal = Math.max(...data.map(m => Math.max(m.opened || 0, m.closed || 0, m.cancelled || 0, m.openBacklog || 0)), target || 0, 1);
  const rawStep = maxVal / 4;
  const step = Math.max(1, Math.ceil(rawStep / 4) * 4);
  const yMax = Math.ceil(maxVal / step) * step;

  const grpW = cW / data.length;
  const barW = Math.min(grpW * 0.22, 16);
  const gap  = 3;

  let bars = '', labels = '', gridLines = '', yLabels = '';

  for (let v = 0; v <= yMax; v += step) {
    const y = pad.t + cH - (v / yMax) * cH;
    gridLines += `<line x1="${pad.l}" y1="${y.toFixed(1)}" x2="${W - pad.r}" y2="${y.toFixed(1)}" stroke="var(--bg-border)" stroke-width="1"${v > 0 ? ' stroke-dasharray="4,4"' : ''}/>`;
    yLabels   += `<text x="${pad.l - 6}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="9" fill="var(--text-faint)">${v}</text>`;
  }

  data.forEach((m, i) => {
    const cx        = pad.l + i * grpW + grpW / 2;
    const opened    = m.opened    || 0;
    const closed    = m.closed    || 0;
    const cancelled = m.cancelled || 0;
    const hO  = (opened    / yMax) * cH;
    const hC  = (closed    / yMax) * cH;
    const hCa = (cancelled / yMax) * cH;
    const isSel = selectedMonth && m.label === selectedMonth;

    // Fundo de destaque para o mês selecionado
    if (isSel) {
      bars += `<rect x="${(pad.l + i * grpW + 2).toFixed(1)}" y="${pad.t}" width="${(grpW - 4).toFixed(1)}" height="${cH}" fill="var(--bg-border)" rx="3" opacity="0.35"/>`;
    }

    const totalGrpW = 3 * barW + 2 * gap;
    const xO  = cx - totalGrpW / 2;
    const xC  = xO + barW + gap;
    const xCa = xC + barW + gap;

    const mLbl = _fmtMonth(m.label);
    if (hO > 0) {
      bars += `<rect x="${xO.toFixed(1)}" y="${(pad.t + cH - hO).toFixed(1)}" width="${barW}" height="${hO.toFixed(1)}" fill="${isSel ? '#60a5fa' : '#93c5fd'}" rx="2" ${_incOnclick('opened', m.label, '', '', `Abertos · ${mLbl}`)}/>`;
      bars += `<text x="${(xO + barW / 2).toFixed(1)}" y="${(pad.t + cH - hO - 3).toFixed(1)}" text-anchor="middle" font-size="8" fill="var(--text-faint)" style="pointer-events:none">${opened}</text>`;
    }
    if (hC > 0) {
      bars += `<rect x="${xC.toFixed(1)}" y="${(pad.t + cH - hC).toFixed(1)}" width="${barW}" height="${hC.toFixed(1)}" fill="${isSel ? '#10b981' : '#34d399'}" rx="2" ${_incOnclick('closed', m.label, '', '', `Fechados · ${mLbl}`)}/>`;
      bars += `<text x="${(xC + barW / 2).toFixed(1)}" y="${(pad.t + cH - hC - 3).toFixed(1)}" text-anchor="middle" font-size="8" fill="var(--text-faint)" style="pointer-events:none">${closed}</text>`;
    }
    if (hCa > 0) {
      bars += `<rect x="${xCa.toFixed(1)}" y="${(pad.t + cH - hCa).toFixed(1)}" width="${barW}" height="${hCa.toFixed(1)}" fill="${isSel ? '#fbbf24' : '#fde68a'}" rx="2" ${_incOnclick('cancelled', m.label, '', '', `Cancelados · ${mLbl}`)}/>`;
      bars += `<text x="${(xCa + barW / 2).toFixed(1)}" y="${(pad.t + cH - hCa - 3).toFixed(1)}" text-anchor="middle" font-size="8" fill="var(--text-faint)" style="pointer-events:none">${cancelled}</text>`;
    }

    const labelColor  = isSel ? 'var(--text-muted)' : 'var(--text-faint)';
    const labelWeight = isSel ? 'font-weight="600"' : '';
    labels += `<text x="${cx.toFixed(1)}" y="${(H - pad.b + 14).toFixed(1)}" text-anchor="middle" font-size="9" fill="${labelColor}" ${labelWeight}>${_esc(_fmtMonth(m.label))}</text>`;
  });

  const targetLine = target > 0 ? (() => {
    const ty = pad.t + cH - (Math.min(target, yMax) / yMax) * cH;
    return `<line x1="${pad.l}" y1="${ty.toFixed(1)}" x2="${W - pad.r}" y2="${ty.toFixed(1)}" stroke="#ef4444" stroke-width="1.5" stroke-dasharray="6,4"/>`;
  })() : '';

  // Linha de backlog (mesma escala das barras)
  const backlogVals = data.map(m => Math.abs(m.openBacklog ?? 0));
  const bkPts = data.map((m, i) => {
    const cx = pad.l + i * grpW + grpW / 2;
    const y  = pad.t + cH - (backlogVals[i] / yMax) * cH;
    return [cx, y];
  });
  const backlogLine = `<polyline points="${bkPts.map(p => p.join(',')).join(' ')}" fill="none" stroke="#f97316" stroke-width="1.5" stroke-dasharray="4,3"/>`;
  const backlogDots = bkPts.map((p, i) => {
    return `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="4" fill="#f97316" style="cursor:default"><title>${_fmtMonth(data[i].label)}: ${backlogVals[i]} em backlog</title></circle>`;
  }).join('');

  const axes = `
    <line x1="${pad.l}" y1="${pad.t}" x2="${pad.l}" y2="${pad.t + cH}" stroke="var(--bg-border)" stroke-width="1"/>
    <line x1="${pad.l}" y1="${pad.t + cH}" x2="${W - pad.r}" y2="${pad.t + cH}" stroke="var(--bg-border)" stroke-width="1"/>`;

  const legendItems = [
    { type: 'rect', color: '#93c5fd', get label() { return t('rpt_legend_opened'); } },
    { type: 'rect', color: '#34d399', get label() { return t('rpt_legend_closed'); } },
    { type: 'rect', color: '#fde68a', get label() { return t('rpt_legend_cancelled'); } },
    { type: 'line', color: '#f97316', get label() { return t('rpt_legend_backlog'); }, dashed: true, dot: true },
    ...(target > 0 ? [{ type: 'line', color: '#ef4444', label: `Target (${target})`, dashed: true }] : []),
  ];

  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;display:block" xmlns="http://www.w3.org/2000/svg">
    ${gridLines}${axes}${bars}${targetLine}${backlogLine}${backlogDots}${labels}${yLabels}
  </svg>` + _legendHtml(legendItems);
}

// ── Incident system charts ─────────────────────────────────────────────────────

function _renderIncidentSystemBars(bySystem, reportMonth, groupby) {
  const all = bySystem || [];
  if (!all.length) return `<div class="report-empty-hint">${t('rpt_chart_no_ic')}</div>`;
  let items;
  const cutoff = _heatmapTopN > 0 ? _heatmapTopN : Infinity;
  if (all.length <= cutoff) {
    items = all;
  } else {
    const topN  = all.slice(0, cutoff);
    const rest  = all.slice(cutoff);
    const outros = rest.reduce((acc, s) => ({
      name: 'Outros', total: acc.total + (s.total || 0),
      p1: acc.p1 + (s.p1 || 0), p2: acc.p2 + (s.p2 || 0), p3: acc.p3 + (s.p3 || 0),
    }), { name: 'Outros', total: 0, p1: 0, p2: 0, p3: 0 });
    items = outros.total > 0 ? [...topN, outros] : topN;
  }

  const W = 600, H = 280;
  const pad = { t: 24, r: 16, b: 60, l: 36 };
  const chartW = W - pad.l - pad.r;
  const chartH = H - pad.t - pad.b;
  const slotW  = chartW / items.length;
  const bw     = Math.floor(slotW * 0.62);
  const maxVal = Math.max(...items.map(s => s.total), 1);

  const gridLines = Array.from({ length: 5 }, (_, i) => {
    const val = Math.round(maxVal * i / 4);
    const y   = pad.t + chartH - (val / maxVal) * chartH;
    return `<line x1="${pad.l}" y1="${y.toFixed(1)}" x2="${W - pad.r}" y2="${y.toFixed(1)}" stroke="var(--text-faint)" stroke-width="0.3" stroke-dasharray="3,3"/>` +
      `<text x="${pad.l - 4}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="7.5" fill="var(--text-faint)">${val}</text>`;
  }).join('');

  const SEGS = [
    { key: 'p1',   color: 'rgba(239,68,68,0.65)',  label: 'P1' },
    { key: 'p2',   color: 'rgba(249,115,22,0.55)', label: 'P2' },
    { key: 'p3',   color: 'rgba(250,204,21,0.45)', label: 'P3' },
    { key: 'rest', color: 'rgba(34,197,94,0.35)',  label: 'Outros' },
  ];

  let bars = '';
  items.forEach((s, i) => {
    const cx  = pad.l + i * slotW + slotW / 2;
    const bx  = cx - bw / 2;
    const rest = Math.max(0, s.total - s.p1 - s.p2 - s.p3);
    const vals = { p1: s.p1, p2: s.p2, p3: s.p3, rest };
    let yBottom = pad.t + chartH;

    SEGS.forEach(seg => {
      const count = vals[seg.key] || 0;
      if (!count) return;
      const h = (count / maxVal) * chartH;
      yBottom -= h;
      bars += `<rect x="${bx.toFixed(1)}" y="${yBottom.toFixed(1)}" width="${bw}" height="${h.toFixed(1)}" fill="${seg.color}" rx="1"><title>${seg.label}: ${count}</title></rect>`;
      if (h > 12) bars += `<text x="${cx.toFixed(1)}" y="${(yBottom + h / 2 + 3).toFixed(1)}" text-anchor="middle" font-size="8" fill="var(--text-muted)">${count}</text>`;
    });

    if (s.total > 0) {
      const topY = pad.t + chartH - (s.total / maxVal) * chartH;
      bars += `<text x="${cx.toFixed(1)}" y="${(topY - 4).toFixed(1)}" text-anchor="middle" font-size="8" fill="var(--text-muted)" style="pointer-events:none">${s.total}</text>`;
      // transparent overlay for click (skip "Outros" aggregate)
      if (s.name !== 'Outros' && reportMonth) {
        const oh = pad.t + chartH - topY;
        const fv = s.rawValue || s.name;
        bars += `<rect x="${bx.toFixed(1)}" y="${topY.toFixed(1)}" width="${bw}" height="${oh.toFixed(1)}" fill="transparent" ${_incOnclick('opened', reportMonth, groupby || 'cmdb_ci', fv, `${s.name} · ${_fmtMonth(reportMonth)}`)}/>`;
      }
    }

    const name  = s.name.length > 14 ? s.name.slice(0, 13) + '…' : s.name;
    const lblY  = pad.t + chartH + 10;
    bars += `<text x="${cx.toFixed(1)}" y="${lblY}" text-anchor="end" font-size="8.5" fill="var(--text-faint)" transform="rotate(-42 ${cx.toFixed(1)} ${lblY})">${_esc(name)}</text>`;
  });

  const axes = `
    <line x1="${pad.l}" y1="${pad.t}" x2="${pad.l}" y2="${pad.t + chartH}" stroke="var(--bg-border)" stroke-width="1"/>
    <line x1="${pad.l}" y1="${pad.t + chartH}" x2="${W - pad.r}" y2="${pad.t + chartH}" stroke="var(--bg-border)" stroke-width="1"/>`;

  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;display:block" xmlns="http://www.w3.org/2000/svg">
    ${gridLines}${axes}${bars}
  </svg>` + _legendHtml([
    { type: 'rect', color: 'rgba(239,68,68,0.65)',  label: 'P1' },
    { type: 'rect', color: 'rgba(249,115,22,0.55)', label: 'P2' },
    { type: 'rect', color: 'rgba(250,204,21,0.45)', label: 'P3' },
  ]);
}

function _renderIncidentHeatmap(bySystemMonthly, monthly, colLabel, groupby) {
  const allMonths = monthly || [];
  const months = allMonths.slice(-_incidentMonths);
  const allSystems = bySystemMonthly || [];
  if (!allSystems.length || !months.length) return `<div class="report-empty-hint">${t('rpt_chart_no_heatmap')}</div>`;
  let items;
  const cutoffH = _heatmapTopN > 0 ? _heatmapTopN : Infinity;
  if (allSystems.length <= cutoffH) {
    items = allSystems;
  } else {
    const topN    = allSystems.slice(0, cutoffH);
    const rest    = allSystems.slice(cutoffH);
    const histLen0 = (topN[0]?.monthly || []).length;
    const outrosMonthly = Array(histLen0).fill(0);
    rest.forEach(s => (s.monthly || []).forEach((v, i) => { outrosMonthly[i] += v; }));
    items = rest.length > 0 ? [...topN, { name: 'Outros', monthly: outrosMonthly }] : topN;
  }

  const histLen   = (items[0]?.monthly || []).length;
  const monthStart = Math.max(0, histLen - months.length);
  const autoMax   = Math.max(...items.flatMap(s => months.map((_, i) => s.monthly[monthStart + i] || 0)), 1);
  const maxCount  = _heatmapMax > 0 ? _heatmapMax : autoMax;

  const heatBg = cnt => {
    if (!cnt) return 'var(--bg-card)';
    const r = Math.min(1, cnt / maxCount);
    if (r < 0.25) return 'rgba(34,197,94,0.25)';
    if (r < 0.5)  return 'rgba(250,204,21,0.45)';
    if (r < 0.75) return 'rgba(249,115,22,0.55)';
    return 'rgba(239,68,68,0.65)';
  };

  const monthLabels = months.map(m => _fmtMonth(m.label));

  const th = 'padding:4px 8px;font-size:9px;font-weight:600;color:var(--text-faint);text-align:center;border-bottom:1px solid var(--bg-border)';
  const td = 'padding:4px 6px;font-size:10px;text-align:center;border:1px solid var(--bg-border)';
  const nt = 'padding:4px 8px;font-size:9.5px;color:var(--text-muted);text-align:left;border:1px solid var(--bg-border);max-width:140px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';

  const headerCells = monthLabels.map(l => `<th style="${th}">${_esc(l)}</th>`).join('');
  const rows = items.map(s => {
    const cells = months.map((m, i) => {
      const cnt = s.monthly[monthStart + i] || 0;
      const fv = s.rawValue || s.name;
      const clickable = cnt > 0 && s.name !== 'Outros' && groupby
        ? _incOnclick('opened', m.label, groupby, fv, `${s.name} · ${_fmtMonth(m.label)}`)
        : '';
      return `<td style="${td};background:${heatBg(cnt)}${cnt > 0 && s.name !== 'Outros' ? ';cursor:pointer' : ''}" ${clickable}>${cnt > 0 ? cnt : ''}</td>`;
    }).join('');
    const name = s.name.length > 22 ? s.name.slice(0, 20) + '…' : s.name;
    return `<tr><td style="${nt}" title="${_esc(s.name)}">${_esc(name)}</td>${cells}</tr>`;
  }).join('');

  return `<div style="overflow-x:auto">
    <table style="border-collapse:collapse;width:100%;min-width:360px">
      <thead><tr><th style="${th};text-align:left">${_esc(colLabel || 'Sistema')}</th>${headerCells}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}


// ── Unified chart cell (draggable, resizable) ─────────────────────────────────

function _renderChartCell(chart, delivery, idx, sprints, incidents) {
  const size      = chart.size || 'md';
  const canRemove = _reportCharts.length > 1;

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
      ? _renderIncidentsVolumeChart(incidents.monthly, monthsLabel, _incidentTarget)
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
  const canRemove = _incidentCharts.length > 1;
  const useAlt     = _incidentGroupBy === 'resolution_code';
  const barData    = useAlt ? (inc.byGroupAlt || [])        : (inc.bySystem || []);
  const heatData   = useAlt ? (inc.byGroupAltMonthly || []) : (inc.bySystemMonthly || []);
  const groupLabel = useAlt ? t('rpt_groupby_res_code') : t('rpt_inc_cfg_groupby_ic');

  let title, subtitle, content;
  switch (chart.type) {
    case 'inc-volume':
      title     = t('rpt_inc_volume_title');
      subtitle  = `${t('rpt_inc_history_sub')}${_incidentTarget > 0 ? ` — target: ${_incidentTarget}` : ''} · ${_incidentMonths} ${t('rpt_months')}`;
      content   = _renderIncidentsVolumeChart(inc.monthly, _incidentMonths, _incidentTarget, _reportMonth);
      break;
    case 'inc-bars':
      title     = `${groupLabel} — ${t('rpt_inc_bars_top9')}`;
      subtitle  = t('rpt_inc_bars_sub');
      content   = _renderIncidentSystemBars(barData, _reportMonth, useAlt ? 'resolution_code' : 'cmdb_ci');
      break;
    case 'inc-heatmap':
      title     = `Heatmap: ${groupLabel} × ${t('rpt_month')}`;
      subtitle  = `${t('rpt_heatmap_freq_sub')}${_heatmapTopN > 0 ? ` — ${t('rpt_heatmap_top')} ${_heatmapTopN}` : ` — ${t('rpt_heatmap_all_sys')}`}${_heatmapMax > 0 ? ` — ${t('rpt_heatmap_fixed_scale')} ${_heatmapMax}` : ''}`;
      content   = _renderIncidentHeatmap(heatData, inc.monthly, groupLabel, useAlt ? 'resolution_code' : 'cmdb_ci');
      break;
    case 'inc-location':
      title     = t('rpt_inc_location_title');
      subtitle  = `${t('rpt_inc_loc_sub')} · ${_locationMonths} ${t(_locationMonths === 1 ? 'rpt_month' : 'rpt_months')}`;
      content   = _renderIncidentLocationChart(inc.byLocationMonthly, inc.monthly, _locationMonths);
      break;
    case 'inc-priority-trend':
      title     = t('rpt_priority_trend_title');
      subtitle  = `${t('rpt_priority_trend_sub')} · ${_incidentMonths} ${t('rpt_months')}`;
      content   = _renderIncPriorityTrend(inc.monthly);
      break;
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
  const canRemove = _prbCharts.length > 1;
  let title, subtitle, content;
  switch (chart.type) {
    case 'prb-evolution': title = t('rpt_prb_evolution'); subtitle = ''; content = _renderPrbEvolutionChart(prbs.monthly); break;
    case 'prb-donut':     title = t('rpt_prb_status_title'); subtitle = t('rpt_prb_status_sub'); content = _renderPrbStatusDonut(prbs.list); break;
    case 'prb-aging':     title = t('rpt_aging_backlog'); subtitle = t('rpt_prb_aging_sub'); content = _renderPrbAgingChart(prbs.list); break;
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

function _computeAgingBuckets(items, thresholds) {
  const [t1, t2, t3, t4] = thresholds;
  const labels = [`≤${t1}d`, `${t1 + 1}–${t2}d`, `${t2 + 1}–${t3}d`, `${t3 + 1}–${t4}d`, `>${t4}d`];
  const counts = labels.map(label => ({ label, count: 0 }));
  (items || []).forEach(item => {
    const d = item.agingDays || 0;
    if (d <= t1)      counts[0].count++;
    else if (d <= t2) counts[1].count++;
    else if (d <= t3) counts[2].count++;
    else if (d <= t4) counts[3].count++;
    else              counts[4].count++;
  });
  return counts;
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

// ── US Aging charts ──────────────────────────────────────────────────────────

function _renderUsAgingBuckets(usAging) {
  if (!usAging) return `<div class="report-empty-hint">${t('rpt_aging_no_data')}</div>`;
  if (!usAging.total) return `<div class="report-empty-hint">${t('rpt_aging_no_us_state')}</div>`;
  // Use list for configurable thresholds; fall back to pre-computed buckets in old cache entries
  const buckets = usAging.list?.length
    ? _computeAgingBuckets(usAging.list, _agingBuckets)
    : (usAging.buckets || []);
  if (!buckets.length || !buckets.some(b => b.count > 0)) return `<div class="report-empty-hint">${t('rpt_aging_no_us_state')}</div>`;

  const COLORS  = ['#0d9488', '#3b82f6', '#f59e0b', '#f97316', '#ef4444'];
  const maxCount = Math.max(...buckets.map(b => b.count), 1);

  const W = 600, H = 210;
  const pad = { t: 20, r: 20, b: 60, l: 36 };
  const chartW = W - pad.l - pad.r;
  const chartH = H - pad.t - pad.b;
  const slotW  = chartW / buckets.length;
  const bw     = Math.floor(slotW * 0.5);

  const gridLines = Array.from({ length: 5 }, (_, i) => {
    const val = Math.round(maxCount * i / 4);
    const y   = pad.t + chartH - (val / maxCount) * chartH;
    return `<line x1="${pad.l}" y1="${y}" x2="${W - pad.r}" y2="${y}" stroke="var(--text-faint)" stroke-width="0.3" stroke-dasharray="3,3"/>` +
      `<text x="${pad.l - 4}" y="${y + 4}" text-anchor="end" font-size="7.5" fill="var(--text-faint)">${val}</text>`;
  }).join('');

  const bars = buckets.map((b, i) => {
    const cx = pad.l + i * slotW + slotW / 2;
    const bx = cx - bw / 2;
    const h  = (b.count / maxCount) * chartH;
    const y  = pad.t + chartH - h;
    const color = COLORS[i];
    return (b.count > 0
      ? `<rect x="${bx}" y="${y}" width="${bw}" height="${h}" fill="${color}" rx="1"/>` +
        (h > 12 ? `<text x="${cx}" y="${(y + h / 2 + 3).toFixed(1)}" text-anchor="middle" font-size="8" font-weight="700" fill="#fff">${b.count}</text>` : '') +
        `<text x="${cx}" y="${y - 4}" text-anchor="middle" font-size="8" fill="var(--text-muted)">${b.count}</text>`
      : '') +
      `<text x="${cx}" y="${pad.t + chartH + 14}" text-anchor="middle" font-size="9" fill="var(--text-muted)">${_esc(b.label)}</text>`;
  }).join('');

  const H_svg = H - 38;
  const svgHtml = `<svg viewBox="0 0 ${W} ${H_svg}" style="width:100%;display:block">
    ${gridLines}
    <line x1="${pad.l}" y1="${pad.t}" x2="${pad.l}" y2="${pad.t + chartH}" stroke="var(--text-faint)" stroke-width="0.5"/>
    <line x1="${pad.l}" y1="${pad.t + chartH}" x2="${W - pad.r}" y2="${pad.t + chartH}" stroke="var(--text-faint)" stroke-width="0.5"/>
    ${bars}
  </svg>`;

  return svgHtml + _legendHtml(COLORS.map((color, i) => ({ type: 'rect', color, label: buckets[i]?.label || '' })));
}

function _renderUsTop10(usAging) {
  if (!usAging) return `<div class="report-empty-hint">${t('rpt_aging_no_data')}</div>`;
  const list = (usAging.list || usAging.top10 || []).slice(0, 10);
  if (!list.length) return `<div class="report-empty-hint">${t('rpt_aging_no_us_found')}</div>`;

  const maxDays = Math.max(...list.map(u => u.agingDays || 0), 1);

  const rows = list.map((u, i) => {
    const pct       = Math.round((u.agingDays || 0) / maxDays * 100);
    const barColor  = pct > 66 ? '#ef4444' : pct > 33 ? '#f97316' : '#0d9488';
    const daysColor = pct > 66 ? '#ef4444' : pct > 33 ? '#f97316' : 'var(--text-muted)';
    return `<tr>
      <td class="report-td" style="color:var(--text-faint);width:24px;text-align:center">${i + 1}</td>
      <td class="report-td" style="width:60px">
        <a href="${u.url || '#'}" target="_blank" style="color:var(--c-blue);text-decoration:none;font-family:monospace;font-size:11px">#${u.id}</a>
      </td>
      <td class="report-td" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${_esc(u.title)}">${_esc(u.title)}</td>
      <td class="report-td" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:120px" title="${_esc(u.sprint)}">${_esc(u.sprint)}</td>
      <td class="report-td" style="min-width:130px">
        <div style="display:flex;align-items:center;gap:6px">
          <div style="flex:1;height:5px;background:var(--bg-el);border-radius:3px;overflow:hidden">
            <div style="width:${pct}%;height:100%;background:${barColor};border-radius:3px"></div>
          </div>
          <span style="font-size:11px;font-weight:700;color:${daysColor};min-width:34px;text-align:right">${u.agingDays}d</span>
        </div>
      </td>
    </tr>`;
  }).join('');

  return `<table class="report-table" style="width:100%;table-layout:fixed">
    <colgroup>
      <col style="width:28px"><col style="width:68px"><col>
      <col style="width:120px"><col style="width:150px">
    </colgroup>
    <thead><tr><th></th><th>ID</th><th>Título</th><th>Sprint</th><th>Aging</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
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

  const chartCells = _reportCharts.map((chart, idx) =>
    _renderChartCell(chart, delivery, idx, sprints, incidents)
  ).join('');

  const DEFAULT_DONE = ['Closed', 'Done', 'Resolved'];
  const isCustomDelivery = _deliveryStates.length !== DEFAULT_DONE.length || _deliveryStates.some(s => !DEFAULT_DONE.includes(s));
  const deliveryStatesSub = isCustomDelivery
    ? `<div class="report-prb-chart-sub" style="margin-top:2px">Contando como entregue: <strong>${_deliveryStates.join(', ')}</strong></div>`
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
    <div class="report-subsection-title" style="margin-top:20px">US Aging — ${_esc(usAging?.state || _agingState)}</div>
    <div class="report-prb-chart-sub">${usAging ? `${usAging.total} US em "${_esc(usAging.state)}" · sem filtro de sprint` : `Aguardando dados para "${_esc(_agingState)}"`}</div>
    <div class="report-donuts-grid">
      <div class="report-donut-cell report-donut-cell-${_agingCharts[0]?.size || 'md'}">
        <div class="report-field-picker-header">
          <div class="report-donut-title-row"><div class="report-subsection-title">${t('rpt_aging_backlog')}</div></div>
          <div class="report-field-chart-actions"><button class="report-field-picker-btn" title="${t('rpt_configure_chart')}" onclick="reportOpenAgingPicker(0)" draggable="false">⚙</button></div>
        </div>
        ${_renderUsAgingBuckets(usAging)}
      </div>
      <div class="report-donut-cell report-donut-cell-${_agingCharts[1]?.size || 'md'}">
        <div class="report-field-picker-header">
          <div class="report-donut-title-row"><div class="report-subsection-title">${t('rpt_aging_top10')} "${_esc(usAging?.state || _agingState)}"</div></div>
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
    ${_indConfigSection === 'incidents' ? _renderIndicatorConfigPanel('incidents') : ''}
    ${_renderIndicatorCards('incidents', inc, null)}
    <div class="report-donuts-grid">
      ${_incidentCharts.map((chart, idx) => _renderIncidentChartCell(chart, idx, inc)).join('')}
      <div class="report-add-chart-section" style="flex-basis:100%">
        <button class="report-add-chart-btn" onclick="reportAddIncChart()">+ ${t('rpt_add_chart')}</button>
      </div>
    </div>
  </div>`;
}

// ── Incident by Location — grouped bar per month ───────────────────────────────

function _renderIncidentLocationChart(byLocationMonthly, monthly, months) {
  const allMonths = monthly || [];
  const slicedM   = allMonths.slice(-months);
  if (!slicedM.length || !byLocationMonthly || !byLocationMonthly.length) {
    return `<div class="report-empty-hint">${t('rpt_chart_no_location')}</div>`;
  }

  const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16'];
  const TOP    = 8;

  // Top locations by total in the visible window
  const histLen = (byLocationMonthly[0]?.monthly || []).length;
  const mStart  = Math.max(0, histLen - months);
  const visLocs = byLocationMonthly
    .map(l => ({ ...l, visTotal: (l.monthly || []).slice(mStart).reduce((s, v) => s + v, 0) }))
    .filter(l => l.visTotal > 0)
    .sort((a, b) => b.visTotal - a.visTotal);

  let locs;
  if (visLocs.length <= TOP) {
    locs = visLocs;
  } else {
    const topLocs = visLocs.slice(0, TOP);
    const rest    = visLocs.slice(TOP);
    const outrosMonthly = new Array(histLen).fill(0);
    rest.forEach(l => (l.monthly || []).forEach((v, i) => { outrosMonthly[i] += v; }));
    locs = [...topLocs, { name: 'Outros', monthly: outrosMonthly, visTotal: rest.reduce((s, l) => s + l.visTotal, 0) }];
  }

  const W = 600, padT = 20, padB = 50, padL = 36, padR = 16;
  const cH = 180;
  const H  = padT + cH + padB;
  const cW = W - padL - padR;

  // Max is the highest individual bar value (not the stacked total)
  const maxVal = Math.max(
    ...slicedM.flatMap((_, mi) => locs.map(l => (l.monthly || [])[mStart + mi] || 0)),
    1
  );

  const rawStep = maxVal / 4;
  const step    = Math.max(1, Math.ceil(rawStep));
  const ticks   = [];
  for (let v = 0; v <= maxVal; v += step) ticks.push(v);
  if (ticks[ticks.length - 1] < maxVal) ticks.push(maxVal);

  // Each month group occupies slotW; inside: locs.length bars with gap
  const slotW    = cW / slicedM.length;
  const barGap   = 2;
  const barW     = Math.max(2, Math.min((slotW * 0.85) / locs.length - barGap, 24));
  const grpW     = locs.length * (barW + barGap) - barGap;

  let grid = '', bars = '', xlabels = '';

  ticks.forEach(v => {
    const y = padT + cH - (v / maxVal) * cH;
    grid += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="var(--bg-border)" stroke-width="1" stroke-dasharray="3,3"/>`;
    grid += `<text x="${padL - 4}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="var(--text-faint)">${v}</text>`;
  });

  slicedM.forEach((m, mi) => {
    const grpCx = padL + (mi + 0.5) * slotW;
    const grpX0 = grpCx - grpW / 2;

    locs.forEach((l, li) => {
      const val   = (l.monthly || [])[mStart + mi] || 0;
      const color = COLORS[li % COLORS.length];
      const bx    = grpX0 + li * (barW + barGap);
      const bH    = (val / maxVal) * cH;
      const by    = padT + cH - bH;
      const locClick = val > 0 && l.name !== 'Outros'
        ? _incOnclick('opened', m.label, 'location', l.name, `${l.name} · ${_fmtMonth(m.label)}`) : '';
      bars += `<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(bH, 0).toFixed(1)}" fill="${color}" opacity=".85" rx="2" ${locClick}>`;
      bars += `<title>${_esc(l.name)}: ${val}</title></rect>`;
      if (bH > 14) {
        bars += `<text x="${(bx + barW / 2).toFixed(1)}" y="${(by + bH / 2 + 4).toFixed(1)}" text-anchor="middle" font-size="8" fill="var(--text-muted)">${val}</text>`;
      } else if (val > 0) {
        bars += `<text x="${(bx + barW / 2).toFixed(1)}" y="${(by - 3).toFixed(1)}" text-anchor="middle" font-size="8" fill="var(--text-faint)">${val}</text>`;
      }
    });

    const lbl = _fmtMonth(m.label);
    xlabels += `<text x="${grpCx.toFixed(1)}" y="${padT + cH + 14}" text-anchor="middle" font-size="9" fill="var(--text-faint)">${_esc(lbl)}</text>`;
  });

  const axes = `<line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + cH}" stroke="var(--bg-border)" stroke-width="1"/>
    <line x1="${padL}" y1="${padT + cH}" x2="${W - padR}" y2="${padT + cH}" stroke="var(--bg-border)" stroke-width="1"/>`;

  const legendItems = locs.map((l, li) =>
    `<span style="display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--text-faint)">` +
    `<span style="width:10px;height:10px;border-radius:2px;background:${COLORS[li % COLORS.length]};display:inline-block;flex-shrink:0"></span>` +
    `${_esc(l.name)}</span>`
  ).join('');

  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;display:block" xmlns="http://www.w3.org/2000/svg">
    ${grid}${axes}${bars}${xlabels}
  </svg>
  <div style="margin-top:6px;display:flex;justify-content:center;flex-wrap:wrap;gap:4px 12px;padding:0 4px">${legendItems}</div>`;
}

// ── Indicator card helpers ─────────────────────────────────────────────────────

function _getResolvedCards(section) {
  const catalog  = _INDICATOR_CATALOG.filter(c => c.section === section);
  const saved    = _indicatorCards[section] || [];
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
      const riskCls = _incidentTarget !== null
        ? ((inc?.total ?? 0) > _incidentTarget * 1.2 ? 'red' : (inc?.total ?? 0) > _incidentTarget ? 'yellow' : '')
        : '';
      const sub = _incidentTarget !== null ? `Target: ${_incidentTarget}` : t('rpt_sub_no_target');
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
      const subHtml = _slaEnabled ? _slaBadge(inc?.slaByPriority?.p1) : `<div class="report-prb-card-sub">${t('rpt_sub_max_priority')}</div>`;
      return { val: String(inc?.byPriority?.p1 ?? 0), label: t('rpt_ind_inc_p1'), subHtml, cls };
    }
    case 'inc_p2': {
      const cls = (inc?.byPriority?.p2 ?? 0) > 3 ? 'yellow' : '';
      const subHtml = _slaEnabled ? _slaBadge(inc?.slaByPriority?.p2) : `<div class="report-prb-card-sub">${t('rpt_sub_high_priority')}</div>`;
      return { val: String(inc?.byPriority?.p2 ?? 0), label: t('rpt_ind_inc_p2'), subHtml, cls };
    }
    case 'inc_p3': {
      const subHtml = _slaEnabled ? _slaBadge(inc?.slaByPriority?.p3) : `<div class="report-prb-card-sub">${t('rpt_sub_medium_priority')}</div>`;
      return { val: String(inc?.byPriority?.p3 ?? 0), label: t('rpt_ind_inc_p3'), subHtml, cls: '' };
    }
    case 'inc_target': {
      if (_incidentTarget === null) {
        return { val: '<span style="font-size:20px;line-height:1;opacity:.55">&#9881;</span>', label: t('rpt_ind_inc_target'), sub: t('rpt_sub_click_configure'), cls: '', clickable: true, onclick: 'reportOpenTargetModal()' };
      }
      const pct = _incidentTarget > 0 ? Math.round((inc?.total ?? 0) / _incidentTarget * 100) : null;
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
  const perRow  = _indicatorCardsPerRow[section] || 4;
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
  const perRow = _indicatorCardsPerRow[section] || 4;
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

function _renderPrbStatusDonut(list) {
  const counts = {};
  (list || []).forEach(p => { const k = String(p.state); counts[k] = (counts[k] || 0) + 1; });
  const total = Object.values(counts).reduce((s, v) => s + v, 0);
  if (total === 0) return '<div class="report-empty-hint">Sem PRBs para o período</div>';
  const items = Object.entries(counts).map(([state, count]) => {
    const cfg = _PRB_STATES[state] || { label: state, color: '#6b7280' };
    return { type: cfg.label, count, color: cfg.color };
  });
  return _donutChart(items, 'PRBs');
}


function _renderPrbEvolutionChart(monthly) {
  if (!monthly || monthly.length === 0) return '<div class="report-empty-row">No data</div>';
  const W = 600, H = 184;
  const pad = { t: 30, r: 56, b: 20, l: 44 };
  const chartW = W - pad.l - pad.r;
  const chartH = H - pad.t - pad.b;

  // Backlog real de PRBs abertos no final de cada mês (consultado diretamente no SN)
  const accumulated = monthly.map(m => m.openBacklog ?? 0);

  const maxBar = Math.max(...monthly.flatMap(m => [m.opened || 0, m.resolved || 0]), ...accumulated, 1);
  const n = monthly.length;
  const slotW = chartW / n;
  const bw = Math.max(4, Math.floor(slotW * 0.28));

  // Grid lines (left axis)
  const gridLines = Array.from({ length: 5 }, (_, i) => {
    const val = Math.round(maxBar * i / 4);
    const y = pad.t + chartH - (val / maxBar) * chartH;
    return `<line x1="${pad.l}" y1="${y}" x2="${W - pad.r}" y2="${y}" stroke="var(--text-faint)" stroke-width="0.3" stroke-dasharray="3,3"/>` +
      `<text x="${pad.l - 4}" y="${y + 4}" text-anchor="end" font-size="7.5" fill="var(--text-faint)">${val}</text>`;
  }).join('');

  const bars = monthly.map((m, i) => {
    const cx = pad.l + i * slotW + slotW / 2;
    const hO = (m.opened  || 0) / maxBar * chartH;
    const hR = (m.resolved|| 0) / maxBar * chartH;
    const xO = cx - bw - 1;
    const xR = cx + 1;
    const lbl = _fmtMonth(m.label);
    return `<rect x="${xO}" y="${pad.t + chartH - hO}" width="${bw}" height="${hO}" fill="#6366f1" rx="1"/>` +
      `<rect x="${xR}" y="${pad.t + chartH - hR}" width="${bw}" height="${hR}" fill="#a5b4fc" rx="1"/>` +
      (m.opened  > 0 ? `<text x="${xO + bw / 2}" y="${pad.t + chartH - hO - 3}" text-anchor="middle" font-size="7" fill="var(--text-faint)">${m.opened}</text>`   : '') +
      (m.resolved> 0 ? `<text x="${xR + bw / 2}" y="${pad.t + chartH - hR - 3}" text-anchor="middle" font-size="7" fill="var(--text-faint)">${m.resolved}</text>` : '') +
      `<text x="${cx}" y="${pad.t + chartH + 14}" text-anchor="middle" font-size="8" fill="var(--text-muted)">${lbl}</text>`;
  });

  // Linha do backlog (mesma escala das barras)
  const accPts = accumulated.map((v, i) => [
    pad.l + i * slotW + slotW / 2,
    pad.t + chartH - Math.max(0, v) / maxBar * chartH,
  ]);
  const accDots = accPts.map((p, i) => {
    return `<circle cx="${p[0]}" cy="${p[1]}" r="4" fill="#ef4444" style="cursor:default"><title>${_fmtMonth(monthly[i].label)}: ${accumulated[i]} em backlog</title></circle>`;
  }).join('');

  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;display:block">
    ${gridLines}
    <line x1="${pad.l}" y1="${pad.t}" x2="${pad.l}" y2="${pad.t + chartH}" stroke="var(--text-faint)" stroke-width="0.5"/>
    <line x1="${pad.l}" y1="${pad.t + chartH}" x2="${W - pad.r}" y2="${pad.t + chartH}" stroke="var(--text-faint)" stroke-width="0.5"/>
    ${bars.join('')}
    <polyline points="${accPts.map(p => p.join(',')).join(' ')}" fill="none" stroke="#ef4444" stroke-width="1.5" stroke-dasharray="4,3"/>
    ${accDots}
  </svg>` + _legendHtml([
    { type: 'rect', color: '#6366f1', get label() { return t('rpt_legend_opened'); } },
    { type: 'rect', color: '#a5b4fc', get label() { return t('rpt_legend_resolved'); } },
    { type: 'line', color: '#ef4444', get label() { return t('rpt_legend_backlog'); }, dashed: true, dot: true },
  ]);
}

function _renderPrbAgingChart(list) {
  if (!list || list.length === 0) return '<div class="report-empty-row">No PRBs</div>';

  const STATE_ORDER = ['101','102','103','104','106','107'];

  const BUCKETS = [
    { label: '≤30d',    test: d => d <= 30 },
    { label: '31–60d',  test: d => d > 30  && d <= 60 },
    { label: '61–90d',  test: d => d > 60  && d <= 90 },
    { label: '91–180d', test: d => d > 90  && d <= 180 },
    { label: '>180d',   test: d => d > 180 },
  ];

  const counts = BUCKETS.map(() => ({}));
  list.forEach(p => {
    const bi = BUCKETS.findIndex(b => b.test(p.agingDays || 0));
    if (bi < 0) return;
    const st = String(p.state);
    counts[bi][st] = (counts[bi][st] || 0) + 1;
  });
  const totals  = counts.map(c => Object.values(c).reduce((s, v) => s + v, 0));
  const maxTotal = Math.max(...totals, 1);
  const activeStates = STATE_ORDER.filter(st => counts.some(c => c[st] > 0));

  const W = 600, H = 210;
  const pad = { t: 20, r: 20, b: 60, l: 36 };
  const chartW = W - pad.l - pad.r;
  const chartH = H - pad.t - pad.b;
  const slotW  = chartW / BUCKETS.length;
  const bw     = Math.floor(slotW * 0.5);

  const gridLines = Array.from({ length: 5 }, (_, i) => {
    const val = Math.round(maxTotal * i / 4);
    const y   = pad.t + chartH - (val / maxTotal) * chartH;
    return `<line x1="${pad.l}" y1="${y}" x2="${W - pad.r}" y2="${y}" stroke="var(--text-faint)" stroke-width="0.3" stroke-dasharray="3,3"/>` +
      `<text x="${pad.l - 4}" y="${y + 4}" text-anchor="end" font-size="7.5" fill="var(--text-faint)">${val}</text>`;
  }).join('');

  const bars = counts.map((bkt, i) => {
    const cx   = pad.l + i * slotW + slotW / 2;
    const bx   = cx - bw / 2;
    let   yTop = pad.t + chartH;
    const segs = activeStates.map(st => {
      const count = bkt[st] || 0;
      if (!count) return '';
      const h = (count / maxTotal) * chartH;
      yTop -= h;
      const segY = (yTop + h / 2 + 3).toFixed(1);
      return `<rect x="${bx}" y="${yTop}" width="${bw}" height="${h}" fill="${_PRB_STATES[st].color}" rx="1"/>` +
        (h > 12 ? `<text x="${cx}" y="${segY}" text-anchor="middle" font-size="8" font-weight="700" fill="#fff">${count}</text>` : '');
    }).join('');
    return segs +
      (totals[i] > 0 ? `<text x="${cx}" y="${pad.t + chartH - (totals[i] / maxTotal) * chartH - 4}" text-anchor="middle" font-size="8" fill="var(--text-muted)">${totals[i]}</text>` : '') +
      `<text x="${cx}" y="${pad.t + chartH + 14}" text-anchor="middle" font-size="9" fill="var(--text-muted)">${BUCKETS[i].label}</text>`;
  }).join('');

  const H_svg = H - 38;
  const svgHtml = `<svg viewBox="0 0 ${W} ${H_svg}" style="width:100%;display:block">
    ${gridLines}
    <line x1="${pad.l}" y1="${pad.t}" x2="${pad.l}" y2="${pad.t + chartH}" stroke="var(--text-faint)" stroke-width="0.5"/>
    <line x1="${pad.l}" y1="${pad.t + chartH}" x2="${W - pad.r}" y2="${pad.t + chartH}" stroke="var(--text-faint)" stroke-width="0.5"/>
    ${bars}
  </svg>`;
  return svgHtml + _legendHtml(activeStates.map(st =>
    ({ type: 'rect', color: _PRB_STATES[st].color, label: _PRB_STATES[st].label })
  ));
}

function _renderPrbOldestList(list) {
  if (!list || list.length === 0) return '<div class="report-empty-row">No PRBs</div>';

  const P_COLORS = { '1':'#ef4444','2':'#f97316','3':'#eab308','4':'#6b7280' };

  const sorted  = [...list].sort((a, b) => (b.agingDays || 0) - (a.agingDays || 0)).slice(0, 10);
  const maxDays = Math.max(...sorted.map(p => p.agingDays || 0), 1);

  const rows = sorted.map((p, i) => {
    const st  = String(p.state);
    const pr  = String(p.priority);
    const pct = Math.round((p.agingDays || 0) / maxDays * 100);
    const barColor  = pct > 66 ? '#ef4444' : pct > 33 ? '#f97316' : '#0d9488';
    const daysColor = pct > 66 ? '#ef4444' : pct > 33 ? '#f97316' : 'var(--text-muted)';
    return `<tr>
      <td class="report-td" style="color:var(--text-faint);width:24px;text-align:center">${i + 1}</td>
      <td class="report-td" style="font-family:monospace;font-size:11px;white-space:nowrap">${_esc(p.id || '—')}</td>
      <td class="report-td" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${_esc(p.title)}">${_esc(p.title || '—')}</td>
      <td class="report-td"><span style="font-size:11px;font-weight:600;color:${_PRB_STATES[st]?.color || 'var(--text-faint)'}">${_esc(_PRB_STATES[st]?.label || st)}</span></td>
      <td class="report-td" style="text-align:center"><span style="font-size:11px;font-weight:700;color:${P_COLORS[pr] || 'var(--text-faint)'}">P${_esc(pr)}</span></td>
      <td class="report-td" style="min-width:130px">
        <div style="display:flex;align-items:center;gap:6px">
          <div style="flex:1;height:5px;background:var(--bg-el);border-radius:3px;overflow:hidden">
            <div style="width:${pct}%;height:100%;background:${barColor};border-radius:3px"></div>
          </div>
          <span style="font-size:11px;font-weight:700;color:${daysColor};min-width:34px;text-align:right">${p.agingDays}d</span>
        </div>
      </td>
    </tr>`;
  }).join('');

  return `<table class="report-table" style="width:100%;table-layout:fixed">
    <colgroup>
      <col style="width:28px"><col style="width:100px"><col>
      <col style="width:140px"><col style="width:52px"><col style="width:150px">
    </colgroup>
    <thead><tr>
      <th class="report-th">#</th>
      <th class="report-th">ID</th>
      <th class="report-th">Título</th>
      <th class="report-th">Status</th>
      <th class="report-th">Prior.</th>
      <th class="report-th">Aging</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function _renderIncPriorityTrend(monthly) {
  const data = (monthly || []).slice(-_incidentMonths);
  if (!data.length) return `<div class="report-empty-hint">${t('rpt_chart_no_heatmap')}</div>`;

  const W = 600, padT = 24, padB = 30, padL = 32, padR = 16;
  const cH = 150;
  const H  = padT + cH + padB;
  const cW = W - padL - padR;
  const n  = data.length;

  const maxV = Math.max(...data.flatMap(m => [m.p1 || 0, m.p2 || 0, m.p3 || 0]), 1);
  const xOf  = i => padL + (n === 1 ? cW / 2 : i / (n - 1) * cW);
  const yOf  = v => padT + cH - (v / maxV) * cH;

  const LINES = [
    { key: 'p1', color: '#ef4444', get label() { return t('rpt_priority_p1'); } },
    { key: 'p2', color: '#f97316', get label() { return t('rpt_priority_p2'); } },
    { key: 'p3', color: '#eab308', get label() { return t('rpt_priority_p3'); } },
  ];

  const grid = Array.from({ length: 4 }, (_, i) => {
    const v = Math.round(maxV * i / 3);
    const y = yOf(v);
    return `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="var(--bg-border)" stroke-width="0.4" stroke-dasharray="3,3"/>` +
      `<text x="${padL - 4}" y="${y + 4}" text-anchor="end" font-size="7.5" fill="var(--text-faint)">${v}</text>`;
  }).join('');

  const series = LINES.map(({ key, color }) => {
    const pts  = data.map((m, i) => `${xOf(i)},${yOf(m[key] || 0)}`).join(' ');
    const dots = data.map((m, i) =>
      `<circle cx="${xOf(i)}" cy="${yOf(m[key] || 0)}" r="3" fill="${color}"><title>${_fmtMonth(m.label)}: ${m[key] || 0}</title></circle>`
    ).join('');
    return `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.8"/>` + dots;
  }).join('');

  const xlabels = data.map((m, i) =>
    `<text x="${xOf(i)}" y="${H - 4}" text-anchor="middle" font-size="8" fill="var(--text-muted)">${_fmtMonth(m.label)}</text>`
  ).join('');

  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;display:block" xmlns="http://www.w3.org/2000/svg">
    ${grid}
    <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + cH}" stroke="var(--bg-border)" stroke-width="0.5"/>
    <line x1="${padL}" y1="${padT + cH}" x2="${W - padR}" y2="${padT + cH}" stroke="var(--bg-border)" stroke-width="0.5"/>
    ${series}${xlabels}
  </svg>` + _legendHtml(LINES.map(l => ({ type: 'line', color: l.color, label: l.label })));
}

function _renderIncSlaBars(slaByPriority) {
  if (!slaByPriority) return `<div class="report-empty-hint">${t('rpt_chart_no_inc_data')}</div>`;
  const PRIOS = [
    { key: 'p1', get label() { return t('rpt_priority_p1'); }, color: '#ef4444', target: _slaTargets.p1 ?? 95 },
    { key: 'p2', get label() { return t('rpt_priority_p2'); }, color: '#f97316', target: _slaTargets.p2 ?? 90 },
    { key: 'p3', get label() { return t('rpt_priority_p3'); }, color: '#eab308', target: _slaTargets.p3 ?? 85 },
  ];
  const rows = PRIOS.map(p => {
    const d = slaByPriority[p.key];
    if (!d || d.pct === null) {
      return `<div style="margin-bottom:10px;display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:12px;color:var(--text-muted)">${_esc(p.label)}</span>
        <span style="font-size:11px;color:var(--text-faint)">Sem dados</span>
      </div>`;
    }
    const pct  = d.pct;
    const good = pct >= p.target;
    const warn = pct >= p.target - 10;
    const barColor = good ? '#10b981' : warn ? '#f59e0b' : '#ef4444';
    const txtColor = good ? '#10b981' : warn ? '#f59e0b' : '#ef4444';
    return `<div style="margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <span style="font-size:12px;color:var(--text-muted)">${_esc(p.label)}</span>
        <span style="font-size:13px;font-weight:700;color:${txtColor}">${pct}%</span>
      </div>
      <div style="height:8px;background:var(--bg-el);border-radius:4px;overflow:hidden">
        <div style="width:${pct}%;height:100%;background:${barColor};border-radius:4px"></div>
      </div>
      <div style="font-size:10px;color:var(--text-faint);margin-top:2px">${d.withinSla} de ${d.total} dentro do SLA — Meta: ${p.target}%</div>
    </div>`;
  });
  return `<div style="padding:4px 0">${rows.join('')}</div>`;
}

function _renderPrbCategoryChart(list) {
  if (!list || !list.length) return '<div class="report-empty-hint">Sem PRBs para o período</div>';
  const counts = {};
  list.forEach(p => {
    const cat = (p.category && String(p.category).trim()) || 'Não categorizado';
    counts[cat] = (counts[cat] || 0) + 1;
  });
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 7);
  if (!sorted.length) return '<div class="report-empty-hint">Sem dados de categoria</div>';
  const COLORS = ['#6366f1', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];
  const items = sorted.map(([type, count], i) => ({ type, count, color: COLORS[i % COLORS.length] }));
  return _donutChart(items, 'PRBs');
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
    ${_indConfigSection === 'prbs' ? _renderIndicatorConfigPanel('prbs') : ''}
    ${_renderIndicatorCards('prbs', null, prbs)}
    <div class="report-donuts-grid">
      ${_prbCharts.map((chart, idx) => _renderPrbChartCell(chart, idx, prbs)).join('')}
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

  const savedNotes = localStorage.getItem(`reportNotes::${_reportProject}::${_reportMonth}`) || '';
  const notesBar = `<div class="report-notes-bar">
    <textarea class="report-notes-input" placeholder="${t('rpt_notes_placeholder')}" onchange="reportSaveNotes(this.value)">${_esc(savedNotes)}</textarea>
    <button class="report-print-btn" onclick="exportReportHtml()" title="${t('rpt_export_html')}">
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M13 10v3a1 1 0 01-1 1H4a1 1 0 01-1-1v-3"/><polyline points="10 6 8 8 6 6"/><line x1="8" y1="8" x2="8" y2="2"/></svg>
      ${t('rpt_export_html')}</button>
  </div>`;

  const _af = _activeSectionFilter;
  const filterBar = `<div class="report-filter-bar">
    ${hasAzure ? `<button class="report-filter-btn${_af === 'sprint' ? ' report-filter-btn--active' : ''}" data-filter="sprint" onclick="reportSetSectionFilter('sprint')">${t('rpt_filter_azure')}</button>` : ''}
    <button class="report-filter-btn${_af === 'incidents' ? ' report-filter-btn--active' : ''}" data-filter="incidents" onclick="reportSetSectionFilter('incidents')">${t('rpt_filter_incidents')}</button>
    <button class="report-filter-btn${_af === 'prbs' ? ' report-filter-btn--active' : ''}" data-filter="prbs" onclick="reportSetSectionFilter('prbs')">${t('rpt_filter_prbs')}</button>
    <button class="report-filter-btn${_af === 'all' ? ' report-filter-btn--active' : ''}" data-filter="all" onclick="reportSetSectionFilter('all')">${t('rpt_filter_all')}</button>
  </div>`;

  const sectionFilterAttr = _activeSectionFilter !== 'all' ? ` data-section-filter="${_activeSectionFilter}"` : '';

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

export async function openReport(btn) {
  const card = btn.closest('[data-project]');
  _reportProject = card ? card.dataset.project : '';
  _reportMonth   = null;
  await _loadReportConfig();

  document.getElementById('report-modal-title').textContent = _reportProject;
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
  const key = `reportNotes::${_reportProject}::${_reportMonth}`;
  if (value && value.trim()) localStorage.setItem(key, value);
  else localStorage.removeItem(key);
}

export function reportSetSectionFilter(filter) {
  _activeSectionFilter = filter;
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
  window.openSnConfig?.(_reportProject);
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
  _reportMonth = month;
  _load();
}

export function reportRefresh() {
  _load(true);
}

// ── Indicator config panel ─────────────────────────────────────────────────────

export function reportOpenIndicatorConfig(section) {
  _indConfigSection = section;
  _rerender();
}

export function reportCloseIndicatorConfig() {
  _indConfigSection = null;
  _rerender();
}

export function reportToggleIndicator(section, id) {
  const cards = _getResolvedCards(section);
  _indicatorCards[section] = cards.map(c => ({ id: c.id, visible: c.id === id ? !c.visible : c.visible, order: c.order }));
  _saveReportConfig();
  _rerender();
}

export function reportSetCardsPerRow(section, n) {
  _indicatorCardsPerRow = { ..._indicatorCardsPerRow, [section]: n };
  _saveReportConfig();
  _rerender();
}

export function reportIndDragStart(event, section, id) {
  _indDragSrcId      = id;
  _indDragSrcSection = section;
  event.dataTransfer.effectAllowed = 'move';
}

export function reportIndDragOver(event) {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  event.currentTarget.classList.add('report-ind-cfg-dragover');
}

export function reportIndDragLeave(event) {
  event.currentTarget.classList.remove('report-ind-cfg-dragover');
}

export function reportIndDrop(event, section, targetId) {
  event.preventDefault();
  event.currentTarget.classList.remove('report-ind-cfg-dragover');
  if (_indDragSrcId === targetId || _indDragSrcSection !== section) return;
  const cards  = _getResolvedCards(section);
  const srcIdx = cards.findIndex(c => c.id === _indDragSrcId);
  const tgtIdx = cards.findIndex(c => c.id === targetId);
  if (srcIdx < 0 || tgtIdx < 0) return;
  const reordered = [...cards];
  const [moved]   = reordered.splice(srcIdx, 1);
  reordered.splice(tgtIdx, 0, moved);
  _indicatorCards[section] = reordered.map((c, i) => ({ id: c.id, visible: c.visible, order: i }));
  _saveReportConfig();
  _rerender();
}

export function reportIndDragEnd() {
  _indDragSrcId      = null;
  _indDragSrcSection = null;
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
      target:             _incidentTarget > 0 ? _incidentTarget : null,
      vsTarget:           _incidentTarget > 0
        ? (incidents.total > _incidentTarget
            ? `+${incidents.total - _incidentTarget} acima do target`
            : `${_incidentTarget - incidents.total} abaixo do target`)
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
  if (!_lastPayload) return;
  const contextStr = _buildReportContext(_lastPayload);
  await openCopilotWithContext(contextStr);
}

export function reportOpenFieldPicker(idx) {
  _pickerIdx = idx !== undefined ? idx : -1;
  _closeFieldPicker();

  const isEdit        = _pickerIdx >= 0;
  const currentChart  = isEdit ? _reportCharts[_pickerIdx] : null;
  const currentSize     = currentChart?.size       || 'md';
  const currentType     = currentChart?.type       || 'donut';
  const currentRef      = currentChart?.ref        || '';
  const currentStyle    = currentChart?.chartStyle || 'donut';
  const currentBarColor = currentChart?.barColor   || '';
  const currentCountBy  = currentChart?.countBy    || 'count';
  const isDonut         = !isEdit ? true : currentType === 'donut';
  const isIncidents     = isEdit && (currentType === 'incidents' || currentType === 'incident-location');
  const currentMonths   = currentChart?.months || (currentType === 'incident-location' ? 6 : 5);
  const isBarStyle      = isDonut && (currentStyle === 'bar' || currentStyle === 'bar-vertical');

  const backdrop = document.createElement('div');
  backdrop.id        = 'report-picker-backdrop';
  backdrop.className = 'report-field-backdrop';
  backdrop.onclick   = _closeFieldPicker;
  document.body.appendChild(backdrop);

  const picker = document.createElement('div');
  picker.id        = 'report-field-picker';
  picker.className = 'report-field-picker';

  const sizeOpts = [
    { val: 'sm', get label() { return t('rpt_size_3col'); } },
    { val: 'md', get label() { return t('rpt_size_2col'); } },
    { val: 'lg', get label() { return t('rpt_size_full'); } },
  ].map(o => `<button class="report-size-opt${currentSize === o.val ? ' active' : ''}" data-size="${o.val}">${o.label}</button>`).join('');

  // Type selector (only when adding new)
  const typeSection = !isEdit ? `
    <div class="report-field-picker-label">${t('rpt_label_chart_type')}</div>
    <select id="report-chart-type-sel" class="report-field-sel">
      <option value="donut">${t('rpt_type_groupby')}</option>
      <option value="incidents">${t('rpt_type_incidents')}</option>
      <option value="sprint">${t('rpt_type_sprint')}</option>
      <option value="volatility">${t('rpt_type_volatility')}</option>
    </select>` : '';

  // Field selector — shown for donut charts
  const fieldSection = `
    <div id="report-field-label"${!isDonut ? ' style="display:none"' : ''}>
      <div class="report-field-picker-label">${t('rpt_label_groupby_field')}</div>
    </div>
    <div id="report-field-picker-body" class="report-field-picker-body"${!isDonut ? ' style="display:none"' : ''}>
      ${isDonut ? `<div class="report-field-picker-loading">${t('rpt_loading_fields')}</div>` : ''}
    </div>`;

  // Chart style (donut vs bar) — only for donut charts
  const styleOpts = [
    { val: 'donut',        get label() { return t('rpt_style_donut'); } },
    { val: 'bar',          get label() { return t('rpt_style_bars'); } },
    { val: 'bar-vertical', get label() { return t('rpt_style_bars_v'); } },
  ].map(o => `<button class="report-size-opt${currentStyle === o.val ? ' active' : ''}" data-style="${o.val}">${o.label}</button>`).join('');
  const styleSection = `
    <div id="report-style-label"${!isDonut ? ' style="display:none"' : ''}>
      <div class="report-field-picker-label">${t('rpt_label_visual_style')}</div>
    </div>
    <div class="report-size-group" id="report-style-group"${!isDonut ? ' style="display:none"' : ''}>${styleOpts}</div>`;

  // Months input — only for incidents charts
  const monthsSection = `
    <div id="report-months-section"${!isIncidents ? ' style="display:none"' : ''}>
      <div class="report-field-picker-label">${t('rpt_label_history_months')}</div>
      <input type="number" id="report-inc-months" class="report-inc-months-input" min="1" max="12" value="${currentMonths}">
    </div>`;

  // Metric — only for donut/grouping charts
  const metricOpts = [
    { val: 'count', get label() { return t('rpt_metric_count'); } },
    { val: 'pts',   get label() { return t('rpt_metric_pts'); } },
  ].map(o => `<button class="report-size-opt${currentCountBy === o.val ? ' active' : ''}" data-countby="${o.val}">${o.label}</button>`).join('');
  const metricSection = `
    <div id="report-metric-label"${!isDonut ? ' style="display:none"' : ''}>
      <div class="report-field-picker-label">${t('rpt_label_metric')}</div>
    </div>
    <div class="report-size-group" id="report-metric-group"${!isDonut ? ' style="display:none"' : ''}>${metricOpts}</div>`;

  // Bar color — only for bar/bar-vertical donut charts
  const barColorSection = `
    <div id="report-bar-color-section"${!isBarStyle ? ' style="display:none"' : ''}>
      <div class="report-field-picker-label">${t('rpt_label_bar_color')}</div>
      <select id="report-bar-color-mode" class="report-field-sel">
        <option value="multi"${!currentBarColor ? ' selected' : ''}>${t('rpt_color_multi')}</option>
        <option value="single"${currentBarColor ? ' selected' : ''}>${t('rpt_color_single')}</option>
      </select>
      <div id="report-bar-color-picker"${!currentBarColor ? ' style="display:none"' : ''}>
        <input type="color" id="report-bar-color-input" value="${currentBarColor || '#8b5cf6'}"
          style="margin-top:6px;width:100%;height:32px;border:none;padding:0;cursor:pointer;background:none">
      </div>
    </div>`;

  picker.innerHTML = `
    <div class="report-field-picker-title">${isEdit ? t('rpt_title_configure_chart') : t('rpt_title_new_chart')}</div>
    ${typeSection}
    ${fieldSection}
    ${metricSection}
    ${styleSection}
    ${barColorSection}
    ${monthsSection}
    <div class="report-field-picker-label">${t('rpt_label_size')}</div>
    <div class="report-size-group" id="report-size-group-el">${sizeOpts}</div>
    <div class="report-field-picker-actions">
      <button class="report-picker-btn-cancel" id="report-field-cancel-btn">${t('rpt_btn_cancel')}</button>
      <button class="report-picker-btn-apply" id="report-field-apply-btn">${isEdit ? t('rpt_btn_apply') : t('rpt_btn_add')}</button>
    </div>`;
  document.body.appendChild(picker);

  document.getElementById('report-field-cancel-btn').onclick = _closeFieldPicker;
  document.getElementById('report-field-apply-btn').onclick  = _applyChartPicker;

  // Button toggles — scoped per group so size and style don't interfere
  picker.addEventListener('click', e => {
    const opt   = e.target.closest('.report-size-opt');
    if (!opt) return;
    const group = opt.closest('.report-size-group');
    group?.querySelectorAll('.report-size-opt').forEach(b => b.classList.remove('active'));
    opt.classList.add('active');
    // Show/hide bar color section when style changes
    if (group?.id === 'report-style-group' && opt.dataset.style) {
      const sec = document.getElementById('report-bar-color-section');
      if (sec) sec.style.display = (opt.dataset.style === 'bar' || opt.dataset.style === 'bar-vertical') ? '' : 'none';
    }
  });

  // Toggle color picker input when mode changes
  document.getElementById('report-bar-color-mode')?.addEventListener('change', e => {
    const cp = document.getElementById('report-bar-color-picker');
    if (cp) cp.style.display = e.target.value === 'single' ? '' : 'none';
  });

  function _loadPickerFields(selectedRef) {
    fetch('/api/report-fields?' + new URLSearchParams({ project: _reportProject }))
      .then(r => r.json())
      .then(({ fields = [] }) => {
        const body = document.getElementById('report-field-picker-body');
        if (!body) return;
        body.innerHTML = `<select id="report-field-sel" class="report-field-sel">
          <option value="">— Tipo de item (padrão) —</option>
          ${fields.map(f => `<option value="${_esc(f.ref)}"${selectedRef === f.ref ? ' selected' : ''}>${_esc(f.label)}</option>`).join('')}
        </select>`;
      })
      .catch(() => {
        const body = document.getElementById('report-field-picker-body');
        if (body) body.innerHTML = `<div class="report-field-picker-error">${t('rpt_error_fields')}</div>`;
      });
  }

  // Type select toggle: show/hide sections when adding
  if (!isEdit) {
    const typeSel = document.getElementById('report-chart-type-sel');
    typeSel?.addEventListener('change', () => {
      const t            = typeSel.value;
      const isDonutNow   = t === 'donut';
      const isIncNow     = t === 'incidents' || t === 'incident-location';
      const show = id => { const el = document.getElementById(id); if (el) el.style.display = ''; };
      const hide = id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; };

      if (isDonutNow) {
        show('report-field-label'); show('report-field-picker-body');
        show('report-style-label'); show('report-style-group');
        show('report-metric-label'); show('report-metric-group');
        hide('report-months-section');
        hide('report-bar-color-section'); // hidden until bar style selected
        _loadPickerFields('');
      } else if (isIncNow) {
        hide('report-field-label'); hide('report-field-picker-body');
        hide('report-style-label'); hide('report-style-group');
        hide('report-metric-label'); hide('report-metric-group');
        hide('report-bar-color-section');
        show('report-months-section');
      } else {
        hide('report-field-label'); hide('report-field-picker-body');
        hide('report-style-label'); hide('report-style-group');
        hide('report-metric-label'); hide('report-metric-group');
        hide('report-bar-color-section');
        hide('report-months-section');
      }
    });
  }

  // Load fields for donut picker
  if (isDonut) {
    _loadPickerFields(currentRef);
  }
}


export function reportAddChart() {
  reportOpenFieldPicker(-1);
}

export function reportRemoveChart(idx) {
  _reportCharts.splice(idx, 1);
  _saveReportConfig();
  _rerender();
}

export function reportResizeChart(idx, size) {
  _reportCharts[idx] = { ..._reportCharts[idx], size };
  _saveReportConfig();
  _rerender();
}

export function reportDragStart(e, idx) {
  if (e.target.closest('.report-field-chart-actions, button, a, select, input')) { e.preventDefault(); return; }
  _dragSrcIdx = idx;
  e.dataTransfer.effectAllowed = 'move';
  setTimeout(() => e.currentTarget?.classList.add('report-dragging'), 0);
}

export function reportDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  e.currentTarget.classList.add('report-drag-over');
}

export function reportDragLeave(e) {
  e.currentTarget.classList.remove('report-drag-over');
}

export function reportDrop(e, targetIdx) {
  e.preventDefault();
  e.currentTarget.classList.remove('report-drag-over');
  if (_dragSrcIdx < 0 || _dragSrcIdx === targetIdx) { _dragSrcIdx = -1; return; }
  const moved = _reportCharts.splice(_dragSrcIdx, 1)[0];
  _reportCharts.splice(targetIdx, 0, moved);
  _dragSrcIdx = -1;
  _saveReportConfig();
  _rerender();
}

export function reportDragEnd(e) {
  e.currentTarget?.classList.remove('report-dragging');
  document.querySelectorAll('.report-drag-over').forEach(el => el.classList.remove('report-drag-over'));
  _dragSrcIdx = -1;
}

// ── Incident chart drag / remove / add ────────────────────────────────────────

export function reportRemoveIncChart(idx) {
  _incidentCharts.splice(idx, 1);
  _saveReportConfig();
  _rerender();
}

export function reportIncChartDragStart(e, idx) {
  if (e.target.closest('.report-field-chart-actions, button, a, select, input')) { e.preventDefault(); return; }
  _incChartDragIdx = idx;
  e.dataTransfer.effectAllowed = 'move';
  setTimeout(() => e.currentTarget?.classList.add('report-dragging'), 0);
}

export function reportIncChartDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  e.currentTarget.classList.add('report-drag-over');
}

export function reportIncChartDragLeave(e) {
  e.currentTarget.classList.remove('report-drag-over');
}

export function reportIncChartDrop(e, targetIdx) {
  e.preventDefault();
  e.currentTarget.classList.remove('report-drag-over');
  if (_incChartDragIdx < 0 || _incChartDragIdx === targetIdx) { _incChartDragIdx = -1; return; }
  const moved = _incidentCharts.splice(_incChartDragIdx, 1)[0];
  _incidentCharts.splice(targetIdx, 0, moved);
  _incChartDragIdx = -1;
  _saveReportConfig();
  _rerender();
}

export function reportIncChartDragEnd(e) {
  e.currentTarget?.classList.remove('report-dragging');
  document.querySelectorAll('.report-drag-over').forEach(el => el.classList.remove('report-drag-over'));
  _incChartDragIdx = -1;
}

export function reportAddIncChart() {
  reportOpenIncChartPicker(-1);
}

// ── PRB chart drag / remove / add ─────────────────────────────────────────────

export function reportRemovePrbChart(idx) {
  _prbCharts.splice(idx, 1);
  _saveReportConfig();
  _rerender();
}

export function reportPrbChartDragStart(e, idx) {
  if (e.target.closest('.report-field-chart-actions, button, a, select, input')) { e.preventDefault(); return; }
  _prbChartDragIdx = idx;
  e.dataTransfer.effectAllowed = 'move';
  setTimeout(() => e.currentTarget?.classList.add('report-dragging'), 0);
}

export function reportPrbChartDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  e.currentTarget.classList.add('report-drag-over');
}

export function reportPrbChartDragLeave(e) {
  e.currentTarget.classList.remove('report-drag-over');
}

export function reportPrbChartDrop(e, targetIdx) {
  e.preventDefault();
  e.currentTarget.classList.remove('report-drag-over');
  if (_prbChartDragIdx < 0 || _prbChartDragIdx === targetIdx) { _prbChartDragIdx = -1; return; }
  const moved = _prbCharts.splice(_prbChartDragIdx, 1)[0];
  _prbCharts.splice(targetIdx, 0, moved);
  _prbChartDragIdx = -1;
  _saveReportConfig();
  _rerender();
}

export function reportPrbChartDragEnd(e) {
  e.currentTarget?.classList.remove('report-dragging');
  document.querySelectorAll('.report-drag-over').forEach(el => el.classList.remove('report-drag-over'));
  _prbChartDragIdx = -1;
}

export function reportAddPrbChart() {
  reportOpenPrbChartPicker(-1);
}

// ── Groupby field definitions ─────────────────────────────────────────────────

const _INC_GROUPBY_FIELDS = [
  { key: 'cmdb_ci.name',          get label() { return t('rpt_groupby_ic'); } },
  { key: 'u_additional_res_code', get label() { return t('rpt_groupby_res_code'); } },
  { key: 'assignment_group',      get label() { return t('rpt_groupby_assignment'); } },
  { key: 'assigned_to',           get label() { return t('rpt_groupby_assignee'); } },
  { key: 'priority',              get label() { return t('rpt_groupby_priority'); } },
  { key: 'impact',                get label() { return t('rpt_groupby_impact'); } },
  { key: 'urgency',               get label() { return t('rpt_groupby_urgency'); } },
  { key: 'state',                 get label() { return t('rpt_groupby_state'); } },
  { key: 'category',              get label() { return t('rpt_groupby_category'); } },
  { key: 'subcategory',           get label() { return t('rpt_groupby_subcategory'); } },
  { key: 'location.name',         get label() { return t('rpt_groupby_location'); } },
  { key: 'close_code',            get label() { return t('rpt_groupby_close_code'); } },
  { key: 'contact_type',          get label() { return t('rpt_groupby_contact_type'); } },
];

const _PRB_GROUPBY_FIELDS = [
  { key: 'priority',         get label() { return t('rpt_groupby_priority'); } },
  { key: 'impact',           get label() { return t('rpt_groupby_impact'); } },
  { key: 'urgency',          get label() { return t('rpt_groupby_urgency'); } },
  { key: 'category',         get label() { return t('rpt_groupby_category'); } },
  { key: 'state',            get label() { return t('rpt_groupby_state'); } },
  { key: 'assignment_group', get label() { return t('rpt_groupby_assignment'); } },
  { key: 'assigned_to',      get label() { return t('rpt_groupby_assignee'); } },
  { key: 'known_error',      get label() { return t('rpt_groupby_known_error'); } },
  { key: 'rca_complete',     get label() { return t('rpt_groupby_rca'); } },
];

function _acHtml(inputId, hiddenId, fields, currentKey) {
  const cur  = fields.find(f => f.key === currentKey);
  const opts = fields.map(f =>
    `<div class="report-ac-opt" data-key="${_esc(f.key)}" data-label="${_esc(f.label)}">${_esc(f.label)}<span class="report-ac-key">${_esc(f.key)}</span></div>`
  ).join('');
  return `<div class="report-ac-wrap">
    <input type="text" id="${inputId}" class="report-field-sel report-ac-input" value="${_esc(cur?.label || '')}" placeholder="${t('rpt_search_field')}" autocomplete="off">
    <input type="hidden" id="${hiddenId}" value="${_esc(currentKey || '')}">
    <div class="report-ac-dropdown" id="ac-drop-${inputId}">${opts}</div>
  </div>`;
}

function _acInit(picker, inputId, hiddenId) {
  const input = picker.querySelector('#' + inputId);
  const hidden = picker.querySelector('#' + hiddenId);
  const drop  = picker.querySelector('#ac-drop-' + inputId);
  if (!input || !hidden || !drop) return;
  const show = () => { drop.style.display = 'block'; };
  const hide = () => { drop.style.display = 'none'; };
  const filter = () => {
    const q = input.value.toLowerCase();
    drop.querySelectorAll('.report-ac-opt').forEach(o => {
      o.style.display = (o.dataset.label.toLowerCase().includes(q) || o.dataset.key.toLowerCase().includes(q)) ? '' : 'none';
    });
    show();
  };
  input.addEventListener('focus', show);
  input.addEventListener('input', filter);
  input.addEventListener('blur', () => setTimeout(hide, 160));
  drop.addEventListener('mousedown', e => {
    const o = e.target.closest('.report-ac-opt');
    if (!o) return;
    input.value  = o.dataset.label;
    hidden.value = o.dataset.key;
    hide();
    e.preventDefault();
  });
  input.addEventListener('keydown', e => {
    const visible = [...drop.querySelectorAll('.report-ac-opt:not([style*="none"])')];
    const cur = drop.querySelector('.report-ac-opt.report-ac-hi');
    let idx = visible.indexOf(cur);
    if (e.key === 'Escape') { hide(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); idx = Math.min(idx + 1, visible.length - 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); idx = Math.max(idx - 1, 0); }
    else if (e.key === 'Enter' && cur) {
      input.value  = cur.dataset.label;
      hidden.value = cur.dataset.key;
      hide(); e.preventDefault(); return;
    } else return;
    visible.forEach(o => o.classList.remove('report-ac-hi'));
    if (visible[idx]) { visible[idx].classList.add('report-ac-hi'); visible[idx].scrollIntoView({ block: 'nearest' }); }
    show();
  });
}

// ── Incident chart picker (unified ⚙ modal) ────────────────────────────────────

export function reportOpenIncChartPicker(idx) {
  _incPickerIdx = idx !== undefined ? idx : -1;
  _closeFieldPicker();
  const isEdit       = _incPickerIdx >= 0;
  const currentChart = isEdit ? _incidentCharts[_incPickerIdx] : null;
  const currentSize  = currentChart?.size || 'lg';
  const currentType  = currentChart?.type || 'inc-volume';

  const INC_TYPES = [
    { val: 'inc-volume',          get label() { return t('rpt_inc_type_volume'); } },
    { val: 'inc-bars',            get label() { return t('rpt_inc_type_bars'); } },
    { val: 'inc-heatmap',         get label() { return t('rpt_inc_type_heatmap'); } },
    { val: 'inc-location',        get label() { return t('rpt_inc_type_location'); } },
    { val: 'inc-priority-trend',  get label() { return t('rpt_inc_type_priority_trend'); } },
    { val: 'inc-sla-bars',        get label() { return t('rpt_inc_type_sla_bars'); } },
    { val: 'inc-priority-donut',  get label() { return t('rpt_inc_type_priority_donut'); } },
    { val: 'inc-groupby',         get label() { return t('rpt_inc_type_groupby'); } },
  ];

  const backdrop = document.createElement('div');
  backdrop.id = 'report-picker-backdrop';
  backdrop.className = 'report-field-backdrop';
  backdrop.onclick = _closeFieldPicker;
  document.body.appendChild(backdrop);

  const picker = document.createElement('div');
  picker.id = 'report-field-picker';
  picker.className = 'report-field-picker';

  const sizeOpts = [
    { val: 'sm', get label() { return t('rpt_size_3col'); } },
    { val: 'md', get label() { return t('rpt_size_2col'); } },
    { val: 'lg', get label() { return t('rpt_size_full'); } },
  ].map(o => `<button class="report-size-opt${currentSize === o.val ? ' active' : ''}" data-size="${o.val}">${o.label}</button>`).join('');

  const typeSection = !isEdit
    ? `<div class="report-field-picker-label">${t('rpt_label_chart_type')}</div>
       <select id="report-inc-type-sel" class="report-field-sel">
         ${INC_TYPES.map(tp => `<option value="${tp.val}">${tp.label}</option>`).join('')}
       </select>`
    : `<div class="report-field-picker-label">${t('rpt_label_chart')}</div>
       <div style="font-size:13px;color:var(--text-muted);padding:2px 0 8px">${_esc(INC_TYPES.find(tp => tp.val === currentType)?.label || currentType)}</div>`;

  const MONTH_OPTS = [3, 5, 6, 8, 10, 12, 13, 24];
  const LOC_OPTS   = [1, 3, 6];
  const showVolume  = isEdit && currentType === 'inc-volume';
  const showBars    = isEdit && (currentType === 'inc-bars' || currentType === 'inc-heatmap');
  const showHeat    = isEdit && currentType === 'inc-heatmap';
  const showLoc     = isEdit && currentType === 'inc-location';
  const showSla     = isEdit && currentType === 'inc-sla-bars';
  const showGroupby = isEdit && currentType === 'inc-groupby';
  const curGbStyle  = currentChart?.chartStyle || 'donut';
  const curGbColor  = currentChart?.barColor   || '';

  const specificSection = `
    ${showGroupby ? `
      <div class="report-field-picker-label">${t('rpt_label_groupby_field')}</div>
      ${_acHtml('report-inc-groupby-input', 'report-inc-groupby-field', _INC_GROUPBY_FIELDS, currentChart?.ref || 'cmdb_ci.name')}
      <div class="report-field-picker-label">${t('rpt_label_visual_style')}</div>
      <div class="report-size-group" id="report-inc-groupby-style">
        ${[{get label() { return t('rpt_style_donut'); },val:'donut'},{get label() { return t('rpt_style_bars'); },val:'bar'},{get label() { return t('rpt_style_bars_v'); },val:'bar-vertical'}]
          .map(o => `<button class="report-size-opt${curGbStyle === o.val ? ' active' : ''}" data-style="${o.val}">${o.label}</button>`).join('')}
      </div>
      <div id="report-inc-groupby-color-section"${curGbStyle === 'donut' ? ' style="display:none"' : ''}>
        <div class="report-field-picker-label">${t('rpt_label_bar_color')}</div>
        <select id="report-inc-groupby-color-mode" class="report-field-sel">
          <option value="multi"${!curGbColor ? ' selected' : ''}>${t('rpt_color_multi')}</option>
          <option value="single"${curGbColor ? ' selected' : ''}>${t('rpt_color_single')}</option>
        </select>
        <div id="report-inc-groupby-color-picker"${!curGbColor ? ' style="display:none"' : ''}>
          <input type="color" id="report-inc-groupby-color-input" value="${curGbColor || '#3b82f6'}"
            style="margin-top:6px;width:100%;height:32px;border:none;padding:0;cursor:pointer;background:none">
        </div>
      </div>
    ` : ''}
    ${showSla ? `
      <div class="report-field-picker-label">${t('rpt_label_sla_targets')}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:4px">
        <div>
          <label style="font-size:11px;color:var(--text-faint);display:block;margin-bottom:4px">${t('rpt_priority_p1')}</label>
          <div style="display:flex;align-items:center;gap:4px">
            <input type="number" id="report-sla-p1" min="0" max="100" value="${_slaTargets.p1 ?? 95}" style="width:56px;padding:4px 6px;background:var(--bg-el);border:1px solid var(--border);border-radius:var(--r-sm);color:var(--text-1);font-size:13px;text-align:right">
            <span style="font-size:12px;color:var(--text-faint)">%</span>
          </div>
        </div>
        <div>
          <label style="font-size:11px;color:var(--text-faint);display:block;margin-bottom:4px">${t('rpt_priority_p2')}</label>
          <div style="display:flex;align-items:center;gap:4px">
            <input type="number" id="report-sla-p2" min="0" max="100" value="${_slaTargets.p2 ?? 90}" style="width:56px;padding:4px 6px;background:var(--bg-el);border:1px solid var(--border);border-radius:var(--r-sm);color:var(--text-1);font-size:13px;text-align:right">
            <span style="font-size:12px;color:var(--text-faint)">%</span>
          </div>
        </div>
        <div>
          <label style="font-size:11px;color:var(--text-faint);display:block;margin-bottom:4px">${t('rpt_priority_p3')}</label>
          <div style="display:flex;align-items:center;gap:4px">
            <input type="number" id="report-sla-p3" min="0" max="100" value="${_slaTargets.p3 ?? 85}" style="width:56px;padding:4px 6px;background:var(--bg-el);border:1px solid var(--border);border-radius:var(--r-sm);color:var(--text-1);font-size:13px;text-align:right">
            <span style="font-size:12px;color:var(--text-faint)">%</span>
          </div>
        </div>
      </div>
    ` : ''}
    ${showVolume ? `
      <div class="report-field-picker-label">${t('rpt_label_history_months')}</div>
      <div class="report-size-group" style="flex-wrap:wrap" id="report-inc-p-months">
        ${MONTH_OPTS.map(n => `<button class="report-size-opt${n === _incidentMonths ? ' active' : ''}" data-months="${n}">${n} ${t('rpt_months')}</button>`).join('')}
      </div>
      <div class="report-field-picker-label" style="margin-top:8px">${t('rpt_label_monthly_target')}</div>
      <input type="number" id="report-inc-p-target" class="report-inc-months-input" min="0" max="9999" value="${_incidentTarget}">
    ` : ''}
    ${showBars ? `
      <div class="report-field-picker-label">${t('rpt_label_grouping')}</div>
      <select id="report-inc-p-groupby" class="report-field-sel">
        <option value="cmdb_ci"${_incidentGroupBy === 'cmdb_ci' ? ' selected' : ''}>${t('rpt_groupby_ic')}</option>
        <option value="resolution_code"${_incidentGroupBy === 'resolution_code' ? ' selected' : ''}>${t('rpt_groupby_res_code')}</option>
      </select>
    ` : ''}
    ${showHeat ? `
      <div class="report-field-picker-label" style="margin-top:8px">${t('rpt_label_heatmap_max')}</div>
      <input type="number" id="report-inc-p-heatmax" class="report-inc-months-input" min="0" max="999" value="${_heatmapMax}" placeholder="0 = automático">
    ` : ''}
    ${showLoc ? `
      <div class="report-field-picker-label">${t('rpt_label_history_months')}</div>
      <div class="report-size-group" id="report-inc-p-locmonths">
        ${LOC_OPTS.map(n => `<button class="report-size-opt${n === _locationMonths ? ' active' : ''}" data-locmonths="${n}">${n} ${t(n === 1 ? 'rpt_month' : 'rpt_months')}</button>`).join('')}
      </div>
    ` : ''}`;

  picker.innerHTML = `
    <div class="report-field-picker-title">${isEdit ? t('rpt_title_configure_chart') : t('rpt_title_new_chart')}</div>
    ${typeSection}
    ${specificSection}
    <div class="report-field-picker-label">${t('rpt_label_size')}</div>
    <div class="report-size-group" id="report-inc-size-group">${sizeOpts}</div>
    <div class="report-field-picker-actions">
      <button class="report-picker-btn-cancel" id="report-inc-p-cancel">${t('rpt_btn_cancel')}</button>
      <button class="report-picker-btn-apply"  id="report-inc-p-apply">${isEdit ? t('rpt_btn_apply') : t('rpt_btn_add')}</button>
    </div>`;
  document.body.appendChild(picker);

  document.getElementById('report-inc-p-cancel').onclick = _closeFieldPicker;
  document.getElementById('report-inc-p-apply').onclick  = _applyIncChartPicker;
  if (showGroupby) _acInit(picker, 'report-inc-groupby-input', 'report-inc-groupby-field');

  picker.addEventListener('click', e => {
    const opt = e.target.closest('.report-size-opt');
    if (!opt) return;
    const group = opt.closest('.report-size-group');
    group?.querySelectorAll('.report-size-opt').forEach(b => b.classList.remove('active'));
    opt.classList.add('active');
    if (group?.id === 'report-inc-groupby-style') {
      const colorSection = document.getElementById('report-inc-groupby-color-section');
      if (colorSection) colorSection.style.display = opt.dataset.style === 'donut' ? 'none' : '';
    }
  });

  if (showGroupby) {
    document.getElementById('report-inc-groupby-color-mode')?.addEventListener('change', e => {
      const cp = document.getElementById('report-inc-groupby-color-picker');
      if (cp) cp.style.display = e.target.value === 'single' ? '' : 'none';
    });
  }
}

function _applyIncChartPicker() {
  const picker = document.getElementById('report-field-picker');
  if (!picker) return;
  const isEdit = _incPickerIdx >= 0;
  const size   = picker.querySelector('#report-inc-size-group .report-size-opt.active')?.dataset.size || 'lg';
  const type   = isEdit ? _incidentCharts[_incPickerIdx].type : (document.getElementById('report-inc-type-sel')?.value || 'inc-volume');

  const newMonths    = parseInt(picker.querySelector('#report-inc-p-months .report-size-opt.active')?.dataset.months);
  const newTarget    = parseInt(document.getElementById('report-inc-p-target')?.value);
  const newGroupBy   = document.getElementById('report-inc-p-groupby')?.value;
  const newHeatMax   = parseInt(document.getElementById('report-inc-p-heatmax')?.value);
  const newLocMonths = parseInt(picker.querySelector('#report-inc-p-locmonths .report-size-opt.active')?.dataset.locmonths);
  const clamp01      = v => Math.min(100, Math.max(0, parseInt(v) || 0));
  const newSlaP1     = document.getElementById('report-sla-p1') ? clamp01(document.getElementById('report-sla-p1').value) : null;
  const newSlaP2     = document.getElementById('report-sla-p2') ? clamp01(document.getElementById('report-sla-p2').value) : null;
  const newSlaP3     = document.getElementById('report-sla-p3') ? clamp01(document.getElementById('report-sla-p3').value) : null;

  let needReload = false;
  if (!isNaN(newMonths)    && newMonths    !== _incidentMonths)  { _incidentMonths  = Math.min(24, Math.max(1, newMonths)); needReload = true; }
  if (!isNaN(newTarget))                                          { _incidentTarget  = Math.max(0, newTarget); }
  if (newGroupBy            && newGroupBy  !== _incidentGroupBy)  { _incidentGroupBy = newGroupBy; needReload = true; }
  if (!isNaN(newHeatMax))                                         { _heatmapMax      = Math.max(0, newHeatMax); }
  if (!isNaN(newLocMonths) && newLocMonths !== _locationMonths)   { _locationMonths  = newLocMonths; needReload = true; }
  if (newSlaP1 !== null || newSlaP2 !== null || newSlaP3 !== null) {
    _slaTargets = { p1: newSlaP1 ?? _slaTargets.p1, p2: newSlaP2 ?? _slaTargets.p2, p3: newSlaP3 ?? _slaTargets.p3 };
  }

  const isGroupby      = type === 'inc-groupby';
  const gbRef          = document.getElementById('report-inc-groupby-field')?.value;
  const gbStyle        = picker.querySelector('#report-inc-groupby-style .report-size-opt.active')?.dataset.style;
  const gbColorMode    = document.getElementById('report-inc-groupby-color-mode')?.value;
  const gbColor        = gbColorMode === 'single' ? (document.getElementById('report-inc-groupby-color-input')?.value || '') : '';

  if (isEdit) {
    const update = { ..._incidentCharts[_incPickerIdx], size };
    if (isGroupby) {
      if (gbRef)   update.ref        = gbRef;
      if (gbStyle) update.chartStyle = gbStyle;
      update.barColor = gbColor;
    }
    _incidentCharts[_incPickerIdx] = update;
  } else {
    _incidentCharts.push(isGroupby ? { type, size, ref: 'cmdb_ci', chartStyle: 'donut', barColor: '' } : { type, size });
  }

  _saveReportConfig();
  _closeFieldPicker();
  if (needReload) _load(); else _rerender();
}

// ── PRB chart picker (unified ⚙ modal) ────────────────────────────────────────

export function reportOpenPrbChartPicker(idx) {
  _prbPickerIdx = idx !== undefined ? idx : -1;
  _closeFieldPicker();
  const isEdit       = _prbPickerIdx >= 0;
  const currentChart = isEdit ? _prbCharts[_prbPickerIdx] : null;
  const currentSize  = currentChart?.size || 'lg';
  const currentType  = currentChart?.type || 'prb-evolution';

  const PRB_TYPES = [
    { val: 'prb-evolution', get label() { return t('rpt_prb_type_evolution'); } },
    { val: 'prb-donut',     get label() { return t('rpt_prb_type_donut'); } },
    { val: 'prb-aging',     get label() { return t('rpt_prb_type_aging'); } },
    { val: 'prb-oldest',    get label() { return t('rpt_prb_type_oldest'); } },
    { val: 'prb-groupby',   get label() { return t('rpt_prb_type_groupby'); } },
  ];

  const backdrop = document.createElement('div');
  backdrop.id = 'report-picker-backdrop';
  backdrop.className = 'report-field-backdrop';
  backdrop.onclick = _closeFieldPicker;
  document.body.appendChild(backdrop);

  const picker = document.createElement('div');
  picker.id = 'report-field-picker';
  picker.className = 'report-field-picker';

  const sizeOpts = [
    { val: 'sm', get label() { return t('rpt_size_3col'); } },
    { val: 'md', get label() { return t('rpt_size_2col'); } },
    { val: 'lg', get label() { return t('rpt_size_full'); } },
  ].map(o => `<button class="report-size-opt${currentSize === o.val ? ' active' : ''}" data-size="${o.val}">${o.label}</button>`).join('');

  const typeSection = !isEdit
    ? `<div class="report-field-picker-label">${t('rpt_label_chart_type')}</div>
       <select id="report-prb-type-sel" class="report-field-sel">
         ${PRB_TYPES.map(tp => `<option value="${tp.val}">${tp.label}</option>`).join('')}
       </select>`
    : `<div class="report-field-picker-label">${t('rpt_label_chart')}</div>
       <div style="font-size:13px;color:var(--text-muted);padding:2px 0 8px">${_esc(PRB_TYPES.find(tp => tp.val === currentType)?.label || currentType)}</div>`;

  const showPrbGroupby = isEdit && currentType === 'prb-groupby';
  const curPgStyle     = currentChart?.chartStyle || 'donut';
  const curPgColor     = currentChart?.barColor   || '';

  const prbGroupbySection = showPrbGroupby ? `
    <div class="report-field-picker-label">${t('rpt_label_groupby_field')}</div>
    ${_acHtml('report-prb-groupby-input', 'report-prb-groupby-field', _PRB_GROUPBY_FIELDS, currentChart?.ref || 'category')}
    <div class="report-field-picker-label">${t('rpt_label_visual_style')}</div>
    <div class="report-size-group" id="report-prb-groupby-style">
      ${[{get label() { return t('rpt_style_donut'); },val:'donut'},{get label() { return t('rpt_style_bars'); },val:'bar'},{get label() { return t('rpt_style_bars_v'); },val:'bar-vertical'}]
        .map(o => `<button class="report-size-opt${curPgStyle === o.val ? ' active' : ''}" data-style="${o.val}">${o.label}</button>`).join('')}
    </div>
    <div id="report-prb-groupby-color-section"${curPgStyle === 'donut' ? ' style="display:none"' : ''}>
      <div class="report-field-picker-label">${t('rpt_label_bar_color')}</div>
      <select id="report-prb-groupby-color-mode" class="report-field-sel">
        <option value="multi"${!curPgColor ? ' selected' : ''}>${t('rpt_color_multi')}</option>
        <option value="single"${curPgColor ? ' selected' : ''}>${t('rpt_color_single')}</option>
      </select>
      <div id="report-prb-groupby-color-picker"${!curPgColor ? ' style="display:none"' : ''}>
        <input type="color" id="report-prb-groupby-color-input" value="${curPgColor || '#10b981'}"
          style="margin-top:6px;width:100%;height:32px;border:none;padding:0;cursor:pointer;background:none">
      </div>
    </div>` : '';

  picker.innerHTML = `
    <div class="report-field-picker-title">${isEdit ? t('rpt_title_configure_chart') : t('rpt_title_new_chart')}</div>
    ${typeSection}
    ${prbGroupbySection}
    <div class="report-field-picker-label">${t('rpt_label_size')}</div>
    <div class="report-size-group" id="report-prb-size-group">${sizeOpts}</div>
    <div class="report-field-picker-actions">
      <button class="report-picker-btn-cancel" id="report-prb-p-cancel">${t('rpt_btn_cancel')}</button>
      <button class="report-picker-btn-apply"  id="report-prb-p-apply">${isEdit ? t('rpt_btn_apply') : t('rpt_btn_add')}</button>
    </div>`;
  document.body.appendChild(picker);

  document.getElementById('report-prb-p-cancel').onclick = _closeFieldPicker;
  document.getElementById('report-prb-p-apply').onclick  = _applyPrbChartPicker;
  if (showPrbGroupby) _acInit(picker, 'report-prb-groupby-input', 'report-prb-groupby-field');

  picker.addEventListener('click', e => {
    const opt = e.target.closest('.report-size-opt');
    if (!opt) return;
    const group = opt.closest('.report-size-group');
    group?.querySelectorAll('.report-size-opt').forEach(b => b.classList.remove('active'));
    opt.classList.add('active');
    if (group?.id === 'report-prb-groupby-style') {
      const colorSection = document.getElementById('report-prb-groupby-color-section');
      if (colorSection) colorSection.style.display = opt.dataset.style === 'donut' ? 'none' : '';
    }
  });

  if (showPrbGroupby) {
    document.getElementById('report-prb-groupby-color-mode')?.addEventListener('change', e => {
      const cp = document.getElementById('report-prb-groupby-color-picker');
      if (cp) cp.style.display = e.target.value === 'single' ? '' : 'none';
    });
  }
}

function _applyPrbChartPicker() {
  const picker = document.getElementById('report-field-picker');
  if (!picker) return;
  const isEdit = _prbPickerIdx >= 0;
  const size   = picker.querySelector('#report-prb-size-group .report-size-opt.active')?.dataset.size || 'lg';
  const type   = isEdit ? _prbCharts[_prbPickerIdx].type : (document.getElementById('report-prb-type-sel')?.value || 'prb-evolution');

  const isPrbGroupby   = type === 'prb-groupby';
  const pgRef          = document.getElementById('report-prb-groupby-field')?.value;
  const pgStyle        = picker.querySelector('#report-prb-groupby-style .report-size-opt.active')?.dataset.style;
  const pgColorMode    = document.getElementById('report-prb-groupby-color-mode')?.value;
  const pgColor        = pgColorMode === 'single' ? (document.getElementById('report-prb-groupby-color-input')?.value || '') : '';

  if (isEdit) {
    const update = { ..._prbCharts[_prbPickerIdx], size };
    if (isPrbGroupby) {
      if (pgRef)   update.ref        = pgRef;
      if (pgStyle) update.chartStyle = pgStyle;
      update.barColor = pgColor;
    }
    _prbCharts[_prbPickerIdx] = update;
  } else {
    _prbCharts.push(isPrbGroupby ? { type, size, ref: 'category', chartStyle: 'donut', barColor: '' } : { type, size });
  }

  _saveReportConfig();
  _closeFieldPicker();
  _rerender();
}

function _rerender() {
  if (!_lastPayload) { _load(true); return; }
  const body = document.getElementById('report-modal-body');
  if (body) {
    body.innerHTML = _buildHTML(_lastPayload);
  }
}

function _closeFieldPicker() {
  document.getElementById('report-field-picker')?.remove();
  document.getElementById('report-picker-backdrop')?.remove();
}

export function reportOpenIncidentVolumePicker() {
  _closeFieldPicker();

  const MONTH_OPTS = [3, 5, 6, 8, 10, 12, 13, 24];
  const monthBtns = MONTH_OPTS.map(n =>
    `<button class="report-size-opt${n === _incidentMonths ? ' active' : ''}" data-months="${n}">${n} ${t('rpt_months')}</button>`
  ).join('');

  const backdrop = document.createElement('div');
  backdrop.id        = 'report-picker-backdrop';
  backdrop.className = 'report-field-backdrop';
  backdrop.onclick   = _closeFieldPicker;
  document.body.appendChild(backdrop);

  const picker = document.createElement('div');
  picker.id        = 'report-field-picker';
  picker.className = 'report-field-picker';
  picker.innerHTML = `
    <div class="report-field-picker-title">${t('rpt_title_cfg_inc_hist')}</div>
    <div class="report-field-picker-label">${t('rpt_label_history_months')}</div>
    <div class="report-size-group" id="report-inc-vol-months-group" style="flex-wrap:wrap">${monthBtns}</div>
    <div class="report-field-picker-label" style="margin-top:10px">${t('rpt_label_monthly_target')}</div>
    <input type="number" id="report-inc-vol-target" class="report-inc-months-input" min="0" max="9999" value="${_incidentTarget}">
    <div class="report-field-picker-actions">
      <button class="report-picker-btn-cancel" id="report-inc-vol-cancel">${t('rpt_btn_cancel')}</button>
      <button class="report-picker-btn-apply"  id="report-inc-vol-apply">${t('rpt_btn_apply')}</button>
    </div>`;
  document.body.appendChild(picker);

  document.getElementById('report-inc-vol-cancel').onclick = _closeFieldPicker;
  document.getElementById('report-inc-vol-apply').onclick  = _applyIncidentVolumePicker;

  picker.querySelectorAll('#report-inc-vol-months-group .report-size-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      picker.querySelectorAll('#report-inc-vol-months-group .report-size-opt').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
}

function _applyIncidentVolumePicker() {
  const newMonths = parseInt(document.querySelector('#report-inc-vol-months-group .report-size-opt.active')?.dataset.months) || _incidentMonths;
  const newTarget = Math.max(0, parseInt(document.getElementById('report-inc-vol-target')?.value) || 0);
  _closeFieldPicker();
  const monthsChanged = newMonths !== _incidentMonths;
  _incidentMonths = newMonths;
  _incidentTarget = newTarget;
  _saveReportConfig();
  if (monthsChanged) _load(); else _rerender();
}

export function reportOpenIncidentGroupByPicker() {
  _closeFieldPicker();
  const selectOpts = [
    { val: 'cmdb_ci',         get label() { return t('rpt_inc_cfg_groupby_ic'); } },
    { val: 'resolution_code', get label() { return t('rpt_groupby_res_code'); } },
  ].map(o => `<option value="${o.val}"${_incidentGroupBy === o.val ? ' selected' : ''}>${o.label}</option>`).join('');

  const backdrop = document.createElement('div');
  backdrop.id        = 'report-picker-backdrop';
  backdrop.className = 'report-field-backdrop';
  backdrop.onclick   = _closeFieldPicker;
  document.body.appendChild(backdrop);

  const picker = document.createElement('div');
  picker.id        = 'report-field-picker';
  picker.className = 'report-field-picker';
  picker.innerHTML = `
    <div class="report-field-picker-title">${t('rpt_title_cfg_groupby')}</div>
    <div class="report-field-picker-label">${t('rpt_label_group_by')}</div>
    <select id="report-inc-groupby-sel" class="report-inc-months-sel" style="width:100%">${selectOpts}</select>
    <div class="report-field-picker-actions">
      <button class="report-picker-btn-cancel" id="report-inc-groupby-cancel">${t('rpt_btn_cancel')}</button>
      <button class="report-picker-btn-apply"  id="report-inc-groupby-apply">${t('rpt_btn_apply')}</button>
    </div>`;
  document.body.appendChild(picker);

  document.getElementById('report-inc-groupby-cancel').onclick = _closeFieldPicker;
  document.getElementById('report-inc-groupby-apply').onclick  = _applyIncidentGroupByPicker;
}

function _applyIncidentGroupByPicker() {
  const val = document.getElementById('report-inc-groupby-sel')?.value || _incidentGroupBy;
  _closeFieldPicker();
  _incidentGroupBy = val === 'resolution_code' ? 'resolution_code' : 'cmdb_ci';
  _saveReportConfig();
  _rerender();
}

export function reportOpenHeatmapPicker() {
  _closeFieldPicker();

  const backdrop = document.createElement('div');
  backdrop.id        = 'report-picker-backdrop';
  backdrop.className = 'report-field-backdrop';
  backdrop.onclick   = _closeFieldPicker;
  document.body.appendChild(backdrop);

  const picker = document.createElement('div');
  picker.id        = 'report-field-picker';
  picker.className = 'report-field-picker';
  picker.innerHTML = `
    <div class="report-field-picker-title">${t('rpt_title_cfg_heatmap')}</div>
    <div class="report-field-picker-label">
      ${t('rpt_label_systems_disp')}
      <span style="font-weight:400;opacity:.7;display:block;font-size:11px;margin-top:2px">${t('rpt_heatmap_systems_hint')}</span>
    </div>
    <input type="number" id="report-heatmap-topn-input" class="report-inc-months-input" min="0" max="999" value="${_heatmapTopN}" placeholder="9">
    <div class="report-field-picker-label" style="margin-top:12px">
      ${t('rpt_label_heatmap_max')}
      <span style="font-weight:400;opacity:.7;display:block;font-size:11px;margin-top:2px">${t('rpt_heatmap_hint')}</span>
    </div>
    <input type="number" id="report-heatmap-max-input" class="report-inc-months-input" min="0" max="9999" value="${_heatmapMax}" placeholder="0">
    <div class="report-field-picker-actions">
      <button class="report-picker-btn-cancel" id="report-heatmap-cancel">${t('rpt_btn_cancel')}</button>
      <button class="report-picker-btn-apply"  id="report-heatmap-apply">${t('rpt_btn_apply')}</button>
    </div>`;
  document.body.appendChild(picker);

  document.getElementById('report-heatmap-cancel').onclick = _closeFieldPicker;
  document.getElementById('report-heatmap-apply').onclick  = _applyHeatmapPicker;
}

function _applyHeatmapPicker() {
  _heatmapTopN = Math.max(0, parseInt(document.getElementById('report-heatmap-topn-input')?.value) || 0);
  _heatmapMax  = Math.max(0, parseInt(document.getElementById('report-heatmap-max-input')?.value)  || 0);
  _closeFieldPicker();
  _saveReportConfig();
  _rerender();
}

export function reportOpenLocationPicker() {
  _closeFieldPicker();

  const backdrop = document.createElement('div');
  backdrop.id        = 'report-picker-backdrop';
  backdrop.className = 'report-field-backdrop';
  backdrop.onclick   = _closeFieldPicker;
  document.body.appendChild(backdrop);

  const picker = document.createElement('div');
  picker.id        = 'report-field-picker';
  picker.className = 'report-field-picker';

  const monthOpts = [1, 3, 6].map(v =>
    `<button class="report-size-opt${_locationMonths === v ? ' active' : ''}" data-locmonths="${v}">${v} ${t(v === 1 ? 'rpt_month' : 'rpt_months')}</button>`
  ).join('');

  picker.innerHTML = `
    <div class="report-field-picker-title">${t('rpt_title_cfg_location')}</div>
    <div class="report-field-picker-label">${t('rpt_label_months_disp')}</div>
    <div class="report-size-group" id="report-loc-months-group">${monthOpts}</div>
    <div class="report-field-picker-actions">
      <button class="report-picker-btn-cancel" id="report-loc-cancel">${t('rpt_btn_cancel')}</button>
      <button class="report-picker-btn-apply"  id="report-loc-apply">${t('rpt_btn_apply')}</button>
    </div>`;
  document.body.appendChild(picker);

  document.getElementById('report-loc-cancel').onclick = _closeFieldPicker;
  document.getElementById('report-loc-apply').onclick  = () => {
    const active = document.querySelector('#report-loc-months-group .report-size-opt.active');
    _locationMonths = parseInt(active?.dataset.locmonths) || 6;
    _closeFieldPicker();
    _saveReportConfig();
    _rerender();
  };

  picker.addEventListener('click', e => {
    const opt = e.target.closest('.report-size-opt');
    if (!opt) return;
    picker.querySelectorAll('.report-size-opt').forEach(b => b.classList.remove('active'));
    opt.classList.add('active');
  });
}

let _agingPickerIdx = -1; // índice do gráfico de aging sendo configurado

export async function reportOpenAgingPicker(idx) {
  _agingPickerIdx = idx ?? 0;
  _closeFieldPicker();

  const currentSize = _agingCharts[_agingPickerIdx]?.size || 'md';
  const sizeOpts = [
    { val: 'sm', get label() { return t('rpt_size_3col'); } },
    { val: 'md', get label() { return t('rpt_size_2col'); } },
    { val: 'lg', get label() { return t('rpt_size_full'); } },
  ].map(o => `<button class="report-size-opt${currentSize === o.val ? ' active' : ''}" data-size="${o.val}">${o.label}</button>`).join('');

  const backdrop = document.createElement('div');
  backdrop.id        = 'report-picker-backdrop';
  backdrop.className = 'report-field-backdrop';
  backdrop.onclick   = _closeFieldPicker;
  document.body.appendChild(backdrop);

  const picker = document.createElement('div');
  picker.id        = 'report-field-picker';
  picker.className = 'report-field-picker';
  picker.innerHTML = `
    <div class="report-field-picker-title">${t('rpt_title_cfg_aging')}</div>
    <div class="report-field-picker-label">${t('rpt_label_monitored_state')}</div>
    <select id="report-aging-state-sel" class="report-field-sel">
      <option value="${_esc(_agingState)}">${_esc(_agingState)}</option>
    </select>
    <div class="report-field-picker-label">${t('rpt_label_aging_buckets')}</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
      <div><label style="font-size:11px;color:var(--text-faint)">${t('rpt_label_limit')} 1</label><br>
        <input type="number" id="report-aging-rb0" class="report-inc-months-input" style="width:100%;box-sizing:border-box" min="1" max="999" value="${_agingBuckets[0]}"></div>
      <div><label style="font-size:11px;color:var(--text-faint)">${t('rpt_label_limit')} 2</label><br>
        <input type="number" id="report-aging-rb1" class="report-inc-months-input" style="width:100%;box-sizing:border-box" min="1" max="999" value="${_agingBuckets[1]}"></div>
      <div><label style="font-size:11px;color:var(--text-faint)">${t('rpt_label_limit')} 3</label><br>
        <input type="number" id="report-aging-rb2" class="report-inc-months-input" style="width:100%;box-sizing:border-box" min="1" max="999" value="${_agingBuckets[2]}"></div>
      <div><label style="font-size:11px;color:var(--text-faint)">${t('rpt_label_limit')} 4</label><br>
        <input type="number" id="report-aging-rb3" class="report-inc-months-input" style="width:100%;box-sizing:border-box" min="1" max="999" value="${_agingBuckets[3]}"></div>
    </div>
    <div class="report-field-picker-label">${t('rpt_label_size')}</div>
    <div class="report-size-group" id="report-aging-size-group">${sizeOpts}</div>
    <div class="report-field-picker-actions">
      <button class="report-picker-btn-cancel" id="report-aging-cancel-btn">${t('rpt_btn_cancel')}</button>
      <button class="report-picker-btn-apply" id="report-aging-apply-btn">${t('rpt_btn_apply')}</button>
    </div>`;
  document.body.appendChild(picker);

  document.getElementById('report-aging-cancel-btn').onclick = _closeFieldPicker;
  document.getElementById('report-aging-apply-btn').onclick  = _applyAgingPicker;

  // Toggle de tamanho
  picker.querySelectorAll('#report-aging-size-group .report-size-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      picker.querySelectorAll('#report-aging-size-group .report-size-opt').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Carrega estados do Azure e popula o select
  try {
    const r    = await fetch('/api/us-states?' + new URLSearchParams({ project: _reportProject }));
    const data = await r.json();
    const sel  = document.getElementById('report-aging-state-sel');
    if (sel && data.states?.length) {
      sel.innerHTML = data.states
        .map(s => `<option value="${_esc(s)}"${s === _agingState ? ' selected' : ''}>${_esc(s)}</option>`)
        .join('');
    }
  } catch (_) {}
}

function _applyAgingPicker() {
  const sel      = document.getElementById('report-aging-state-sel');
  const newState = sel?.value || _agingState;
  const newSize  = document.querySelector('#report-aging-size-group .report-size-opt.active')?.dataset.size
                || _agingCharts[_agingPickerIdx]?.size || 'md';
  const rb0 = Math.max(1, parseInt(document.getElementById('report-aging-rb0')?.value) || _agingBuckets[0]);
  const rb1 = Math.max(rb0 + 1, parseInt(document.getElementById('report-aging-rb1')?.value) || _agingBuckets[1]);
  const rb2 = Math.max(rb1 + 1, parseInt(document.getElementById('report-aging-rb2')?.value) || _agingBuckets[2]);
  const rb3 = Math.max(rb2 + 1, parseInt(document.getElementById('report-aging-rb3')?.value) || _agingBuckets[3]);
  const newBuckets = [rb0, rb1, rb2, rb3];
  _closeFieldPicker();

  const stateChanged   = newState !== _agingState;
  const bucketsChanged = newBuckets.some((v, i) => v !== _agingBuckets[i]);
  if (_agingCharts[_agingPickerIdx]) _agingCharts[_agingPickerIdx] = { size: newSize };
  if (stateChanged)   _agingState   = newState;
  if (bucketsChanged) _agingBuckets = newBuckets;

  _saveReportConfig();
  if (stateChanged) _load();
  else _rerender();
}

export async function reportOpenDeliveryStatesPicker() {
  _closeFieldPicker();

  const backdrop = document.createElement('div');
  backdrop.id = 'report-picker-backdrop';
  backdrop.className = 'report-field-backdrop';
  backdrop.onclick = _closeFieldPicker;
  document.body.appendChild(backdrop);

  const picker = document.createElement('div');
  picker.id = 'report-field-picker';
  picker.className = 'report-field-picker';
  picker.innerHTML = `
    <div class="report-field-picker-title">${t('rpt_title_delivery_states')}</div>
    <div class="report-field-picker-desc" style="font-size:12px;color:var(--text-faint);margin-top:-6px">${t('rpt_delivery_states_desc')}</div>
    <div id="report-delivery-states-body"><div class="report-field-picker-loading">${t('rpt_loading_states')}</div></div>
    <div class="report-field-picker-actions">
      <button class="report-picker-btn-cancel" id="report-delivery-cancel">${t('rpt_btn_cancel')}</button>
      <button class="report-picker-btn-apply"  id="report-delivery-apply">${t('rpt_btn_apply')}</button>
    </div>`;
  document.body.appendChild(picker);

  document.getElementById('report-delivery-cancel').onclick = _closeFieldPicker;
  document.getElementById('report-delivery-apply').onclick  = _applyDeliveryStatesPicker;

  // Load states from Azure
  try {
    const r    = await fetch('/api/us-states?' + new URLSearchParams({ project: _reportProject }));
    const data = await r.json();
    const body = document.getElementById('report-delivery-states-body');
    if (!body) return;
    const states = data.states?.length ? data.states : ['Closed', 'Done', 'Resolved', 'UAT', 'In Review'];
    body.innerHTML = `<div style="display:flex;flex-direction:column;gap:6px;max-height:240px;overflow-y:auto;padding:2px 0">` +
      states.map(s => {
        const checked = _deliveryStates.includes(s) ? ' checked' : '';
        return `<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:var(--text-1)">
          <input type="checkbox" value="${_esc(s)}"${checked} style="accent-color:var(--c-blue);width:15px;height:15px">
          ${_esc(s)}
        </label>`;
      }).join('') + `</div>`;
  } catch (_) {
    const body = document.getElementById('report-delivery-states-body');
    if (body) body.innerHTML = `<div class="report-field-picker-error">${t('rpt_error_states')}</div>`;
  }
}

function _applyDeliveryStatesPicker() {
  const checkboxes = document.querySelectorAll('#report-delivery-states-body input[type=checkbox]:checked');
  const selected   = [...checkboxes].map(cb => cb.value);
  _closeFieldPicker();
  if (!selected.length) return; // não salva seleção vazia
  _deliveryStates = selected;
  _saveReportConfig();
  _load();
}

export function reportOpenSlaPicker() {
  _closeFieldPicker();

  const backdrop = document.createElement('div');
  backdrop.id        = 'report-picker-backdrop';
  backdrop.className = 'report-field-backdrop';
  backdrop.onclick   = _closeFieldPicker;
  document.body.appendChild(backdrop);

  const picker = document.createElement('div');
  picker.id        = 'report-field-picker';
  picker.className = 'report-field-picker';
  picker.innerHTML = `
    <div class="report-field-picker-title">${t('rpt_title_cfg_sla')}</div>
    <div style="font-size:12px;color:var(--text-faint);margin-bottom:14px;line-height:1.6">
      ${t('rpt_sla_desc_1')} <strong style="color:var(--text-1)">business_elapsed_percentage</strong> ${t('rpt_sla_desc_2')} <code>task_sla</code> ${t('rpt_sla_desc_3')}<br>
      ${t('rpt_sla_violated')}
    </div>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px">
      <input type="checkbox" id="report-sla-enabled-chk" style="width:15px;height:15px;accent-color:var(--c-blue);cursor:pointer" ${_slaEnabled ? 'checked' : ''}>
      <label for="report-sla-enabled-chk" style="font-size:13px;color:var(--text-1);cursor:pointer;user-select:none">${t('rpt_label_show_sla')}</label>
    </div>
    <div style="font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:.04em">${t('rpt_label_sla_targets')}</div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:4px">
      <div>
        <label style="font-size:11px;color:var(--text-faint);display:block;margin-bottom:4px">${t('rpt_priority_p1')}</label>
        <div style="display:flex;align-items:center;gap:4px">
          <input type="number" id="report-sla-p1" min="0" max="100" value="${_slaTargets.p1 ?? 95}" style="width:56px;padding:4px 6px;background:var(--bg-el);border:1px solid var(--border);border-radius:var(--r-sm);color:var(--text-1);font-size:13px;text-align:right">
          <span style="font-size:12px;color:var(--text-faint)">%</span>
        </div>
      </div>
      <div>
        <label style="font-size:11px;color:var(--text-faint);display:block;margin-bottom:4px">${t('rpt_priority_p2')}</label>
        <div style="display:flex;align-items:center;gap:4px">
          <input type="number" id="report-sla-p2" min="0" max="100" value="${_slaTargets.p2 ?? 90}" style="width:56px;padding:4px 6px;background:var(--bg-el);border:1px solid var(--border);border-radius:var(--r-sm);color:var(--text-1);font-size:13px;text-align:right">
          <span style="font-size:12px;color:var(--text-faint)">%</span>
        </div>
      </div>
      <div>
        <label style="font-size:11px;color:var(--text-faint);display:block;margin-bottom:4px">${t('rpt_priority_p3')}</label>
        <div style="display:flex;align-items:center;gap:4px">
          <input type="number" id="report-sla-p3" min="0" max="100" value="${_slaTargets.p3 ?? 85}" style="width:56px;padding:4px 6px;background:var(--bg-el);border:1px solid var(--border);border-radius:var(--r-sm);color:var(--text-1);font-size:13px;text-align:right">
          <span style="font-size:12px;color:var(--text-faint)">%</span>
        </div>
      </div>
    </div>
    <div class="report-field-picker-actions">
      <button class="report-picker-btn-cancel" id="report-sla-cancel">${t('rpt_btn_cancel')}</button>
      <button class="report-picker-btn-apply" id="report-sla-apply">${t('rpt_btn_apply')}</button>
    </div>`;
  document.body.appendChild(picker);

  picker.querySelector('#report-sla-cancel').onclick = _closeFieldPicker;
  picker.querySelector('#report-sla-apply').onclick  = _applySlaPicker;
}

async function _applySlaPicker() {
  const enabled = document.getElementById('report-sla-enabled-chk')?.checked ?? false;
  const clamp   = v => Math.min(100, Math.max(0, parseInt(v) || 0));
  const p1 = clamp(document.getElementById('report-sla-p1')?.value);
  const p2 = clamp(document.getElementById('report-sla-p2')?.value);
  const p3 = clamp(document.getElementById('report-sla-p3')?.value);
  _closeFieldPicker();
  _slaEnabled  = enabled;
  _slaTargets  = { p1, p2, p3 };
  await fetch('/api/sn-config', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ project: _reportProject, slaEnabled: enabled }),
  }).catch(() => {});
  _saveReportConfig();
  _rerender();
}

function _applyChartPicker() {
  const size       = document.querySelector('#report-size-group-el .report-size-opt.active')?.dataset.size
                  || document.querySelector('#report-field-picker .report-size-opt[data-size].active')?.dataset.size
                  || 'md';
  const chartStyle    = document.querySelector('#report-style-group .report-size-opt.active')?.dataset.style || 'donut';
  const countBy       = document.querySelector('#report-metric-group .report-size-opt.active')?.dataset.countby || 'count';
  const barColorMode  = document.getElementById('report-bar-color-mode')?.value;
  const barColor      = barColorMode === 'single' ? (document.getElementById('report-bar-color-input')?.value || '') : '';
  let needsRefetch = false;

  if (_pickerIdx >= 0) {
    // Edit existing chart
    const chart = _reportCharts[_pickerIdx];
    if (chart.type === 'incidents') {
      const months = Math.min(24, Math.max(1, parseInt(document.getElementById('report-inc-months')?.value) || 5));
      _reportCharts[_pickerIdx] = { type: 'incidents', size, months };
    } else if (chart.type === 'incident-location') {
      const months = Math.min(6, Math.max(1, parseInt(document.getElementById('report-inc-months')?.value) || 6));
      _reportCharts[_pickerIdx] = { type: 'incident-location', size, months };
    } else if (chart.type === 'donut') {
      const sel = document.getElementById('report-field-sel');
      if (sel) {
        const ref   = sel.value;
        const label = ref ? (sel.options[sel.selectedIndex]?.text || ref) : t('rpt_item_type');
        needsRefetch = ref !== chart.ref;
        _reportCharts[_pickerIdx] = { type: 'donut', ref, label, size, chartStyle, countBy, barColor };
      } else {
        _reportCharts[_pickerIdx] = { ...chart, size, chartStyle, countBy, barColor };
      }
    } else {
      // sprint or volatility — only size can change
      _reportCharts[_pickerIdx] = { ...chart, size };
    }
  } else {
    // Add new chart
    const typeSel = document.getElementById('report-chart-type-sel');
    const type    = typeSel?.value || 'donut';
    if (type === 'incidents') {
      const months = Math.min(24, Math.max(1, parseInt(document.getElementById('report-inc-months')?.value) || 5));
      _reportCharts.push({ type: 'incidents', size, months });
    } else if (type === 'incident-location') {
      const months = Math.min(6, Math.max(1, parseInt(document.getElementById('report-inc-months')?.value) || 6));
      _reportCharts.push({ type: 'incident-location', size, months });
    } else if (type === 'donut') {
      const sel   = document.getElementById('report-field-sel');
      const ref   = sel?.value || '';
      const label = ref ? (sel?.options[sel?.selectedIndex]?.text || ref) : t('rpt_item_type');
      _reportCharts.push({ type: 'donut', ref, label, size, chartStyle, countBy, barColor });
      needsRefetch = true;
    } else {
      _reportCharts.push({ type, size });
    }
  }

  _saveReportConfig();
  _closeFieldPicker();
  if (needsRefetch) {
    _load(true);
  } else {
    _rerender();
  }
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (document.getElementById('report-inc-modal-overlay')) { _closeIncidentsModal(); return; }
    if (document.getElementById('report-modal')?.classList.contains('open')) closeReport();
  }
});

// ── Incidents backlog modal ─────────────────────────────────────────────────

function _closeIncidentsModal() {
  document.getElementById('report-inc-modal-overlay')?.remove();
}

export function reportCloseIncidentsModal() { _closeIncidentsModal(); }

export function reportExportIncidentsCSV() {
  const tbl = document.querySelector('#report-inc-modal-overlay .report-inc-table');
  if (!tbl) return;
  const headers = Array.from(tbl.querySelectorAll('thead tr:first-child th')).map(th => th.textContent.trim());
  const visibleRows = Array.from(tbl.querySelectorAll('tbody tr')).filter(tr => tr.style.display !== 'none');
  const csvRows = [headers, ...visibleRows.map(tr =>
    Array.from(tr.querySelectorAll('td')).map(td => `"${td.textContent.trim().replace(/"/g, '""')}"`)
  )];
  const csv = '\uFEFF' + csvRows.map(r => r.join(';')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `incidentes_${_reportProject || 'export'}_${_reportMonth || ''}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function _buildIncidentsTable(items) {
  const priLabel = p => ({ '1': 'P1', '2': 'P2', '3': 'P3', '4': 'P4' }[p] || p || '—');
  const priCls   = p => ({ '1': 'p1', '2': 'p2', '3': 'p3', '4': 'p4' }[p] || 'p4');
  const fmtDate  = d => {
    if (!d) return '—';
    const dt = new Date(d);
    if (isNaN(dt)) return d;
    return dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };
  const rows = items.map(i => `
    <tr>
      <td class="inc-num"><a href="${_esc(i.url)}" target="_blank" rel="noopener">${_esc(i.number) || '—'}</a></td>
      <td class="inc-desc">${_esc(i.description) || '—'}</td>
      <td><span class="report-inc-priority ${priCls(i.priority)}">${priLabel(i.priority)}</span></td>
      <td>${_esc(i.state) || '—'}</td>
      <td style="white-space:nowrap">${fmtDate(i.openedAt)}</td>
      <td>${_esc(i.assignedTo) || '—'}</td>
      <td>${_esc(i.resolutionCode) || '—'}</td>
      <td>${_esc(i.affectedIC) || '—'}</td>
      <td>${_esc(i.impactedPlants) || '—'}</td>
    </tr>`).join('');
  // Unique values for select-filter columns: 2=Prior, 3=Estado, 5=Assigned to, 6=Res.Code, 7=IC Afetado, 8=Imp.Plants
  const selectVals = {
    2: [...new Set(items.map(i => priLabel(i.priority)).filter(Boolean))].sort(),
    3: [...new Set(items.map(i => i.state  || '—'))].sort(),
    5: [...new Set(items.map(i => i.assignedTo     || '—'))].sort(),
    6: [...new Set(items.map(i => i.resolutionCode || '—'))].sort(),
    7: [...new Set(items.map(i => i.affectedIC     || '—'))].sort(),
    8: [...new Set(items.map(i => i.impactedPlants || '—'))].sort(),
  };
  const filterRow = `<tr class="inc-filter-row">${Array.from({ length: 9 }, (_, ci) => {
    if (selectVals[ci]) {
      const opts = selectVals[ci].map(v => `<option value="${_esc(v)}">${_esc(v)}</option>`).join('');
      return `<th><select data-col="${ci}"><option value="">${t('rpt_filter_all')}</option>${opts}</select></th>`;
    }
    return `<th><input type="text" data-col="${ci}" placeholder="⌕" title="${t('rpt_filter_placeholder')}"></th>`;
  }).join('')}</tr>`;
  return `<table class="report-inc-table">
    <thead>
      <tr>
        <th>${t('rpt_inc_modal_number')}</th><th>${t('rpt_inc_modal_desc')}</th><th>${t('rpt_inc_modal_priority')}</th><th>${t('rpt_inc_modal_state')}</th><th>${t('rpt_inc_modal_opened')}</th>
        <th>${t('rpt_inc_col_assignedto')}</th><th>${t('rpt_inc_modal_res_code')}</th><th>${t('rpt_inc_modal_ci')}</th><th>${t('rpt_inc_col_plants')}</th>
      </tr>
      ${filterRow}
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function _initIncidentTableFilters(tbl) {
  const controls = tbl.querySelectorAll('.inc-filter-row [data-col]');
  function applyFilters() {
    const filters = Array.from(controls).map(el => ({
      col:   +el.dataset.col,
      val:   el.value.trim().toLowerCase(),
      exact: el.tagName === 'SELECT',
    }));
    tbl.querySelectorAll('tbody tr').forEach(row => {
      const tds = row.querySelectorAll('td');
      const show = filters.every(f => {
        if (!f.val) return true;
        const text = tds[f.col]?.textContent?.toLowerCase() || '';
        return f.exact ? text === f.val : text.includes(f.val);
      });
      row.style.display = show ? '' : 'none';
    });
  }
  controls.forEach(ctrl => {
    ctrl.addEventListener('change', applyFilters);
    if (ctrl.tagName === 'INPUT') ctrl.addEventListener('input', applyFilters);
  });
}

function _incOnclick(mode, month, filterField, filterValue, title) {
  const json = JSON.stringify({ mode, month, filterField, filterValue, title }).replace(/'/g, '&#39;');
  return `data-inc='${json}' onclick="reportOpenIncidentFilter(this)" style="cursor:pointer"`;
}

async function _showIncidentsModal(title, fetchParams) {
  _closeIncidentsModal();
  const overlay = document.createElement('div');
  overlay.id        = 'report-inc-modal-overlay';
  overlay.className = 'report-inc-modal-overlay open';
  overlay.onclick   = e => { if (e.target === overlay) _closeIncidentsModal(); };

  const panel = document.createElement('div');
  panel.className = 'report-inc-modal-panel';
  panel.innerHTML = `
    <div class="report-inc-modal-header">
      <div class="report-inc-modal-title">${_esc(title)}</div>
      <div class="report-inc-modal-actions">
        <button class="report-inc-export-btn" id="report-inc-export-btn" onclick="reportExportIncidentsCSV()" title="${t('rpt_inc_export_tooltip')}">&#x2193; ${t('rpt_inc_export_btn')}</button>
        <button class="modal-maximize" id="report-inc-max-btn" onclick="toggleReportIncMax()" title="Maximizar">&#x2922;</button>
        <button class="report-inc-modal-close" onclick="reportCloseIncidentsModal()">&#x2715;</button>
      </div>
    </div>
    <div class="report-inc-modal-body">
      <div class="report-loading" style="padding:32px 20px">${t('rpt_loading')}</div>
    </div>`;
  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  try {
    const r = await fetch(`/api/sn-incidents?${fetchParams}`);
    const { incidents, error } = await r.json();
    const body = panel.querySelector('.report-inc-modal-body');
    if (error) {
      body.innerHTML = `<div class="report-inc-modal-empty">${t('rpt_inc_modal_error')} ${error}</div>`;
    } else if (!incidents || incidents.length === 0) {
      body.innerHTML = `<div class="report-inc-modal-empty">${t('rpt_no_incidents_found')}</div>`;
    } else {
      body.innerHTML = `<div class="report-inc-modal-count">${incidents.length} ${t(incidents.length !== 1 ? 'rpt_inc_count_p' : 'rpt_inc_count_s')}</div>${_buildIncidentsTable(incidents)}`;
      _initIncidentTableFilters(body.querySelector('.report-inc-table'));
    }
  } catch {
    panel.querySelector('.report-inc-modal-body').innerHTML = `<div class="report-inc-modal-empty">${t('rpt_error_incidents')}</div>`;
  }
}

export function reportOpenIncidentFilter(el) {
  const raw = typeof el === 'string' ? el : (el?.dataset?.inc || el?.getAttribute?.('data-inc') || '');
  if (!raw) return;
  let mode, month, filterField, filterValue, title;
  try { ({ mode, month, filterField, filterValue, title } = JSON.parse(raw)); } catch { return; }
  const params = new URLSearchParams({ project: _reportProject, month, mode, filterField, filterValue });
  _showIncidentsModal(title || t('rpt_filter_incidents'), params.toString());
}

export async function reportOpenIncidentsModal() {
  const params = new URLSearchParams({ project: _reportProject, month: _reportMonth || '', mode: 'backlog', filterField: '', filterValue: '' });
  _showIncidentsModal(t('rpt_inc_modal_backlog'), params.toString());
}

export function toggleReportIncMax() {
  const panel = document.querySelector('.report-inc-modal-panel');
  if (!panel) return;
  const isMax = panel.classList.toggle('maximized');
  const btn = document.getElementById('report-inc-max-btn');
  if (btn) btn.textContent = isMax ? '⤡' : '⤢';
}

export function reportOpenTargetModal() {
  document.getElementById('inc-target-modal')?.remove();
  const el = document.createElement('div');
  el.id = 'inc-target-modal';
  el.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45)';
  el.innerHTML = `
    <div style="background:var(--bg-card);border:1px solid var(--bg-border);border-radius:12px;padding:24px 24px 20px;width:300px;display:flex;flex-direction:column;gap:14px;box-shadow:0 8px 32px rgba(0,0,0,.3)">
      <div style="font-size:14px;font-weight:600;color:var(--text-1)">${t('rpt_title_target_monthly')}</div>
      <div style="font-size:12px;color:var(--text-2);line-height:1.5">${t('rpt_hint_target_monthly')}</div>
      <input id="inc-target-input" type="number" min="1" max="9999" placeholder="Ex: 30"
        style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--bg-border);border-radius:6px;background:var(--bg-2);color:var(--text-1);font-size:14px;outline:none"
        value="${_incidentTarget ?? ''}">
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:2px">
        <button onclick="document.getElementById('inc-target-modal').remove()"
          style="padding:6px 16px;border-radius:6px;border:1px solid var(--bg-border);background:transparent;color:var(--text-2);cursor:pointer;font-size:13px">
          ${t('rpt_btn_cancel')}
        </button>
        <button onclick="reportSaveTargetModal()"
          style="padding:6px 16px;border-radius:6px;border:none;background:var(--c-blue);color:#fff;cursor:pointer;font-size:13px;font-weight:600">
          ${t('rpt_btn_save')}
        </button>
      </div>
    </div>`;
  el.addEventListener('click', e => { if (e.target === el) el.remove(); });
  document.body.appendChild(el);
  setTimeout(() => document.getElementById('inc-target-input')?.focus(), 0);
}

export function reportSaveTargetModal() {
  const val = parseInt(document.getElementById('inc-target-input')?.value);
  if (!isNaN(val) && val > 0) {
    _incidentTarget = val;
    _saveReportConfig();
    _rerender();
  }
  document.getElementById('inc-target-modal')?.remove();
}

export async function exportReportHtml() {
  const body = document.getElementById('report-modal-body');
  if (!body || !body.innerHTML.trim()) return;

  const project  = _reportProject || '';
  const month    = _reportMonth   || '';
  const theme    = document.documentElement.getAttribute('data-theme') || 'dark';
  const safeName = project.replace(/[^a-zA-Z0-9]/g, '-');
  const title    = `Review Mensal — ${project}${month ? ' — ' + month : ''}`;
  const now      = new Date().toLocaleString('pt-BR');

  const css = await fetch('/style.css').then(r => r.text()).catch(() => '');

  const clone = body.cloneNode(true);
  // strip interactive controls not meaningful in a static export
  clone.querySelectorAll('.report-chart-edit-btn, .report-field-picker, .report-picker-overlay').forEach(el => el.remove());
  clone.querySelectorAll('button').forEach(el => { if (!el.closest('.report-filter-bar')) el.style.display = 'none'; });
  clone.querySelectorAll('[onclick]').forEach(el => { if (!el.closest('.report-filter-bar')) el.removeAttribute('onclick'); });
  clone.querySelectorAll('.report-filter-btn[onclick]').forEach(el => el.removeAttribute('onclick'));
  clone.querySelectorAll('textarea').forEach(el => {
    const p = document.createElement('p');
    p.className = 'report-notes-text';
    p.style.cssText = 'white-space:pre-wrap;margin:0;color:var(--text-2);font-size:13px;line-height:1.6';
    p.textContent = el.value;
    el.replaceWith(p);
  });

  const html = `<!DOCTYPE html>
<html lang="pt-BR" data-theme="${theme}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
*,*::before,*::after{box-sizing:border-box}
body{margin:0;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
.report-modal-body{height:auto!important;overflow:visible!important;max-height:none!important}
${css}
</style>
</head>
<body class="report-body">
<div style="position:sticky;top:0;z-index:100;padding:10px 24px;background:var(--bg-card);border-bottom:1px solid var(--bg-border);display:flex;align-items:center;gap:12px">
  <span style="font-size:13px;font-weight:700;color:var(--text-1)">Backlog Health</span>
  <span style="font-size:10px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--text-muted)">Service Delivery Report</span>
  <span style="margin-left:auto;font-size:11px;color:var(--text-faint)">${title} &nbsp;&middot;&nbsp; ${now}</span>
</div>
<div class="report-modal-body" style="padding:24px 28px">
${clone.innerHTML}
</div>
<script>
(function(){
  var body=document.querySelector('.report-modal-body');
  document.querySelectorAll('.report-filter-btn').forEach(function(btn){
    btn.addEventListener('click',function(){
      var filter=btn.getAttribute('data-filter');
      document.querySelectorAll('.report-filter-btn').forEach(function(b){b.classList.remove('report-filter-btn--active');});
      btn.classList.add('report-filter-btn--active');
      if(filter==='all') body.removeAttribute('data-section-filter');
      else body.setAttribute('data-section-filter',filter);
    });
  });
})();
<\/script>
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = `review-${safeName}${month ? '-' + month : ''}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function openIncidentsForGroup(groupName) {
  const month = new Date().toISOString().slice(0, 7);
  const params = new URLSearchParams({ group: groupName, month, mode: 'backlog', filterField: '', filterValue: '' });
  _showIncidentsModal(groupName, params.toString());
}

async function _load(refresh = false) {
  _activeSectionFilter = 'all';
  const body       = document.getElementById('report-modal-body');
  const refreshBtn = document.getElementById('report-refresh-btn');
  body.innerHTML = '<div class="report-loading">Loading...</div>';
  if (refreshBtn) refreshBtn.disabled = true;

  // Extract unique field refs from donut charts only
  const donutRefs = [...new Set(_reportCharts.filter(c => c.type === 'donut').map(c => c.ref))];

  const q = new URLSearchParams({ project: _reportProject });
  if (_reportMonth) q.set('month', _reportMonth);
  if (refresh)      q.set('refresh', '1');
  q.set('groupFields', donutRefs.join(','));
  q.set('agingState', _agingState);
  q.set('incidentMonths', String(_incidentMonths));
  q.set('deliveryStates', _deliveryStates.join(','));

  try {
    const r = await fetch('/api/report?' + q);
    if (!r.ok) { const errBody = await r.json().catch(() => ({})); throw new Error(errBody.error || `HTTP ${r.status}`); }
    const data = await r.json();
    _lastPayload = data.payload;
    _reportMonth = data.month;
    _populateMonths(data.months, data.month);
    body.innerHTML = _buildHTML(data.payload);
  } catch (e) {
    body.innerHTML = `<div class="report-error">Error: ${_esc(e.message)}</div>`;
  } finally {
    if (refreshBtn) refreshBtn.disabled = false;
  }
}

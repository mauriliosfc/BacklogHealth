// ── Monthly Review — modal ES module ─────────────────────────────────────────

let _reportProject   = null;
let _reportMonth     = null;
let _reportCharts    = []; // [{type:'sprint'|'volatility'|'donut'|'incidents', size:'sm'|'md'|'lg', ref?:'', label?:'', chartStyle?:'donut'|'bar'|'bar-vertical', barColor?:'', months?:number}]
let _agingState      = 'In Review'; // estado monitorado nos gráficos de aging (compartilhado)
let _agingCharts     = [{ size: 'md' }, { size: 'md' }]; // tamanho por gráfico de aging
let _incidentMonths  = 5;        // months to show in the incidents section
let _incidentTarget  = 24;       // target mensal de incidentes
let _incidentGroupBy = 'cmdb_ci'; // 'cmdb_ci' | 'resolution_code'
let _heatmapMax      = 0;        // 0 = escala automática (relativa ao max dos dados)
let _agingBuckets    = [7, 14, 30, 60]; // thresholds for US aging buckets (days)
let _deliveryStates  = ['Closed', 'Done', 'Resolved']; // states counted as delivered
let _slaEnabled      = false;
let _pickerIdx       = -1; // -1 = add new, >=0 = edit existing chart
let _lastPayload     = null;
let _dragSrcIdx      = -1;

const _DEFAULT_CHARTS = [
  { type: 'sprint',     size: 'lg' },
  { type: 'volatility', size: 'md' },
  { type: 'donut',      size: 'md', ref: '', label: 'Tipo de Item' },
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
  let charts   = null;
  let needsSave = false;

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
    if (Array.isArray(data.agingBuckets) && data.agingBuckets.length === 4) _agingBuckets = data.agingBuckets;
    if (Array.isArray(data.deliveryStates) && data.deliveryStates.length)  _deliveryStates = data.deliveryStates;
    if (data.agingState)              _agingState      = data.agingState;
    if (data.agingCharts?.length) _agingCharts    = data.agingCharts;
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

  // 3. Default
  _reportCharts = charts || _DEFAULT_CHARTS.map(c => ({ ...c }));
  if (!charts || needsSave) _saveReportConfig(); // persist to config.json
}

function _saveReportConfig() {
  fetch('/api/report-config', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ project: _reportProject, reportCharts: _reportCharts, incidentMonths: _incidentMonths, incidentTarget: _incidentTarget, incidentGroupBy: _incidentGroupBy, heatmapMax: _heatmapMax, agingState: _agingState, agingCharts: _agingCharts, agingBuckets: _agingBuckets, deliveryStates: _deliveryStates }),
  }).catch(() => {});
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
  if (!sprints.length) return '<div class="report-empty-hint">Sem dados de sprint para o período</div>';
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
    { type: 'rect', color: 'var(--c-blue)',  label: 'Planejado (SP)' },
    { type: 'rect', color: 'var(--c-green)', label: 'Entregue (SP)' },
    { type: 'line', color: '#f59e0b', label: '% Entrega', dashed: true },
  ]);
}

function _renderVolatilityChart(sprints) {
  if (!sprints.length) return '<div class="report-empty-hint">Sem dados de sprint para o período</div>';
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
    { type: 'rect', color: '#f59e0b', label: 'Adicionadas após início da sprint' },
    { type: 'rect', color: '#ef4444', label: 'Removidas da sprint' },
  ]);
}

function _renderTypeDonut(byType) {
  if (!byType || !byType.length) return '<div class="report-empty-hint">Sem User Stories no período</div>';
  const total = byType.reduce((s, t) => s + t.count, 0);
  if (!total) return '<div class="report-empty-hint">Sem User Stories no período</div>';

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
  segs += `<text x="${cx}" y="${cy + 13}" text-anchor="middle" font-size="10" fill="var(--text-faint)">User Stories</text>`;

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

function _renderTypeBar(byType, barColor) {
  if (!byType || !byType.length) return '<div class="report-empty-hint">Sem User Stories no período</div>';
  const total = byType.reduce((s, t) => s + t.count, 0);
  if (!total) return '<div class="report-empty-hint">Sem User Stories no período</div>';

  const COLORS  = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899'];
  const maxVal  = Math.max(...byType.map(t => t.count), 1);
  const barH    = 28;
  const gap     = 10;
  const padL    = 110; // label column
  const padR    = 40;  // value label space
  const padT    = 10;
  const padB    = 28;  // axis labels
  const W       = 420;
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

function _renderTypeBarVertical(byType, barColor) {
  if (!byType || !byType.length) return '<div class="report-empty-hint">Sem User Stories no período</div>';
  const total = byType.reduce((s, t) => s + t.count, 0);
  if (!total) return '<div class="report-empty-hint">Sem User Stories no período</div>';

  const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899'];
  const W = 480, padT = 20, padB = 56, padL = 36, padR = 16;
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

function _renderIncidentsVolumeChart(monthly, months, target, selectedMonth) {
  const data = (monthly || []).slice(-months);
  if (!data.length) return '<div class="report-empty-hint">Sem dados de incidentes para o período</div>';

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

    if (hO > 0) {
      bars += `<rect x="${xO.toFixed(1)}" y="${(pad.t + cH - hO).toFixed(1)}" width="${barW}" height="${hO.toFixed(1)}" fill="${isSel ? '#60a5fa' : '#93c5fd'}" rx="2"/>`;
      bars += `<text x="${(xO + barW / 2).toFixed(1)}" y="${(pad.t + cH - hO - 3).toFixed(1)}" text-anchor="middle" font-size="8" fill="var(--text-faint)">${opened}</text>`;
    }
    if (hC > 0) {
      bars += `<rect x="${xC.toFixed(1)}" y="${(pad.t + cH - hC).toFixed(1)}" width="${barW}" height="${hC.toFixed(1)}" fill="${isSel ? '#10b981' : '#34d399'}" rx="2"/>`;
      bars += `<text x="${(xC + barW / 2).toFixed(1)}" y="${(pad.t + cH - hC - 3).toFixed(1)}" text-anchor="middle" font-size="8" fill="var(--text-faint)">${closed}</text>`;
    }
    if (hCa > 0) {
      bars += `<rect x="${xCa.toFixed(1)}" y="${(pad.t + cH - hCa).toFixed(1)}" width="${barW}" height="${hCa.toFixed(1)}" fill="${isSel ? '#fbbf24' : '#fde68a'}" rx="2"/>`;
      bars += `<text x="${(xCa + barW / 2).toFixed(1)}" y="${(pad.t + cH - hCa - 3).toFixed(1)}" text-anchor="middle" font-size="8" fill="var(--text-faint)">${cancelled}</text>`;
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
    { type: 'rect', color: '#93c5fd', label: 'Abertos' },
    { type: 'rect', color: '#34d399', label: 'Fechados' },
    { type: 'rect', color: '#fde68a', label: 'Cancelados' },
    { type: 'line', color: '#f97316', label: 'Backlog', dashed: true, dot: true },
    ...(target > 0 ? [{ type: 'line', color: '#ef4444', label: `Target (${target})`, dashed: true }] : []),
  ];

  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;display:block" xmlns="http://www.w3.org/2000/svg">
    ${gridLines}${axes}${bars}${targetLine}${backlogLine}${backlogDots}${labels}${yLabels}
  </svg>` + _legendHtml(legendItems);
}

// ── Incident system charts ─────────────────────────────────────────────────────

function _renderIncidentSystemBars(bySystem) {
  const all = bySystem || [];
  if (!all.length) return '<div class="report-empty-hint">Sem dados de IC para o período</div>';
  let items;
  if (all.length <= 9) {
    items = all;
  } else {
    const top9  = all.slice(0, 9);
    const rest  = all.slice(9);
    const outros = rest.reduce((acc, s) => ({
      name: 'Outros', total: acc.total + (s.total || 0),
      p1: acc.p1 + (s.p1 || 0), p2: acc.p2 + (s.p2 || 0), p3: acc.p3 + (s.p3 || 0),
    }), { name: 'Outros', total: 0, p1: 0, p2: 0, p3: 0 });
    items = outros.total > 0 ? [...top9, outros] : top9;
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
      bars += `<text x="${cx.toFixed(1)}" y="${(topY - 4).toFixed(1)}" text-anchor="middle" font-size="8" fill="var(--text-muted)">${s.total}</text>`;
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

function _renderIncidentHeatmap(bySystemMonthly, monthly, colLabel) {
  const allMonths = monthly || [];
  const months = allMonths.slice(-_incidentMonths);
  const allSystems = bySystemMonthly || [];
  if (!allSystems.length || !months.length) return '<div class="report-empty-hint">Sem dados para o período</div>';
  let items;
  if (allSystems.length <= 9) {
    items = allSystems;
  } else {
    const top9 = allSystems.slice(0, 9);
    const rest  = allSystems.slice(9);
    const histLen0 = (top9[0]?.monthly || []).length;
    const outrosMonthly = Array(histLen0).fill(0);
    rest.forEach(s => (s.monthly || []).forEach((v, i) => { outrosMonthly[i] += v; }));
    items = [...top9, { name: 'Outros', monthly: outrosMonthly }];
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
    const cells = months.map((_, i) => {
      const cnt = s.monthly[monthStart + i] || 0;
      return `<td style="${td};background:${heatBg(cnt)}">${cnt > 0 ? cnt : ''}</td>`;
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
    title   = 'SP Planejados vs Entregues por Sprint';
    content = _renderSprintChart(sprints);
  } else if (chart.type === 'volatility') {
    title   = 'Volatilidade do Backlog';
    content = _renderVolatilityChart(sprints);
  } else if (chart.type === 'incidents') {
    const monthsLabel = chart.months || 5;
    title   = `Volume de Incidentes vs Target · ${monthsLabel} meses`;
    content = incidents
      ? _renderIncidentsVolumeChart(incidents.monthly, monthsLabel, _incidentTarget)
      : '<div class="report-empty-hint">Service Now not configured for this project</div>';
  } else {
    title   = `US por ${_esc(chart.label || 'Tipo de Item')}`;
    const data = (delivery.byTypes || {})[chart.ref || ''] || [];
    content = chart.chartStyle === 'bar'          ? _renderTypeBar(data, chart.barColor)
            : chart.chartStyle === 'bar-vertical' ? _renderTypeBarVertical(data, chart.barColor)
            : _renderTypeDonut(data);
  }

  const header = `<div class="report-field-picker-header">
    <div class="report-donut-title-row">
      <span class="report-drag-handle" title="Arrastar para reordenar">⠿</span>
      <div class="report-subsection-title">${title}</div>
    </div>
    <div class="report-field-chart-actions" draggable="false">
      <button class="report-field-picker-btn" title="Configurar gráfico" onclick="reportOpenFieldPicker(${idx})" draggable="false">⚙</button>
      ${canRemove ? `<button class="report-field-remove-btn" title="Remover gráfico" onclick="reportRemoveChart(${idx})" draggable="false">×</button>` : ''}
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

// ── Helpers ───────────────────────────────────────────────────────────────────

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
  if (!sla || sla.total === 0) return '<div class="report-prb-card-sub">Sem dados de SLA</div>';
  const cls = sla.pct >= 90 ? 'sla-ok' : sla.pct >= 70 ? 'sla-warn' : 'sla-bad';
  const breachLabel = sla.breached > 0
    ? `<span class="report-sla-threshold">(${sla.breached} violado${sla.breached !== 1 ? 's' : ''})</span>`
    : '';
  return `<div class="report-sla-badge ${cls}">${sla.pct}% no SLA ${breachLabel}</div>`;
}

// ── US Aging charts ──────────────────────────────────────────────────────────

function _renderUsAgingBuckets(usAging) {
  if (!usAging) return '<div class="report-empty-hint">Sem dados — clique em ⚙ para configurar o estado</div>';
  if (!usAging.total) return '<div class="report-empty-hint">Sem US no estado configurado</div>';
  // Use list for configurable thresholds; fall back to pre-computed buckets in old cache entries
  const buckets = usAging.list?.length
    ? _computeAgingBuckets(usAging.list, _agingBuckets)
    : (usAging.buckets || []);
  if (!buckets.length || !buckets.some(b => b.count > 0)) return '<div class="report-empty-hint">Sem US no estado configurado</div>';

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
  if (!usAging) return '<div class="report-empty-hint">Sem dados — clique em ⚙ para configurar o estado</div>';
  const list = (usAging.list || usAging.top10 || []).slice(0, 10);
  if (!list.length) return '<div class="report-empty-hint">Nenhuma US encontrada</div>';

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
  const saldoSub  = net < 0 ? 'Melhorando' : net > 0 ? 'Piorando' : 'Estável';

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

  return `<div class="report-section">
    <div class="report-section-header-row">
      <div class="report-section-title">AMS Sprint Delivery</div>
      <button class="report-field-picker-btn" onclick="reportOpenDeliveryStatesPicker()" title="Configurar estados de entrega">⚙</button>
    </div>
    ${deliveryStatesSub}
    <div class="report-prb-cards">
      <div class="report-prb-card">
        <div class="report-prb-card-val">${totalUS} ${_deltaHtml(totalUS, prevDelivery?.totalUS, false)}</div>
        <div class="report-prb-card-label">User Stories</div>
        <div class="report-prb-card-sub">no período</div>
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
        <div class="report-prb-card-label">Bugs Abertos</div>
        <div class="report-prb-card-sub">ativos no momento</div>
      </div>
      <div class="report-prb-card">
        <div class="report-prb-card-val ${newCls}">${quality.bugsNew} ${_deltaHtml(quality.bugsNew, prevQuality?.bugsNew, true)}</div>
        <div class="report-prb-card-label">Bugs Novos</div>
        <div class="report-prb-card-sub">abertos no período</div>
      </div>
      <div class="report-prb-card">
        <div class="report-prb-card-val ${closedCls}">${quality.bugsClosed}</div>
        <div class="report-prb-card-label">Bugs Resolvidos</div>
        <div class="report-prb-card-sub">fechados no período</div>
      </div>
      <div class="report-prb-card">
        <div class="report-prb-card-val ${saldoCls}">${net > 0 ? '+' : ''}${net}</div>
        <div class="report-prb-card-label">Saldo de Bugs</div>
        <div class="report-prb-card-sub">${saldoSub}</div>
      </div>
    </div>
    <div class="report-subsection-title" style="margin-top:4px">Distribuição por Sprint</div>
    <div class="report-prb-chart-sub">User Stories e Story Points por sprint no período</div>
    <table class="report-table">
      <thead><tr><th>Sprint</th><th class="num">Total US</th><th class="num">Entregues</th><th class="num">SP Total</th><th class="num">SP Entregues</th></tr></thead>
      <tbody>${sprintRows}</tbody>
    </table>
    <div class="report-donuts-grid">
      ${chartCells}
      <div class="report-add-chart-section">
        <button class="report-add-chart-btn" onclick="reportAddChart()">+ Adicionar gráfico</button>
      </div>
    </div>
    <div class="report-subsection-title" style="margin-top:20px">US Aging — ${_esc(usAging?.state || _agingState)}</div>
    <div class="report-prb-chart-sub">${usAging ? `${usAging.total} US em "${_esc(usAging.state)}" · sem filtro de sprint` : `Aguardando dados para "${_esc(_agingState)}"`}</div>
    <div class="report-donuts-grid">
      <div class="report-donut-cell report-donut-cell-${_agingCharts[0]?.size || 'md'}">
        <div class="report-field-picker-header">
          <div class="report-donut-title-row"><div class="report-subsection-title">Aging do Backlog</div></div>
          <div class="report-field-chart-actions"><button class="report-field-picker-btn" title="Configurar gráfico" onclick="reportOpenAgingPicker(0)" draggable="false">⚙</button></div>
        </div>
        ${_renderUsAgingBuckets(usAging)}
      </div>
      <div class="report-donut-cell report-donut-cell-${_agingCharts[1]?.size || 'md'}">
        <div class="report-field-picker-header">
          <div class="report-donut-title-row"><div class="report-subsection-title">TOP 10 — Mais Tempo em "${_esc(usAging?.state || _agingState)}"</div></div>
          <div class="report-field-chart-actions"><button class="report-field-picker-btn" title="Configurar gráfico" onclick="reportOpenAgingPicker(1)" draggable="false">⚙</button></div>
        </div>
        ${_renderUsTop10(usAging)}
      </div>
    </div>
  </div>`;
}


function _renderIncidents(inc) {
  if (!inc) return '';
  const riskCls    = _incidentTarget > 0 ? (inc.total > _incidentTarget ? 'red' : inc.total > _incidentTarget * 0.8 ? 'yellow' : 'green') : '';
  const closedCls  = (inc.closedThisMonth || 0) > 0 ? 'green' : '';
  const backlogCls = (inc.openBacklog || 0) > 20 ? 'red' : (inc.openBacklog || 0) > 10 ? 'yellow' : 'green';
  const _curMonth   = new Date().toISOString().slice(0, 7);
  const backlogLabel = _reportMonth === _curMonth ? 'Backlog atual' : 'Backlog no Encerramento';
  const avgCls     = (inc.avgResolutionDays || 0) > 5 ? 'red' : (inc.avgResolutionDays || 0) > 2 ? 'yellow' : 'green';

  const monthly    = inc.monthly || [];
  const prevMonth  = monthly.length >= 2 ? monthly[monthly.length - 2] : null;

  const useAlt      = _incidentGroupBy === 'resolution_code';
  const barData     = useAlt ? (inc.byGroupAlt || [])        : (inc.bySystem || []);
  const heatmapData = useAlt ? (inc.byGroupAltMonthly || []) : (inc.bySystemMonthly || []);
  const groupLabel  = useAlt ? 'Resolution Code' : 'IC Afetado';

  const p1Cls = inc.byPriority.p1 > 0 ? 'red' : 'green';
  const p2Cls = inc.byPriority.p2 > 3 ? 'yellow' : '';

  return `<div class="report-section">
    <div class="report-section-header-row">
      <div class="report-section-title">Incidents</div>
      <div class="report-field-chart-actions"><button class="report-field-picker-btn" title="Configurar SLA" onclick="reportOpenSlaPicker()" draggable="false">&#9881;</button></div>
    </div>
    <div class="report-prb-cards">
      <div class="report-prb-card">
        <div class="report-prb-card-val ${riskCls}">${inc.total} ${_deltaHtml(inc.total, prevMonth?.opened, true)}</div>
        <div class="report-prb-card-label">Abertos no mês</div>
        <div class="report-prb-card-sub">Target: ${_incidentTarget}</div>
      </div>
      <div class="report-prb-card">
        <div class="report-prb-card-val ${closedCls}">${inc.closedThisMonth ?? 0} ${_deltaHtml(inc.closedThisMonth ?? 0, prevMonth?.closed, false)}</div>
        <div class="report-prb-card-label">Encerrados no mês</div>
        <div class="report-prb-card-sub">Resolvidos no período</div>
      </div>
      <div class="report-prb-card report-prb-card--clickable" onclick="reportOpenIncidentsModal()" title="Ver lista de incidentes">
        <div class="report-prb-card-val ${backlogCls}">${inc.openBacklog ?? 0}</div>
        <div class="report-prb-card-label">${backlogLabel}</div>
        <div class="report-prb-card-sub">Clique para ver lista</div>
      </div>
      <div class="report-prb-card">
        <div class="report-prb-card-val ${avgCls}">${inc.avgResolutionDays ?? 0}d</div>
        <div class="report-prb-card-label">Tempo médio resolução</div>
        <div class="report-prb-card-sub">Dias médios no mês</div>
      </div>
    </div>
    <div class="report-prb-cards" style="margin-top:8px">
      <div class="report-prb-card">
        <div class="report-prb-card-val ${p1Cls}">${inc.byPriority.p1}</div>
        <div class="report-prb-card-label">P1 — Crítico</div>
        ${_slaEnabled ? _slaBadge(inc.slaByPriority?.p1) : '<div class="report-prb-card-sub">Prioridade máxima</div>'}
      </div>
      <div class="report-prb-card">
        <div class="report-prb-card-val ${p2Cls}">${inc.byPriority.p2}</div>
        <div class="report-prb-card-label">P2 — Alto</div>
        ${_slaEnabled ? _slaBadge(inc.slaByPriority?.p2) : '<div class="report-prb-card-sub">Alta prioridade</div>'}
      </div>
      <div class="report-prb-card">
        <div class="report-prb-card-val">${inc.byPriority.p3}</div>
        <div class="report-prb-card-label">P3 — Médio</div>
        ${_slaEnabled ? _slaBadge(inc.slaByPriority?.p3) : '<div class="report-prb-card-sub">Média prioridade</div>'}
      </div>
      <div class="report-prb-card">
        <div class="report-prb-card-val">${_incidentTarget > 0 ? `${Math.round(inc.total / _incidentTarget * 100)}%` : '—'}</div>
        <div class="report-prb-card-label">vs Target</div>
        <div class="report-prb-card-sub">${_incidentTarget > 0 ? (inc.total > _incidentTarget ? 'Acima do target' : 'Dentro do target') : 'Sem target definido'}</div>
      </div>
    </div>
    <div class="report-field-picker-header" style="margin-top:12px">
      <div class="report-donut-title-row"><div class="report-subsection-title">Abertos e Fechados por Mês</div></div>
      <div class="report-field-chart-actions"><button class="report-field-picker-btn" title="Configurar gráfico" onclick="reportOpenIncidentVolumePicker()" draggable="false">⚙</button></div>
    </div>
    <div class="report-prb-chart-sub">Histórico de volume de incidentes${_incidentTarget > 0 ? ` — target: ${_incidentTarget}` : ''} · ${_incidentMonths} meses</div>
    ${_renderIncidentsVolumeChart(inc.monthly, _incidentMonths, _incidentTarget, _reportMonth)}
    <div class="report-field-picker-header" style="margin-top:16px">
      <div class="report-donut-title-row"><div class="report-subsection-title">${groupLabel} — Top 9 por Volume</div></div>
      <div class="report-field-chart-actions"><button class="report-field-picker-btn" title="Configurar agrupamento" onclick="reportOpenIncidentGroupByPicker()" draggable="false">⚙</button></div>
    </div>
    <div class="report-prb-chart-sub">Volume de incidentes por severidade</div>
    ${_renderIncidentSystemBars(barData)}
    <div class="report-field-picker-header" style="margin-top:16px">
      <div class="report-donut-title-row"><div class="report-subsection-title">Heatmap: ${groupLabel} × Mês</div></div>
      <div class="report-field-chart-actions"><button class="report-field-picker-btn" title="Configurar heatmap" onclick="reportOpenHeatmapPicker()" draggable="false">⚙</button></div>
    </div>
    <div class="report-prb-chart-sub">Frequência de incidentes${_heatmapMax > 0 ? ` — escala fixa: máx ${_heatmapMax}` : ' — escala automática'}</div>
    ${_renderIncidentHeatmap(heatmapData, inc.monthly, groupLabel)}
  </div>`;
}

function _renderPrbStatusDonut(list) {
  const counts = {};
  (list || []).forEach(p => { const k = String(p.state); counts[k] = (counts[k] || 0) + 1; });
  const total = Object.values(counts).reduce((s, v) => s + v, 0);
  if (total === 0) return '<div class="report-empty-row">No PRBs</div>';

  const W = 280, cx = 140, cy = 105, R = 82, ri = 46;
  let startAngle = -Math.PI / 2;
  const slices = [];
  const legendItems = [];
  Object.entries(counts).forEach(([state, count]) => {
    const cfg = _PRB_STATES[state] || { label: state, color: '#6b7280' };
    const angle = (count / total) * 2 * Math.PI;
    const endAngle = startAngle + angle;
    const large = angle > Math.PI ? 1 : 0;
    const x1 = cx + R  * Math.cos(startAngle); const y1 = cy + R  * Math.sin(startAngle);
    const x2 = cx + R  * Math.cos(endAngle);   const y2 = cy + R  * Math.sin(endAngle);
    const xi1= cx + ri * Math.cos(startAngle); const yi1= cy + ri * Math.sin(startAngle);
    const xi2= cx + ri * Math.cos(endAngle);   const yi2= cy + ri * Math.sin(endAngle);
    slices.push(`<path d="M${xi1} ${yi1} L${x1} ${y1} A${R} ${R} 0 ${large} 1 ${x2} ${y2} L${xi2} ${yi2} A${ri} ${ri} 0 ${large} 0 ${xi1} ${yi1}Z" fill="${cfg.color}" stroke="var(--bg)" stroke-width="1.5"/>`);
    if (angle > 0.3) {
      const rm = (R + ri) / 2;
      const mid = startAngle + angle / 2;
      const tx = (cx + rm * Math.cos(mid)).toFixed(1);
      const ty = (cy + rm * Math.sin(mid)).toFixed(1);
      slices.push(`<text x="${tx}" y="${ty}" text-anchor="middle" dominant-baseline="middle" font-size="9" font-weight="700" fill="#fff">${count}</text>`);
    }
    legendItems.push({ label: cfg.label, color: cfg.color, count });
    startAngle = endAngle;
  });

  const H_svg = cy + R + 8;
  const svgHtml = `<svg viewBox="0 0 ${W} ${H_svg}" style="width:100%;display:block">
    ${slices.join('')}
    <text x="${cx}" y="${cy - 6}" text-anchor="middle" dominant-baseline="middle" font-size="22" font-weight="700" fill="var(--text)">${total}</text>
    <text x="${cx}" y="${cy + 14}" text-anchor="middle" font-size="10" fill="var(--text-faint)">total</text>
  </svg>`;
  return svgHtml + _legendHtml(legendItems.map(item =>
    ({ type: 'rect', color: item.color, label: `${item.label}: ${item.count}` })
  ));
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
    { type: 'rect', color: '#6366f1', label: 'Abertos' },
    { type: 'rect', color: '#a5b4fc', label: 'Resolvidos' },
    { type: 'line', color: '#ef4444', label: 'Backlog', dashed: true, dot: true },
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

function _renderPRBs(prbs, incidents) {
  if (!prbs) return '';

  const openedCls = (prbs.openedThisMonth || 0) > 5 ? 'red' : (prbs.openedThisMonth || 0) > 0 ? 'yellow' : 'green';
  const resCls    = (prbs.resolvedThisMonth || 0) > 0 ? 'green' : '';
  const accCls       = prbs.open > 10 ? 'red' : prbs.open > 3 ? 'yellow' : 'green';
  const avgResCls    = (prbs.avgResolutionDays || 0) > 30 ? 'red' : (prbs.avgResolutionDays || 0) > 14 ? 'yellow' : 'green';
  const _curMonthPrb = new Date().toISOString().slice(0, 7);
  const prbBacklogLabel = _reportMonth === _curMonthPrb ? 'Backlog atual' : 'Backlog no Encerramento';

  const hasPrbMonthly = prbs.monthly && prbs.monthly.length > 0;

  let donutChart = '', agingChart = '';
  if (prbs.list && prbs.list.length > 0) {
    donutChart = _renderPrbStatusDonut(prbs.list);
    agingChart = _renderPrbAgingChart(prbs.list);
  }

  return `<div class="report-section">
    <div class="report-section-title">PRBs — Problems</div>
    <div class="report-prb-cards">
      <div class="report-prb-card">
        <div class="report-prb-card-val ${openedCls}">${prbs.openedThisMonth ?? 0}</div>
        <div class="report-prb-card-label">Abertos no mês</div>
        <div class="report-prb-card-sub">Novos no período</div>
      </div>
      <div class="report-prb-card">
        <div class="report-prb-card-val ${resCls}">${prbs.resolvedThisMonth ?? 0}</div>
        <div class="report-prb-card-label">Resolvidos no mês</div>
        <div class="report-prb-card-sub">No período</div>
      </div>
      <div class="report-prb-card">
        <div class="report-prb-card-val ${accCls}">${prbs.open}</div>
        <div class="report-prb-card-label">${prbBacklogLabel}</div>
        <div class="report-prb-card-sub">Total em aberto</div>
      </div>
      <div class="report-prb-card">
        <div class="report-prb-card-val ${avgResCls}">${prbs.avgResolutionDays ?? 0}d</div>
        <div class="report-prb-card-label">Tempo médio resolução</div>
        <div class="report-prb-card-sub">Dias médios no mês</div>
      </div>
    </div>
    ${hasPrbMonthly ? `
    <div class="report-subsection-title" style="margin-top:12px">Evolução de PRBs — Abertos · Resolvidos · Backlog</div>
    ${_renderPrbEvolutionChart(prbs.monthly)}
    ` : ''}
    ${prbs.list && prbs.list.length > 0 ? `
    <div style="display:flex;gap:24px;align-items:flex-start;flex-wrap:wrap">
      <div style="flex:0 0 280px">
        <div class="report-subsection-title">PRBs por status</div>
        <div class="report-prb-chart-sub">Distribuição atual</div>
        ${donutChart}
      </div>
      <div style="flex:1;min-width:300px">
        <div class="report-subsection-title">Aging do Backlog</div>
        <div class="report-prb-chart-sub">Distribuição por tempo em aberto e status</div>
        ${agingChart}
      </div>
    </div>
    <div class="report-subsection-title" style="margin-top:12px">Top 10 PRBs mais antigos</div>
    <div class="report-prb-chart-sub">Ordenado por tempo em aberto</div>
    ${_renderPrbOldestList(prbs.list)}
    ` : ''}
  </div>`;
}

function _buildHTML(payload) {
  const { metadata, hasSn, delivery, quality, incidents, prbs, prevDelivery, prevQuality } = payload;

  // Cache age indicator
  const ageMs  = metadata.generatedAtTs ? Date.now() - metadata.generatedAtTs : 0;
  const ageH   = Math.floor(ageMs / 3600000);
  const ageMin = Math.floor((ageMs % 3600000) / 60000);
  const ageCls = ageH >= 5 ? 'red' : ageH >= 3 ? 'yellow' : 'green';
  const ageStr = ageMs > 0
    ? (ageH > 0 ? `${ageH}h${ageMin > 0 ? ` ${ageMin}min` : ''} atrás` : ageMin > 0 ? `${ageMin}min atrás` : 'agora mesmo')
    : '';

  const snWarning = !hasSn
    ? `<div class="report-sn-notice">
        <span>Service Now não configurado para este projeto. Exibindo apenas dados do Azure DevOps.</span>
        <button class="report-sn-notice-btn" onclick="openReportSnConfig()">Configurar</button>
       </div>`
    : '';

  const savedNotes = localStorage.getItem(`reportNotes::${_reportProject}::${_reportMonth}`) || '';
  const notesBar = `<div class="report-notes-bar">
    <textarea class="report-notes-input" placeholder="Anotações para este relatório..." onchange="reportSaveNotes(this.value)">${_esc(savedNotes)}</textarea>
    <button class="report-print-btn" onclick="window.print()" title="Imprimir / Exportar PDF">&#128424; Imprimir / PDF</button>
  </div>`;

  return `
    <div class="report-content">
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
      ${_renderDelivery(delivery, quality, incidents, prevDelivery, prevQuality)}
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
  const isDonut         = !isEdit ? true : currentType === 'donut';
  const isIncidents     = isEdit && currentType === 'incidents';
  const currentMonths   = currentChart?.months || 5;
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
    { val: 'sm', label: '3 por linha' },
    { val: 'md', label: '2 por linha' },
    { val: 'lg', label: 'Largura total' },
  ].map(o => `<button class="report-size-opt${currentSize === o.val ? ' active' : ''}" data-size="${o.val}">${o.label}</button>`).join('');

  // Type selector (only when adding new)
  const typeSection = !isEdit ? `
    <div class="report-field-picker-label">Tipo de gráfico</div>
    <select id="report-chart-type-sel" class="report-field-sel">
      <option value="donut">Agrupamento por campo</option>
      <option value="incidents">Volume de Incidentes</option>
      <option value="sprint">SP Planejados vs Entregues</option>
      <option value="volatility">Volatilidade do Backlog</option>
    </select>` : '';

  // Field selector — shown for donut charts
  const fieldSection = `
    <div id="report-field-label"${!isDonut ? ' style="display:none"' : ''}>
      <div class="report-field-picker-label">Campo de agrupamento</div>
    </div>
    <div id="report-field-picker-body" class="report-field-picker-body"${!isDonut ? ' style="display:none"' : ''}>
      ${isDonut ? '<div class="report-field-picker-loading">Carregando campos...</div>' : ''}
    </div>`;

  // Chart style (donut vs bar) — only for donut charts
  const styleOpts = [
    { val: 'donut',        label: 'Donut' },
    { val: 'bar',          label: 'Barras' },
    { val: 'bar-vertical', label: 'Barras Verticais' },
  ].map(o => `<button class="report-size-opt${currentStyle === o.val ? ' active' : ''}" data-style="${o.val}">${o.label}</button>`).join('');
  const styleSection = `
    <div id="report-style-label"${!isDonut ? ' style="display:none"' : ''}>
      <div class="report-field-picker-label">Estilo visual</div>
    </div>
    <div class="report-size-group" id="report-style-group"${!isDonut ? ' style="display:none"' : ''}>${styleOpts}</div>`;

  // Months input — only for incidents charts
  const monthsSection = `
    <div id="report-months-section"${!isIncidents ? ' style="display:none"' : ''}>
      <div class="report-field-picker-label">Meses de hist&oacute;rico</div>
      <input type="number" id="report-inc-months" class="report-inc-months-input" min="1" max="12" value="${currentMonths}">
    </div>`;

  // Bar color — only for bar/bar-vertical donut charts
  const barColorSection = `
    <div id="report-bar-color-section"${!isBarStyle ? ' style="display:none"' : ''}>
      <div class="report-field-picker-label">Cor das barras</div>
      <select id="report-bar-color-mode" class="report-field-sel">
        <option value="multi"${!currentBarColor ? ' selected' : ''}>Multicolor</option>
        <option value="single"${currentBarColor ? ' selected' : ''}>Cor única</option>
      </select>
      <div id="report-bar-color-picker"${!currentBarColor ? ' style="display:none"' : ''}>
        <input type="color" id="report-bar-color-input" value="${currentBarColor || '#8b5cf6'}"
          style="margin-top:6px;width:100%;height:32px;border:none;padding:0;cursor:pointer;background:none">
      </div>
    </div>`;

  picker.innerHTML = `
    <div class="report-field-picker-title">${isEdit ? 'Configurar gráfico' : 'Novo gráfico'}</div>
    ${typeSection}
    ${fieldSection}
    ${styleSection}
    ${barColorSection}
    ${monthsSection}
    <div class="report-field-picker-label">Tamanho</div>
    <div class="report-size-group" id="report-size-group-el">${sizeOpts}</div>
    <div class="report-field-picker-actions">
      <button class="report-picker-btn-cancel" id="report-field-cancel-btn">Cancelar</button>
      <button class="report-picker-btn-apply" id="report-field-apply-btn">${isEdit ? 'Aplicar' : 'Adicionar'}</button>
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
        if (body) body.innerHTML = '<div class="report-field-picker-error">Erro ao carregar campos</div>';
      });
  }

  // Type select toggle: show/hide sections when adding
  if (!isEdit) {
    const typeSel = document.getElementById('report-chart-type-sel');
    typeSel?.addEventListener('change', () => {
      const t            = typeSel.value;
      const isDonutNow   = t === 'donut';
      const isIncNow     = t === 'incidents';
      const show = id => { const el = document.getElementById(id); if (el) el.style.display = ''; };
      const hide = id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; };

      if (isDonutNow) {
        show('report-field-label'); show('report-field-picker-body');
        show('report-style-label'); show('report-style-group');
        hide('report-months-section');
        hide('report-bar-color-section'); // hidden until bar style selected
        _loadPickerFields('');
      } else if (isIncNow) {
        hide('report-field-label'); hide('report-field-picker-body');
        hide('report-style-label'); hide('report-style-group');
        hide('report-bar-color-section');
        show('report-months-section');
      } else {
        hide('report-field-label'); hide('report-field-picker-body');
        hide('report-style-label'); hide('report-style-group');
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

function _rerender() {
  if (!_lastPayload) { _load(true); return; }
  const body = document.getElementById('report-modal-body');
  if (body) body.innerHTML = _buildHTML(_lastPayload);
}

function _closeFieldPicker() {
  document.getElementById('report-field-picker')?.remove();
  document.getElementById('report-picker-backdrop')?.remove();
}

export function reportOpenIncidentVolumePicker() {
  _closeFieldPicker();

  const MONTH_OPTS = [3, 5, 6, 8, 10, 12, 13, 24];
  const monthBtns = MONTH_OPTS.map(n =>
    `<button class="report-size-opt${n === _incidentMonths ? ' active' : ''}" data-months="${n}">${n} meses</button>`
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
    <div class="report-field-picker-title">Configurar — Histórico de Incidentes</div>
    <div class="report-field-picker-label">Meses de histórico</div>
    <div class="report-size-group" id="report-inc-vol-months-group" style="flex-wrap:wrap">${monthBtns}</div>
    <div class="report-field-picker-label" style="margin-top:10px">Target mensal</div>
    <input type="number" id="report-inc-vol-target" class="report-inc-months-input" min="0" max="9999" value="${_incidentTarget}">
    <div class="report-field-picker-actions">
      <button class="report-picker-btn-cancel" id="report-inc-vol-cancel">Cancelar</button>
      <button class="report-picker-btn-apply"  id="report-inc-vol-apply">Aplicar</button>
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
    { val: 'cmdb_ci',         label: 'IC Afetado' },
    { val: 'resolution_code', label: 'Additional Resolution Code' },
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
    <div class="report-field-picker-title">Configurar — Agrupamento de Incidentes</div>
    <div class="report-field-picker-label">Agrupar por</div>
    <select id="report-inc-groupby-sel" class="report-inc-months-sel" style="width:100%">${selectOpts}</select>
    <div class="report-field-picker-actions">
      <button class="report-picker-btn-cancel" id="report-inc-groupby-cancel">Cancelar</button>
      <button class="report-picker-btn-apply"  id="report-inc-groupby-apply">Aplicar</button>
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
    <div class="report-field-picker-title">Configurar — Heatmap de Incidentes</div>
    <div class="report-field-picker-label">
      Máximo da escala de cor
      <span style="font-weight:400;opacity:.7;display:block;font-size:11px;margin-top:2px">0 = automático (relativo ao maior valor dos dados visíveis)</span>
    </div>
    <input type="number" id="report-heatmap-max-input" class="report-inc-months-input" min="0" max="9999" value="${_heatmapMax}" placeholder="0">
    <div class="report-field-picker-actions">
      <button class="report-picker-btn-cancel" id="report-heatmap-cancel">Cancelar</button>
      <button class="report-picker-btn-apply"  id="report-heatmap-apply">Aplicar</button>
    </div>`;
  document.body.appendChild(picker);

  document.getElementById('report-heatmap-cancel').onclick = _closeFieldPicker;
  document.getElementById('report-heatmap-apply').onclick  = _applyHeatmapPicker;
}

function _applyHeatmapPicker() {
  _heatmapMax = Math.max(0, parseInt(document.getElementById('report-heatmap-max-input')?.value) || 0);
  _closeFieldPicker();
  _saveReportConfig();
  _rerender();
}

let _agingPickerIdx = -1; // índice do gráfico de aging sendo configurado

export async function reportOpenAgingPicker(idx) {
  _agingPickerIdx = idx ?? 0;
  _closeFieldPicker();

  const currentSize = _agingCharts[_agingPickerIdx]?.size || 'md';
  const sizeOpts = [
    { val: 'sm', label: '3 por linha' },
    { val: 'md', label: '2 por linha' },
    { val: 'lg', label: 'Largura total' },
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
    <div class="report-field-picker-title">Configurar gráfico — Aging</div>
    <div class="report-field-picker-label">Estado monitorado</div>
    <select id="report-aging-state-sel" class="report-field-sel">
      <option value="${_esc(_agingState)}">${_esc(_agingState)}</option>
    </select>
    <div class="report-field-picker-label">Faixas de aging (dias)</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
      <div><label style="font-size:11px;color:var(--text-faint)">Limite 1</label><br>
        <input type="number" id="report-aging-rb0" class="report-inc-months-input" style="width:100%;box-sizing:border-box" min="1" max="999" value="${_agingBuckets[0]}"></div>
      <div><label style="font-size:11px;color:var(--text-faint)">Limite 2</label><br>
        <input type="number" id="report-aging-rb1" class="report-inc-months-input" style="width:100%;box-sizing:border-box" min="1" max="999" value="${_agingBuckets[1]}"></div>
      <div><label style="font-size:11px;color:var(--text-faint)">Limite 3</label><br>
        <input type="number" id="report-aging-rb2" class="report-inc-months-input" style="width:100%;box-sizing:border-box" min="1" max="999" value="${_agingBuckets[2]}"></div>
      <div><label style="font-size:11px;color:var(--text-faint)">Limite 4</label><br>
        <input type="number" id="report-aging-rb3" class="report-inc-months-input" style="width:100%;box-sizing:border-box" min="1" max="999" value="${_agingBuckets[3]}"></div>
    </div>
    <div class="report-field-picker-label">Tamanho</div>
    <div class="report-size-group" id="report-aging-size-group">${sizeOpts}</div>
    <div class="report-field-picker-actions">
      <button class="report-picker-btn-cancel" id="report-aging-cancel-btn">Cancelar</button>
      <button class="report-picker-btn-apply" id="report-aging-apply-btn">Aplicar</button>
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
    <div class="report-field-picker-title">Estados de Entrega</div>
    <div class="report-field-picker-desc" style="font-size:12px;color:var(--text-faint);margin-top:-6px">US nesses estados contam como entregues na sprint</div>
    <div id="report-delivery-states-body"><div class="report-field-picker-loading">Carregando estados...</div></div>
    <div class="report-field-picker-actions">
      <button class="report-picker-btn-cancel" id="report-delivery-cancel">Cancelar</button>
      <button class="report-picker-btn-apply"  id="report-delivery-apply">Aplicar</button>
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
    if (body) body.innerHTML = '<div class="report-field-picker-error">Erro ao carregar estados</div>';
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
    <div class="report-field-picker-title">Configurar SLA — Incidents</div>
    <div style="font-size:12px;color:var(--text-faint);margin-bottom:14px;line-height:1.6">
      Usa <strong style="color:var(--text-1)">business_elapsed_percentage</strong> da tabela <code>task_sla</code> do ServiceNow.<br>
      Incidente violado = maior % entre seus SLAs &gt; 100%.
    </div>
    <div style="display:flex;align-items:center;gap:8px">
      <input type="checkbox" id="report-sla-enabled-chk" style="width:15px;height:15px;accent-color:var(--c-blue);cursor:pointer" ${_slaEnabled ? 'checked' : ''}>
      <label for="report-sla-enabled-chk" style="font-size:13px;color:var(--text-1);cursor:pointer;user-select:none">Exibir % dentro do SLA por prioridade</label>
    </div>
    <div class="report-field-picker-actions">
      <button class="report-picker-btn-cancel" id="report-sla-cancel">Cancelar</button>
      <button class="report-picker-btn-apply" id="report-sla-apply">Aplicar</button>
    </div>`;
  document.body.appendChild(picker);

  picker.querySelector('#report-sla-cancel').onclick = _closeFieldPicker;
  picker.querySelector('#report-sla-apply').onclick  = _applySlaPicker;
}

async function _applySlaPicker() {
  const enabled = document.getElementById('report-sla-enabled-chk')?.checked ?? false;
  _closeFieldPicker();
  _slaEnabled = enabled;
  await fetch('/api/sn-config', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ project: _reportProject, slaEnabled: enabled }),
  }).catch(() => {});
  _rerender();
}

function _applyChartPicker() {
  const size       = document.querySelector('#report-size-group-el .report-size-opt.active')?.dataset.size
                  || document.querySelector('#report-field-picker .report-size-opt[data-size].active')?.dataset.size
                  || 'md';
  const chartStyle    = document.querySelector('#report-style-group .report-size-opt.active')?.dataset.style || 'donut';
  const barColorMode  = document.getElementById('report-bar-color-mode')?.value;
  const barColor      = barColorMode === 'single' ? (document.getElementById('report-bar-color-input')?.value || '') : '';
  let needsRefetch = false;

  if (_pickerIdx >= 0) {
    // Edit existing chart
    const chart = _reportCharts[_pickerIdx];
    if (chart.type === 'incidents') {
      const months = Math.min(24, Math.max(1, parseInt(document.getElementById('report-inc-months')?.value) || 5));
      _reportCharts[_pickerIdx] = { type: 'incidents', size, months };
    } else if (chart.type === 'donut') {
      const sel = document.getElementById('report-field-sel');
      if (sel) {
        const ref   = sel.value;
        const label = ref ? (sel.options[sel.selectedIndex]?.text || ref) : 'Tipo de Item';
        needsRefetch = ref !== chart.ref;
        _reportCharts[_pickerIdx] = { type: 'donut', ref, label, size, chartStyle, barColor };
      } else {
        _reportCharts[_pickerIdx] = { ...chart, size, chartStyle, barColor };
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
    } else if (type === 'donut') {
      const sel   = document.getElementById('report-field-sel');
      const ref   = sel?.value || '';
      const label = ref ? (sel?.options[sel?.selectedIndex]?.text || ref) : 'Tipo de Item';
      _reportCharts.push({ type: 'donut', ref, label, size, chartStyle, barColor });
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
      <td class="inc-num"><a href="${i.url}" target="_blank" rel="noopener">${i.number || '—'}</a></td>
      <td class="inc-desc">${i.description || '—'}</td>
      <td><span class="report-inc-priority ${priCls(i.priority)}">${priLabel(i.priority)}</span></td>
      <td>${i.state || '—'}</td>
      <td style="white-space:nowrap">${fmtDate(i.openedAt)}</td>
      <td>${i.category || '—'}</td>
    </tr>`).join('');
  return `<table class="report-inc-table">
    <thead><tr>
      <th>Número</th><th>Descrição</th><th>Prior.</th><th>Estado</th><th>Aberto em</th><th>Categoria</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

export async function reportOpenIncidentsModal() {
  _closeIncidentsModal();

  const overlay = document.createElement('div');
  overlay.id        = 'report-inc-modal-overlay';
  overlay.className = 'report-inc-modal-overlay open';
  overlay.onclick   = e => { if (e.target === overlay) _closeIncidentsModal(); };

  const panel = document.createElement('div');
  panel.className = 'report-inc-modal-panel';
  panel.innerHTML = `
    <div class="report-inc-modal-header">
      <div class="report-inc-modal-title">Backlog de Incidentes</div>
      <button class="report-inc-modal-close" onclick="reportCloseIncidentsModal()">&#x2715;</button>
    </div>
    <div class="report-inc-modal-body">
      <div class="report-loading" style="padding:32px 20px">Carregando...</div>
    </div>`;

  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  try {
    const r = await fetch(`/api/sn-incidents?project=${encodeURIComponent(_reportProject)}&month=${encodeURIComponent(_reportMonth || '')}`);
    const { incidents, error } = await r.json();
    const body = panel.querySelector('.report-inc-modal-body');
    if (error) {
      body.innerHTML = `<div class="report-inc-modal-empty">Erro: ${error}</div>`;
    } else if (!incidents || incidents.length === 0) {
      body.innerHTML = '<div class="report-inc-modal-empty">Nenhum incidente encontrado.</div>';
    } else {
      body.innerHTML = `
        <div class="report-inc-modal-count">${incidents.length} incidente${incidents.length !== 1 ? 's' : ''}</div>
        ${_buildIncidentsTable(incidents)}`;
    }
  } catch (e) {
    const body = panel.querySelector('.report-inc-modal-body');
    body.innerHTML = '<div class="report-inc-modal-empty">Erro ao buscar incidentes.</div>';
  }
}

async function _load(refresh = false) {
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
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
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

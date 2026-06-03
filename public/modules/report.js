// ── Monthly Review — modal ES module ─────────────────────────────────────────

let _reportProject   = null;
let _reportMonth     = null;
let _reportCharts    = []; // [{type:'sprint'|'volatility'|'donut'|'incidents', size:'sm'|'md'|'lg', ref?:'', label?:'', chartStyle?:'donut'|'bar', months?:number}]
let _incidentMonths  = 5; // months to show in the static incidents section
let _incidentGroupBy = 'cmdb_ci'; // 'cmdb_ci' | 'resolution_code'
let _pickerIdx       = -1; // -1 = add new, >=0 = edit existing chart
let _lastPayload     = null;
let _dragSrcIdx      = -1;

const _DEFAULT_CHARTS = [
  { type: 'sprint',     size: 'lg' },
  { type: 'volatility', size: 'md' },
  { type: 'donut',      size: 'md', ref: '', label: 'Tipo de Item' },
];

async function _loadGroupFields() {
  let charts   = null;
  let needsSave = false;

  // 1. Try server (config.json) — prefer new format, migrate old format
  try {
    const r    = await fetch('/api/report-config?' + new URLSearchParams({ project: _reportProject }));
    const data = await r.json();
    if (data.incidentMonths)  _incidentMonths  = data.incidentMonths;
    if (data.incidentGroupBy) _incidentGroupBy = data.incidentGroupBy;
    if (data.reportCharts?.length) {
      charts = data.reportCharts; // already in new format — no re-save needed
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
  if (!charts || needsSave) _saveGroupFields(); // persist to config.json
}

function _saveGroupFields() {
  fetch('/api/report-config', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ project: _reportProject, reportCharts: _reportCharts, incidentMonths: _incidentMonths, incidentGroupBy: _incidentGroupBy }),
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
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:${W}px" xmlns="http://www.w3.org/2000/svg">
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

  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:${W}px" xmlns="http://www.w3.org/2000/svg">
      ${axes}${bars}${labels}
    </svg>` + _legendHtml([
    { type: 'rect', color: '#f59e0b', label: 'Adicionadas após início da sprint' },
    { type: 'rect', color: '#ef4444', label: 'Removidas da sprint' },
  ]);
}

function _renderTypeDonut(byType) {
  if (!byType || !byType.length) return '<div class="report-empty-hint">Sem entregas no período</div>';
  const total = byType.reduce((s, t) => s + t.count, 0);
  if (!total) return '<div class="report-empty-hint">Sem entregas no período</div>';

  const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899'];
  const r = 44, cx = 70, cy = 64;
  const circ = 2 * Math.PI * r;

  let segs = '', accumulated = 0;
  byType.forEach((t, i) => {
    const arc    = (t.count / total) * circ;
    const offset = circ - accumulated;
    segs += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none"
      stroke="${COLORS[i % COLORS.length]}" stroke-width="22"
      stroke-dasharray="${arc.toFixed(2)} ${(circ - arc).toFixed(2)}"
      stroke-dashoffset="${offset.toFixed(2)}"
      transform="rotate(-90 ${cx} ${cy})"/>`;
    accumulated += arc;
  });
  segs += `<text x="${cx}" y="${cy - 5}" text-anchor="middle" font-size="15" font-weight="800" fill="var(--text-1)">${total}</text>`;
  segs += `<text x="${cx}" y="${cy + 11}" text-anchor="middle" font-size="9" fill="var(--text-faint)">entregues</text>`;

  const legendItems = byType.map((t, i) => {
    const pct = Math.round(t.count / total * 100);
    return `<span style="display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--text-faint)">` +
      `<span style="width:10px;height:10px;border-radius:2px;background:${COLORS[i % COLORS.length]};display:inline-block;flex-shrink:0"></span>` +
      `${_esc(t.type)}: <strong style="color:var(--text-1)">${t.count} (${pct}%)</strong></span>`;
  }).join('');

  return `<svg viewBox="0 0 140 128" style="width:100%;max-width:140px" xmlns="http://www.w3.org/2000/svg">${segs}</svg>` +
    `<div style="display:flex;justify-content:center;flex-wrap:wrap;gap:6px 16px;padding:8px 0 4px">${legendItems}</div>`;
}

function _renderTypeBar(byType) {
  if (!byType || !byType.length) return '<div class="report-empty-hint">Sem entregas no período</div>';
  const total = byType.reduce((s, t) => s + t.count, 0);
  if (!total) return '<div class="report-empty-hint">Sem entregas no período</div>';

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
    const y  = padT + i * (barH + gap);
    const bW = (t.count / maxVal) * trackW;
    bars   += `<rect x="${padL}" y="${y}" width="${bW.toFixed(1)}" height="${barH}" fill="#8b5cf6" opacity=".8" rx="3"/>`;
    bars   += `<text x="${(padL + bW + 6).toFixed(1)}" y="${(y + barH / 2 + 4).toFixed(1)}" font-size="10" font-weight="700" fill="var(--text-1)">${t.count}</text>`;
    const lbl = t.type.length > 15 ? t.type.slice(0, 14) + '…' : t.type;
    labels += `<text x="${padL - 8}" y="${(y + barH / 2 + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="var(--text-faint)">${_esc(lbl)}</text>`;
  });

  const axes = `<line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + innerH}" stroke="var(--bg-border)" stroke-width="1"/>
    <line x1="${padL}" y1="${padT + innerH}" x2="${W - padR}" y2="${padT + innerH}" stroke="var(--bg-border)" stroke-width="1"/>`;

  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:${W}px" xmlns="http://www.w3.org/2000/svg">
    ${gridLines}${axes}${bars}${labels}
  </svg>`;
}

function _renderIncidentsVolumeChart(monthly, months, target) {
  const data = (monthly || []).slice(-months);
  if (!data.length) return '<div class="report-empty-hint">Sem dados de incidentes para o período</div>';

  const W = 600, H = 214;
  const pad = { t: 20, r: 20, b: 20, l: 44 };
  const cW = W - pad.l - pad.r;
  const cH = H - pad.t - pad.b;

  const maxVal = Math.max(...data.map(m => Math.max(m.opened || 0, m.closed || 0, m.openBacklog || 0)), target || 0, 1);
  const rawStep = maxVal / 4;
  const step = Math.max(1, Math.ceil(rawStep / 4) * 4);
  const yMax = Math.ceil(maxVal / step) * step;

  const grpW = cW / data.length;
  const barW = Math.min(grpW * 0.28, 22);
  const gap  = 5;

  let bars = '', labels = '', gridLines = '', yLabels = '';

  for (let v = 0; v <= yMax; v += step) {
    const y = pad.t + cH - (v / yMax) * cH;
    gridLines += `<line x1="${pad.l}" y1="${y.toFixed(1)}" x2="${W - pad.r}" y2="${y.toFixed(1)}" stroke="var(--bg-border)" stroke-width="1"${v > 0 ? ' stroke-dasharray="4,4"' : ''}/>`;
    yLabels   += `<text x="${pad.l - 6}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="9" fill="var(--text-faint)">${v}</text>`;
  }

  data.forEach((m, i) => {
    const cx     = pad.l + i * grpW + grpW / 2;
    const opened = m.opened || 0;
    const closed = m.closed || 0;
    const hO     = (opened / yMax) * cH;
    const hC     = (closed / yMax) * cH;

    const xO = cx - barW - gap / 2;
    const xC = cx + gap / 2;
    if (hO > 0) {
      bars += `<rect x="${xO.toFixed(1)}" y="${(pad.t + cH - hO).toFixed(1)}" width="${barW}" height="${hO.toFixed(1)}" fill="#93c5fd" rx="2"/>`;
      bars += `<text x="${(xO + barW / 2).toFixed(1)}" y="${(pad.t + cH - hO - 3).toFixed(1)}" text-anchor="middle" font-size="8" fill="var(--text-faint)">${opened}</text>`;
    }
    if (hC > 0) {
      bars += `<rect x="${xC.toFixed(1)}" y="${(pad.t + cH - hC).toFixed(1)}" width="${barW}" height="${hC.toFixed(1)}" fill="#34d399" rx="2"/>`;
      bars += `<text x="${(xC + barW / 2).toFixed(1)}" y="${(pad.t + cH - hC - 3).toFixed(1)}" text-anchor="middle" font-size="8" fill="var(--text-faint)">${closed}</text>`;
    }

    // Label: "Jun/26" (3-char month + 2-digit year)
    const parts = (m.label || '').split('-');
    let shortLabel = m.label;
    if (parts.length === 2) {
      try {
        const raw = new Date(+parts[0], +parts[1] - 1, 1).toLocaleString('pt-BR', { month: 'short' });
        const mon = raw.charAt(0).toUpperCase() + raw.slice(1, 3).replace('.', '');
        shortLabel = mon + '/' + parts[0].slice(2);
      } catch (_) {}
    }
    labels += `<text x="${cx.toFixed(1)}" y="${(H - pad.b + 14).toFixed(1)}" text-anchor="middle" font-size="9" fill="var(--text-faint)">${_esc(shortLabel)}</text>`;
  });

  const targetLine = target > 0 ? (() => {
    const ty = pad.t + cH - (Math.min(target, yMax) / yMax) * cH;
    return `<line x1="${pad.l}" y1="${ty.toFixed(1)}" x2="${W - pad.r}" y2="${ty.toFixed(1)}" stroke="#ef4444" stroke-width="1.5" stroke-dasharray="6,4"/>`;
  })() : '';

  // Linha de backlog (mesma escala das barras)
  const backlogVals = data.map(m => m.openBacklog ?? 0);
  const bkPts = data.map((m, i) => {
    const cx = pad.l + i * grpW + grpW / 2;
    const y  = pad.t + cH - (backlogVals[i] / yMax) * cH;
    return [cx, y];
  });
  const backlogLine = `<polyline points="${bkPts.map(p => p.join(',')).join(' ')}" fill="none" stroke="#f97316" stroke-width="1.5" stroke-dasharray="4,3"/>`;
  const backlogDots = bkPts.map((p, i) => {
    const parts = (data[i].label || '').split('-');
    let lbl = data[i].label;
    if (parts.length === 2) {
      try {
        const raw = new Date(+parts[0], +parts[1] - 1, 1).toLocaleString('pt-BR', { month: 'short' });
        lbl = raw.charAt(0).toUpperCase() + raw.slice(1, 3).replace('.', '') + '/' + parts[0].slice(2);
      } catch (_) {}
    }
    return `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="4" fill="#f97316" style="cursor:default"><title>${lbl}: ${backlogVals[i]} em backlog</title></circle>`;
  }).join('');

  const axes = `
    <line x1="${pad.l}" y1="${pad.t}" x2="${pad.l}" y2="${pad.t + cH}" stroke="var(--bg-border)" stroke-width="1"/>
    <line x1="${pad.l}" y1="${pad.t + cH}" x2="${W - pad.r}" y2="${pad.t + cH}" stroke="var(--bg-border)" stroke-width="1"/>`;

  const legendItems = [
    { type: 'rect', color: '#93c5fd', label: 'Abertos' },
    { type: 'rect', color: '#34d399', label: 'Fechados' },
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

function _renderIncidentHeatmap(bySystemMonthly, monthly) {
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
  const maxCount  = Math.max(...items.flatMap(s => months.map((_, i) => s.monthly[monthStart + i] || 0)), 1);

  const heatBg = cnt => {
    if (!cnt) return 'var(--bg-card)';
    const r = cnt / maxCount;
    if (r < 0.25) return 'rgba(34,197,94,0.25)';
    if (r < 0.5)  return 'rgba(250,204,21,0.45)';
    if (r < 0.75) return 'rgba(249,115,22,0.55)';
    return 'rgba(239,68,68,0.65)';
  };

  const monthLabels = months.map(m => {
    const p = (m.label || '').split('-');
    if (p.length === 2) {
      try {
        const raw = new Date(+p[0], +p[1] - 1, 1).toLocaleString('pt-BR', { month: 'short' });
        return raw.charAt(0).toUpperCase() + raw.slice(1, 3).replace('.', '') + '/' + p[0].slice(2);
      } catch (_) {}
    }
    return m.label;
  });

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
      <thead><tr><th style="${th};text-align:left">IC Afetado</th>${headerCells}</tr></thead>
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
      ? _renderIncidentsVolumeChart(incidents.monthly, chart.months || 5, incidents.target)
      : '<div class="report-empty-hint">Service Now not configured for this project</div>';
  } else {
    title   = `Entregas por ${_esc(chart.label || 'Tipo de Item')}`;
    const data = (delivery.byTypes || {})[chart.ref || ''] || [];
    content = (chart.chartStyle === 'bar') ? _renderTypeBar(data) : _renderTypeDonut(data);
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

// ── Sections ──────────────────────────────────────────────────────────────────

function _renderDelivery(delivery) {
  const sprints = (delivery.sprints || []).sort((a, b) => a.name.localeCompare(b.name));
  const totalSP          = sprints.reduce((s, sp) => s + (sp.points || 0), 0);
  const totalSPDelivered = sprints.reduce((s, sp) => s + (sp.pointsDelivered || 0), 0);

  const sprintRows = sprints.length
    ? sprints.map(s => {
        const pct    = s.total > 0 ? Math.round(s.delivered / s.total * 100) : 0;
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

  return `<div class="report-section">
    <div class="report-section-title">Delivery</div>
    <div class="report-metrics-row">
      ${_metric('User Stories', delivery.totalUS ?? delivery.totalDelivered, 'in period sprints', '')}
      ${_metric('Delivered', delivery.totalDelivered, 'Done / Closed / Resolved', delivery.totalDelivered > 0 ? 'green' : '')}
      ${_metric('Story Points', totalSP, 'committed', '')}
      ${_metric('SP Delivered', totalSPDelivered, 'Done / Closed / Resolved', totalSPDelivered > 0 ? 'green' : '')}
    </div>
    <table class="report-table">
      <thead><tr><th>Sprint</th><th class="num">Total US</th><th class="num">Delivered</th><th class="num">SP Total</th><th class="num">SP Delivered</th></tr></thead>
      <tbody>${sprintRows}</tbody>
    </table>
  </div>`;
}

function _renderQuality(quality) {
  const openCls   = quality.bugsOpen > 10 ? 'red' : quality.bugsOpen > 5 ? 'yellow' : 'green';
  const newCls    = quality.bugsNew  > 5  ? 'red' : quality.bugsNew  > 2  ? 'yellow' : '';
  const closedCls = quality.bugsClosed > 0 ? 'green' : '';
  return `<div class="report-section">
    <div class="report-section-title">Quality</div>
    <div class="report-metrics-row">
      ${_metric('Open Bugs', quality.bugsOpen,   'currently active', openCls)}
      ${_metric('New Bugs',  quality.bugsNew,    'opened this month', newCls)}
      ${_metric('Fixed',     quality.bugsClosed, 'closed this month', closedCls)}
    </div>
  </div>`;
}

function _renderIncidents(inc) {
  if (!inc) return '';
  const riskCls    = inc.total > inc.target ? 'red' : inc.total > inc.target * 0.8 ? 'yellow' : 'green';
  const closedCls  = (inc.closedThisMonth || 0) > 0 ? 'green' : '';
  const backlogCls = (inc.openBacklog || 0) > 20 ? 'red' : (inc.openBacklog || 0) > 10 ? 'yellow' : 'green';
  const avgCls     = (inc.avgResolutionDays || 0) > 5 ? 'red' : (inc.avgResolutionDays || 0) > 2 ? 'yellow' : 'green';

  const monthsOpts = [3, 5, 6, 8, 10, 12, 13].map(n =>
    `<option value="${n}"${n === _incidentMonths ? ' selected' : ''}>${n} meses</option>`
  ).join('');

  const groupOpts = [
    { val: 'cmdb_ci',         label: 'IC Afetado' },
    { val: 'resolution_code', label: 'Additional Resolution Code' },
  ].map(o => `<option value="${o.val}"${_incidentGroupBy === o.val ? ' selected' : ''}>${o.label}</option>`).join('');

  const useAlt      = _incidentGroupBy === 'resolution_code';
  const barData     = useAlt ? (inc.byGroupAlt || [])        : (inc.bySystem || []);
  const heatmapData = useAlt ? (inc.byGroupAltMonthly || []) : (inc.bySystemMonthly || []);
  const groupLabel  = useAlt ? 'Resolution Code' : 'IC Afetado';

  const p1Cls = inc.byPriority.p1 > 0 ? 'red' : 'green';
  const p2Cls = inc.byPriority.p2 > 3 ? 'yellow' : '';

  return `<div class="report-section">
    <div class="report-section-header-row">
      <div class="report-section-title">Incidents</div>
      <div style="display:flex;gap:12px;align-items:center">
        <div class="report-inc-months-ctrl">
          <span class="report-inc-months-lbl">Agrupar</span>
          <select class="report-inc-months-sel" onchange="reportSetIncidentGroupBy(this.value)">${groupOpts}</select>
        </div>
        <div class="report-inc-months-ctrl">
          <span class="report-inc-months-lbl">Hist.</span>
          <select class="report-inc-months-sel" onchange="reportSetIncidentMonths(this.value)">${monthsOpts}</select>
        </div>
      </div>
    </div>
    <div class="report-prb-cards">
      <div class="report-prb-card">
        <div class="report-prb-card-val ${riskCls}">${inc.total}</div>
        <div class="report-prb-card-label">Abertos no mês</div>
        <div class="report-prb-card-sub">Target: ${inc.target}</div>
      </div>
      <div class="report-prb-card">
        <div class="report-prb-card-val ${closedCls}">${inc.closedThisMonth ?? 0}</div>
        <div class="report-prb-card-label">Encerrados no mês</div>
        <div class="report-prb-card-sub">Resolvidos no período</div>
      </div>
      <div class="report-prb-card">
        <div class="report-prb-card-val ${backlogCls}">${inc.openBacklog ?? 0}</div>
        <div class="report-prb-card-label">Backlog atual</div>
        <div class="report-prb-card-sub">Total em aberto</div>
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
        <div class="report-prb-card-sub">Prioridade máxima</div>
      </div>
      <div class="report-prb-card">
        <div class="report-prb-card-val ${p2Cls}">${inc.byPriority.p2}</div>
        <div class="report-prb-card-label">P2 — Alto</div>
        <div class="report-prb-card-sub">Alta prioridade</div>
      </div>
      <div class="report-prb-card">
        <div class="report-prb-card-val">${inc.byPriority.p3}</div>
        <div class="report-prb-card-label">P3 — Médio</div>
        <div class="report-prb-card-sub">Média prioridade</div>
      </div>
      <div class="report-prb-card">
        <div class="report-prb-card-val">${Math.round(inc.target > 0 ? inc.total / inc.target * 100 : 0)}%</div>
        <div class="report-prb-card-label">vs Target</div>
        <div class="report-prb-card-sub">${inc.total > inc.target ? 'Acima do target' : 'Dentro do target'}</div>
      </div>
    </div>
    <div class="report-subsection-title">Abertos e Fechados por Mês</div>
    <div class="report-prb-chart-sub">Histórico de volume de incidentes${inc.target > 0 ? ` — target: ${inc.target}` : ''}</div>
    ${_renderIncidentsVolumeChart(inc.monthly, _incidentMonths, inc.target)}
    <div class="report-subsection-title" style="margin-top:16px">${groupLabel} — Top 9 por Volume</div>
    <div class="report-prb-chart-sub">Volume de incidentes por severidade</div>
    ${_renderIncidentSystemBars(barData)}
    <div class="report-subsection-title" style="margin-top:16px">Heatmap: ${groupLabel} × Mês</div>
    <div class="report-prb-chart-sub">Frequência de incidentes no histórico</div>
    ${_renderIncidentHeatmap(heatmapData, inc.monthly)}
  </div>`;
}

function _renderPrbStatusDonut(list) {
  const STATE_CFG = {
    '101': { label: 'New',                 color: '#0d9488' },
    '102': { label: 'Assess',              color: '#f97316' },
    '103': { label: 'Root Cause Analysis', color: '#eab308' },
    '104': { label: 'Fix in Progress',     color: '#3b82f6' },
    '106': { label: 'Resolved',            color: '#8b5cf6' },
    '107': { label: 'Closed',              color: '#374151' },
  };
  const counts = {};
  (list || []).forEach(p => { const k = String(p.state); counts[k] = (counts[k] || 0) + 1; });
  const total = Object.values(counts).reduce((s, v) => s + v, 0);
  if (total === 0) return '<div class="report-empty-row">No PRBs</div>';

  const W = 280, cx = 140, cy = 105, R = 82, ri = 46;
  let startAngle = -Math.PI / 2;
  const slices = [];
  const legendItems = [];
  Object.entries(counts).forEach(([state, count]) => {
    const cfg = STATE_CFG[state] || { label: state, color: '#6b7280' };
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

  const MONTH_NAMES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

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
    const [y, mo] = m.label.split('-');
    const lbl = MONTH_NAMES[parseInt(mo) - 1] + '/' + y.slice(2);
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
    const [y, mo] = monthly[i].label.split('-');
    const lbl = MONTH_NAMES[parseInt(mo) - 1] + '/' + y.slice(2);
    return `<circle cx="${p[0]}" cy="${p[1]}" r="4" fill="#ef4444" style="cursor:default"><title>${lbl}: ${accumulated[i]} em backlog</title></circle>`;
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

  const STATE_CFG = {
    '101': { label: 'New',                 color: '#0d9488' },
    '102': { label: 'Assess',              color: '#f97316' },
    '103': { label: 'Root Cause Analysis', color: '#eab308' },
    '104': { label: 'Fix in Progress',     color: '#3b82f6' },
    '106': { label: 'Resolved',            color: '#8b5cf6' },
    '107': { label: 'Closed',              color: '#374151' },
  };
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
      return `<rect x="${bx}" y="${yTop}" width="${bw}" height="${h}" fill="${STATE_CFG[st].color}" rx="1"/>` +
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
    ({ type: 'rect', color: STATE_CFG[st].color, label: STATE_CFG[st].label })
  ));
}

function _renderPrbOldestList(list) {
  if (!list || list.length === 0) return '<div class="report-empty-row">No PRBs</div>';

  const STATE_LABELS = { '101':'New','102':'Assess','103':'Root Cause Analysis','104':'Fix in Progress','106':'Resolved','107':'Closed' };
  const STATE_COLORS = { '101':'#0d9488','102':'#f97316','103':'#eab308','104':'#3b82f6','106':'#8b5cf6','107':'#6b7280' };
  const P_COLORS     = { '1':'#ef4444','2':'#f97316','3':'#eab308','4':'#6b7280' };

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
      <td class="report-td"><span style="font-size:11px;font-weight:600;color:${STATE_COLORS[st] || 'var(--text-faint)'}">${_esc(STATE_LABELS[st] || st)}</span></td>
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
  const accCls    = prbs.open > 10 ? 'red' : prbs.open > 3 ? 'yellow' : 'green';
  const avgResCls = (prbs.avgResolutionDays || 0) > 30 ? 'red' : (prbs.avgResolutionDays || 0) > 14 ? 'yellow' : 'green';

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
        <div class="report-prb-card-label">Backlog atual</div>
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
  const { metadata, hasSn, delivery, quality, incidents, prbs } = payload;
  const snWarning = !hasSn
    ? '<div class="report-sn-notice">Service Now not configured for this project. Showing Azure DevOps data only.</div>'
    : '';

  const sprints = (delivery.sprints || []).sort((a, b) => a.name.localeCompare(b.name));

  const chartCells = _reportCharts.map((chart, idx) =>
    _renderChartCell(chart, delivery, idx, sprints, incidents)
  ).join('');

  return `
    <div class="report-content">
      <div class="report-header-card">
        <div class="report-header-title">${_esc(metadata.project)}</div>
        <div class="report-header-period">${_esc(metadata.period)}</div>
        <div class="report-header-gen">Generated: ${_esc(metadata.generatedAt)}</div>
      </div>
      ${snWarning}
      <div class="report-grid">
        ${_renderDelivery(delivery)}
        ${_renderQuality(quality)}
      </div>
      <div class="report-donuts-grid">
        ${chartCells}
        <div class="report-add-chart-section">
          <button class="report-add-chart-btn" onclick="reportAddChart()">+ Adicionar gráfico</button>
        </div>
      </div>
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
  await _loadGroupFields();

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
  const currentSize   = currentChart?.size       || 'md';
  const currentType   = currentChart?.type       || 'donut';
  const currentRef    = currentChart?.ref        || '';
  const currentStyle  = currentChart?.chartStyle || 'donut';
  const isDonut       = !isEdit ? true : currentType === 'donut';
  const isIncidents   = isEdit && currentType === 'incidents';
  const currentMonths = currentChart?.months || 5;

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
    { val: 'donut', label: 'Donut' },
    { val: 'bar',   label: 'Barras' },
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

  picker.innerHTML = `
    <div class="report-field-picker-title">${isEdit ? 'Configurar gráfico' : 'Novo gráfico'}</div>
    ${typeSection}
    ${fieldSection}
    ${styleSection}
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
        _loadPickerFields('');
      } else if (isIncNow) {
        hide('report-field-label'); hide('report-field-picker-body');
        hide('report-style-label'); hide('report-style-group');
        show('report-months-section');
      } else {
        hide('report-field-label'); hide('report-field-picker-body');
        hide('report-style-label'); hide('report-style-group');
        hide('report-months-section');
      }
    });
  }

  // Load fields for donut picker
  if (isDonut) {
    _loadPickerFields(currentRef);
  }
}

export function reportSetIncidentMonths(n) {
  _incidentMonths = Math.min(13, Math.max(1, parseInt(n) || 5));
  _saveGroupFields();
  _rerender();
}

export function reportSetIncidentGroupBy(val) {
  _incidentGroupBy = val === 'resolution_code' ? 'resolution_code' : 'cmdb_ci';
  _saveGroupFields();
  _rerender();
}

export function reportAddChart() {
  reportOpenFieldPicker(-1);
}

export function reportRemoveChart(idx) {
  _reportCharts.splice(idx, 1);
  _saveGroupFields();
  _rerender();
}

export function reportResizeChart(idx, size) {
  _reportCharts[idx] = { ..._reportCharts[idx], size };
  _saveGroupFields();
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
  _saveGroupFields();
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

function _applyChartPicker() {
  const size       = document.querySelector('#report-size-group-el .report-size-opt.active')?.dataset.size
                  || document.querySelector('#report-field-picker .report-size-opt[data-size].active')?.dataset.size
                  || 'md';
  const chartStyle = document.querySelector('#report-style-group .report-size-opt.active')?.dataset.style || 'donut';
  let needsRefetch = false;

  if (_pickerIdx >= 0) {
    // Edit existing chart
    const chart = _reportCharts[_pickerIdx];
    if (chart.type === 'incidents') {
      const months = Math.min(12, Math.max(1, parseInt(document.getElementById('report-inc-months')?.value) || 5));
      _reportCharts[_pickerIdx] = { type: 'incidents', size, months };
    } else if (chart.type === 'donut') {
      const sel = document.getElementById('report-field-sel');
      if (sel) {
        const ref   = sel.value;
        const label = ref ? (sel.options[sel.selectedIndex]?.text || ref) : 'Tipo de Item';
        needsRefetch = ref !== chart.ref;
        _reportCharts[_pickerIdx] = { type: 'donut', ref, label, size, chartStyle };
      } else {
        _reportCharts[_pickerIdx] = { ...chart, size, chartStyle };
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
      const months = Math.min(12, Math.max(1, parseInt(document.getElementById('report-inc-months')?.value) || 5));
      _reportCharts.push({ type: 'incidents', size, months });
    } else if (type === 'donut') {
      const sel   = document.getElementById('report-field-sel');
      const ref   = sel?.value || '';
      const label = ref ? (sel?.options[sel?.selectedIndex]?.text || ref) : 'Tipo de Item';
      _reportCharts.push({ type: 'donut', ref, label, size, chartStyle });
      needsRefetch = true;
    } else {
      _reportCharts.push({ type, size });
    }
  }

  _saveGroupFields();
  _closeFieldPicker();
  if (needsRefetch) {
    _load(true);
  } else {
    _rerender();
  }
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.getElementById('report-modal')?.classList.contains('open')) {
    closeReport();
  }
});

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

// ── Monthly Review — chart renderers ─────────────────────────────────────────
import { S } from './report-state.js';

const _PRB_STATES = {
  '101': { label: 'New',                 color: '#0d9488' },
  '102': { label: 'Assess',              color: '#f97316' },
  '103': { label: 'Root Cause Analysis', color: '#eab308' },
  '104': { label: 'Fix in Progress',     color: '#3b82f6' },
  '106': { label: 'Resolved',            color: '#8b5cf6' },
  '107': { label: 'Closed',              color: '#374151' },
};

// Builds onclick attribute string for incidents modal (pure string helper).
function _incOnclick(mode, month, filterField, filterValue, title) {
  const json = JSON.stringify({ mode, month, filterField, filterValue, title }).replace(/'/g, '&#39;');
  return `data-inc='${json}' onclick="reportOpenIncidentFilter(this)" style="cursor:pointer"`;
}

export function _esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function _metric(label, value, sub, colorClass) {
  return `<div class="report-metric">
    <div class="report-metric-val${colorClass ? ' ' + colorClass : ''}">${value}</div>
    <div class="report-metric-label">${label}</div>
    ${sub ? `<div class="report-metric-sub">${sub}</div>` : ''}
  </div>`;
}

// ── Bar chart (CSS div-based, zero deps) ─────────────────────────────────────

export function _barChart(items, maxVal) {
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
export function _legendHtml(items) {
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

export function _renderSprintChart(sprints) {
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

export function _renderVolatilityChart(sprints) {
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

export function _renderTypeDonut(byType, metricLabel) {
  const emptyHint = metricLabel === 'Story Points' ? 'Sem Story Points no período' : 'Sem User Stories no período';
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
export function _donutChart(items, centerLabel) {
  const total = items.reduce((s, i) => s + i.count, 0);
  if (!total) return `<div class="report-empty-hint">Sem dados</div>`;
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

export function _renderTypeBar(byType, barColor, metricLabel, size) {
  const emptyHint = metricLabel === 'Story Points' ? 'Sem Story Points no período' : 'Sem User Stories no período';
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

export function _renderTypeBarVertical(byType, barColor, metricLabel, size) {
  const emptyHint = metricLabel === 'Story Points' ? 'Sem Story Points no período' : 'Sem User Stories no período';
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

export function _renderIncPriorityDonut(inc) {
  const p1     = inc?.p1    || 0;
  const p2     = inc?.p2    || 0;
  const p3     = inc?.p3    || 0;
  const outros = Math.max(0, (inc?.total || 0) - p1 - p2 - p3);
  const items  = [
    { type: 'P1 — Critico', count: p1,     color: '#ef4444' },
    { type: 'P2 — Alto',    count: p2,     color: '#f97316' },
    { type: 'P3 — Medio',   count: p3,     color: '#eab308' },
    ...(outros > 0 ? [{ type: 'Outros', count: outros, color: '#6b7280' }] : []),
  ].filter(item => item.count > 0);
  if (!items.length) return '<div class="report-empty-hint">Sem incidentes no periodo</div>';
  return _donutChart(items, 'Incidentes');
}

export function _renderIncidentsVolumeChart(monthly, months, target, selectedMonth) {
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

export function _renderIncidentSystemBars(bySystem, reportMonth, groupby) {
  const all = bySystem || [];
  if (!all.length) return '<div class="report-empty-hint">Sem dados de IC para o período</div>';
  let items;
  const cutoff = S.heatmapTopN > 0 ? S.heatmapTopN : Infinity;
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

export function _renderIncidentHeatmap(bySystemMonthly, monthly, colLabel, groupby) {
  const allMonths = monthly || [];
  const months = allMonths.slice(-S.incidentMonths);
  const allSystems = bySystemMonthly || [];
  if (!allSystems.length || !months.length) return '<div class="report-empty-hint">Sem dados para o período</div>';
  let items;
  const cutoffH = S.heatmapTopN > 0 ? S.heatmapTopN : Infinity;
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
  const maxCount  = S.heatmapMax > 0 ? S.heatmapMax : autoMax;

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

// ── US Aging charts ──────────────────────────────────────────────────────────

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

export function _renderUsAgingBuckets(usAging) {
  if (!usAging) return '<div class="report-empty-hint">Sem dados — clique em ⚙ para configurar o estado</div>';
  if (!usAging.total) return '<div class="report-empty-hint">Sem US no estado configurado</div>';
  // Use list for configurable thresholds; fall back to pre-computed buckets in old cache entries
  const buckets = usAging.list?.length
    ? _computeAgingBuckets(usAging.list, S.agingBuckets)
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

export function _renderUsTop10(usAging) {
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

// ── Incident by Location — grouped bar per month ───────────────────────────────

export function _renderIncidentLocationChart(byLocationMonthly, monthly, months) {
  const allMonths = monthly || [];
  const slicedM   = allMonths.slice(-months);
  if (!slicedM.length || !byLocationMonthly || !byLocationMonthly.length) {
    return '<div class="report-empty-hint">Sem dados de localização para o período</div>';
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

// ── PRB charts ────────────────────────────────────────────────────────────────

export function _renderPrbStatusDonut(list) {
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

export function _renderPrbEvolutionChart(monthly) {
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

export function _renderPrbAgingChart(list) {
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

export function _renderPrbOldestList(list) {
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

export function _renderIncPriorityTrend(monthly) {
  const data = (monthly || []).slice(-S.incidentMonths);
  if (!data.length) return '<div class="report-empty-hint">Sem dados para o período</div>';

  const W = 600, padT = 24, padB = 30, padL = 32, padR = 16;
  const cH = 150;
  const H  = padT + cH + padB;
  const cW = W - padL - padR;
  const n  = data.length;

  const maxV = Math.max(...data.flatMap(m => [m.p1 || 0, m.p2 || 0, m.p3 || 0]), 1);
  const xOf  = i => padL + (n === 1 ? cW / 2 : i / (n - 1) * cW);
  const yOf  = v => padT + cH - (v / maxV) * cH;

  const LINES = [
    { key: 'p1', color: '#ef4444', label: 'P1 — Crítico' },
    { key: 'p2', color: '#f97316', label: 'P2 — Alto' },
    { key: 'p3', color: '#eab308', label: 'P3 — Médio' },
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

export function _renderIncSlaBars(slaByPriority) {
  if (!slaByPriority) return '<div class="report-empty-hint">Sem dados de SLA para o período</div>';
  const PRIOS = [
    { key: 'p1', label: 'P1 — Crítico', color: '#ef4444', target: S.slaTargets.p1 ?? 95 },
    { key: 'p2', label: 'P2 — Alto',    color: '#f97316', target: S.slaTargets.p2 ?? 90 },
    { key: 'p3', label: 'P3 — Médio',   color: '#eab308', target: S.slaTargets.p3 ?? 85 },
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

export function _renderPrbCategoryChart(list) {
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

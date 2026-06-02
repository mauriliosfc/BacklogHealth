// ── Report renderer ───────────────────────────────────────────────────────────

const payload = window.__REPORT_PAYLOAD__;

function _esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
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

// ── Sections ──────────────────────────────────────────────────────────────────

function _renderDelivery(delivery) {
  const sprints = (delivery.sprints || []).sort((a, b) => a.name.localeCompare(b.name));
  const sprintRows = sprints.length
    ? sprints.map(s => `<tr><td>${_esc(s.name)}</td><td class="num">${s.delivered}</td><td class="num">${s.points || 0}</td></tr>`).join('')
    : '<tr><td colspan="3" class="report-empty-row">No deliveries found for this period</td></tr>';

  return `<div class="report-section">
    <div class="report-section-title">Delivery</div>
    <div class="report-metrics-row">
      ${_metric('User Stories Delivered', delivery.totalDelivered, 'in the period', delivery.totalDelivered > 0 ? 'green' : '')}
    </div>
    <table class="report-table">
      <thead><tr><th>Sprint</th><th class="num">Delivered</th><th class="num">Story Points</th></tr></thead>
      <tbody>${sprintRows}</tbody>
    </table>
  </div>`;
}

function _renderQuality(quality) {
  const openPct = quality.bugsTotal > 0 ? Math.round(quality.bugsOpen / quality.bugsTotal * 100) : 0;
  const cls     = quality.bugsOpen > 10 ? 'red' : quality.bugsOpen > 5 ? 'yellow' : 'green';
  return `<div class="report-section">
    <div class="report-section-title">Quality</div>
    <div class="report-metrics-row">
      ${_metric('Open Bugs', quality.bugsOpen, `${openPct}% of total`, cls)}
      ${_metric('Total Bugs (all time)', quality.bugsTotal, '')}
    </div>
  </div>`;
}

function _renderIncidents(inc) {
  if (!inc) return '';
  const riskCls = inc.total > inc.target ? 'red' : inc.total > inc.target * 0.8 ? 'yellow' : 'green';
  const pctOfTarget = inc.target > 0 ? Math.round(inc.total / inc.target * 100) : 0;

  const monthlyItems = (inc.monthly || []).map(m => ({ label: m.label.slice(5), value: m.opened }));
  const maxOpened = Math.max(...monthlyItems.map(i => i.value), inc.target, 1);

  const bySystemRows = (inc.bySystem || []).map(s =>
    `<tr><td>${_esc(s.name)}</td><td class="num">${s.count}</td></tr>`
  ).join('') || '<tr><td colspan="2" class="report-empty-row">No data</td></tr>';

  return `<div class="report-section">
    <div class="report-section-title">Incidents</div>
    <div class="report-metrics-row">
      ${_metric('Total Incidents', inc.total, `Target: ${inc.target}`, riskCls)}
      ${_metric('vs Target', pctOfTarget + '%', inc.total > inc.target ? 'above target' : 'within target', riskCls)}
      ${_metric('P1', inc.byPriority.p1, 'critical', inc.byPriority.p1 > 0 ? 'red' : 'green')}
      ${_metric('P2', inc.byPriority.p2, 'high', inc.byPriority.p2 > 3 ? 'yellow' : '')}
      ${_metric('P3', inc.byPriority.p3, 'medium', '')}
    </div>
    <div class="report-subsection-title">Monthly Trend</div>
    ${_barChart(monthlyItems, maxOpened)}
    <div class="report-target-line-hint">Target: ${inc.target} / month</div>
    <div class="report-subsection-title">By Category (Top 5)</div>
    <table class="report-table">
      <thead><tr><th>Category</th><th class="num">Count</th></tr></thead>
      <tbody>${bySystemRows}</tbody>
    </table>
  </div>`;
}

function _renderPRBs(prbs) {
  if (!prbs) return '';
  const agingCls = prbs.avgAging > 30 ? 'red' : prbs.avgAging > 14 ? 'yellow' : 'green';

  const prbRows = (prbs.list || []).slice(0, 20).map(p => {
    const agCls = p.agingDays > 30 ? 'red' : p.agingDays > 14 ? 'yellow' : '';
    return `<tr>
      <td class="report-id">${_esc(p.id)}</td>
      <td>${_esc(p.title)}</td>
      <td class="num">P${_esc(p.priority || '?')}</td>
      <td class="num ${agCls}">${p.agingDays}d</td>
    </tr>`;
  }).join('') || '<tr><td colspan="4" class="report-empty-row">No open PRBs</td></tr>';

  return `<div class="report-section">
    <div class="report-section-title">PRBs — Problems</div>
    <div class="report-metrics-row">
      ${_metric('Open PRBs', prbs.open, '', prbs.open > 5 ? 'red' : prbs.open > 0 ? 'yellow' : 'green')}
      ${_metric('Avg Aging', prbs.avgAging + 'd', 'days open', agingCls)}
    </div>
    <table class="report-table">
      <thead><tr><th>ID</th><th>Title</th><th class="num">Priority</th><th class="num">Aging</th></tr></thead>
      <tbody>${prbRows}</tbody>
    </table>
  </div>`;
}

// ── Main render ───────────────────────────────────────────────────────────────

function renderReport() {
  const el = document.getElementById('report-content');
  if (!payload) { el.innerHTML = '<div class="report-error">No report data available.</div>'; return; }

  const { metadata, hasSn, delivery, quality, incidents, prbs } = payload;

  const snWarning = !hasSn
    ? '<div class="report-sn-notice">Service Now not configured for this project. Showing Azure DevOps data only.</div>'
    : '';

  el.innerHTML = `
    <div class="report-header-card">
      <div class="report-header-title">${_esc(metadata.project)}</div>
      <div class="report-header-period">${_esc(metadata.period)}</div>
    </div>
    ${snWarning}
    <div class="report-grid">
      ${_renderDelivery(delivery)}
      ${_renderQuality(quality)}
    </div>
    ${incidents ? _renderIncidents(incidents) : ''}
    ${prbs      ? _renderPRBs(prbs)           : ''}
  `;
}

renderReport();

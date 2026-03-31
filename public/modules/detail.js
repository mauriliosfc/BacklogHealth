import { buildSprintData, fmtD } from './utils.js';

export const _detailState = { project: null, sprints: [] };

export async function loadDetailData(project, selectedSprints = _detailState.sprints) {
  const btnRefreshDetail = document.getElementById('btnRefreshDetail');
  if (btnRefreshDetail) { btnRefreshDetail.disabled = true; btnRefreshDetail.textContent = '\u23f3'; }
  document.getElementById('modal-sub').textContent = 'Carregando dados completos...';
  document.getElementById('modal-body').innerHTML = '<div class="modal-loading">\u23f3 Buscando todos os itens do projeto...</div>';
  try {
    const resp = await fetch('/detail?' + new URLSearchParams({ project }));
    const data = await resp.json();
    if (data.error) throw new Error(data.error);

    const filtered = selectedSprints.length > 0
      ? data.items.filter(i => selectedSprints.includes(i.iteration))
      : data.items;

    const filterLabel = selectedSprints.length === 0
      ? 'Todos os sprints \u00b7 ' + data.items.length + ' itens'
      : selectedSprints.length + ' sprint(s) filtrada(s) \u00b7 ' + filtered.length + ' de ' + data.items.length + ' itens';

    document.getElementById('modal-sub').textContent = filterLabel;
    const sprintFilter = s => !selectedSprints.length || selectedSprints.includes(s.iteration);
    const taskItems = (data.taskItems || []).filter(sprintFilter);
    const bugItems  = (data.bugItems  || []).filter(sprintFilter);
    const taskCompletedWork = taskItems.reduce((s, t) => s + t.completedWork, 0);
    const bugCompletedWork  = bugItems.reduce((s, t)  => s + t.completedWork, 0);
    const totalBugs         = bugItems.length;
    document.getElementById('modal-body').innerHTML = buildDetailHTML(filtered, data.iterMap, selectedSprints, taskCompletedWork, totalBugs, bugCompletedWork);
  } catch(e) {
    document.getElementById('modal-body').innerHTML = '<p style="color:#f87171;padding:20px">Erro: ' + e.message + '</p>';
  } finally {
    if (btnRefreshDetail) { btnRefreshDetail.disabled = false; btnRefreshDetail.textContent = '\u21bb'; }
  }
}

export async function openDetails(btn) {
  const card = btn.closest('.card');
  _detailState.project = card.dataset.project;
  _detailState.sprints = Array.from(
    card.querySelectorAll('.custom-select input[type="checkbox"]:checked')
  ).map(c => c.value);

  const modal = document.getElementById('detail-modal');
  document.getElementById('modal-title').textContent = _detailState.project;
  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
  await loadDetailData(_detailState.project, _detailState.sprints);
}

export function closeDetails(e) {
  if (e && e.target !== document.getElementById('detail-modal')) return;
  document.getElementById('detail-modal').classList.remove('open');
  document.body.style.overflow = '';
}

export function closeDetailsBtn() {
  const modal = document.getElementById('detail-modal');
  modal.classList.remove('open', 'maximized');
  document.body.style.overflow = '';
  document.getElementById('btnMaximize').textContent = '\u2922';
}

export function toggleMaximize() {
  const modal = document.getElementById('detail-modal');
  const btn = document.getElementById('btnMaximize');
  const isMax = modal.classList.toggle('maximized');
  btn.textContent = isMax ? '\u2921' : '\u2922';
  btn.title = isMax ? 'Restaurar' : 'Maximizar';
}

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDetailsBtn(); });

function statusColor(s) {
  if (['Active','In Progress','Doing','Committed'].includes(s)) return '#60a5fa';
  if (['Closed','Done'].includes(s)) return '#22c55e';
  if (['Resolved'].includes(s)) return '#a78bfa';
  if (['Removed'].includes(s)) return '#ef4444';
  if (['Blocked','Impediment'].includes(s)) return '#f87171';
  return '#64748b';
}

function typeColor(t) {
  const m = { 'Bug':'#ef4444','User Story':'#60a5fa','Product Backlog Item':'#60a5fa','Task':'#f59e0b','Feature':'#a78bfa','Epic':'#ec4899' };
  return m[t] || '#64748b';
}

function barList(entries, total) {
  const max = Math.max(...entries.map(e => e[1]), 1);
  return entries.map(([label, val, color]) => {
    const pct = Math.round(val / max * 100);
    const ofTotal = total ? Math.round(val / total * 100) : 0;
    const short = label.includes('\\') ? label.split('\\').slice(1).join(' \u203a ') : label;
    return '<div class="bar-row">' +
      '<div class="bar-label" title="' + label + '">' + short + '</div>' +
      '<div class="bar-track"><div class="bar-fill" style="width:' + pct + '%;background:' + (color||'#60a5fa') + '"></div></div>' +
      '<div class="bar-num">' + val + '</div>' +
      '<div class="bar-pct">' + ofTotal + '%</div>' +
      '</div>';
  }).join('');
}

function ring(pct, color) {
  const r = 34, circ = 2 * Math.PI * r;
  const dash = circ * pct / 100;
  return '<div class="ring-wrap"><svg width="80" height="80" viewBox="0 0 80 80">' +
    '<circle cx="40" cy="40" r="' + r + '" fill="none" stroke="#1e293b" stroke-width="8"/>' +
    '<circle cx="40" cy="40" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="8" stroke-dasharray="' + dash + ' ' + circ + '" stroke-linecap="round"/>' +
    '</svg><div class="ring-pct" style="color:' + color + '">' + pct + '%</div></div>';
}

function buildDetailHTML(items, iterMap, selectedSprints, taskCompletedWork, totalBugs, bugCompletedWork) {
  const total = items.length;
  if (!total) return '<p style="color:#64748b;padding:20px">Nenhum item encontrado.</p>';

  const filterBanner = selectedSprints && selectedSprints.length > 0
    ? '<div style="background:#1e3a5f;border:1px solid #2d5a8e;border-radius:8px;padding:10px 14px;margin-bottom:20px;font-size:12px;color:#93c5fd">' +
      '\uD83D\uDD0D Filtrado por ' + selectedSprints.length + ' sprint(s): ' +
      selectedSprints.map(function(s) { var p = s.split('\u005c'); return '<strong>' + (p.length > 1 ? p.slice(1).join(' \u203a ') : s) + '</strong>'; }).join(', ') +
      '</div>'
    : '';

  const US_TYPES = ['User Story', 'Product Backlog Item', 'Requirement'];
  const usItems  = items.filter(i => US_TYPES.includes(i.type));
  const usTotal  = usItems.length;
  const totalPts = items.reduce((s, i) => s + (i.pts || 0), 0);
  const closed   = items.filter(i => ['Closed','Done'].includes(i.state)).length;
  const resolved = items.filter(i => i.state === 'Resolved').length;
  const active   = items.filter(i => ['Active','In Progress','Doing','Committed'].includes(i.state)).length;
  const newItems = items.filter(i => i.state === 'New').length;
  const bugs     = totalBugs || items.filter(i => i.type === 'Bug').length;
  const us       = usTotal;
  const noEst    = items.filter(i => i.pts == null).length;
  const noAsgn   = items.filter(i => !i.assigned).length;
  const donePts  = items.filter(i => ['Closed','Done','Resolved'].includes(i.state)).reduce((s,i)=>s+(i.pts||0),0);
  const usClosed     = usItems.filter(i => ['Closed','Done','Resolved'].includes(i.state)).length;
  const usUAT        = usItems.filter(i => i.state === 'UAT').length;
  const uatPct       = usTotal ? Math.round(usUAT / usTotal * 100) : 0;
  const usNoEst      = usItems.filter(i => i.pts == null).length;
  const completedHrs = taskCompletedWork || 0;
  const completedHrsFmt = completedHrs % 1 === 0 ? completedHrs : completedHrs.toFixed(1);
  const bugHrs = bugCompletedWork || 0;
  const bugHrsFmt = bugHrs % 1 === 0 ? bugHrs : bugHrs.toFixed(1);
  const closedPct    = usTotal ? Math.round(usClosed / usTotal * 100) : 0;
  const totalHrs     = completedHrs + bugHrs;
  const bugRate      = totalHrs ? Math.round(bugHrs / totalHrs * 100) : 0;
  const estPct       = usTotal ? Math.round((usTotal - usNoEst) / usTotal * 100) : 0;

  // By status — apenas US
  const US_TYPES_D = ['User Story', 'Product Backlog Item', 'Requirement'];
  const byStatus = {};
  items.filter(i => US_TYPES_D.includes(i.type)).forEach(i => { byStatus[i.state] = (byStatus[i.state]||0) + 1; });
  const statusEntries = Object.entries(byStatus).sort((a,b)=>b[1]-a[1]).map(([k,v])=>[k,v,statusColor(k)]);

  // By assignee — apenas US
  const byAsgn = {};
  items.filter(i => US_TYPES_D.includes(i.type)).forEach(i => { const n = i.assigned||'Sem respons\u00e1vel'; byAsgn[n]=(byAsgn[n]||0)+1; });
  const asgnEntries = Object.entries(byAsgn).sort((a,b)=>b[1]-a[1]).slice(0,12).map(([k,v])=>[k,v,'#60a5fa']);

  // By sprint
  const { bySprint, sorted: sortedSprintEntries, sprintMeta } = buildSprintData(items, iterMap);
  const allSprintData = JSON.stringify(sprintMeta).replace(/</g, '\\u003c').replace(/'/g, '&#39;');

  const sprintRows = sortedSprintEntries.map(([key, d]) => {
    const iter = iterMap[key]||{};
    const label = key.includes('\\') ? key.split('\\').slice(1).join(' \u203a ') : key;
    const dateR = (iter.start && iter.end) ? fmtD(iter.start) + ' \u2013 ' + fmtD(iter.end) : '\u2014';
    const pct = d.us ? Math.round(d.usClosed/d.us*100) : 0;
    const isCurr = iter.isCurrent;
    const safeKey = key.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    return '<tr' + (isCurr?' class="is-current"':'') + ' data-sprint-key="' + safeKey + '">' +
      '<td>' + label + (isCurr?' <span class="badge green" style="font-size:10px;padding:1px 6px">atual</span>':'') + '</td>' +
      '<td>' + dateR + '</td>' +
      '<td>' + d.us + '</td>' +
      '<td>' + d.pts + '</td>' +
      '<td>' + d.usClosed + ' <span style="color:#475569">(' + pct + '%)</span></td>' +
      '<td><button class="btn-burndown" type="button" onclick="openBurndown(this)" title="Ver burndown">\uD83D\uDCCA</button></td>' +
      '</tr>';
  }).join('');

  const tlSection = buildTimeline(bySprint, iterMap);

  return filterBanner + '<div class="d-section"><div class="d-section-title">Resumo Geral</div>' +
    '<div class="d-grid">' +
      '<div class="d-card"><div class="d-label">Total Itens</div><div class="d-val blue">' + total + '</div></div>' +
      '<div class="d-card"><div class="d-label">User Stories</div><div class="d-val blue">' + us + '</div></div>' +
      '<div class="d-card"><div class="d-label">Story Points</div><div class="d-val purple">' + totalPts + '</div></div>' +
      '<div class="d-card"><div class="d-label">Pts Entregues</div><div class="d-val green">' + donePts + '</div></div>' +
      '<div class="d-card"><div class="d-label">Em Andamento</div><div class="d-val blue">' + active + '</div></div>' +
      '<div class="d-card"><div class="d-label">Novos</div><div class="d-val">' + newItems + '</div></div>' +
      '<div class="d-card"><div class="d-label">Sem Estimativa</div><div class="d-val ' + (noEst>total*0.3?'yellow':'') + '">' + noEst + '</div></div>' +
      '<div class="d-card"><div class="d-label">Hrs Tasks</div><div class="d-val purple">' + completedHrsFmt + 'h</div></div>' +
      '<div class="d-card"><div class="d-label">Hrs Bugs</div><div class="d-val ' + (bugHrs>0?'red':'') + '">' + bugHrsFmt + 'h</div></div>' +
    '</div></div>' +

    '<div class="d-section"><div class="d-section-title">Indicadores de Sa\u00fade</div>' +
      '<div style="display:flex;gap:32px;flex-wrap:wrap">' +
        '<div class="progress-ring">' + ring(closedPct,'#22c55e') + '<div><div class="d-label">Taxa de Conclus\u00e3o</div><div class="d-val green" style="font-size:22px">' + closedPct + '%</div><div class="d-sub">' + usClosed + ' de ' + usTotal + ' US conclu\u00eddas</div></div></div>' +
        '<div class="progress-ring">' + ring(uatPct,'#f59e0b') + '<div><div class="d-label">Em UAT</div><div class="d-val ' + (uatPct>30?'red':uatPct>15?'yellow':'') + '" style="font-size:22px;color:#f59e0b">' + uatPct + '%</div><div class="d-sub">' + usUAT + ' de ' + usTotal + ' US em valida\u00e7\u00e3o</div></div></div>' +
        '<div class="progress-ring">' + ring(bugRate,'#ef4444') + '<div><div class="d-label">Taxa de Bugs</div><div class="d-val ' + (bugRate>20?'red':bugRate>10?'yellow':'') + '" style="font-size:22px">' + bugRate + '%</div><div class="d-sub">' + bugs + ' bugs no total</div></div></div>' +
        '<div class="progress-ring">' + ring(estPct,'#60a5fa') + '<div><div class="d-label">Cobertura de Estimativas</div><div class="d-val blue" style="font-size:22px">' + estPct + '%</div><div class="d-sub">' + (usTotal-usNoEst) + ' de ' + usTotal + ' US estimadas</div></div></div>' +
      '</div>' +
    '</div>' +

    '<div class="d-cols">' +
      '<div class="d-section" style="margin:0"><div class="d-section-title">US por Status</div><div class="bar-list">' + barList(statusEntries, usTotal) + '</div></div>' +
      '<div class="d-section" style="margin:0"><div class="d-section-title">US por Respons\u00e1vel</div><div class="bar-list">' + barList(asgnEntries, usTotal) + '</div></div>' +
    '</div>' +

    '<div class="d-section"><div class="d-section-title">Distribui\u00e7\u00e3o por Sprint</div>' +
      '<table class="d-table" data-sprints=\'' + allSprintData + '\'><thead><tr><th>Sprint</th><th>Per\u00edodo</th><th>User Stories</th><th>Story Points</th><th>Conclu\u00eddos</th><th>A\u00e7\u00f5es</th></tr></thead>' +
      '<tbody>' + sprintRows + '</tbody></table>' +
    '</div>' +
    tlSection;
}

function buildTimeline(bySprint, iterMap) {
  const now = new Date();
  const items = Object.entries(bySprint)
    .filter(([key]) => iterMap[key] && iterMap[key].start && iterMap[key].end)
    .map(([key, d]) => {
      const it = iterMap[key];
      const start = new Date(it.start), end = new Date(it.end);
      const label = key.split('\u005c').pop();
      return { key, label, start, end, us: d.us, total: d.total, pts: d.pts, closed: d.closed, isCurrent: !!it.isCurrent, isPast: end < now };
    })
    .sort((a, b) => a.start - b.start);

  if (items.length < 2) return '';

  const minDate = items[0].start;
  const maxDate = items[items.length - 1].end;
  const totalMs  = maxDate - minDate || 1;
  const maxUS    = Math.max(...items.map(t => t.us), 1);

  function pct(d) { return ((d - minDate) / totalMs * 100).toFixed(2); }

  const months = [];
  const mc = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
  while (mc <= maxDate) {
    const lp = Math.max(0, parseFloat(pct(mc)));
    if (lp <= 100) months.push('<div class="tl-month" style="left:' + lp + '%">' + mc.toLocaleDateString('pt-BR', {month:'short', year:'2-digit'}) + '</div>');
    mc.setMonth(mc.getMonth() + 1);
  }

  const blocks = items.map(t => {
    const l = pct(t.start), w = ((t.end - t.start) / totalMs * 100).toFixed(2);
    const barH = Math.max(8, Math.round(t.us / maxUS * 100));
    const color = t.isCurrent ? '#22c55e' : t.isPast ? '#475569' : '#60a5fa';
    const bg    = t.isCurrent ? '#22c55e18' : t.isPast ? '#1e293b' : '#1e3a5f44';
    return '<div class="tl-block" style="left:' + l + '%;width:' + w + '%;background:' + bg + ';border-color:' + color + '55" title="' + t.label + ' | ' + fmtD(t.start.toISOString()) + ' \u2013 ' + fmtD(t.end.toISOString()) + ' | ' + t.us + ' US">' +
      '<div class="tl-bar-inner" style="height:' + barH + '%;background:' + color + (t.isCurrent ? '' : '99') + '"></div>' +
      '<div class="tl-block-foot" style="color:' + color + '">' +
        '<div class="tl-block-name">' + t.label + (t.isCurrent ? ' \uD83D\uDCC5' : '') + '</div>' +
        '<div class="tl-block-us">' + t.us + ' US</div>' +
      '</div>' +
    '</div>';
  }).join('');

  const todayPct = Math.min(100, Math.max(0, parseFloat(pct(now))));
  const todayMarker = now >= minDate && now <= maxDate
    ? '<div class="tl-today" style="left:' + todayPct + '%"><div class="tl-today-line"></div><div class="tl-today-label">hoje</div></div>'
    : '';

  return '<div class="d-section"><div class="d-section-title">Cronograma de Sprints</div>' +
    '<div class="tl-wrap">' +
      '<div class="tl-months">' + months.join('') + '</div>' +
      '<div class="tl-track">' + blocks + todayMarker + '</div>' +
    '</div>' +
    '<div class="tl-legend">' +
      '<span class="tl-leg" style="color:#475569">\u25CF Encerrada</span>' +
      '<span class="tl-leg" style="color:#60a5fa">\u25CF Futura</span>' +
      '<span class="tl-leg" style="color:#22c55e">\u25CF Sprint atual</span>' +
      '<span class="tl-leg" style="color:#f87171">\u2503 Hoje</span>' +
    '</div>' +
  '</div>';
}

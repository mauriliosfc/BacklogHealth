const INTERVAL = 300; // 5 minutos em segundos
let remaining = INTERVAL;
let countdown;

function pad(n) { return String(n).padStart(2, '0'); }

function startTimer() {
  clearInterval(countdown);
  remaining = INTERVAL;
  countdown = setInterval(() => {
    remaining--;
    const m = Math.floor(remaining / 60);
    const s = remaining % 60;
    document.getElementById('timer').textContent = 'Próximo refresh em ' + m + ':' + pad(s);
    if (remaining <= 0) doRefresh();
  }, 1000);
}

async function doRefresh() {
  const btn = document.getElementById('btnRefresh');
  const content = document.getElementById('content');
  btn.classList.add('loading');
  btn.textContent = '↻ Atualizando...';
  content.classList.add('loading');
  document.getElementById('timer').textContent = 'Atualizando...';
  try {
    const resp = await fetch('/refresh');
    const html = await resp.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    document.getElementById('content').innerHTML = doc.getElementById('content').innerHTML;
    document.getElementById('lastUpdate').textContent = doc.getElementById('lastUpdate').textContent;
    initFilters();
  } catch(e) {
    console.error('Erro ao atualizar:', e);
  }
  btn.classList.remove('loading');
  btn.textContent = '↻ Atualizar';
  content.classList.remove('loading');
  startTimer();
}

function toggleDropdown(trigger) {
  const panel = trigger.nextElementSibling;
  const isOpen = panel.classList.contains('open');
  document.querySelectorAll('.select-panel.open').forEach(p => {
    p.classList.remove('open');
    p.previousElementSibling.classList.remove('open');
  });
  if (!isOpen) {
    panel.classList.add('open');
    trigger.classList.add('open');
  }
}

document.addEventListener('click', e => {
  if (!e.target.closest('.custom-select')) {
    document.querySelectorAll('.select-panel.open').forEach(p => {
      p.classList.remove('open');
      p.previousElementSibling.classList.remove('open');
    });
  }
});

function onCheckChange(checkbox) {
  const customSelect = checkbox.closest('.custom-select');
  const card = checkbox.closest('.card');
  const checked = Array.from(customSelect.querySelectorAll('input[type="checkbox"]:checked'));
  const selected = checked.map(c => c.value);

  const valueEl = customSelect.querySelector('.select-value');
  if (selected.length === 0) valueEl.textContent = 'Todas as sprints';
  else if (selected.length === 1) valueEl.textContent = checked[0].closest('.option-row').querySelector('span').textContent;
  else valueEl.textContent = selected.length + ' sprints selecionadas';

  applyFilter(card, selected);
  saveFilter(card, selected);
}

function clearFilter(btn) {
  const customSelect = btn.closest('.custom-select');
  customSelect.querySelectorAll('input[type="checkbox"]').forEach(c => c.checked = false);
  customSelect.querySelector('.select-value').textContent = 'Todas as sprints';
  const card = btn.closest('.card');
  applyFilter(card, []);
  saveFilter(card, []);
}

function saveFilter(card, selected) {
  const project = card.dataset.project;
  if (selected.length === 0) localStorage.removeItem('filter_' + project);
  else localStorage.setItem('filter_' + project, JSON.stringify(selected));
}

function applyFilter(card, selected) {
  const allItems = JSON.parse(card.dataset.items);

  card.querySelectorAll('tbody tr[data-iteration]').forEach(row => {
    row.style.display = (selected.length === 0 || selected.includes(row.dataset.iteration)) ? '' : 'none';
  });

  card.querySelectorAll('tbody tr.group-header').forEach(header => {
    const group = header.dataset.group;
    const hasVisible = selected.length === 0 || selected.includes(group);
    header.style.display = hasVisible ? '' : 'none';
  });

  const filtered = selected.length === 0 ? allItems : allItems.filter(i => selected.includes(i.iteration));
  const US_TYPES = ['User Story', 'Product Backlog Item', 'Requirement'];
  const CLOSED_STATES = ['Closed', 'Done', 'Resolved', 'Removed'];
  const filteredUS = filtered.filter(i => US_TYPES.includes(i.type));
  const total = filteredUS.length;
  const openUS = filteredUS.filter(i => !CLOSED_STATES.includes(i.state));
  const semEst = openUS.filter(i => i.pts == null).length;
  const semResp = openUS.filter(i => !i.assigned).length;
  const bugs = filtered.filter(i => i.type === 'Bug' && ['Active','In Progress','New'].includes(i.state)).length;

  card.querySelector('.card-total').textContent = total;

  const semEstEl = card.querySelector('.card-semest');
  semEstEl.textContent = semEst;
  semEstEl.className = 'stat-val card-semest' + (semEst > 2 ? ' warn' : '');

  const semRespEl = card.querySelector('.card-semresp');
  semRespEl.textContent = semResp;
  semRespEl.className = 'stat-val card-semresp' + (semResp > 2 ? ' warn' : '');

  const bugsEl = card.querySelector('.card-bugs');
  bugsEl.textContent = bugs;
  bugsEl.className = 'stat-val card-bugs' + (bugs > 3 ? ' crit' : '');

  const hReasons = [];
  if (bugs > 10) hReasons.push(bugs + ' bugs abertos (cr\u00edtico: >10)');
  else if (bugs > 5) hReasons.push(bugs + ' bugs abertos (alerta: >5)');
  if (total > 0 && semEst > total * 0.5) hReasons.push(Math.round(semEst / total * 100) + '% das US sem estimativa (cr\u00edtico: >50%)');
  else if (total > 0 && semEst > total * 0.3) hReasons.push(Math.round(semEst / total * 100) + '% das US sem estimativa (alerta: >30%)');
  if (total > 0 && semResp > total * 0.2) hReasons.push(Math.round(semResp / total * 100) + '% das US sem respons\u00e1vel (alerta: >20%)');
  const hTooltip = hReasons.length ? hReasons.join(' \u00b7 ') : 'Backlog bem estruturado';
  const h = bugs > 10 || semEst > total * 0.5 ? ['🔴 Cr\u00edtico','red']
    : semEst > total * 0.3 || semResp > total * 0.2 || bugs > 5 ? ['🟡 Aten\u00e7\u00e3o','yellow']
    : ['🟢 Saud\u00e1vel','green'];
  const healthEl = card.querySelector('.card-health');
  healthEl.textContent = h[0];
  healthEl.className = 'badge big card-health ' + h[1];
  healthEl.title = hTooltip;

  const usCount = filtered.filter(i => ['User Story','Product Backlog Item','Requirement'].includes(i.type)).length;
  const summaryBtn = card.querySelector('.card-summary');
  summaryBtn.querySelector('.us-toggle-count').textContent = '(' + usCount + ')';
}

function toggleUS(btn) {
  const table = btn.closest('.us-section').querySelector('.us-table');
  const icon = btn.querySelector('.us-toggle-icon');
  const isOpen = !table.hidden;
  table.hidden = isOpen;
  icon.textContent = isOpen ? '\u25b6' : '\u25bc';
  btn.classList.toggle('open', !isOpen);
}

function initFilters() {
  document.querySelectorAll('.card[data-project]').forEach(card => {
    const project = card.dataset.project;
    const saved = localStorage.getItem('filter_' + project);
    if (!saved) return;
    const selected = JSON.parse(saved);
    if (!selected.length) return;

    const customSelect = card.querySelector('.custom-select');
    customSelect.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.checked = selected.includes(cb.value);
    });

    const checked = Array.from(customSelect.querySelectorAll('input[type="checkbox"]:checked'));
    const valueEl = customSelect.querySelector('.select-value');
    if (checked.length === 1) valueEl.textContent = checked[0].closest('.option-row').querySelector('span').textContent;
    else valueEl.textContent = checked.length + ' sprints selecionadas';

    applyFilter(card, selected);
  });
}

initFilters();
startTimer();

// ── Theme ────────────────────────────────────────────────────────────────────
function setTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem('theme', t);
  const btn = document.getElementById('btnTheme');
  if (btn) { btn.textContent = t === 'dark' ? '☀️' : '🌙'; btn.title = t === 'dark' ? 'Tema claro' : 'Tema escuro'; }
}
function toggleTheme() {
  setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
}
setTheme(localStorage.getItem('theme') || 'dark');

// ── Detail Modal ──────────────────────────────────────────────────────────────
let _detailProject = null;
let _detailSprints = [];

async function loadDetailData(project, selectedSprints) {
  const btnRefreshDetail = document.getElementById('btnRefreshDetail');
  if (btnRefreshDetail) { btnRefreshDetail.disabled = true; btnRefreshDetail.textContent = '⏳'; }
  document.getElementById('modal-sub').textContent = 'Carregando dados completos...';
  document.getElementById('modal-body').innerHTML = '<div class="modal-loading">⏳ Buscando todos os itens do projeto...</div>';
  try {
    const resp = await fetch('/detail?' + new URLSearchParams({ project }));
    const data = await resp.json();
    if (data.error) throw new Error(data.error);

    const filtered = selectedSprints.length > 0
      ? data.items.filter(i => selectedSprints.includes(i.iteration))
      : data.items;

    const filterLabel = selectedSprints.length === 0
      ? 'Todos os sprints · ' + data.items.length + ' itens'
      : selectedSprints.length + ' sprint(s) filtrada(s) · ' + filtered.length + ' de ' + data.items.length + ' itens';

    document.getElementById('modal-sub').textContent = filterLabel;
    const sprintFilter = s => !selectedSprints.length || selectedSprints.includes(s.iteration);
    const taskItems = (data.taskItems || []).filter(sprintFilter);
    const bugItems  = (data.bugItems  || []).filter(sprintFilter);
    const allItems  = (data.allItems  || []).filter(sprintFilter);
    const taskCompletedWork = taskItems.reduce((s, t) => s + t.completedWork, 0);
    const bugCompletedWork  = bugItems.reduce((s, t)  => s + t.completedWork, 0);
    const totalBugs         = bugItems.length;
    document.getElementById('modal-body').innerHTML = buildDetailHTML(filtered, data.iterMap, selectedSprints, taskCompletedWork, totalBugs, bugCompletedWork, allItems);
  } catch(e) {
    document.getElementById('modal-body').innerHTML = '<p style="color:#f87171;padding:20px">Erro: ' + e.message + '</p>';
  } finally {
    if (btnRefreshDetail) { btnRefreshDetail.disabled = false; btnRefreshDetail.textContent = '↻'; }
  }
}

async function openDetails(btn) {
  const card = btn.closest('.card');
  _detailProject = card.dataset.project;
  _detailSprints = Array.from(
    card.querySelectorAll('.custom-select input[type="checkbox"]:checked')
  ).map(c => c.value);

  const modal = document.getElementById('detail-modal');
  document.getElementById('modal-title').textContent = _detailProject;
  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
  await loadDetailData(_detailProject, _detailSprints);
}

function closeDetails(e) {
  if (e && e.target !== document.getElementById('detail-modal')) return;
  document.getElementById('detail-modal').classList.remove('open');
  document.body.style.overflow = '';
}

function closeDetailsBtn() {
  const modal = document.getElementById('detail-modal');
  modal.classList.remove('open', 'maximized');
  document.body.style.overflow = '';
  document.getElementById('btnMaximize').textContent = '⤢';
}

function toggleMaximize() {
  const modal = document.getElementById('detail-modal');
  const btn = document.getElementById('btnMaximize');
  const isMax = modal.classList.toggle('maximized');
  btn.textContent = isMax ? '⤡' : '⤢';
  btn.title = isMax ? 'Restaurar' : 'Maximizar';
}

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDetailsBtn(); });

function fmtD(s) {
  if (!s) return '';
  return new Date(s).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

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

function buildDetailHTML(items, iterMap, selectedSprints, taskCompletedWork, totalBugs, bugCompletedWork, allItems) {
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

  // By type — usa allItems para incluir fechados
  const byType = {};
  (allItems.length ? allItems : items).forEach(i => { byType[i.type] = (byType[i.type]||0)+1; });
  const typeEntries = Object.entries(byType).sort((a,b)=>b[1]-a[1]).map(([k,v])=>[k,v,typeColor(k)]);

  // By assignee — apenas US
  const byAsgn = {};
  items.filter(i => US_TYPES_D.includes(i.type)).forEach(i => { const n = i.assigned||'Sem respons\u00e1vel'; byAsgn[n]=(byAsgn[n]||0)+1; });
  const asgnEntries = Object.entries(byAsgn).sort((a,b)=>b[1]-a[1]).slice(0,12).map(([k,v])=>[k,v,'#60a5fa']);

  // By sprint
  const bySprint = {};
  items.forEach(i => {
    const k = i.iteration||'Sem Sprint';
    if (!bySprint[k]) bySprint[k] = { total:0, pts:0, closed:0, us:0, usClosed:0 };
    bySprint[k].total++;
    bySprint[k].pts += i.pts||0;
    if (['Closed','Done','Resolved'].includes(i.state)) bySprint[k].closed++;
    if (US_TYPES.includes(i.type)) {
      bySprint[k].us++;
      if (['Closed','Done','Resolved'].includes(i.state)) bySprint[k].usClosed++;
    }
  });

  const sortedSprintEntries = Object.entries(bySprint).sort((a,b) => {
    const aS = iterMap[a[0]]?.start, bS = iterMap[b[0]]?.start;
    if (aS && bS) return new Date(aS) - new Date(bS);
    return a[0].localeCompare(b[0]);
  });

  const allSprintData = JSON.stringify(sortedSprintEntries.map(([key, d]) => {
    const iter = iterMap[key] || {};
    return {
      key,
      label: key.includes('\\') ? key.split('\\').slice(1).join(' \u203a ') : key,
      us: d.us, usClosed: d.usClosed, pts: d.pts,
      isCurrent: !!iter.isCurrent,
      start: iter.start || null,
      end: iter.end || null
    };
  })).replace(/</g, '\\u003c').replace(/'/g, '&#39;');

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

// ── Daily Standup Modal ───────────────────────────────────────────────────────

let _dailyIndex = 0;
let _dailySlides = [];

function buildDailySlide(card) {
  const project = card.dataset.project;
  const items = JSON.parse(card.dataset.items);

  // Sprint atual: usada apenas para filtrar a tabela de US
  const currentOption = card.querySelector('.option-row.is-current input');
  const currentIter = currentOption ? currentOption.value : null;

  const sprintEl = card.querySelector('.sprint');
  const sprintName = sprintEl ? sprintEl.textContent.trim() : 'Sem sprint definido';
  const currentRow = card.querySelector('.option-row.is-current');
  const sprintDate = currentRow ? (currentRow.querySelector('.option-date') || {}).textContent || '' : '';
  const sprintLabel = sprintDate ? sprintName + '\u2002\u00b7\u2002' + sprintDate : sprintName;

  // Stats e tabela: filtrados pela sprint atual
  const filteredForStats = currentIter ? items.filter(i => i.iteration === currentIter) : items;

  const US_TYPES = ['User Story', 'Product Backlog Item', 'Requirement'];
  const CLOSED_STATES = ['Closed', 'Done', 'Resolved', 'Removed'];
  const usItems = filteredForStats.filter(i => US_TYPES.includes(i.type));
  const total = usItems.length;
  const openUS = usItems.filter(i => !CLOSED_STATES.includes(i.state));
  const semEst = openUS.filter(i => i.pts == null).length;
  const semResp = openUS.filter(i => !i.assigned).length;
  const bugs = filteredForStats.filter(i => i.type === 'Bug' && ['Active','In Progress','New'].includes(i.state)).length;

  const dReasons = [];
  if (bugs > 10) dReasons.push(bugs + ' bugs abertos (cr\u00edtico: >10)');
  else if (bugs > 5) dReasons.push(bugs + ' bugs abertos (alerta: >5)');
  if (total > 0 && semEst > total * 0.5) dReasons.push(Math.round(semEst / total * 100) + '% das US sem estimativa (cr\u00edtico: >50%)');
  else if (total > 0 && semEst > total * 0.3) dReasons.push(Math.round(semEst / total * 100) + '% das US sem estimativa (alerta: >30%)');
  if (total > 0 && semResp > total * 0.2) dReasons.push(Math.round(semResp / total * 100) + '% das US sem respons\u00e1vel (alerta: >20%)');
  const dTooltip = dReasons.length ? dReasons.join(' \u00b7 ') : 'Backlog bem estruturado';
  const health = bugs > 10 || semEst > total * 0.5 ? ['🔴 Cr\u00edtico', 'red']
    : semEst > total * 0.3 || semResp > total * 0.2 || bugs > 5 ? ['🟡 Aten\u00e7\u00e3o', 'yellow']
    : ['🟢 Saud\u00e1vel', 'green'];

  // Linhas da tabela de US para a sprint atual (extrai do DOM já renderizado)
  let tableRows = '';
  card.querySelectorAll('tbody tr[data-iteration]').forEach(row => {
    if (!currentIter || row.dataset.iteration === currentIter) {
      tableRows += row.outerHTML;
    }
  });

  const usSection = tableRows
    ? '<div class="daily-us-title">User Stories na sprint</div>' +
      '<div class="daily-table-wrap"><table><thead><tr><th>T\u00edtulo</th><th>Status</th><th>Estimativa</th><th>Respons\u00e1vel</th></tr></thead>' +
      '<tbody>' + tableRows + '</tbody></table></div>'
    : '<div class="daily-empty">Nenhuma User Story na sprint atual.</div>';

  return '<div class="daily-slide">' +
    '<div class="daily-fixed">' +
      '<div class="daily-slide-header">' +
        '<div class="daily-project-name">' + project + '</div>' +
        '<span class="badge ' + health[1] + ' big" title="' + dTooltip + '">' + health[0] + '</span>' +
      '</div>' +
      '<div class="daily-sprint-row">' +
        '<div class="daily-sprint-label">' + sprintLabel + '</div>' +
        '<button class="btn-burndown-daily" type="button" data-project="' + project.replace(/"/g,'&quot;') + '" data-iter="' + (currentIter||'').replace(/"/g,'&quot;') + '" onclick="openBurndownFromDaily(this.dataset.project, this.dataset.iter)">\uD83D\uDCCA Burndown</button>' +
      '</div>' +
      '<div class="stats daily-stats">' +
        '<div class="stat"><div class="stat-label">User Stories</div><div class="stat-val">' + total + '</div></div>' +
        '<div class="stat"><div class="stat-label">Sem Estimativa</div><div class="stat-val ' + (semEst > 2 ? 'warn' : '') + '">' + semEst + '</div></div>' +
        '<div class="stat"><div class="stat-label">Sem Respons\u00e1vel</div><div class="stat-val ' + (semResp > 2 ? 'warn' : '') + '">' + semResp + '</div></div>' +
        '<div class="stat"><div class="stat-label">Bugs Abertos</div><div class="stat-val ' + (bugs > 3 ? 'crit' : '') + '">' + bugs + '</div></div>' +
      '</div>' +
    '</div>' +
    usSection +
    '</div>';
}

function openDaily() {
  const cards = Array.from(document.querySelectorAll('#content .card[data-project]'));
  if (!cards.length) return;

  _dailySlides = cards;
  _dailyIndex = 0;

  const track = document.getElementById('daily-track');
  track.innerHTML = _dailySlides.map(c => buildDailySlide(c)).join('');
  track.style.transform = 'translateX(0)';

  updateDailyNav();

  document.getElementById('daily-modal').classList.add('open');
  document.body.style.overflow = 'hidden';
  document.getElementById('daily-modal').focus();
}

function closeDaily() {
  document.getElementById('daily-modal').classList.remove('open', 'maximized');
  document.getElementById('btnDailyMax').textContent = '\u2922';
  document.body.style.overflow = '';
}

function toggleDailyMaximize() {
  const overlay = document.getElementById('daily-modal');
  const btn = document.getElementById('btnDailyMax');
  const isMax = overlay.classList.toggle('maximized');
  btn.textContent = isMax ? '\u2921' : '\u2922';
  btn.title = isMax ? 'Restaurar' : 'Expandir';
}

function dailyPrev() {
  if (_dailyIndex > 0) {
    _dailyIndex--;
    updateDailyNav();
  }
}

function dailyNext() {
  if (_dailyIndex < _dailySlides.length - 1) {
    _dailyIndex++;
    updateDailyNav();
  }
}

function updateDailyNav() {
  const track = document.getElementById('daily-track');
  track.style.transform = 'translateX(-' + (_dailyIndex * 100) + '%)';

  document.getElementById('daily-counter').textContent = (_dailyIndex + 1) + ' / ' + _dailySlides.length;
  document.getElementById('btnDailyPrev').disabled = _dailyIndex === 0;
  document.getElementById('btnDailyNext').disabled = _dailyIndex === _dailySlides.length - 1;
}

function handleDailyKey(e) {
  if (e.key === 'ArrowRight') dailyNext();
  else if (e.key === 'ArrowLeft') dailyPrev();
  else if (e.key === 'Escape') closeDaily();
}

document.addEventListener('keydown', e => {
  if (!document.getElementById('daily-modal').classList.contains('open')) return;
  handleDailyKey(e);
});

// ── Burndown Modal ────────────────────────────────────────────────────────────

function _showBurndownModal(allSprints, key) {
  const sprint = allSprints.find(s => s.key === key);
  if (!sprint) return;
  document.getElementById('burndown-title').textContent = sprint.label;
  document.getElementById('burndown-sub').textContent   = sprint.start && sprint.end
    ? fmtD(sprint.start) + ' \u2013 ' + fmtD(sprint.end)
    : '';
  document.getElementById('burndown-body').innerHTML = buildBurndownChart(allSprints, key);
  document.getElementById('burndown-modal').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function openBurndown(btn) {
  const key = btn.closest('tr').dataset.sprintKey;
  const allSprints = JSON.parse(btn.closest('table').dataset.sprints);
  _showBurndownModal(allSprints, key);
}

function closeBurndown() {
  const modalEl = document.getElementById('burndown-modal');
  modalEl.classList.remove('open', 'maximized');
  document.getElementById('btnBurndownMax').textContent = '\u2922';
  document.body.style.overflow = '';
}

function closeBurndownOverlay(e) {
  if (e.target === document.getElementById('burndown-modal')) closeBurndown();
}

function toggleBurndownMaximize() {
  const overlay = document.getElementById('burndown-modal');
  const btn = document.getElementById('btnBurndownMax');
  const isMax = overlay.classList.toggle('maximized');
  btn.textContent = isMax ? '\u2921' : '\u2922';
  btn.title = isMax ? 'Restaurar' : 'Maximizar';
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.getElementById('burndown-modal').classList.contains('open')) {
    closeBurndown();
  }
});

async function openBurndownFromDaily(project, currentIter) {
  const modalEl = document.getElementById('burndown-modal');
  const bodyEl  = document.getElementById('burndown-body');

  document.getElementById('burndown-title').textContent = project;
  document.getElementById('burndown-sub').textContent   = 'Carregando...';
  bodyEl.innerHTML = '<div class="modal-loading">\u23F3 Buscando dados da sprint...</div>';
  modalEl.classList.add('open');
  document.body.style.overflow = 'hidden';

  try {
    const resp = await fetch('/detail?' + new URLSearchParams({ project }));
    const data = await resp.json();
    if (data.error) throw new Error(data.error);

    const US_TYPES = ['User Story', 'Product Backlog Item', 'Requirement'];
    const bySprint = {};
    data.items.forEach(i => {
      const k = i.iteration || 'Sem Sprint';
      if (!bySprint[k]) bySprint[k] = { us: 0, usClosed: 0, pts: 0 };
      bySprint[k].pts += i.pts || 0;
      if (US_TYPES.includes(i.type)) {
        bySprint[k].us++;
        if (['Closed','Done','Resolved'].includes(i.state)) bySprint[k].usClosed++;
      }
    });

    const iterMap = data.iterMap || {};
    const allSprints = Object.entries(bySprint)
      .sort((a, b) => {
        const aS = iterMap[a[0]] && iterMap[a[0]].start;
        const bS = iterMap[b[0]] && iterMap[b[0]].start;
        if (aS && bS) return new Date(aS) - new Date(bS);
        return a[0].localeCompare(b[0]);
      })
      .map(([key, d]) => {
        const iter = iterMap[key] || {};
        return {
          key,
          label: key.includes('\\') ? key.split('\\').slice(1).join(' \u203a ') : key,
          us: d.us, usClosed: d.usClosed, pts: d.pts,
          isCurrent: !!iter.isCurrent,
          start: iter.start || null,
          end: iter.end || null
        };
      });

    const sprint = allSprints.find(s => s.key === currentIter)
                || allSprints.find(s => s.isCurrent)
                || allSprints[allSprints.length - 1];

    if (!sprint) throw new Error('Sprint n\u00e3o encontrada');
    _showBurndownModal(allSprints, sprint.key);
  } catch(e) {
    bodyEl.innerHTML = '<p style="color:#f87171;padding:20px">Erro: ' + e.message + '</p>';
  }
}

function buildBurndownChart(allSprints, highlightKey) {
  // Find the sprint to burn down
  const sprint = allSprints.find(s => s.key === highlightKey);
  if (!sprint || !sprint.start || !sprint.end) {
    return '<p style="color:#64748b;padding:20px;text-align:center">Sem dados de per\u00edodo para esta sprint.</p>';
  }

  const start   = new Date(sprint.start);
  const end     = new Date(sprint.end);
  const today   = new Date();
  const totalUs = sprint.us;
  const donePts = sprint.usClosed;

  if (totalUs === 0) {
    return '<p style="color:#64748b;padding:20px;text-align:center">Nenhuma User Story nesta sprint.</p>';
  }

  // Build day-by-day axis
  const days = [];
  const d = new Date(start);
  while (d <= end) {
    days.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  const totalDays = days.length - 1 || 1;

  // Ideal burndown: from totalUs on day 0 to 0 on last day
  // Real progress: assume linear distribution of completed US up to today
  const todayClamp = today < start ? start : today > end ? end : today;
  const elapsed    = (todayClamp - start) / (1000 * 60 * 60 * 24);
  const elapsedDays = Math.min(Math.round(elapsed), totalDays);

  // SVG dimensions
  const W = 760, H = 320, PL = 50, PR = 20, PT = 20, PB = 40;
  const cW = W - PL - PR, cH = H - PT - PB;

  function xOf(dayIdx) { return PL + (dayIdx / totalDays) * cW; }
  function yOf(val)    { return PT + cH - (val / totalUs) * cH; }

  // Ideal line points
  const idealPts = days.map((_, i) => xOf(i) + ',' + yOf(totalUs - (totalUs * i / totalDays))).join(' ');

  // Real line: linear from totalUs at start to (totalUs - donePts) at today
  const realPts = [];
  for (let i = 0; i <= elapsedDays; i++) {
    const remaining = totalUs - Math.round(donePts * i / (elapsedDays || 1));
    realPts.push(xOf(i) + ',' + yOf(remaining));
  }

  // Today marker
  const todayX  = xOf(elapsedDays);
  const isActive = today >= start && today <= end;

  // Y-axis labels
  const yLabels = [0, 0.25, 0.5, 0.75, 1].map(f => {
    const v = Math.round(totalUs * f);
    const y = yOf(v);
    return '<text x="' + (PL - 6) + '" y="' + (y + 4) + '" text-anchor="end" font-size="11" fill="#64748b">' + v + '</text>' +
           '<line x1="' + PL + '" y1="' + y + '" x2="' + (W - PR) + '" y2="' + y + '" stroke="#1e293b" stroke-width="1"/>';
  }).join('');

  // X-axis labels (every ~7 days)
  const step = Math.max(1, Math.ceil(totalDays / 8));
  const xLabels = days.filter((_, i) => i % step === 0 || i === totalDays).map((day, _, arr) => {
    const i = days.indexOf(day);
    const x = xOf(i);
    const label = day.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
    return '<text x="' + x + '" y="' + (H - PB + 18) + '" text-anchor="middle" font-size="11" fill="#64748b">' + label + '</text>';
  }).join('');

  const todayLine = isActive
    ? '<line x1="' + todayX + '" y1="' + PT + '" x2="' + todayX + '" y2="' + (H - PB) + '" stroke="#f87171" stroke-width="1.5" stroke-dasharray="4,3"/>' +
      '<text x="' + (todayX + 4) + '" y="' + (PT + 12) + '" font-size="10" fill="#f87171">hoje</text>'
    : '';

  const svg =
    '<svg viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-height:320px">' +
      yLabels +
      '<polyline points="' + idealPts + '" fill="none" stroke="#475569" stroke-width="1.5" stroke-dasharray="6,4"/>' +
      (realPts.length > 1 ? '<polyline points="' + realPts.join(' ') + '" fill="none" stroke="#22c55e" stroke-width="2.5" stroke-linejoin="round"/>' : '') +
      todayLine +
      xLabels +
      '<line x1="' + PL + '" y1="' + PT + '" x2="' + PL + '" y2="' + (H - PB) + '" stroke="#334155" stroke-width="1"/>' +
      '<line x1="' + PL + '" y1="' + (H - PB) + '" x2="' + (W - PR) + '" y2="' + (H - PB) + '" stroke="#334155" stroke-width="1"/>' +
    '</svg>';

  const remaining = totalUs - donePts;
  const pct = Math.round(donePts / totalUs * 100);

  const summary =
    '<div style="display:flex;gap:24px;flex-wrap:wrap;padding:16px 4px 0">' +
      '<div class="d-card"><div class="d-label">Total US</div><div class="d-val blue">' + totalUs + '</div></div>' +
      '<div class="d-card"><div class="d-label">Conclu\u00eddas</div><div class="d-val green">' + donePts + '</div></div>' +
      '<div class="d-card"><div class="d-label">Restantes</div><div class="d-val ' + (remaining > 0 ? 'yellow' : 'green') + '">' + remaining + '</div></div>' +
      '<div class="d-card"><div class="d-label">Progresso</div><div class="d-val ' + (pct >= 80 ? 'green' : pct >= 50 ? 'yellow' : 'red') + '">' + pct + '%</div></div>' +
    '</div>';

  const legend =
    '<div style="display:flex;gap:16px;padding:8px 4px;font-size:12px;color:#64748b">' +
      '<span><svg width="24" height="8"><line x1="0" y1="4" x2="24" y2="4" stroke="#475569" stroke-width="1.5" stroke-dasharray="6,4"/></svg> Ideal</span>' +
      '<span><svg width="24" height="8"><line x1="0" y1="4" x2="24" y2="4" stroke="#22c55e" stroke-width="2.5"/></svg> Real</span>' +
    '</div>';

  return '<div style="padding:20px">' + summary + '<div style="margin-top:20px">' + svg + '</div>' + legend + '</div>';
}

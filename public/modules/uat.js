import { fmtD } from './utils.js';
import { getAlias } from './alias.js';

let _uatProject  = null;
let _uatPlans    = [];
let _sprintFilter = '';
const _expandedPlans     = new Set();
const _planOutcomeFilter = {};
const _planPrioFilter    = {};

const _FOLDER_ICON = '<svg class="uat-folder-svg" viewBox="0 0 16 13" fill="none" xmlns="http://www.w3.org/2000/svg">'
  + '<path d="M1 3.5C1 2.67 1.67 2 2.5 2H6L7.5 4H14C14.83 4 15.5 4.67 15.5 5.5V11C15.5 11.83 14.83 12.5 14 12.5H2C1.17 12.5 0.5 11.83 0.5 11V3.5H1Z" stroke="currentColor" stroke-width="1.3" fill="none"/>'
  + '</svg>';

function _sprintLabel(iteration) {
  if (!iteration) return '—';
  return iteration.includes('\\') ? iteration.split('\\').pop() : iteration;
}

function _fmtDate(d) {
  if (!d) return '—';
  return fmtD(d.slice(0, 10));
}


function _stateClass(s) {
  if (s === 'Active')   return 'green';
  if (s === 'Inactive') return 'gray';
  return 'gray';
}

function _outcomeBadge(outcome) {
  switch (outcome) {
    case 'passed':  return '<span class="uat-badge uat-badge-pass">&#10003; Passou</span>';
    case 'failed':  return '<span class="uat-badge uat-badge-fail">&#10007; Falhou</span>';
    case 'blocked': return '<span class="uat-badge uat-badge-block">&#9632; Bloqueado</span>';
    default:        return '<span class="uat-badge uat-badge-notex">&#8212; Pendente</span>';
  }
}

function _priorityBadge(priority) {
  if (!priority || priority === 0) return '';
  const cls = priority === 1 ? 'p1' : priority === 2 ? 'p2' : priority === 3 ? 'p3' : 'p4';
  return `<span class="uat-priority ${cls}">P${priority}</span>`;
}

// ── Summary card ──────────────────────────────────────────────────────────────

function _planStat(label, count, colorClass) {
  return '<div class="uat-plan-stat">'
    + `<div class="uat-plan-stat-val ${colorClass}">${count}</div>`
    + `<div class="uat-plan-stat-label">${label}</div>`
    + '</div>';
}

function _buildSummaryCard(filteredPlans) {
  const total = filteredPlans.reduce((s, p) => s + (p.totalCount || 0), 0);
  if (total === 0) return '';

  const totalPlans = filteredPlans.length;
  const _isDone    = p => (p.totalCount || 0) > 0 && (p.passCount || 0) === (p.totalCount || 0) && (p.failCount || 0) === 0;
  const _isFailed  = p => (p.failCount || 0) > 0;
  const _isActive  = p => (p.state || '').toLowerCase() === 'active';

  // Stat card counts — each uses its own independent criterion
  const plansDone       = filteredPlans.filter(p => _isDone(p)).length;
  const plansFailed     = filteredPlans.filter(p => _isFailed(p)).length;
  const plansWIP        = filteredPlans.filter(p => _isActive(p)).length;
  const plansNotStarted = filteredPlans.filter(p => !_isDone(p) && !_isFailed(p) && !_isActive(p)).length;

  // Bar segments — mutually exclusive so widths sum to 100%
  const barDone    = plansDone;
  const barFailed  = filteredPlans.filter(p => !_isDone(p) && _isFailed(p)).length;
  const barWIP     = filteredPlans.filter(p => !_isDone(p) && !_isFailed(p) && _isActive(p)).length;
  const barNotStarted = totalPlans - barDone - barFailed - barWIP;

  const pct      = totalPlans > 0 ? Math.round((plansDone / totalPlans) * 100) : 0;
  const pctColor = pct >= 80 ? 'var(--c-green)' : pct >= 50 ? 'var(--c-yellow)' : 'var(--c-red2)';

  const ref        = filteredPlans.find(p => p.startDate || p.endDate) || filteredPlans[0];
  const sprintName = _sprintLabel(ref.iteration);
  const startDate  = ref.startDate;
  const endDate    = ref.endDate;

  let daysHtml = '';
  if (endDate) {
    const end   = new Date(endDate.slice(0, 10));
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const diff  = Math.ceil((end - today) / 86400000);
    if (diff > 0)       daysHtml = `<span class="uat-sum-info-chip">&#9201; ${diff} dias restantes</span>`;
    else if (diff === 0) daysHtml = `<span class="uat-sum-info-chip">&#9201; Encerra hoje</span>`;
  }

  const riskClass = pct >= 80 ? 'green' : pct >= 50 ? 'yellow' : 'red';
  const riskLabel = pct >= 80 ? 'No prazo' : 'Em risco';

  const doneW  = totalPlans > 0 ? (barDone       / totalPlans * 100).toFixed(1) : 0;
  const failPW = totalPlans > 0 ? (barFailed      / totalPlans * 100).toFixed(1) : 0;
  const wipW   = totalPlans > 0 ? (barWIP         / totalPlans * 100).toFixed(1) : 0;
  const notW   = totalPlans > 0 ? (barNotStarted  / totalPlans * 100).toFixed(1) : 0;

  const sprintInfoHtml = sprintName !== '—'
    ? '<div class="uat-sum-info">'
      + `<span class="uat-sum-info-chip">&#9729; ${sprintName}</span>`
      + (startDate && endDate ? `<span class="uat-sum-info-chip">&#128197; ${_fmtDate(startDate)} &mdash; ${_fmtDate(endDate)}</span>` : '')
      + daysHtml
      + `<span class="badge ${riskClass}">${riskLabel}</span>`
      + '</div>'
    : '';

  return '<div class="uat-summary-card">'
    + '<div class="uat-sum-top">'
    +   '<div class="uat-sum-left">'
    +     `<div class="uat-sum-title">${getAlias(_uatProject)}</div>`
    +     sprintInfoHtml
    +   '</div>'
    +   '<div class="uat-sum-right">'
    +     `<div class="uat-sum-pct" style="color:${pctColor}">${pct}%</div>`
    +     `<div class="uat-sum-pct-sub">${plansDone} de ${totalPlans} planos concluídos</div>`
    +   '</div>'
    + '</div>'
    + '<div class="uat-sum-bar">'
    +   `<div class="uat-sum-bar-seg uat-seg-pass"  style="width:${doneW}%"  title="Concluídos: ${plansDone}"></div>`
    +   `<div class="uat-sum-bar-seg uat-seg-fail"  style="width:${failPW}%" title="Com falha: ${plansFailed}"></div>`
    +   `<div class="uat-sum-bar-seg uat-seg-block" style="width:${wipW}%"   title="Em andamento: ${plansWIP}"></div>`
    +   `<div class="uat-sum-bar-seg uat-seg-notex" style="width:${notW}%"   title="Não iniciados: ${plansNotStarted}"></div>`
    + '</div>'
    + '<div class="uat-sum-section-label">Indicadores por Testplan</div>'
    + '<div class="uat-sum-plans-row">'
    +   _planStat('Concluídos',   plansDone,   'green')
    +   _planStat('Em andamento', plansWIP,    'yellow')
    +   _planStat('Com falha',    plansFailed, 'red')
    +   _planStat('Total',        totalPlans,  '')
    + '</div>'
    + '</div>';
}

// ── Plan accordion rows ───────────────────────────────────────────────────────

function _buildPlanDetail(plan) {
  const points          = plan.points || [];
  const selectedOutcome = _planOutcomeFilter[plan.id] || new Set();
  const selectedPrio    = _planPrioFilter[plan.id]    || new Set();

  const OUTCOME_LABELS = { passed: 'Passou', failed: 'Falhou', blocked: 'Bloqueado' };
  const labelFor = o => OUTCOME_LABELS[o] || 'Pendente';
  const outcomes = [...new Set(points.map(pt => pt.outcome))].sort();

  const todosActive = selectedOutcome.size === 0 ? ' active' : '';
  const todosBtn    = `<button class="uat-filter-pill${todosActive}" onclick="uatClearPlanFilter(${plan.id})">Todos</button>`;
  const outcomePills = outcomes.map(o => {
    const active = selectedOutcome.has(o) ? ' active' : '';
    return `<button class="uat-filter-pill${active}" onclick="uatFilterPlan(${plan.id}, '${o}')">${labelFor(o)}</button>`;
  }).join('');
  const outcomeFilterHtml = todosBtn + outcomePills;

  const priorities = [...new Set(points.map(pt => pt.priority).filter(p => p && p > 0))].sort();
  const clearPrioBtn = selectedPrio.size > 0
    ? `<button class="uat-filter-pill-clear" onclick="uatClearPlanPrioFilter(${plan.id})">Limpar</button>` : '';
  const prioPills = priorities.length > 0
    ? '<span class="uat-filter-sep">|</span>'
      + priorities.map(p => {
          const active = selectedPrio.size === 0 || selectedPrio.has(p) ? ' active' : '';
          const cls = p === 1 ? 'p1' : p === 2 ? 'p2' : 'p3';
          return `<button class="uat-filter-pill uat-prio-pill ${cls}${active}" onclick="uatFilterPlanPrio(${plan.id}, ${p})">P${p}</button>`;
        }).join('') + clearPrioBtn
    : '';

  const filterHtml = '<div class="uat-detail-filter">' + outcomeFilterHtml + prioPills + '</div>';

  let visible = points;
  if (selectedOutcome.size > 0) visible = visible.filter(pt => selectedOutcome.has(pt.outcome));
  if (selectedPrio.size > 0)    visible = visible.filter(pt => selectedPrio.has(pt.priority));

  if (!visible.length) {
    return filterHtml + '<div class="uat-detail-empty">Nenhum caso de teste encontrado.</div>';
  }

  const rows = visible.map(pt => {
    const tcId    = pt.testCaseId ? `TC-${pt.testCaseId}` : `#${pt.id}`;
    const nameEsc = (pt.name || '—').replace(/</g, '&lt;');
    return '<tr class="uat-tc-tr">'
      + `<td class="uat-tc-id">${tcId}</td>`
      + `<td>${_priorityBadge(pt.priority)}</td>`
      + `<td class="uat-tc-name">${nameEsc}</td>`
      + `<td class="uat-tc-tester" title="${(pt.tester || '').replace(/"/g, '&quot;')}">${pt.tester || '—'}</td>`
      + `<td>${_outcomeBadge(pt.outcome)}</td>`
      + '</tr>';
  }).join('');

  const table = '<table class="uat-tc-table">'
    + '<thead><tr>'
    + '<th class="uat-th-id">ID</th>'
    + '<th class="uat-th-prio">Prioridade</th>'
    + '<th class="uat-th-name">Nome</th>'
    + '<th class="uat-th-tester">Testador</th>'
    + '<th class="uat-th-outcome">Resultado</th>'
    + '</tr></thead>'
    + '<tbody>' + rows + '</tbody>'
    + '</table>';

  return filterHtml + table;
}

function _buildPlanRow(plan) {
  const total  = plan.totalCount || 0;
  const passed = plan.passCount  || 0;
  const pct    = total > 0 ? Math.round((passed / total) * 100) : 0;
  const pctColor = pct >= 80 ? 'var(--c-green)' : pct >= 50 ? 'var(--c-yellow)' : total > 0 ? 'var(--c-red2)' : 'var(--text-faint)';

  const passW  = total > 0 ? (plan.passCount        / total * 100).toFixed(1) : 0;
  const failW  = total > 0 ? (plan.failCount         / total * 100).toFixed(1) : 0;
  const blockW = total > 0 ? (plan.blockedCount      / total * 100).toFixed(1) : 0;
  const notW   = total > 0 ? (plan.notExecutedCount  / total * 100).toFixed(1) : 0;

  const isOpen   = _expandedPlans.has(plan.id);
  const nameEsc  = (plan.name || '—').replace(/</g, '&lt;');
  const arrow    = isOpen ? '&#8743;' : '&#8744;';
  const detailHtml = isOpen ? _buildPlanDetail(plan) : '';

  const stateClass = _stateClass(plan.state);
  const stateBadge = `<span class="badge ${stateClass} uat-plan-state-badge">${plan.state || '—'}</span>`;

  const idHtml = plan.url
    ? `<a class="uat-plan-id-link" href="${plan.url}" target="_blank" title="Abrir no Azure DevOps" onclick="event.stopPropagation()">#${plan.id}</a>`
    : `<span class="uat-plan-id-link">#${plan.id}</span>`;

  return `<div class="uat-plan-row${isOpen ? ' open' : ''}" data-plan-id="${plan.id}">`
    + `<div class="uat-plan-header" onclick="uatTogglePlan(${plan.id})">`
    +   _FOLDER_ICON
    +   idHtml
    +   '<span class="uat-plan-id-sep">|</span>'
    +   `<span class="uat-plan-name" title="${nameEsc}">${nameEsc}</span>`
    +   stateBadge
    +   '<span class="uat-plan-header-right">'
    +     `<span class="uat-plan-count">${passed}/${total}</span>`
    +     `<span class="uat-plan-pct" style="color:${pctColor}">${pct}%</span>`
    +     `<span class="uat-plan-toggle">${arrow}</span>`
    +   '</span>'
    + '</div>'
    + '<div class="uat-plan-bar">'
    +   `<div class="uat-sum-bar-seg uat-seg-pass"  style="width:${passW}%"  title="Aprovados: ${passed}"></div>`
    +   `<div class="uat-sum-bar-seg uat-seg-fail"  style="width:${failW}%"  title="Falhos: ${plan.failCount}"></div>`
    +   `<div class="uat-sum-bar-seg uat-seg-block" style="width:${blockW}%" title="Bloqueados: ${plan.blockedCount}"></div>`
    +   `<div class="uat-sum-bar-seg uat-seg-notex" style="width:${notW}%"   title="Não executados: ${plan.notExecutedCount}"></div>`
    + '</div>'
    + `<div class="uat-plan-detail${isOpen ? ' open' : ''}" data-plan="${plan.id}">${detailHtml}</div>`
    + '</div>';
}

function _renderContent(plans) {
  const iterations = [...new Set(plans.map(p => p.iteration).filter(Boolean))].sort();

  const filterHtml = iterations.length
    ? '<div class="uat-filter-bar">'
      + '<span class="uat-filter-label">Sprint</span>'
      + '<select class="uat-sprint-select" onchange="uatChangeSprint(this.value)">'
      + '<option value="">Todos</option>'
      + iterations.map(it => {
          const selected = _sprintFilter === it ? ' selected' : '';
          return `<option value="${it.replace(/"/g, '&quot;')}"${selected}>${_sprintLabel(it)}</option>`;
        }).join('')
      + '</select>'
      + '</div>'
    : '';

  const filtered = _sprintFilter
    ? plans.filter(p => p.iteration === _sprintFilter)
    : plans;

  if (!filtered.length) {
    return filterHtml + '<div class="uat-empty">Nenhum plano de teste encontrado.</div>';
  }

  const summaryCard = _buildSummaryCard(filtered);
  const rows = filtered.map(p => _buildPlanRow(p)).join('');

  const detailLabel = '<div class="uat-plans-section-label">Testplans Detail</div>';
  return filterHtml + summaryCard + detailLabel + '<div class="uat-plans-list">' + rows + '</div>';
}

async function _load() {
  const body = document.getElementById('uat-modal-body');
  body.innerHTML = '<div class="uat-loading">Loading test plans\u2026</div>';
  try {
    const resp = await fetch('/api/uat?project=' + encodeURIComponent(_uatProject));
    const data = await resp.json();
    if (data.error) throw new Error(data.error);
    _uatPlans = data.plans || [];
    body.innerHTML = _renderContent(_uatPlans);
  } catch (e) {
    body.innerHTML = '<div class="uat-error">Error: ' + e.message + '</div>';
  }
}

export function openUAT(el) {
  const card = el.closest('.card');
  _uatProject   = card.dataset.project;
  _sprintFilter = localStorage.getItem('uatSprint::' + _uatProject) || '';
  _expandedPlans.clear();
  Object.keys(_planOutcomeFilter).forEach(k => delete _planOutcomeFilter[k]);
  Object.keys(_planPrioFilter).forEach(k => delete _planPrioFilter[k]);
  document.getElementById('uat-modal-title').textContent = getAlias(_uatProject);
  document.getElementById('uat-modal').classList.add('open', 'maximized');
  const maxBtn = document.getElementById('uat-modal-max');
  if (maxBtn) maxBtn.textContent = '\u2921';
  _load();
}

export function uatTogglePlan(planId) {
  if (_expandedPlans.has(planId)) {
    _expandedPlans.delete(planId);
  } else {
    _expandedPlans.add(planId);
  }
  const isOpen   = _expandedPlans.has(planId);
  const row      = document.querySelector(`.uat-plan-row[data-plan-id="${planId}"]`);
  const detail   = document.querySelector(`.uat-plan-detail[data-plan="${planId}"]`);
  const toggle   = row && row.querySelector('.uat-plan-toggle');
  if (!row || !detail) return;
  row.classList.toggle('open', isOpen);
  detail.classList.toggle('open', isOpen);
  if (toggle) toggle.innerHTML = isOpen ? '&#8743;' : '&#8744;';
  if (isOpen && !detail.innerHTML.trim()) {
    const plan = _uatPlans.find(p => p.id === planId);
    if (plan) detail.innerHTML = _buildPlanDetail(plan);
  }
  if (isOpen) setTimeout(() => row.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
}

export function uatFilterPlan(planId, outcome) {
  if (!_planOutcomeFilter[planId]) _planOutcomeFilter[planId] = new Set();
  const s = _planOutcomeFilter[planId];
  if (s.has(outcome)) s.delete(outcome);
  else s.add(outcome);
  const detail = document.querySelector(`.uat-plan-detail[data-plan="${planId}"]`);
  const plan   = _uatPlans.find(p => p.id === planId);
  if (detail && plan) detail.innerHTML = _buildPlanDetail(plan);
}

export function uatClearPlanFilter(planId) {
  delete _planOutcomeFilter[planId];
  const detail = document.querySelector(`.uat-plan-detail[data-plan="${planId}"]`);
  const plan   = _uatPlans.find(p => p.id === planId);
  if (detail && plan) detail.innerHTML = _buildPlanDetail(plan);
}

export function uatFilterPlanPrio(planId, prio) {
  if (!_planPrioFilter[planId]) _planPrioFilter[planId] = new Set();
  const s = _planPrioFilter[planId];
  if (s.has(prio)) s.delete(prio);
  else s.add(prio);
  const detail = document.querySelector(`.uat-plan-detail[data-plan="${planId}"]`);
  const plan   = _uatPlans.find(p => p.id === planId);
  if (detail && plan) detail.innerHTML = _buildPlanDetail(plan);
}

export function uatClearPlanPrioFilter(planId) {
  delete _planPrioFilter[planId];
  const detail = document.querySelector(`.uat-plan-detail[data-plan="${planId}"]`);
  const plan   = _uatPlans.find(p => p.id === planId);
  if (detail && plan) detail.innerHTML = _buildPlanDetail(plan);
}

export function closeUAT() {
  document.getElementById('uat-modal').classList.remove('open', 'maximized');
  const btn = document.getElementById('uat-modal-max');
  if (btn) btn.textContent = '\u2922';
}

export function closeUATOverlay(event) {
  if (event.target === event.currentTarget) closeUAT();
}

export function toggleUATMax() {
  const overlay = document.getElementById('uat-modal');
  const btn     = document.getElementById('uat-modal-max');
  const isMax   = overlay.classList.toggle('maximized');
  btn.textContent = isMax ? '\u2921' : '\u2922';
}

export async function refreshUAT() {
  const btn = document.getElementById('uat-refresh-btn');
  if (btn) btn.disabled = true;
  await _load();
  if (btn) btn.disabled = false;
}

export function uatChangeSprint(value) {
  _sprintFilter = value;
  if (value) localStorage.setItem('uatSprint::' + _uatProject, value);
  else        localStorage.removeItem('uatSprint::' + _uatProject);
  _expandedPlans.clear();
  Object.keys(_planOutcomeFilter).forEach(k => delete _planOutcomeFilter[k]);
  Object.keys(_planPrioFilter).forEach(k => delete _planPrioFilter[k]);
  document.getElementById('uat-modal-body').innerHTML = _renderContent(_uatPlans);
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.getElementById('uat-modal')?.classList.contains('open')) {
    closeUAT();
  }
});

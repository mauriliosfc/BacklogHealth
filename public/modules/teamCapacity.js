// ── Team Capacity & Performance module ────────────────────────────────────────

import { getAlias } from './alias.js';
import { t } from './i18n.js';

// ── State ─────────────────────────────────────────────────────────────────────
let _data    = null;
let _project = null;   // display-name of currently selected project
let _loading = false;

// ── localStorage ──────────────────────────────────────────────────────────────
function _capKey(dev, sprint) { return `tc::${dev}::${sprint}`; }
function getCapacity(dev, sprint) {
  const v = localStorage.getItem(_capKey(dev, sprint));
  return v !== null ? parseFloat(v) : 0;
}
function saveCapacity(dev, sprint, hrs) {
  localStorage.setItem(_capKey(dev, sprint), String(hrs));
}

// ── View switching ─────────────────────────────────────────────────────────────
export function openTeamCapacity() {
  document.getElementById('content')?.style.setProperty('display', 'none');
  document.querySelector('.cards-toolbar')?.style.setProperty('display', 'none');
  document.getElementById('tc-view').style.display = 'block';

  _setSidebarActive('sidebar-link-tc');

  // Restore last selected project or pick first
  if (!_project) _project = localStorage.getItem('tcProject') || _getProjectList()[0] || null;
  if (!_data) _loadData();
}

export function showDashboardView() {
  document.getElementById('tc-view').style.display = 'none';
  document.getElementById('content')?.style.removeProperty('display');
  document.querySelector('.cards-toolbar')?.style.removeProperty('display');
  _setSidebarActive('sidebar-link-dashboard');
}

function _setSidebarActive(id) {
  document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
  document.getElementById(id)?.classList.add('active');
}

function _getProjectList() {
  return [...document.querySelectorAll('.card[data-project]')].map(c => c.dataset.project).filter(Boolean);
}

// ── Data fetching ─────────────────────────────────────────────────────────────
async function _loadData() {
  if (_loading) return;
  _loading = true;

  const body = document.getElementById('tc-body');
  if (body) body.innerHTML = `<div class="tc-loading"><span class="spinner"></span> ${t('tc_loading') || 'Loading…'}</div>`;

  try {
    const qs  = _project ? `?project=${encodeURIComponent(_project)}` : '';
    const res = await fetch(`/api/team-capacity${qs}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    _data = await res.json();
    _render();
  } catch (e) {
    if (body) body.innerHTML = `<div class="tc-error">Failed to load: ${e.message}</div>`;
  } finally {
    _loading = false;
  }
}

export function tcRefresh() {
  _data = null;
  _loadData();
}

export function tcChangeProject(val) {
  _project = val;
  localStorage.setItem('tcProject', val);
  _data    = null;
  _loadData();
}

// ── Render ────────────────────────────────────────────────────────────────────
function _render() {
  const body = document.getElementById('tc-body');
  if (!body || !_data) return;

  const { currentSprint, developers = [], recentSprints = [] } = _data;
  const projects = _getProjectList();

  // Squad totals
  const totals = _squadTotals(developers, currentSprint?.name || '');

  const delta     = Math.round((totals.demand - totals.capacity) * 10) / 10;
  const deltaSign = delta > 0 ? '+' : '';
  const demandBarPct = totals.capacity > 0
    ? Math.min(100, Math.round(totals.demand / totals.capacity * 100))
    : 0;

  // Sprint label
  let sprintDates = '';
  if (currentSprint?.start && currentSprint?.end) {
    const fmt = d => new Date(d).toLocaleDateString('en', { month: 'short', day: 'numeric' });
    sprintDates = `<span class="tc-sprint-dates">${fmt(currentSprint.start)} – ${fmt(currentSprint.end)}</span>`;
  }

  // Project selector
  const projSel = projects.length > 1 ? `
    <div class="tc-project-sel">
      <label class="tc-proj-label">${t('tc_project')}</label>
      <select class="tc-proj-select" onchange="tcChangeProject(this.value)">
        ${projects.map(p => `<option value="${_esc(p)}"${p === _project ? ' selected' : ''}>${_esc(getAlias(p) || p)}</option>`).join('')}
      </select>
    </div>` : '';

  body.innerHTML = `
    <div class="tc-header">
      <div class="tc-header-left">
        <h2 class="tc-title">${t('tc_title')}</h2>
        <div class="tc-sprint-row">
          ${currentSprint
            ? `<span class="tc-sprint-badge">${t('tc_active_sprint')}</span>
               <span class="tc-sprint-name">${_esc(currentSprint.name)}</span>
               ${sprintDates}`
            : `<span class="tc-sprint-badge tc-sprint-badge--none">${t('tc_no_sprint')}</span>`}
        </div>
        ${projSel}
      </div>
      <div class="tc-squad-stats">
        <div class="tc-squad-card" id="tc-sc-capacity">
          <div class="tc-squad-label">${t('tc_squad_capacity')}</div>
          <div class="tc-squad-val">${totals.capacity}<span class="tc-squad-unit"> HRS</span></div>
        </div>
        <div class="tc-squad-card" id="tc-sc-demand">
          <div class="tc-squad-label">${t('tc_backlog_demand')}</div>
          <div class="tc-squad-val tc-squad-val--warn">${totals.demand}<span class="tc-squad-unit"> HRS</span></div>
          <div class="tc-demand-track"><div class="tc-demand-fill" style="width:${demandBarPct}%"></div></div>
        </div>
        <div class="tc-squad-card ${delta > 0 ? 'tc-squad-card--danger' : 'tc-squad-card--ok'}" id="tc-sc-delta">
          <div class="tc-squad-label">${t('tc_overload_delta')}</div>
          <div class="tc-squad-val">${deltaSign}${delta}<span class="tc-squad-unit"> HRS</span></div>
        </div>
      </div>
    </div>

    <div class="tc-grid">
      ${developers.map(dev => _devCard(dev, currentSprint?.name || '')).join('')}
      ${developers.length === 0 ? `<div class="tc-empty">${t('tc_empty')}</div>` : ''}
    </div>`;

  _bindSliders();
}

function _devCard(dev, sprintName) {
  const cap       = getCapacity(dev.name, sprintName);
  const logged    = dev.currentSprint.completedWork;
  const remaining = dev.currentSprint.remainingWork;
  const demand    = Math.round((logged + remaining) * 10) / 10;

  // Utilization
  const utilPct = cap > 0 ? Math.round(logged / cap * 100) : null;

  // Status badge
  let badge;
  if (cap === 0) {
    badge = `<span class="tc-badge tc-badge--none">${t('tc_badge_none')}</span>`;
  } else if (utilPct !== null && utilPct > 100) {
    badge = `<span class="tc-badge tc-badge--risk">${t('tc_badge_risk')}</span>`;
  } else {
    badge = `<span class="tc-badge tc-badge--ok">${t('tc_badge_ok')}</span>`;
  }

  // Slider visual %: capacity / 80h (typical 2-week sprint) capped at 160%
  const MAX_HRS = 80;
  const sliderDisplayPct = cap > 0 ? Math.round(Math.min(cap / MAX_HRS, 2) * 100) : 0;

  const { color, initials } = _avatar(dev.name);
  const safeDev    = _esc(dev.name);
  const safeSprint = _esc(sprintName);

  const capDisp  = cap > 0 ? `${cap}h` : '—';
  const utilDisp = utilPct !== null ? `${utilPct}%` : '—';
  const utilCls  = utilPct !== null && utilPct > 100 ? 'tc-val--danger' : utilPct !== null && utilPct >= 85 ? 'tc-val--warn' : '';
  const remDisp  = cap > 0
    ? (cap - logged).toFixed(1).replace(/\.0$/, '') + 'h'
    : `${remaining}h`;

  return `
    <div class="tc-dev-card" data-dev="${safeDev}">
      <div class="tc-dev-header">
        <div class="tc-dev-left">
          <div class="tc-avatar" style="background:${color}">${initials}</div>
          <div>
            <div class="tc-dev-name">${_esc(dev.name)}</div>
            <div class="tc-dev-meta">${dev.currentSprint.taskCount} task${dev.currentSprint.taskCount !== 1 ? 's' : ''} · ${demand}h demand</div>
          </div>
        </div>
        ${badge}
      </div>

      <div class="tc-cap-header">
        <span class="tc-cap-label">${t('tc_define_capacity')}</span>
        <span class="tc-cap-pct">${cap > 0 ? sliderDisplayPct + '%' : '—'}</span>
      </div>
      <div class="tc-slider-row">
        <input type="range" class="tc-slider" min="0" max="160" step="4"
          value="${cap}" data-dev="${safeDev}" data-sprint="${safeSprint}">
        <input type="number" class="tc-slider-tip" min="0" max="999" step="1"
          value="${cap > 0 ? cap : ''}" placeholder="0"
          data-dev="${safeDev}" data-sprint="${safeSprint}" title="Digite a capacidade em horas">
      </div>

      <div class="tc-stats-grid">
        <div class="tc-stat-box">
          <div class="tc-stat-box-label">${t('tc_capacity')}</div>
          <div class="tc-stat-box-val">${capDisp}</div>
        </div>
        <div class="tc-stat-box">
          <div class="tc-stat-box-label">${t('tc_utilization')}</div>
          <div class="tc-stat-box-val ${utilCls}">${utilDisp}</div>
        </div>
        <div class="tc-stat-box">
          <div class="tc-stat-box-label">${t('tc_logged')}</div>
          <div class="tc-stat-box-val">${logged}h</div>
        </div>
        <div class="tc-stat-box">
          <div class="tc-stat-box-label">${t('tc_remaining')}</div>
          <div class="tc-stat-box-val">${remDisp}</div>
        </div>
      </div>

      ${_trendChart(dev.history, sprintName)}
    </div>`;
}

function _trendChart(history, currentSprint) {
  if (!history?.length) return '';
  const maxVal = Math.max(...history.map(h => h.completedWork), 1);

  const bars = history.map(h => {
    const pct = Math.max(Math.round(h.completedWork / maxVal * 100), h.completedWork > 0 ? 6 : 0);
    const cls = h.sprint === currentSprint ? 'tc-bar--current'
              : h.completedWork === 0      ? 'tc-bar--zero'
              : 'tc-bar--past';
    const label = h.sprint.replace(/^.+[\s\-\/](\d+)\s*$/, 'S$1').slice(-6);
    return `
      <div class="tc-bar-col" title="${_esc(h.sprint)}: ${h.completedWork}h">
        <div class="tc-bar ${cls}" style="height:${pct}%"></div>
        <div class="tc-bar-lbl">${label}</div>
      </div>`;
  }).join('');

  return `
    <div class="tc-trend">
      <div class="tc-trend-label">${t('tc_trend_label')} (${t('tc_last') || 'LAST'} ${history.length} ${t('tc_sprints') || 'SPRINTS'})</div>
      <div class="tc-bars">${bars}</div>
    </div>`;
}

// ── Slider interaction ────────────────────────────────────────────────────────
function _bindSliders() {
  document.querySelectorAll('#tc-body .tc-slider').forEach(s => {
    s.addEventListener('input', _onSlider);
  });
  document.querySelectorAll('#tc-body .tc-slider-tip').forEach(inp => {
    inp.addEventListener('change', _onTipInput);
    inp.addEventListener('input', _onTipInput);
  });
}

function _onTipInput(e) {
  const inp     = e.target;
  const hours   = Math.max(0, parseFloat(inp.value) || 0);
  const card    = inp.closest('.tc-dev-card');
  const slider  = card?.querySelector('.tc-slider');
  if (slider) {
    // clamp to slider max and sync
    const clamped = Math.min(hours, parseFloat(slider.max));
    slider.value = clamped;
    inp.value = hours > 0 ? hours : '';
  }
  // reuse slider logic
  _applyCapacityChange(inp.dataset.dev, inp.dataset.sprint, hours, card);
}

function _onSlider(e) {
  const slider = e.target;
  const hours  = parseFloat(slider.value);
  const card   = slider.closest('.tc-dev-card');
  // sync number input
  const tip = card?.querySelector('.tc-slider-tip');
  if (tip) tip.value = hours > 0 ? hours : '';
  _applyCapacityChange(slider.dataset.dev, slider.dataset.sprint, hours, card);
}

function _applyCapacityChange(devName, sprintKey, hours, card) {
  saveCapacity(devName, sprintKey, hours);
  if (!card) return;

  const MAX_HRS = 80;
  const sliderDisplayPct = hours > 0 ? Math.round(Math.min(hours / MAX_HRS, 2) * 100) : 0;

  const pctEl = card.querySelector('.tc-cap-pct');
  if (pctEl) pctEl.textContent = hours > 0 ? `${sliderDisplayPct}%` : '—';

  const dev = _data?.developers?.find(d => d.name === devName);
  if (!dev) return;
  const logged    = dev.currentSprint.completedWork;
  const remaining = dev.currentSprint.remainingWork;

  const utilPct = hours > 0 ? Math.round(logged / hours * 100) : null;
  const utilCls = utilPct !== null && utilPct > 100 ? 'tc-val--danger' : utilPct !== null && utilPct >= 85 ? 'tc-val--warn' : '';
  const remDisp = hours > 0 ? (hours - logged).toFixed(1).replace(/\.0$/, '') + 'h' : `${remaining}h`;

  const boxes = card.querySelectorAll('.tc-stat-box-val');
  if (boxes[0]) boxes[0].textContent = hours > 0 ? `${hours}h` : '—';
  if (boxes[1]) { boxes[1].textContent = utilPct !== null ? `${utilPct}%` : '—'; boxes[1].className = `tc-stat-box-val ${utilCls}`.trim(); }
  if (boxes[3]) boxes[3].textContent = remDisp;

  const badge = card.querySelector('.tc-badge');
  if (badge) {
    if (hours === 0) {
      badge.className = 'tc-badge tc-badge--none'; badge.textContent = t('tc_badge_none');
    } else if (utilPct !== null && utilPct > 100) {
      badge.className = 'tc-badge tc-badge--risk'; badge.textContent = t('tc_badge_risk');
    } else {
      badge.className = 'tc-badge tc-badge--ok'; badge.textContent = t('tc_badge_ok');
    }
  }

  _updateSquadCards();
}

function _updateSquadCards() {
  if (!_data) return;
  const sprintName = _data.currentSprint?.name || '';
  const totals     = _squadTotals(_data.developers, sprintName);
  const delta      = Math.round((totals.demand - totals.capacity) * 10) / 10;
  const deltaSign  = delta > 0 ? '+' : '';

  const sc0 = document.getElementById('tc-sc-capacity');
  if (sc0) sc0.querySelector('.tc-squad-val').innerHTML = `${totals.capacity}<span class="tc-squad-unit"> HRS</span>`;

  const sc1 = document.getElementById('tc-sc-demand');
  if (sc1) {
    sc1.querySelector('.tc-squad-val').innerHTML = `${totals.demand}<span class="tc-squad-unit"> HRS</span>`;
    const pct = totals.capacity > 0 ? Math.min(100, Math.round(totals.demand / totals.capacity * 100)) : 0;
    const fill = sc1.querySelector('.tc-demand-fill');
    if (fill) fill.style.width = `${pct}%`;
  }

  const sc2 = document.getElementById('tc-sc-delta');
  if (sc2) {
    sc2.className = `tc-squad-card ${delta > 0 ? 'tc-squad-card--danger' : 'tc-squad-card--ok'}`;
    sc2.querySelector('.tc-squad-val').innerHTML = `${deltaSign}${delta}<span class="tc-squad-unit"> HRS</span>`;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function _squadTotals(devs, sprintName) {
  let capacity = 0, demand = 0;
  devs.forEach(dev => {
    capacity += getCapacity(dev.name, sprintName);
    demand   += dev.currentSprint.completedWork + dev.currentSprint.remainingWork;
  });
  return { capacity: Math.round(capacity * 10) / 10, demand: Math.round(demand * 10) / 10 };
}

const AVATAR_COLORS = ['#3b82f6','#8b5cf6','#f59e0b','#10b981','#ef4444','#06b6d4','#f97316','#ec4899','#14b8a6','#6366f1'];
function _avatar(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  const color    = AVATAR_COLORS[h % AVATAR_COLORS.length];
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
  return { color, initials };
}

function _esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

import { _esc } from './report-charts.js';
import { t } from './i18n.js';
import { _detailState, loadDetailData, LS_ORIG_EST } from './detail.js';

const DEFAULT_COLOR = {
  completion: '#22c55e',
  uat: '#f59e0b',
  bugRate: '#ef4444',
  estimateCoverage: '#60a5fa',
  effortSaved: '#22c55e',
};

const ALL_KEYS = ['completion', 'uat', 'bugRate', 'estimateCoverage', 'effortSaved'];

const TITLE_KEY = {
  completion: 'ind_cfg_completion',
  uat: 'ind_cfg_uat',
  bugRate: 'ind_cfg_bug_rate',
  estimateCoverage: 'ind_cfg_estimate_coverage',
  effortSaved: 'ind_cfg_effort_saved',
};

let _icfgProject = null;
let _icfgKey = null; // null = configura os 5 indicadores; senão, só o indicador individual
let _icfgOpen = false;

export function openIndicatorConfig(target, indicatorKey = null) {
  const project = typeof target === 'string'
    ? target
    : target?.closest?.('.card, .sn-inc-card')?.dataset?.project;
  if (!project) return;
  _icfgProject = project;
  _icfgKey = indicatorKey;
  _render(project);
}

function _render(project) {
  document.getElementById('indicator-cfg-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'indicator-cfg-overlay';
  overlay.className = 'modal-overlay open';
  overlay.addEventListener('click', e => { if (e.target === overlay) closeIndicatorConfig(); });

  const title = _icfgKey ? t(TITLE_KEY[_icfgKey]) : t('ind_cfg_title');

  overlay.innerHTML = `
    <div class="modal-box hcfg-box icfg-box">
      <div class="modal-head">
        <div>
          <div class="modal-title">${title}</div>
          <div class="modal-sub">${_esc(project)}</div>
        </div>
        <div class="modal-actions">
          <button class="modal-close" onclick="closeIndicatorConfig()">&#215;</button>
        </div>
      </div>
      <div class="modal-body hcfg-body" id="icfg-body">
        <div class="hcfg-group"><div class="icfg-loading">${t('ind_cfg_loading')}</div></div>
      </div>
    </div>`;

  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';
  _icfgOpen = true;
  _loadAndRenderBody(project);
}

async function _loadAndRenderBody(project) {
  const body = document.getElementById('icfg-body');
  if (!body) return;
  try {
    const [cfgResp, statesResp] = await Promise.all([
      fetch('/api/indicator-config?' + new URLSearchParams({ project })),
      fetch('/api/us-states?' + new URLSearchParams({ project })),
    ]);
    if (!statesResp.ok) throw new Error('states');
    const cfg = await cfgResp.json();
    const statesData = await statesResp.json();
    const states = statesData.states || [];
    if (!states.length) throw new Error('states');
    body.innerHTML = _bodyHtml(cfg, states);
    _wireColorToggles();
  } catch (_) {
    body.innerHTML = `<div class="hcfg-error">${t('ind_cfg_err_states')}
      <button class="ca" style="margin-left:8px" onclick="window.__icfgRetry()">${t('ind_cfg_retry')}</button></div>`;
    window.__icfgRetry = () => _loadAndRenderBody(project);
  }
}

function _statesChecklist(id, states, selected) {
  // Garante que estados já configurados apareçam mesmo se não vierem mais na lista
  // de estados válidos do work item type (ex.: workflow alterado desde a config salva).
  const extra = selected.filter(s => !states.includes(s));
  const fullList = [...extra, ...states].sort((a, b) => a.localeCompare(b));
  return `<div id="${id}" class="icfg-states-list">` +
    fullList.map(s => {
      const checked = selected.includes(s) ? ' checked' : '';
      return `<label class="icfg-state-opt">
        <input type="checkbox" value="${_esc(s)}"${checked}>
        ${_esc(s)}
      </label>`;
    }).join('') + `</div>`;
}

function _colorRow(key, label, cfgColor) {
  const hasColor = !!cfgColor;
  const defaultColor = DEFAULT_COLOR[key] || '#60a5fa';
  return `<div class="icfg-color-row">
    <span class="hcfg-txt">${label}</span>
    <select class="report-field-sel icfg-color-mode" id="icfg-${key}-mode">
      <option value="default"${!hasColor ? ' selected' : ''}>${t('ind_cfg_color_default')}</option>
      <option value="custom"${hasColor ? ' selected' : ''}>${t('ind_cfg_color_custom')}</option>
    </select>
    <input type="color" id="icfg-${key}-color" value="${hasColor ? cfgColor : defaultColor}"${hasColor ? '' : ' style="visibility:hidden"'}>
  </div>`;
}

const BLOCKS = {
  completion: (cfg, states) => `
    <div class="hcfg-group">
      <div class="hcfg-label">${t('ind_cfg_completion')}</div>
      <div class="icfg-desc">${t('ind_cfg_completion_desc')}</div>
      ${_statesChecklist('icfg-completion-states', states, cfg.completion.states)}
      ${_colorRow('completion', t('ind_cfg_color'), cfg.completion.color)}
    </div>`,
  uat: (cfg, states) => `
    <div class="hcfg-group">
      <div class="hcfg-label">${t('ind_cfg_uat')}</div>
      <div class="icfg-desc">${t('ind_cfg_uat_desc')}</div>
      ${_statesChecklist('icfg-uat-states', states, cfg.uat.states)}
      ${_colorRow('uat', t('ind_cfg_color'), cfg.uat.color)}
    </div>`,
  bugRate: (cfg) => `
    <div class="hcfg-group">
      <div class="hcfg-label">${t('ind_cfg_bug_rate')}</div>
      <div class="hcfg-row">
        <span class="hcfg-txt">${t('ind_cfg_basis')}</span>
        <select class="report-field-sel" id="icfg-bugrate-basis">
          <option value="hours"${cfg.bugRate.basis !== 'count' ? ' selected' : ''}>${t('ind_cfg_basis_hours')}</option>
          <option value="count"${cfg.bugRate.basis === 'count' ? ' selected' : ''}>${t('ind_cfg_basis_count')}</option>
        </select>
      </div>
      ${_colorRow('bugRate', t('ind_cfg_color'), cfg.bugRate.color)}
    </div>`,
  estimateCoverage: (cfg) => `
    <div class="hcfg-group">
      <div class="hcfg-label">${t('ind_cfg_estimate_coverage')}</div>
      <div class="hcfg-row">
        <span class="hcfg-txt">${t('ind_cfg_scope')}</span>
        <select class="report-field-sel" id="icfg-estcov-scope">
          <option value="all"${cfg.estimateCoverage.scope !== 'open' ? ' selected' : ''}>${t('ind_cfg_scope_all')}</option>
          <option value="open"${cfg.estimateCoverage.scope === 'open' ? ' selected' : ''}>${t('ind_cfg_scope_open')}</option>
        </select>
      </div>
      ${_colorRow('estimateCoverage', t('ind_cfg_color'), cfg.estimateCoverage.color)}
    </div>`,
  effortSaved: (cfg) => {
    const current = localStorage.getItem(LS_ORIG_EST + _icfgProject) || '';
    return `
    <div class="hcfg-group">
      <div class="hcfg-label">${t('ind_cfg_effort_saved')}</div>
      <div class="icfg-desc">${t('ind_cfg_effort_saved_desc')}</div>
      <div class="hcfg-row">
        <span class="hcfg-txt">${t('ind_cfg_effort_orig_est_label')}</span>
        <input type="number" class="hcfg-input" id="icfg-effort-origest" min="0" step="0.5" value="${_esc(current)}" placeholder="${t('ind_cfg_effort_orig_est_placeholder')}">
      </div>
      <div class="icfg-desc">${t('ind_cfg_effort_orig_est_hint')}</div>
      ${_colorRow('effortSaved', t('ind_cfg_color'), cfg.effortSaved.color)}
    </div>`;
  },
};

function _activeKeys() {
  return _icfgKey ? [_icfgKey] : ALL_KEYS;
}

function _bodyHtml(cfg, states) {
  const blocks = _activeKeys().map(k => BLOCKS[k](cfg, states)).join('');
  return blocks +
    `<div id="icfg-error" class="hcfg-error" style="display:none"></div>
    <div class="hcfg-footer">
      <button class="ca" onclick="closeIndicatorConfig()">${t('ind_cfg_cancel')}</button>
      <button class="ca p" id="icfg-save-btn" onclick="saveIndicatorConfigModal()">${t('ind_cfg_save')}</button>
    </div>`;
}

function _wireColorToggles() {
  _activeKeys().forEach(key => {
    const mode  = document.getElementById(`icfg-${key}-mode`);
    const color = document.getElementById(`icfg-${key}-color`);
    if (!mode || !color) return;
    mode.addEventListener('change', () => {
      color.style.visibility = mode.value === 'custom' ? 'visible' : 'hidden';
    });
  });
}

export function closeIndicatorConfig() {
  document.getElementById('indicator-cfg-overlay')?.remove();
  document.body.style.overflow = '';
  _icfgOpen = false;
}

function _readColor(key) {
  const mode = document.getElementById(`icfg-${key}-mode`)?.value;
  if (mode !== 'custom') return '';
  return document.getElementById(`icfg-${key}-color`)?.value || '';
}

function _readStates(id) {
  return [...document.querySelectorAll(`#${id} input[type=checkbox]:checked`)].map(cb => cb.value);
}

export async function saveIndicatorConfigModal() {
  const project = _icfgProject;
  if (!project) return;
  const keys = _activeKeys();

  const errEl   = document.getElementById('icfg-error');
  const showErr = msg => { if (errEl) { errEl.textContent = msg; errEl.style.display = ''; } };
  const hideErr = ()  => { if (errEl) errEl.style.display = 'none'; };
  hideErr();

  const payload = { project };

  if (keys.includes('completion')) {
    const states = _readStates('icfg-completion-states');
    if (!states.length) { showErr(t('ind_cfg_err_completion')); return; }
    payload.completion = { states, color: _readColor('completion') };
  }
  if (keys.includes('uat')) {
    const states = _readStates('icfg-uat-states');
    if (!states.length) { showErr(t('ind_cfg_err_uat')); return; }
    payload.uat = { states, color: _readColor('uat') };
  }
  if (keys.includes('bugRate')) {
    payload.bugRate = { basis: document.getElementById('icfg-bugrate-basis')?.value || 'hours', color: _readColor('bugRate') };
  }
  if (keys.includes('estimateCoverage')) {
    payload.estimateCoverage = { scope: document.getElementById('icfg-estcov-scope')?.value || 'all', color: _readColor('estimateCoverage') };
  }
  if (keys.includes('effortSaved')) {
    payload.effortSaved = { color: _readColor('effortSaved') };
    const lsKey = LS_ORIG_EST + project;
    const v = parseFloat(document.getElementById('icfg-effort-origest')?.value);
    if (!isNaN(v) && v > 0) localStorage.setItem(lsKey, String(v));
    else localStorage.removeItem(lsKey);
  }

  const btn = document.getElementById('icfg-save-btn');
  if (btn) btn.disabled = true;

  try {
    const r = await fetch('/api/indicator-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      showErr(d.error || t('ind_cfg_err_save'));
      if (btn) btn.disabled = false;
      return;
    }
    closeIndicatorConfig();
    if (_detailState.project === project) await loadDetailData(project, _detailState.sprints);
  } catch (_) {
    showErr(t('ind_cfg_err_save'));
    if (btn) btn.disabled = false;
  }
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && _icfgOpen) closeIndicatorConfig();
});

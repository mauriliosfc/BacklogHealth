// ── Monthly Review — pickers + incidents modal ────────────────────────────────
// Callbacks injetados por report.js em initPickerCallbacks() para evitar dep circular.
import { S } from './report-state.js';
import { _esc } from './report-charts.js';
import { t } from './i18n.js';

let _onSave     = null;
let _onRerender = null;
let _onLoad     = null;

export function initPickerCallbacks({ saveConfig, rerender, load }) {
  _onSave     = saveConfig;
  _onRerender = rerender;
  _onLoad     = load;
}

// ── Autocomplete helpers ──────────────────────────────────────────────────────

const _INC_GROUPBY_FIELDS = [
  { key: 'cmdb_ci.name',          get label() { return t('rpt_groupby_ic'); } },
  { key: 'u_additional_res_code', get label() { return t('rpt_groupby_res_code'); } },
  { key: 'assignment_group',      get label() { return t('rpt_groupby_group'); } },
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
  { key: 'assignment_group', get label() { return t('rpt_groupby_group'); } },
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

// ── Picker factory ────────────────────────────────────────────────────────────

function _closeFieldPicker() {
  document.getElementById('report-field-picker')?.remove();
  document.getElementById('report-picker-backdrop')?.remove();
}

function _openPicker({ title, bodyHtml, applyLabel = 'Aplicar', onApply }) {
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
    <div class="report-field-picker-title">${title}</div>
    ${bodyHtml}
    <div class="report-field-picker-actions">
      <button class="report-picker-btn-cancel" id="report-picker-cancel">${t('rpt_btn_cancel')}</button>
      <button class="report-picker-btn-apply"  id="report-picker-apply">${applyLabel}</button>
    </div>`;
  document.body.appendChild(picker);

  picker.querySelector('#report-picker-cancel').onclick = _closeFieldPicker;
  picker.querySelector('#report-picker-apply').onclick  = onApply;

  return picker;
}

// ── Main chart picker (Azure DevOps) ─────────────────────────────────────────

export function reportOpenFieldPicker(idx) {
  S.pickerIdx = idx !== undefined ? idx : -1;

  const isEdit        = S.pickerIdx >= 0;
  const currentChart  = isEdit ? S.reportCharts[S.pickerIdx] : null;
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

  const sizeOpts = [
    { val: 'sm', get label() { return t('rpt_size_3col'); } },
    { val: 'md', get label() { return t('rpt_size_2col'); } },
    { val: 'lg', get label() { return t('rpt_size_full'); } },
  ].map(o => `<button class="report-size-opt${currentSize === o.val ? ' active' : ''}" data-size="${o.val}">${o.label}</button>`).join('');

  const typeSection = !isEdit ? `
    <div class="report-field-picker-label">${t('rpt_label_chart_type')}</div>
    <select id="report-chart-type-sel" class="report-field-sel">
      <option value="donut">${t('rpt_inc_type_groupby')}</option>
      <option value="incidents">${t('rpt_type_incidents')}</option>
      <option value="sprint">${t('rpt_sp_planned_delivered')}</option>
      <option value="volatility">${t('rpt_volatility_backlog')}</option>
    </select>` : '';

  const fieldSection = `
    <div id="report-field-label"${!isDonut ? ' style="display:none"' : ''}>
      <div class="report-field-picker-label">${t('rpt_label_groupby_field')}</div>
    </div>
    <div id="report-field-picker-body" class="report-field-picker-body"${!isDonut ? ' style="display:none"' : ''}>
      ${isDonut ? `<div class="report-field-picker-loading">${t('rpt_loading_fields')}</div>` : ''}
    </div>`;

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

  const monthsSection = `
    <div id="report-months-section"${!isIncidents ? ' style="display:none"' : ''}>
      <div class="report-field-picker-label">${t('rpt_label_history_months')}</div>
      <input type="number" id="report-inc-months" class="report-inc-months-input" min="1" max="12" value="${currentMonths}">
    </div>`;

  const metricOpts = [
    { val: 'count', get label() { return t('rpt_metric_count'); } },
    { val: 'pts',   get label() { return t('rpt_metric_pts'); } },
  ].map(o => `<button class="report-size-opt${currentCountBy === o.val ? ' active' : ''}" data-countby="${o.val}">${o.label}</button>`).join('');
  const metricSection = `
    <div id="report-metric-label"${!isDonut ? ' style="display:none"' : ''}>
      <div class="report-field-picker-label">${t('rpt_label_metric')}</div>
    </div>
    <div class="report-size-group" id="report-metric-group"${!isDonut ? ' style="display:none"' : ''}>${metricOpts}</div>`;

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

  const picker = _openPicker({
    title:       isEdit ? t('rpt_title_configure_chart') : t('rpt_title_new_chart'),
    applyLabel:  isEdit ? t('rpt_btn_apply') : t('rpt_btn_add'),
    bodyHtml: `
      ${typeSection}
      ${fieldSection}
      ${metricSection}
      ${styleSection}
      ${barColorSection}
      ${monthsSection}
      <div class="report-field-picker-label">${t('rpt_label_size')}</div>
      <div class="report-size-group" id="report-size-group-el">${sizeOpts}</div>`,
    onApply: _applyChartPicker,
  });

  picker.addEventListener('click', e => {
    const opt   = e.target.closest('.report-size-opt');
    if (!opt) return;
    const group = opt.closest('.report-size-group');
    group?.querySelectorAll('.report-size-opt').forEach(b => b.classList.remove('active'));
    opt.classList.add('active');
    if (group?.id === 'report-style-group' && opt.dataset.style) {
      const sec = document.getElementById('report-bar-color-section');
      if (sec) sec.style.display = (opt.dataset.style === 'bar' || opt.dataset.style === 'bar-vertical') ? '' : 'none';
    }
  });

  document.getElementById('report-bar-color-mode')?.addEventListener('change', e => {
    const cp = document.getElementById('report-bar-color-picker');
    if (cp) cp.style.display = e.target.value === 'single' ? '' : 'none';
  });

  function _loadPickerFields(selectedRef) {
    fetch('/api/report-fields?' + new URLSearchParams({ project: S.reportProject }))
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
        hide('report-bar-color-section');
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

  if (isDonut) {
    _loadPickerFields(currentRef);
  }
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

  if (S.pickerIdx >= 0) {
    const chart = S.reportCharts[S.pickerIdx];
    if (chart.type === 'incidents') {
      const months = Math.min(24, Math.max(1, parseInt(document.getElementById('report-inc-months')?.value) || 5));
      S.reportCharts[S.pickerIdx] = { type: 'incidents', size, months };
    } else if (chart.type === 'incident-location') {
      const months = Math.min(6, Math.max(1, parseInt(document.getElementById('report-inc-months')?.value) || 6));
      S.reportCharts[S.pickerIdx] = { type: 'incident-location', size, months };
    } else if (chart.type === 'donut') {
      const sel = document.getElementById('report-field-sel');
      if (sel) {
        const ref   = sel.value;
        const label = ref ? (sel.options[sel.selectedIndex]?.text || ref) : 'Tipo de Item';
        needsRefetch = ref !== chart.ref;
        S.reportCharts[S.pickerIdx] = { type: 'donut', ref, label, size, chartStyle, countBy, barColor };
      } else {
        S.reportCharts[S.pickerIdx] = { ...chart, size, chartStyle, countBy, barColor };
      }
    } else {
      S.reportCharts[S.pickerIdx] = { ...chart, size };
    }
  } else {
    const typeSel = document.getElementById('report-chart-type-sel');
    const type    = typeSel?.value || 'donut';
    if (type === 'incidents') {
      const months = Math.min(24, Math.max(1, parseInt(document.getElementById('report-inc-months')?.value) || 5));
      S.reportCharts.push({ type: 'incidents', size, months });
    } else if (type === 'incident-location') {
      const months = Math.min(6, Math.max(1, parseInt(document.getElementById('report-inc-months')?.value) || 6));
      S.reportCharts.push({ type: 'incident-location', size, months });
    } else if (type === 'donut') {
      const sel   = document.getElementById('report-field-sel');
      const ref   = sel?.value || '';
      const label = ref ? (sel?.options[sel?.selectedIndex]?.text || ref) : 'Tipo de Item';
      S.reportCharts.push({ type: 'donut', ref, label, size, chartStyle, countBy, barColor });
      needsRefetch = true;
    } else {
      S.reportCharts.push({ type, size });
    }
  }

  _onSave();
  _closeFieldPicker();
  if (needsRefetch) {
    _onLoad(true);
  } else {
    _onRerender();
  }
}

// ── Incident chart picker ─────────────────────────────────────────────────────

export function reportOpenIncChartPicker(idx) {
  S.incPickerIdx = idx !== undefined ? idx : -1;
  const isEdit       = S.incPickerIdx >= 0;
  const currentChart = isEdit ? S.incidentCharts[S.incPickerIdx] : null;
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

  const sizeOpts = [
    { val: 'sm', get label() { return t('rpt_size_3col'); } },
    { val: 'md', get label() { return t('rpt_size_2col'); } },
    { val: 'lg', get label() { return t('rpt_size_full'); } },
  ].map(o => `<button class="report-size-opt${currentSize === o.val ? ' active' : ''}" data-size="${o.val}">${o.label}</button>`).join('');

  const typeSection = !isEdit
    ? `<div class="report-field-picker-label">${t('rpt_label_chart_type')}</div>
       <select id="report-inc-type-sel" class="report-field-sel">
         ${INC_TYPES.map(t => `<option value="${t.val}">${t.label}</option>`).join('')}
       </select>`
    : `<div class="report-field-picker-label">${t('rpt_label_chart')}</div>
       <div style="font-size:13px;color:var(--text-muted);padding:2px 0 8px">${_esc(INC_TYPES.find(t => t.val === currentType)?.label || currentType)}</div>`;

  const MONTH_OPTS = [3, 5, 6, 8, 10, 12, 13, 24];
  const LOC_OPTS   = [1, 3, 6];
  const showVolume  = isEdit && (currentType === 'inc-volume' || currentType === 'inc-priority-trend' || currentType === 'inc-heatmap');
  const showTarget  = isEdit && currentType === 'inc-volume';
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
        ${[{val:'donut',get label(){return t('rpt_style_donut');}},{val:'bar',get label(){return t('rpt_style_bars');}},{val:'bar-vertical',get label(){return t('rpt_style_bars_v');}}]
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
            <input type="number" id="report-sla-p1" min="0" max="100" value="${S.slaTargets.p1 ?? 95}" style="width:56px;padding:4px 6px;background:var(--bg-el);border:1px solid var(--border);border-radius:var(--r-sm);color:var(--text-1);font-size:13px;text-align:right">
            <span style="font-size:12px;color:var(--text-faint)">%</span>
          </div>
        </div>
        <div>
          <label style="font-size:11px;color:var(--text-faint);display:block;margin-bottom:4px">${t('rpt_priority_p2')}</label>
          <div style="display:flex;align-items:center;gap:4px">
            <input type="number" id="report-sla-p2" min="0" max="100" value="${S.slaTargets.p2 ?? 90}" style="width:56px;padding:4px 6px;background:var(--bg-el);border:1px solid var(--border);border-radius:var(--r-sm);color:var(--text-1);font-size:13px;text-align:right">
            <span style="font-size:12px;color:var(--text-faint)">%</span>
          </div>
        </div>
        <div>
          <label style="font-size:11px;color:var(--text-faint);display:block;margin-bottom:4px">${t('rpt_priority_p3')}</label>
          <div style="display:flex;align-items:center;gap:4px">
            <input type="number" id="report-sla-p3" min="0" max="100" value="${S.slaTargets.p3 ?? 85}" style="width:56px;padding:4px 6px;background:var(--bg-el);border:1px solid var(--border);border-radius:var(--r-sm);color:var(--text-1);font-size:13px;text-align:right">
            <span style="font-size:12px;color:var(--text-faint)">%</span>
          </div>
        </div>
      </div>
    ` : ''}
    ${showVolume ? `
      <div class="report-field-picker-label">${t('rpt_label_history_months')}</div>
      <div class="report-size-group" style="flex-wrap:wrap" id="report-inc-p-months">
        ${MONTH_OPTS.map(n => `<button class="report-size-opt${n === (currentChart?.months || S.incidentMonths) ? ' active' : ''}" data-months="${n}">${n} ${t('rpt_months')}</button>`).join('')}
      </div>
      ${showTarget ? `
        <div class="report-field-picker-label" style="margin-top:8px">${t('rpt_label_monthly_target')}</div>
        <input type="number" id="report-inc-p-target" class="report-inc-months-input" min="0" max="9999" value="${S.incidentTarget}">
      ` : ''}
    ` : ''}
    ${showBars ? `
      <div class="report-field-picker-label">${t('rpt_label_grouping')}</div>
      <select id="report-inc-p-groupby" class="report-field-sel">
        <option value="cmdb_ci"${S.incidentGroupBy === 'cmdb_ci' ? ' selected' : ''}>IC Afetado (CMDB CI)</option>
        <option value="resolution_code"${S.incidentGroupBy === 'resolution_code' ? ' selected' : ''}>Resolution Code</option>
      </select>
    ` : ''}
    ${showHeat ? `
      <div class="report-field-picker-label" style="margin-top:8px">${t('rpt_label_heatmap_max')}</div>
      <input type="number" id="report-inc-p-heatmax" class="report-inc-months-input" min="0" max="999" value="${S.heatmapMax}" placeholder="0 = automático">
    ` : ''}
    ${showLoc ? `
      <div class="report-field-picker-label">${t('rpt_label_months_disp')}</div>
      <div class="report-size-group" id="report-inc-p-locmonths">
        ${LOC_OPTS.map(n => `<button class="report-size-opt${n === S.locationMonths ? ' active' : ''}" data-locmonths="${n}">${n} ${n === 1 ? t('rpt_month') : t('rpt_months')}</button>`).join('')}
      </div>
    ` : ''}`;

  const picker = _openPicker({
    title:      isEdit ? t('rpt_title_configure_chart') : t('rpt_title_new_chart'),
    applyLabel: isEdit ? t('rpt_btn_apply') : t('rpt_btn_add'),
    bodyHtml: `
      ${typeSection}
      ${specificSection}
      <div class="report-field-picker-label">${t('rpt_label_size')}</div>
      <div class="report-size-group" id="report-inc-size-group">${sizeOpts}</div>`,
    onApply: _applyIncChartPicker,
  });

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
  const isEdit = S.incPickerIdx >= 0;
  const size   = picker.querySelector('#report-inc-size-group .report-size-opt.active')?.dataset.size || 'lg';
  const type   = isEdit ? S.incidentCharts[S.incPickerIdx].type : (document.getElementById('report-inc-type-sel')?.value || 'inc-volume');

  const newMonths    = parseInt(picker.querySelector('#report-inc-p-months .report-size-opt.active')?.dataset.months);
  const newTarget    = parseInt(document.getElementById('report-inc-p-target')?.value);
  const newGroupBy   = document.getElementById('report-inc-p-groupby')?.value;
  const newHeatMax   = parseInt(document.getElementById('report-inc-p-heatmax')?.value);
  const newLocMonths = parseInt(picker.querySelector('#report-inc-p-locmonths .report-size-opt.active')?.dataset.locmonths);
  const clamp01      = v => Math.min(100, Math.max(0, parseInt(v) || 0));
  const newSlaP1     = document.getElementById('report-sla-p1') ? clamp01(document.getElementById('report-sla-p1').value) : null;
  const newSlaP2     = document.getElementById('report-sla-p2') ? clamp01(document.getElementById('report-sla-p2').value) : null;
  const newSlaP3     = document.getElementById('report-sla-p3') ? clamp01(document.getElementById('report-sla-p3').value) : null;

  const clampedMonths = !isNaN(newMonths) ? Math.min(24, Math.max(1, newMonths)) : null;

  let needReload = false;
  if (clampedMonths !== null) {
    const curMonths = isEdit ? (S.incidentCharts[S.incPickerIdx]?.months || S.incidentMonths) : S.incidentMonths;
    if (clampedMonths !== curMonths) needReload = true;
  }
  if (!isNaN(newTarget))                                          { S.incidentTarget  = Math.max(0, newTarget); }
  if (newGroupBy            && newGroupBy  !== S.incidentGroupBy)  { S.incidentGroupBy = newGroupBy; needReload = true; }
  if (!isNaN(newHeatMax))                                         { S.heatmapMax      = Math.max(0, newHeatMax); }
  if (!isNaN(newLocMonths) && newLocMonths !== S.locationMonths)   { S.locationMonths  = newLocMonths; needReload = true; }
  if (newSlaP1 !== null || newSlaP2 !== null || newSlaP3 !== null) {
    S.slaTargets = { p1: newSlaP1 ?? S.slaTargets.p1, p2: newSlaP2 ?? S.slaTargets.p2, p3: newSlaP3 ?? S.slaTargets.p3 };
  }

  const isGroupby      = type === 'inc-groupby';
  const gbRef          = document.getElementById('report-inc-groupby-field')?.value;
  const gbStyle        = picker.querySelector('#report-inc-groupby-style .report-size-opt.active')?.dataset.style;
  const gbColorMode    = document.getElementById('report-inc-groupby-color-mode')?.value;
  const gbColor        = gbColorMode === 'single' ? (document.getElementById('report-inc-groupby-color-input')?.value || '') : '';

  if (isEdit) {
    const update = { ...S.incidentCharts[S.incPickerIdx], size };
    if (clampedMonths !== null) update.months = clampedMonths;
    if (isGroupby) {
      if (gbRef)   update.ref        = gbRef;
      if (gbStyle) update.chartStyle = gbStyle;
      update.barColor = gbColor;
    }
    S.incidentCharts[S.incPickerIdx] = update;
  } else {
    const newChart = isGroupby ? { type, size, ref: 'cmdb_ci', chartStyle: 'donut', barColor: '' } : { type, size };
    if (clampedMonths !== null) newChart.months = clampedMonths;
    S.incidentCharts.push(newChart);
  }

  _onSave();
  _closeFieldPicker();
  if (needReload) _onLoad(); else _onRerender();
}

// ── PRB chart picker ──────────────────────────────────────────────────────────

export function reportOpenPrbChartPicker(idx) {
  S.prbPickerIdx = idx !== undefined ? idx : -1;
  const isEdit       = S.prbPickerIdx >= 0;
  const currentChart = isEdit ? S.prbCharts[S.prbPickerIdx] : null;
  const currentSize  = currentChart?.size || 'lg';
  const currentType  = currentChart?.type || 'prb-evolution';

  const PRB_TYPES = [
    { val: 'prb-evolution', get label() { return t('rpt_prb_type_evolution'); } },
    { val: 'prb-donut',     get label() { return t('rpt_prb_type_donut'); } },
    { val: 'prb-aging',     get label() { return t('rpt_prb_type_aging'); } },
    { val: 'prb-oldest',    get label() { return t('rpt_prb_type_oldest'); } },
    { val: 'prb-groupby',   get label() { return t('rpt_prb_type_groupby'); } },
  ];

  const sizeOpts = [
    { val: 'sm', get label() { return t('rpt_size_3col'); } },
    { val: 'md', get label() { return t('rpt_size_2col'); } },
    { val: 'lg', get label() { return t('rpt_size_full'); } },
  ].map(o => `<button class="report-size-opt${currentSize === o.val ? ' active' : ''}" data-size="${o.val}">${o.label}</button>`).join('');

  const typeSection = !isEdit
    ? `<div class="report-field-picker-label">${t('rpt_label_chart_type')}</div>
       <select id="report-prb-type-sel" class="report-field-sel">
         ${PRB_TYPES.map(t => `<option value="${t.val}">${t.label}</option>`).join('')}
       </select>`
    : `<div class="report-field-picker-label">${t('rpt_label_chart')}</div>
       <div style="font-size:13px;color:var(--text-muted);padding:2px 0 8px">${_esc(PRB_TYPES.find(t => t.val === currentType)?.label || currentType)}</div>`;

  const showPrbGroupby   = isEdit && currentType === 'prb-groupby';
  const showPrbEvolution = isEdit && currentType === 'prb-evolution';
  const showPrbAging     = isEdit && currentType === 'prb-aging';
  const curPgStyle       = currentChart?.chartStyle || 'donut';
  const curPgColor       = currentChart?.barColor   || '';

  const MONTH_OPTS = [3, 5, 6, 8, 10, 12, 13, 24];

  const prbEvolutionSection = showPrbEvolution ? `
    <div class="report-field-picker-label">${t('rpt_label_history_months')}</div>
    <div class="report-size-group" style="flex-wrap:wrap" id="report-prb-evo-months">
      ${MONTH_OPTS.map(n => `<button class="report-size-opt${n === (currentChart?.months || S.prbMonths) ? ' active' : ''}" data-months="${n}">${n} ${t('rpt_months')}</button>`).join('')}
    </div>` : '';

  const prbAgingSection = showPrbAging ? `
    <div class="report-field-picker-label">${t('rpt_label_aging_buckets')}</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
      <div><label style="font-size:11px;color:var(--text-faint)">${t('rpt_label_limit')} 1</label><br>
        <input type="number" id="report-prb-aging-rb0" class="report-inc-months-input" style="width:100%;box-sizing:border-box" min="1" max="999" value="${S.prbAgingBuckets[0]}"></div>
      <div><label style="font-size:11px;color:var(--text-faint)">${t('rpt_label_limit')} 2</label><br>
        <input type="number" id="report-prb-aging-rb1" class="report-inc-months-input" style="width:100%;box-sizing:border-box" min="1" max="999" value="${S.prbAgingBuckets[1]}"></div>
      <div><label style="font-size:11px;color:var(--text-faint)">${t('rpt_label_limit')} 3</label><br>
        <input type="number" id="report-prb-aging-rb2" class="report-inc-months-input" style="width:100%;box-sizing:border-box" min="1" max="999" value="${S.prbAgingBuckets[2]}"></div>
      <div><label style="font-size:11px;color:var(--text-faint)">${t('rpt_label_limit')} 4</label><br>
        <input type="number" id="report-prb-aging-rb3" class="report-inc-months-input" style="width:100%;box-sizing:border-box" min="1" max="999" value="${S.prbAgingBuckets[3]}"></div>
    </div>` : '';

  const prbGroupbySection = showPrbGroupby ? `
    <div class="report-field-picker-label">${t('rpt_label_groupby_field')}</div>
    ${_acHtml('report-prb-groupby-input', 'report-prb-groupby-field', _PRB_GROUPBY_FIELDS, currentChart?.ref || 'category')}
    <div class="report-field-picker-label">${t('rpt_label_visual_style')}</div>
    <div class="report-size-group" id="report-prb-groupby-style">
      ${[{val:'donut',get label(){return t('rpt_style_donut');}},{val:'bar',get label(){return t('rpt_style_bars');}},{val:'bar-vertical',get label(){return t('rpt_style_bars_v');}}]
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

  const picker = _openPicker({
    title:      isEdit ? t('rpt_title_configure_chart') : t('rpt_title_new_chart'),
    applyLabel: isEdit ? t('rpt_btn_apply') : t('rpt_btn_add'),
    bodyHtml: `
      ${typeSection}
      ${prbEvolutionSection}
      ${prbAgingSection}
      ${prbGroupbySection}
      <div class="report-field-picker-label">${t('rpt_label_size')}</div>
      <div class="report-size-group" id="report-prb-size-group">${sizeOpts}</div>`,
    onApply: _applyPrbChartPicker,
  });

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
  const isEdit = S.prbPickerIdx >= 0;
  const size   = picker.querySelector('#report-prb-size-group .report-size-opt.active')?.dataset.size || 'lg';
  const type   = isEdit ? S.prbCharts[S.prbPickerIdx].type : (document.getElementById('report-prb-type-sel')?.value || 'prb-evolution');

  const isPrbEvolution = type === 'prb-evolution';
  const isPrbAging     = type === 'prb-aging';
  const isPrbGroupby   = type === 'prb-groupby';
  const pgRef          = document.getElementById('report-prb-groupby-field')?.value;
  const pgStyle        = picker.querySelector('#report-prb-groupby-style .report-size-opt.active')?.dataset.style;
  const pgColorMode    = document.getElementById('report-prb-groupby-color-mode')?.value;
  const pgColor        = pgColorMode === 'single' ? (document.getElementById('report-prb-groupby-color-input')?.value || '') : '';

  // prb-evolution: read months per chart
  let needReload   = false;
  let prbNewMonths = null;
  if (isPrbEvolution) {
    const raw = parseInt(picker.querySelector('#report-prb-evo-months .report-size-opt.active')?.dataset.months);
    if (!isNaN(raw)) {
      prbNewMonths = Math.min(24, Math.max(1, raw));
      const curMonths = isEdit ? (S.prbCharts[S.prbPickerIdx]?.months || S.prbMonths) : S.prbMonths;
      if (prbNewMonths !== curMonths) needReload = true;
    }
  }

  // prb-aging: read buckets
  if (isPrbAging) {
    const rb0 = Math.max(1,        parseInt(document.getElementById('report-prb-aging-rb0')?.value) || S.prbAgingBuckets[0]);
    const rb1 = Math.max(rb0 + 1,  parseInt(document.getElementById('report-prb-aging-rb1')?.value) || S.prbAgingBuckets[1]);
    const rb2 = Math.max(rb1 + 1,  parseInt(document.getElementById('report-prb-aging-rb2')?.value) || S.prbAgingBuckets[2]);
    const rb3 = Math.max(rb2 + 1,  parseInt(document.getElementById('report-prb-aging-rb3')?.value) || S.prbAgingBuckets[3]);
    S.prbAgingBuckets = [rb0, rb1, rb2, rb3];
  }

  if (isEdit) {
    const update = { ...S.prbCharts[S.prbPickerIdx], size };
    if (prbNewMonths !== null) update.months = prbNewMonths;
    if (isPrbGroupby) {
      if (pgRef)   update.ref        = pgRef;
      if (pgStyle) update.chartStyle = pgStyle;
      update.barColor = pgColor;
    }
    S.prbCharts[S.prbPickerIdx] = update;
  } else {
    const newChart = isPrbGroupby ? { type, size, ref: 'category', chartStyle: 'donut', barColor: '' } : { type, size };
    if (prbNewMonths !== null) newChart.months = prbNewMonths;
    S.prbCharts.push(newChart);
  }

  _onSave();
  _closeFieldPicker();
  if (needReload) _onLoad(); else _onRerender();
}

// ── Standalone pickers (volume, groupby, heatmap, location, aging, delivery, SLA) ──

export function reportOpenIncidentVolumePicker() {
  const monthBtns = [3, 5, 6, 8, 10, 12, 13, 24].map(n =>
    `<button class="report-size-opt${n === S.incidentMonths ? ' active' : ''}" data-months="${n}">${n} ${t('rpt_months')}</button>`
  ).join('');

  const picker = _openPicker({
    title: t('rpt_title_cfg_inc_hist'),
    bodyHtml: `
      <div class="report-field-picker-label">${t('rpt_label_history_months')}</div>
      <div class="report-size-group" id="report-inc-vol-months-group" style="flex-wrap:wrap">${monthBtns}</div>
      <div class="report-field-picker-label" style="margin-top:10px">${t('rpt_label_monthly_target')}</div>
      <input type="number" id="report-inc-vol-target" class="report-inc-months-input" min="0" max="9999" value="${S.incidentTarget}">`,
    onApply: _applyIncidentVolumePicker,
  });

  picker.addEventListener('click', e => {
    const opt = e.target.closest('#report-inc-vol-months-group .report-size-opt');
    if (!opt) return;
    picker.querySelectorAll('#report-inc-vol-months-group .report-size-opt').forEach(b => b.classList.remove('active'));
    opt.classList.add('active');
  });
}

function _applyIncidentVolumePicker() {
  const newMonths = parseInt(document.querySelector('#report-inc-vol-months-group .report-size-opt.active')?.dataset.months) || S.incidentMonths;
  const newTarget = Math.max(0, parseInt(document.getElementById('report-inc-vol-target')?.value) || 0);
  _closeFieldPicker();
  const monthsChanged = newMonths !== S.incidentMonths;
  S.incidentMonths = newMonths;
  S.incidentTarget = newTarget;
  _onSave();
  if (monthsChanged) _onLoad(); else _onRerender();
}

export function reportOpenIncidentGroupByPicker() {
  const selectOpts = [
    { val: 'cmdb_ci',         label: 'IC Afetado' },
    { val: 'resolution_code', label: 'Additional Resolution Code' },
  ].map(o => `<option value="${o.val}"${S.incidentGroupBy === o.val ? ' selected' : ''}>${o.label}</option>`).join('');

  _openPicker({
    title: t('rpt_title_cfg_groupby'),
    bodyHtml: `
      <div class="report-field-picker-label">${t('rpt_label_group_by')}</div>
      <select id="report-inc-groupby-sel" class="report-inc-months-sel" style="width:100%">${selectOpts}</select>`,
    onApply: _applyIncidentGroupByPicker,
  });
}

function _applyIncidentGroupByPicker() {
  const val = document.getElementById('report-inc-groupby-sel')?.value || S.incidentGroupBy;
  _closeFieldPicker();
  S.incidentGroupBy = val === 'resolution_code' ? 'resolution_code' : 'cmdb_ci';
  _onSave();
  _onRerender();
}

export function reportOpenHeatmapPicker() {
  _openPicker({
    title: t('rpt_title_cfg_heatmap'),
    bodyHtml: `
      <div class="report-field-picker-label">
        ${t('rpt_label_systems_disp')}
        <span style="font-weight:400;opacity:.7;display:block;font-size:11px;margin-top:2px">${t('rpt_heatmap_systems_hint')}</span>
      </div>
      <input type="number" id="report-heatmap-topn-input" class="report-inc-months-input" min="0" max="999" value="${S.heatmapTopN}" placeholder="9">
      <div class="report-field-picker-label" style="margin-top:12px">
        ${t('rpt_label_heatmap_max')}
        <span style="font-weight:400;opacity:.7;display:block;font-size:11px;margin-top:2px">${t('rpt_heatmap_hint')}</span>
      </div>
      <input type="number" id="report-heatmap-max-input" class="report-inc-months-input" min="0" max="999" value="${S.heatmapMax}" placeholder="0">`,
    onApply: _applyHeatmapPicker,
  });
}

function _applyHeatmapPicker() {
  S.heatmapTopN = Math.max(0, parseInt(document.getElementById('report-heatmap-topn-input')?.value) || 0);
  S.heatmapMax  = Math.max(0, parseInt(document.getElementById('report-heatmap-max-input')?.value)  || 0);
  _closeFieldPicker();
  _onSave();
  _onRerender();
}

export function reportOpenLocationPicker() {
  const monthOpts = [1, 3, 6].map(v =>
    `<button class="report-size-opt${S.locationMonths === v ? ' active' : ''}" data-locmonths="${v}">${v} ${v === 1 ? t('rpt_month') : t('rpt_months')}</button>`
  ).join('');

  const picker = _openPicker({
    title: t('rpt_title_cfg_location'),
    bodyHtml: `
      <div class="report-field-picker-label">${t('rpt_label_months_disp')}</div>
      <div class="report-size-group" id="report-loc-months-group">${monthOpts}</div>`,
    onApply: () => {
      const active = document.querySelector('#report-loc-months-group .report-size-opt.active');
      S.locationMonths = parseInt(active?.dataset.locmonths) || 6;
      _closeFieldPicker();
      _onSave();
      _onRerender();
    },
  });

  picker.addEventListener('click', e => {
    const opt = e.target.closest('.report-size-opt');
    if (!opt) return;
    picker.querySelectorAll('.report-size-opt').forEach(b => b.classList.remove('active'));
    opt.classList.add('active');
  });
}

export async function reportOpenAgingPicker(idx) {
  S.agingPickerIdx = idx ?? 0;

  const currentSize = S.agingCharts[S.agingPickerIdx]?.size || 'md';
  const sizeOpts = [
    { val: 'sm', get label() { return t('rpt_size_3col'); } },
    { val: 'md', get label() { return t('rpt_size_2col'); } },
    { val: 'lg', get label() { return t('rpt_size_full'); } },
  ].map(o => `<button class="report-size-opt${currentSize === o.val ? ' active' : ''}" data-size="${o.val}">${o.label}</button>`).join('');

  const picker = _openPicker({
    title: t('rpt_title_cfg_aging'),
    bodyHtml: `
      <div class="report-field-picker-label">${t('rpt_label_monitored_state')}</div>
      <select id="report-aging-state-sel" class="report-field-sel">
        <option value="${_esc(S.agingState)}">${_esc(S.agingState)}</option>
      </select>
      <div class="report-field-picker-label">${t('rpt_label_aging_buckets')}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
        <div><label style="font-size:11px;color:var(--text-faint)">${t('rpt_label_limit')} 1</label><br>
          <input type="number" id="report-aging-rb0" class="report-inc-months-input" style="width:100%;box-sizing:border-box" min="1" max="999" value="${S.agingBuckets[0]}"></div>
        <div><label style="font-size:11px;color:var(--text-faint)">${t('rpt_label_limit')} 2</label><br>
          <input type="number" id="report-aging-rb1" class="report-inc-months-input" style="width:100%;box-sizing:border-box" min="1" max="999" value="${S.agingBuckets[1]}"></div>
        <div><label style="font-size:11px;color:var(--text-faint)">${t('rpt_label_limit')} 3</label><br>
          <input type="number" id="report-aging-rb2" class="report-inc-months-input" style="width:100%;box-sizing:border-box" min="1" max="999" value="${S.agingBuckets[2]}"></div>
        <div><label style="font-size:11px;color:var(--text-faint)">${t('rpt_label_limit')} 4</label><br>
          <input type="number" id="report-aging-rb3" class="report-inc-months-input" style="width:100%;box-sizing:border-box" min="1" max="999" value="${S.agingBuckets[3]}"></div>
      </div>
      <div class="report-field-picker-label">${t('rpt_label_size')}</div>
      <div class="report-size-group" id="report-aging-size-group">${sizeOpts}</div>`,
    onApply: _applyAgingPicker,
  });

  picker.addEventListener('click', e => {
    const opt = e.target.closest('#report-aging-size-group .report-size-opt');
    if (!opt) return;
    picker.querySelectorAll('#report-aging-size-group .report-size-opt').forEach(b => b.classList.remove('active'));
    opt.classList.add('active');
  });

  try {
    const r    = await fetch('/api/us-states?' + new URLSearchParams({ project: S.reportProject }));
    const data = await r.json();
    const sel  = document.getElementById('report-aging-state-sel');
    if (sel && data.states?.length) {
      sel.innerHTML = data.states
        .map(s => `<option value="${_esc(s)}"${s === S.agingState ? ' selected' : ''}>${_esc(s)}</option>`)
        .join('');
    }
  } catch (_) {}
}

function _applyAgingPicker() {
  const sel      = document.getElementById('report-aging-state-sel');
  const newState = sel?.value || S.agingState;
  const newSize  = document.querySelector('#report-aging-size-group .report-size-opt.active')?.dataset.size
                || S.agingCharts[S.agingPickerIdx]?.size || 'md';
  const rb0 = Math.max(1, parseInt(document.getElementById('report-aging-rb0')?.value) || S.agingBuckets[0]);
  const rb1 = Math.max(rb0 + 1, parseInt(document.getElementById('report-aging-rb1')?.value) || S.agingBuckets[1]);
  const rb2 = Math.max(rb1 + 1, parseInt(document.getElementById('report-aging-rb2')?.value) || S.agingBuckets[2]);
  const rb3 = Math.max(rb2 + 1, parseInt(document.getElementById('report-aging-rb3')?.value) || S.agingBuckets[3]);
  const newBuckets = [rb0, rb1, rb2, rb3];
  _closeFieldPicker();

  const stateChanged   = newState !== S.agingState;
  const bucketsChanged = newBuckets.some((v, i) => v !== S.agingBuckets[i]);
  if (S.agingCharts[S.agingPickerIdx]) S.agingCharts[S.agingPickerIdx] = { size: newSize };
  if (stateChanged)   S.agingState   = newState;
  if (bucketsChanged) S.agingBuckets = newBuckets;

  _onSave();
  if (stateChanged) _onLoad();
  else _onRerender();
}

export async function reportOpenDeliveryStatesPicker() {
  _openPicker({
    title: t('rpt_title_delivery_states'),
    bodyHtml: `
      <div class="report-field-picker-desc" style="font-size:12px;color:var(--text-faint);margin-top:-6px">${t('rpt_delivery_states_desc')}</div>
      <div id="report-delivery-states-body"><div class="report-field-picker-loading">${t('rpt_loading_states')}</div></div>`,
    onApply: _applyDeliveryStatesPicker,
  });

  try {
    const r    = await fetch('/api/us-states?' + new URLSearchParams({ project: S.reportProject }));
    const data = await r.json();
    const body = document.getElementById('report-delivery-states-body');
    if (!body) return;
    const states = data.states?.length ? data.states : ['Closed', 'Done', 'Resolved', 'UAT', 'In Review'];
    body.innerHTML = `<div style="display:flex;flex-direction:column;gap:6px;max-height:240px;overflow-y:auto;padding:2px 0">` +
      states.map(s => {
        const checked = S.deliveryStates.includes(s) ? ' checked' : '';
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
  if (!selected.length) return;
  S.deliveryStates = selected;
  _onSave();
  _onLoad();
}

export function reportOpenSlaPicker() {
  _openPicker({
    title: t('rpt_title_cfg_sla'),
    bodyHtml: `
      <div style="font-size:12px;color:var(--text-faint);margin-bottom:14px;line-height:1.6">
        ${t('rpt_sla_desc_1')} <strong style="color:var(--text-1)">business_elapsed_percentage</strong> ${t('rpt_sla_desc_2')} <code>task_sla</code> ${t('rpt_sla_desc_3')}<br>
        ${t('rpt_sla_violated')}
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px">
        <input type="checkbox" id="report-sla-enabled-chk" style="width:15px;height:15px;accent-color:var(--c-blue);cursor:pointer" ${S.slaEnabled ? 'checked' : ''}>
        <label for="report-sla-enabled-chk" style="font-size:13px;color:var(--text-1);cursor:pointer;user-select:none">${t('rpt_label_show_sla')}</label>
      </div>
      <div style="font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:.04em">${t('rpt_label_sla_targets')}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:4px">
        <div>
          <label style="font-size:11px;color:var(--text-faint);display:block;margin-bottom:4px">${t('rpt_priority_p1')}</label>
          <div style="display:flex;align-items:center;gap:4px">
            <input type="number" id="report-sla-p1" min="0" max="100" value="${S.slaTargets.p1 ?? 95}" style="width:56px;padding:4px 6px;background:var(--bg-el);border:1px solid var(--border);border-radius:var(--r-sm);color:var(--text-1);font-size:13px;text-align:right">
            <span style="font-size:12px;color:var(--text-faint)">%</span>
          </div>
        </div>
        <div>
          <label style="font-size:11px;color:var(--text-faint);display:block;margin-bottom:4px">${t('rpt_priority_p2')}</label>
          <div style="display:flex;align-items:center;gap:4px">
            <input type="number" id="report-sla-p2" min="0" max="100" value="${S.slaTargets.p2 ?? 90}" style="width:56px;padding:4px 6px;background:var(--bg-el);border:1px solid var(--border);border-radius:var(--r-sm);color:var(--text-1);font-size:13px;text-align:right">
            <span style="font-size:12px;color:var(--text-faint)">%</span>
          </div>
        </div>
        <div>
          <label style="font-size:11px;color:var(--text-faint);display:block;margin-bottom:4px">${t('rpt_priority_p3')}</label>
          <div style="display:flex;align-items:center;gap:4px">
            <input type="number" id="report-sla-p3" min="0" max="100" value="${S.slaTargets.p3 ?? 85}" style="width:56px;padding:4px 6px;background:var(--bg-el);border:1px solid var(--border);border-radius:var(--r-sm);color:var(--text-1);font-size:13px;text-align:right">
            <span style="font-size:12px;color:var(--text-faint)">%</span>
          </div>
        </div>
      </div>`,
    onApply: _applySlaPicker,
  });
}

async function _applySlaPicker() {
  const enabled = document.getElementById('report-sla-enabled-chk')?.checked ?? false;
  const clamp   = v => Math.min(100, Math.max(0, parseInt(v) || 0));
  const p1 = clamp(document.getElementById('report-sla-p1')?.value);
  const p2 = clamp(document.getElementById('report-sla-p2')?.value);
  const p3 = clamp(document.getElementById('report-sla-p3')?.value);
  _closeFieldPicker();
  S.slaEnabled  = enabled;
  S.slaTargets  = { p1, p2, p3 };
  await fetch('/api/sn-config', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ project: S.reportProject, slaEnabled: enabled }),
  }).catch(() => {});
  _onSave();
  _onRerender();
}

// ── Incidents backlog modal ───────────────────────────────────────────────────

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
  const csv = '﻿' + csvRows.map(r => r.join(';')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `incidentes_${S.reportProject || 'export'}_${S.reportMonth || ''}.csv`;
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
    return `<th><input type="text" data-col="${ci}" placeholder="⌕" title="${t('rpt_search_field')}"></th>`;
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
      body.innerHTML = `<div class="report-inc-modal-count">${incidents.length} ${incidents.length !== 1 ? t('rpt_inc_count_p') : t('rpt_inc_count_s')}</div>${_buildIncidentsTable(incidents)}`;
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
  const params = new URLSearchParams({ project: S.reportProject, month, mode, filterField, filterValue });
  _showIncidentsModal(title || 'Incidentes', params.toString());
}

export async function reportOpenIncidentsModal() {
  const params = new URLSearchParams({ project: S.reportProject, month: S.reportMonth || '', mode: 'backlog', filterField: '', filterValue: '' });
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
        value="${S.incidentTarget ?? ''}">
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
    S.incidentTarget = val;
    _onSave();
    _onRerender();
  }
  document.getElementById('inc-target-modal')?.remove();
}

export async function exportReportHtml() {
  const body = document.getElementById('report-modal-body');
  if (!body || !body.innerHTML.trim()) return;

  const project  = S.reportProject || '';
  const month    = S.reportMonth   || '';
  const theme    = document.documentElement.getAttribute('data-theme') || 'dark';
  const safeName = project.replace(/[^a-zA-Z0-9]/g, '-');
  const title    = `Review Mensal — ${project}${month ? ' — ' + month : ''}`;
  const now      = new Date().toLocaleString('pt-BR');

  const css = await fetch('/style.css').then(r => r.text()).catch(() => '');

  const clone = body.cloneNode(true);
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

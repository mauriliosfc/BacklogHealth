import { t, getDateLocale } from './i18n.js';
import { getAlias } from './alias.js';

const LABEL_W = 140; // px — largura fixa da coluna de label (sticky)

// ── Estado do módulo ──────────────────────────────────────────────────────────
let _dpTooltip = null;

// ── View switching ────────────────────────────────────────────────────────────
function _setSidebarActive(id) {
  document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
  document.getElementById(id)?.classList.add('active');
}

export function openDeliveryPlan() {
  document.getElementById('content')?.style.setProperty('display', 'none');
  document.querySelector('.cards-toolbar')?.style.setProperty('display', 'none');
  document.getElementById('tc-view').style.display = 'none';
  document.getElementById('dp-view').style.display = 'flex';
  _setSidebarActive('sidebar-link-dp');
  _renderContent();
}

function _renderContent() {
  const cards = Array.from(document.querySelectorAll('#content .card[data-project]'));
  const bodyEl = document.getElementById('delivery-body');
  if (!cards.length) {
    bodyEl.innerHTML = '<p style="color:#64748b;padding:32px;text-align:center">' + t('dp_no_data') + '</p>';
    return;
  }

  const projects = cards.map(card => {
    const name    = card.dataset.project;
    const label   = getAlias(name);
    const iterMap = (() => { try { return JSON.parse(card.dataset.itermap || '{}'); } catch (_) { return {}; } })();
    const saved   = localStorage.getItem('filter_' + name);
    const selectedSprints = saved ? JSON.parse(saved) : [];
    const hbar    = card.querySelector('.health-hbar');
    const healthCls = hbar
      ? (hbar.classList.contains('red') ? 'red' : hbar.classList.contains('yellow') ? 'yellow' : hbar.classList.contains('green') ? 'green' : 'gray')
      : 'gray';
    return { name, label, iterMap, selectedSprints, healthCls };
  }).filter(p => Object.values(p.iterMap).some(v => v.start && v.end));

  if (!projects.length) {
    bodyEl.innerHTML = '<p style="color:#64748b;padding:32px;text-align:center">' + t('dp_no_data') + '</p>';
  } else {
    bodyEl.innerHTML = buildDeliveryPlan(projects);
    requestAnimationFrame(dpPositionHoje);
  }
}

// ── Visibilidade de linhas ────────────────────────────────────────────────────
export function dpToggleRow(id) {
  const row = document.getElementById('dp-row-' + id);
  if (row) row.classList.toggle('dp-row-hidden');
}

export function dpSelectAll() {
  document.querySelectorAll('#delivery-body input[type="checkbox"]').forEach(cb => {
    cb.checked = true;
    const row = document.getElementById('dp-row-' + cb.id.replace('dp-chk-', ''));
    if (row) row.classList.remove('dp-row-hidden');
  });
}

export function dpClearAll() {
  document.querySelectorAll('#delivery-body input[type="checkbox"]').forEach(cb => {
    cb.checked = false;
    const row = document.getElementById('dp-row-' + cb.id.replace('dp-chk-', ''));
    if (row) row.classList.add('dp-row-hidden');
  });
}

// ── Tooltip ───────────────────────────────────────────────────────────────────
export function dpShowTooltip(e, bar) {
  _dpTooltip = document.getElementById('dp-tooltip');
  if (!_dpTooltip) return;
  const status = bar.dataset.ttStatus || '';
  const cls = status === 'Concluido' ? 'dp-tt-past' : status === 'Em andamento' ? 'dp-tt-curr' : 'dp-tt-future';
  _dpTooltip.innerHTML =
    '<div class="dp-tt-title">' + (bar.dataset.ttTitle || '') + '</div>' +
    '<div class="dp-tt-row"><span class="dp-tt-key">Periodo</span><span class="dp-tt-val">' + (bar.dataset.ttPeriod || '') + '</span></div>' +
    '<span class="dp-tt-badge ' + cls + '">' + status + '</span>';
  _dpTooltip.classList.add('dp-tt-visible');
  dpMoveTooltip(e);
}

export function dpMoveTooltip(e) {
  if (!_dpTooltip) return;
  const x = e.clientX + 14, y = e.clientY + 14;
  const tw = _dpTooltip.offsetWidth, th = _dpTooltip.offsetHeight;
  const vw = window.innerWidth,      vh = window.innerHeight;
  _dpTooltip.style.left = (x + tw > vw - 8 ? x - tw - 20 : x) + 'px';
  _dpTooltip.style.top  = (y + th > vh - 8 ? y - th - 20 : y) + 'px';
}

export function dpHideTooltip() {
  if (_dpTooltip) _dpTooltip.classList.remove('dp-tt-visible');
}

// ── Posicionamento da linha HOJE ──────────────────────────────────────────────
export function dpPositionHoje() {
  const hojeEl    = document.getElementById('dp-hoje-line');
  const ganttRows = document.getElementById('dp-gantt-rows');
  if (!hojeEl || !ganttRows) return;
  const fraction = parseFloat(hojeEl.dataset.fraction || '0');
  const barsW    = ganttRows.offsetWidth - LABEL_W;
  hojeEl.style.left    = (LABEL_W + fraction * barsW) + 'px';
  hojeEl.style.opacity = '1';
}

// ── Eventos globais ───────────────────────────────────────────────────────────

window.addEventListener('resize', dpPositionHoje);

// ── Builder ───────────────────────────────────────────────────────────────────
function buildDeliveryPlan(projects) {
  const now        = new Date();
  const dateLocale = getDateLocale();
  const fmtShort   = d => d.toLocaleDateString(dateLocale, { day: '2-digit', month: '2-digit' });

  // 1. Sprints por projeto (respeitando filtro do dashboard)
  const projData = projects.map(p => {
    const sprints = Object.entries(p.iterMap)
      .filter(([key, v]) => v.start && v.end && (p.selectedSprints.length === 0 || p.selectedSprints.includes(key)))
      .map(([key, v]) => {
        const label = key.includes('\\') ? key.split('\\').pop() : key;
        return { label, start: new Date(v.start), end: new Date(v.end), isCurrent: !!v.isCurrent };
      })
      .sort((a, b) => a.start - b.start);
    return { ...p, sprints };
  }).filter(p => p.sprints.length > 0);

  if (!projData.length) {
    return '<p style="color:#64748b;padding:32px;text-align:center">' + t('dp_no_data') + '</p>';
  }

  // 2. Range global de datas (direto das sprints de cada projeto)
  let globalMin = null, globalMax = null;
  projData.forEach(p => p.sprints.forEach(s => {
    if (!globalMin || s.start < globalMin) globalMin = new Date(s.start);
    if (!globalMax || s.end   > globalMax) globalMax = new Date(s.end);
  }));
  const totalMs = Math.max(1, globalMax - globalMin);

  // 3. Fração da data de hoje
  const todayFrac = Math.min(1, Math.max(0, (now - globalMin) / totalMs));
  const showToday = now >= globalMin && now <= globalMax;

  // 4. Header de meses (células flex proporcionais às datas)
  const months = [];
  const mc = new Date(globalMin.getFullYear(), globalMin.getMonth(), 1);
  while (mc <= globalMax) {
    const mStart = new Date(Math.max(+globalMin, +mc));
    const nextM  = new Date(mc.getFullYear(), mc.getMonth() + 1, 1);
    const mEnd   = new Date(Math.min(+globalMax, +nextM));
    months.push({
      label: mc.toLocaleDateString(dateLocale, { month: 'short', year: '2-digit' }),
      pctW:  (mEnd - mStart) / totalMs * 100,
    });
    mc.setMonth(mc.getMonth() + 1);
  }

  const minTrackW  = Math.max(600, months.length * 90);
  const monthRowHTML = months.map(m =>
    '<div class="dp-month-cell" style="width:' + m.pctW.toFixed(3) + '%">' + m.label + '</div>'
  ).join('');

  // 5. Linhas dos projetos — barras com position:absolute baseado em datas reais
  const healthLabels = { red: 'Critico', yellow: 'Atencao', green: 'Saudavel' };
  const avatarClsMap = { red: 'dp-avatar-red', yellow: 'dp-avatar-yellow', green: 'dp-avatar-green' };

  const rowsHTML = projData.map(p => {
    const healthLabel = healthLabels[p.healthCls] || '';

    const barsHTML = p.sprints.map(s => {
      const left  = ((s.start - globalMin) / totalMs * 100).toFixed(3);
      const width = ((s.end   - s.start)   / totalMs * 100).toFixed(3);
      const st = s.end < now ? 'past'
        : (s.isCurrent || (s.start <= now && s.end >= now)) ? 'curr'
        : 'future';

      const ttTitle  = s.label + ' — ' + p.label;
      const ttPeriod = fmtShort(s.start) + ' – ' + fmtShort(s.end);
      const ttStatus = { past: 'Concluido', curr: 'Em andamento', future: 'Planejado' }[st];
      const check    = st === 'past' ? '<span class="dp-bar-check" aria-label="Concluido">&#10003;</span>' : '';

      return '<div class="dp-sprint-bar dp-bar-' + st + '"' +
        ' style="left:' + left + '%;width:' + width + '%"' +
        ' data-tt-title="' + ttTitle.replace(/"/g, '&quot;') + '"' +
        ' data-tt-period="' + ttPeriod + '"' +
        ' data-tt-status="' + ttStatus + '"' +
        ' onmouseenter="dpShowTooltip(event,this)" onmousemove="dpMoveTooltip(event)" onmouseleave="dpHideTooltip()">' +
        '<span class="dp-bar-label">' + s.label + '</span>' +
        '<span class="dp-bar-sub">' + fmtShort(s.start) + ' – ' + fmtShort(s.end) + '</span>' +
        check +
      '</div>';
    }).join('');

    const safeId = p.name.replace(/[^a-zA-Z0-9]/g, '_');

    return '<div class="dp-gantt-row" id="dp-row-' + safeId + '">' +
      '<div class="dp-label-col dp-row-label-inner">' +
        '<span class="dp-row-name" title="' + p.label.replace(/"/g, '&quot;') + '">' + p.label + '</span>' +
        (healthLabel ? '<span class="dp-health-pill ' + (p.healthCls || 'gray') + '">' + healthLabel + '</span>' : '') +
      '</div>' +
      '<div class="dp-bars-container">' + barsHTML + '</div>' +
    '</div>';
  }).join('');

  // 6. Painel lateral
  const avatarClsMapLocal = avatarClsMap;
  const sideProjectsHTML = projData.map(p => {
    const safeId    = p.name.replace(/[^a-zA-Z0-9]/g, '_');
    const safeVal   = p.name.replace(/"/g, '&quot;');
    const avatarText = (p.label || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '??';
    const avatarCls  = avatarClsMapLocal[p.healthCls] || 'dp-avatar-gray';
    return '<label class="dp-project-check" for="dp-chk-' + safeId + '">' +
      '<input type="checkbox" id="dp-chk-' + safeId + '" value="' + safeVal + '" checked onchange="dpToggleRow(\'' + safeId + '\')">' +
      '<span class="dp-avatar ' + avatarCls + '">' + avatarText + '</span>' +
      '<span class="dp-project-name">' + p.label + '</span>' +
    '</label>';
  }).join('');

  const sidebarHTML =
    '<aside class="dp-sidebar">' +
      '<div class="dp-side-label">Projetos</div>' +
      '<div class="dp-side-actions">' +
        '<button class="dp-btn-link" type="button" onclick="dpSelectAll()">Selecionar todos</button>' +
        '<button class="dp-btn-link" type="button" onclick="dpClearAll()">Limpar</button>' +
      '</div>' +
      sideProjectsHTML +
      '<div class="dp-side-divider"></div>' +
      '<div class="dp-side-label">Legenda</div>' +
      '<div class="dp-legend-item"><span class="dp-leg-swatch dp-swatch-past"></span>Passado</div>' +
      '<div class="dp-legend-item"><span class="dp-leg-swatch dp-swatch-curr"></span>Atual</div>' +
      '<div class="dp-legend-item"><span class="dp-leg-swatch dp-swatch-future"></span>Futuro</div>' +
      (showToday ? '<div class="dp-legend-hoje"><span class="dp-swatch-hoje"></span>Hoje</div>' : '') +
    '</aside>';

  // 7. Linha HOJE
  const hojeHTML = showToday
    ? '<div class="dp-hoje-line" id="dp-hoje-line" data-fraction="' + todayFrac.toFixed(6) + '"><span class="dp-hoje-label">HOJE</span></div>'
    : '';

  // 8. Painel de timeline
  const timelineHTML =
    '<div class="dp-timeline">' +
      '<div class="dp-timeline-scroll">' +
        '<div class="dp-timeline-inner" style="min-width:' + (LABEL_W + minTrackW) + 'px">' +
          '<div class="dp-tl-header">' +
            '<div class="dp-month-row">' +
              '<div class="dp-label-col dp-hd-spacer"></div>' +
              '<div class="dp-month-track">' + monthRowHTML + '</div>' +
            '</div>' +
          '</div>' +
          '<div class="dp-gantt-rows" id="dp-gantt-rows">' +
            hojeHTML +
            rowsHTML +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';

  return '<div class="dp-layout">' + sidebarHTML + timelineHTML + '</div>' +
         '<div class="dp-tooltip" id="dp-tooltip"></div>';
}

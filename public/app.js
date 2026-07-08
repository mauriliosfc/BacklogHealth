import { initFilters, toggleDropdown, onCheckChange, clearFilter, applyFilter, toggleUS, initHealthBadges, openCardStat } from './modules/filters.js';
import { setThresholds } from './modules/health.js';
import { openHealthConfig, closeHealthConfig, saveHealthConfigModal } from './modules/healthConfig.js';
import { startTimer, doRefresh } from './modules/timer.js';
import { setTheme, toggleTheme } from './modules/theme.js';
import { openDetails, closeDetails, closeDetailsBtn, toggleMaximize, loadDetailData, _detailState, editOrigEst, openDetailStat } from './modules/detail.js';
import { openDaily, openDailyForProject, closeDaily, toggleDailyMaximize, dailyPrev, dailyNext, handleDailyKey, openDailyForSprint, filterDailyItems, openDailyStat, refreshDaily } from './modules/daily.js';
import { closeItemsModal, closeItemsModalOverlay, toggleItemsFilter, clearItemsFilter, toggleItemsModalMax, toggleItemsFilterDropdown } from './modules/itemsModal.js';
import { openBurndown, closeBurndown, closeBurndownOverlay, toggleBurndownMaximize, openBurndownFromDaily, bdTip, bdTipHide } from './modules/burndown.js';
import { initI18n, applyTranslations, setLocale, getLocale } from './modules/i18n.js';
import { openDeliveryPlan, dpToggleRow, dpSelectAll, dpClearAll, dpShowTooltip, dpMoveTooltip, dpHideTooltip, dpPositionHoje } from './modules/deliveryPlan.js';
import { openCopilot, closeCopilotConfig, closeCopilotConfigOverlay, testCopilotConnection, saveCopilotConfig, openCopilotChat, closeCopilotChat, closeCopilotChatOverlay, toggleCopilotChatMaximize, toggleCopilotMinimize, toggleCopilotMaximize, clearCopilotChat, confirmClearCopilot, hideCopilotConfirm, copilotFabClick, openCopilotSettings, copilotInputKeydown, sendCopilotMessage, openCopilotWithContext } from './modules/copilot.js';
import { getAlias, applyAliases, startRename } from './modules/alias.js';
import { applyOrder, initDragOrder } from './modules/cardOrder.js';
import { openTeamCapacity, showDashboardView, tcRefresh, tcChangeProject } from './modules/teamCapacity.js';
import { openFeedback, closeFeedback, closeFeedbackOverlay, submitFeedback, openFeedbackSuccess, closeFeedbackSuccess, closeFeedbackSuccessOverlay } from './modules/feedback.js';
import { openUAT, closeUAT, closeUATOverlay, toggleUATMax, refreshUAT, uatChangeSprint, uatTogglePlan, uatFilterPlan, uatClearPlanFilter, uatFilterPlanPrio, uatClearPlanPrioFilter } from './modules/uat.js';
import { openReport, closeReport, closeReportOverlay, toggleReportMax, reportChangeMonth, reportRefresh, reportOpenFieldPicker, reportAddChart, reportRemoveChart, reportResizeChart, reportDragStart, reportDragOver, reportDragLeave, reportDrop, reportDragEnd, openReportSnConfig, reportOpenAgingPicker, reportOpenIncidentVolumePicker, reportOpenIncidentGroupByPicker, reportOpenHeatmapPicker, reportOpenLocationPicker, reportSaveNotes, reportOpenDeliveryStatesPicker, reportOpenSlaPicker, reportOpenIncidentsModal, reportCloseIncidentsModal, reportOpenCopilot, reportOpenIncidentFilter, reportExportIncidentsCSV, openIncidentsForGroup, toggleReportIncMax, exportReportHtml, reportOpenIndicatorConfig, reportCloseIndicatorConfig, reportToggleIndicator, reportSetCardsPerRow, reportIndDragStart, reportIndDragOver, reportIndDragLeave, reportIndDrop, reportIndDragEnd, reportRemoveIncChart, reportIncChartDragStart, reportIncChartDragOver, reportIncChartDragLeave, reportIncChartDrop, reportIncChartDragEnd, reportAddIncChart, reportOpenIncChartPicker, reportRemovePrbChart, reportPrbChartDragStart, reportPrbChartDragOver, reportPrbChartDragLeave, reportPrbChartDrop, reportPrbChartDragEnd, reportAddPrbChart, reportOpenPrbChartPicker, reportSetSectionFilter, reportOpenTargetModal, reportSaveTargetModal } from './modules/report.js';
import { openSnConfig, closeSnConfig, closeSnConfigOverlay, snConfigTest, snConfigSaveGlobal, snConfigSaveProject } from './modules/snConfig.js';
import { initUpdater, updDownload, updInstall, updDismiss } from './modules/updater.js';
import { toggleSource } from './modules/sourceToggle.js';

// Expor funções ao window para inline handlers no HTML
window.toggleTheme       = toggleTheme;
window.doRefresh         = doRefresh;
window.toggleDropdown    = toggleDropdown;
window.onCheckChange     = onCheckChange;
window.clearFilter       = clearFilter;
window.toggleUS          = toggleUS;
window.openCardStat      = openCardStat;
window.openDetails       = openDetails;
window.closeDetails      = closeDetails;
window.closeDetailsBtn   = closeDetailsBtn;
window.toggleMaximize    = toggleMaximize;
window.loadDetailData    = (p, s) => loadDetailData(p !== undefined ? p : _detailState.project, s !== undefined ? s : _detailState.sprints);
window.editOrigEst       = editOrigEst;
window.openDetailStat    = openDetailStat;
// Expose state refs for inline HTML handlers
Object.defineProperty(window, '_detailProject', { get: () => _detailState.project });
Object.defineProperty(window, '_detailSprints',  { get: () => _detailState.sprints });
window.openDaily            = openDaily;
window.openDailyForProject  = openDailyForProject;
window.openDailyForSprint   = openDailyForSprint;
window.closeDaily        = closeDaily;
window.toggleDailyMaximize = toggleDailyMaximize;
window.dailyPrev         = dailyPrev;
window.dailyNext         = dailyNext;
window.handleDailyKey    = handleDailyKey;
window.filterDailyItems      = filterDailyItems;
window.openDailyStat         = openDailyStat;
window.refreshDaily          = refreshDaily;
window.closeItemsModal        = closeItemsModal;
window.closeItemsModalOverlay = closeItemsModalOverlay;
window.toggleItemsFilter      = toggleItemsFilter;
window.clearItemsFilter       = clearItemsFilter;
window.toggleItemsModalMax       = toggleItemsModalMax;
window.toggleItemsFilterDropdown = toggleItemsFilterDropdown;
window.openSNGroupIncidents = function(btn) {
  const card = btn.closest('.sn-inc-card');
  if (!card) return;
  const groupName = card.dataset.group || card.querySelector('.sn-inc-group-name')?.textContent || '';
  openIncidentsForGroup(groupName);
};
window.openBurndown           = openBurndown;
window.closeBurndown          = closeBurndown;
window.closeBurndownOverlay   = closeBurndownOverlay;
window.toggleBurndownMaximize = toggleBurndownMaximize;
window.openBurndownFromDaily  = openBurndownFromDaily;
window.bdTip                  = bdTip;
window.bdTipHide              = bdTipHide;
window.setLocale              = setLocale;
window.openDeliveryPlan = openDeliveryPlan;
window.dpToggleRow      = dpToggleRow;
window.dpSelectAll                = dpSelectAll;
window.dpClearAll                 = dpClearAll;
window.dpShowTooltip              = dpShowTooltip;
window.dpMoveTooltip              = dpMoveTooltip;
window.dpHideTooltip              = dpHideTooltip;
window.dpPositionHoje             = dpPositionHoje;
window.openCopilot              = openCopilot;
window.closeCopilotConfig       = closeCopilotConfig;
window.closeCopilotConfigOverlay = closeCopilotConfigOverlay;
window.testCopilotConnection    = testCopilotConnection;
window.saveCopilotConfig        = saveCopilotConfig;
window.openCopilotChat          = openCopilotChat;
window.closeCopilotChat         = closeCopilotChat;
window.closeCopilotChatOverlay  = closeCopilotChatOverlay;
window.toggleCopilotChatMaximize = toggleCopilotChatMaximize;
window.toggleCopilotMinimize     = toggleCopilotMinimize;
window.toggleCopilotMaximize     = toggleCopilotMaximize;
window.clearCopilotChat          = clearCopilotChat;
window.confirmClearCopilot       = confirmClearCopilot;
window.hideCopilotConfirm        = hideCopilotConfirm;
window.copilotFabClick           = copilotFabClick;
window.openCopilotSettings      = openCopilotSettings;
window.copilotInputKeydown      = copilotInputKeydown;
window.sendCopilotMessage        = sendCopilotMessage;
window.openCopilotWithContext    = openCopilotWithContext;
window.startRename               = startRename;
window.openTeamCapacity  = openTeamCapacity;
window.showDashboardView = showDashboardView;
window.tcRefresh         = tcRefresh;
window.tcChangeProject   = tcChangeProject;
window.openFeedback                 = openFeedback;
window.closeFeedback                = closeFeedback;
window.closeFeedbackOverlay         = closeFeedbackOverlay;
window.submitFeedback               = submitFeedback;
window.openFeedbackSuccess          = openFeedbackSuccess;
window.closeFeedbackSuccess         = closeFeedbackSuccess;
window.closeFeedbackSuccessOverlay  = closeFeedbackSuccessOverlay;
window.openUAT           = openUAT;
window.closeUAT          = closeUAT;
window.closeUATOverlay   = closeUATOverlay;
window.toggleUATMax      = toggleUATMax;
window.refreshUAT        = refreshUAT;
window.uatChangeSprint   = uatChangeSprint;
window.uatTogglePlan          = uatTogglePlan;
window.uatFilterPlan          = uatFilterPlan;
window.uatClearPlanFilter     = uatClearPlanFilter;
window.uatFilterPlanPrio      = uatFilterPlanPrio;
window.uatClearPlanPrioFilter = uatClearPlanPrioFilter;
window.openReport            = openReport;
window.closeReport           = closeReport;
window.closeReportOverlay    = closeReportOverlay;
window.toggleReportMax       = toggleReportMax;
window.reportChangeMonth     = reportChangeMonth;
window.reportRefresh         = reportRefresh;
window.reportOpenFieldPicker = reportOpenFieldPicker;
window.reportAddChart        = reportAddChart;
window.reportRemoveChart     = reportRemoveChart;
window.reportResizeChart     = reportResizeChart;
window.reportDragStart       = reportDragStart;
window.reportDragOver        = reportDragOver;
window.reportDragLeave       = reportDragLeave;
window.reportDrop            = reportDrop;
window.reportDragEnd            = reportDragEnd;
window.reportOpenIncidentGroupByPicker = reportOpenIncidentGroupByPicker;
window.reportOpenHeatmapPicker         = reportOpenHeatmapPicker;
window.reportOpenLocationPicker        = reportOpenLocationPicker;
window.reportSaveNotes                 = reportSaveNotes;
window.reportSetSectionFilter          = reportSetSectionFilter;
window.reportOpenDeliveryStatesPicker  = reportOpenDeliveryStatesPicker;
window.reportOpenSlaPicker             = reportOpenSlaPicker;
window.reportOpenIncidentsModal        = reportOpenIncidentsModal;
window.reportCloseIncidentsModal       = reportCloseIncidentsModal;
window.reportOpenIncidentFilter        = reportOpenIncidentFilter;
window.reportExportIncidentsCSV        = reportExportIncidentsCSV;
window.toggleReportIncMax              = toggleReportIncMax;
window.reportOpenCopilot               = reportOpenCopilot;
window.exportReportHtml                = exportReportHtml;
window.reportOpenIndicatorConfig       = reportOpenIndicatorConfig;
window.reportCloseIndicatorConfig      = reportCloseIndicatorConfig;
window.reportToggleIndicator           = reportToggleIndicator;
window.reportSetCardsPerRow            = reportSetCardsPerRow;
window.reportIndDragStart              = reportIndDragStart;
window.reportIndDragOver               = reportIndDragOver;
window.reportIndDragLeave              = reportIndDragLeave;
window.reportIndDrop                   = reportIndDrop;
window.reportIndDragEnd                = reportIndDragEnd;
window.reportOpenAgingPicker          = reportOpenAgingPicker;
window.reportOpenIncidentVolumePicker = reportOpenIncidentVolumePicker;
window.reportRemoveIncChart       = reportRemoveIncChart;
window.reportIncChartDragStart    = reportIncChartDragStart;
window.reportIncChartDragOver     = reportIncChartDragOver;
window.reportIncChartDragLeave    = reportIncChartDragLeave;
window.reportIncChartDrop         = reportIncChartDrop;
window.reportIncChartDragEnd      = reportIncChartDragEnd;
window.reportAddIncChart          = reportAddIncChart;
window.reportOpenIncChartPicker   = reportOpenIncChartPicker;
window.reportRemovePrbChart       = reportRemovePrbChart;
window.reportPrbChartDragStart    = reportPrbChartDragStart;
window.reportPrbChartDragOver     = reportPrbChartDragOver;
window.reportPrbChartDragLeave    = reportPrbChartDragLeave;
window.reportPrbChartDrop         = reportPrbChartDrop;
window.reportPrbChartDragEnd      = reportPrbChartDragEnd;
window.reportAddPrbChart          = reportAddPrbChart;
window.reportOpenPrbChartPicker   = reportOpenPrbChartPicker;
window.reportOpenTargetModal      = reportOpenTargetModal;
window.reportSaveTargetModal      = reportSaveTargetModal;
window.openReportSnConfig    = openReportSnConfig;
window.openSnConfig          = openSnConfig;
window.closeSnConfig         = closeSnConfig;
window.closeSnConfigOverlay  = closeSnConfigOverlay;
window.snConfigTest          = snConfigTest;
window.snConfigSaveGlobal    = snConfigSaveGlobal;
window.snConfigSaveProject   = snConfigSaveProject;
window.openHealthConfig      = openHealthConfig;
window.closeHealthConfig     = closeHealthConfig;
window.saveHealthConfigModal = saveHealthConfigModal;
window.updDownload           = updDownload;
window.updInstall            = updInstall;
window.updDismiss            = updDismiss;
window.toggleSource          = toggleSource;

let _activeHealthFilter = 'all';
window.toggleHealthFilter = function(chip) {
  document.querySelectorAll('#health-filter-row .fchip').forEach(c => c.classList.remove('active'));
  chip.classList.add('active');
  _activeHealthFilter = chip.dataset.health || 'all';
  window.reapplyHealthFilter();
};
window.reapplyHealthFilter = function() {
  document.querySelectorAll('#content .card[data-project]').forEach(card => {
    if (_activeHealthFilter === 'all') {
      card.style.display = '';
    } else {
      const hbar = card.querySelector('.health-hbar');
      card.style.display = (hbar && hbar.classList.contains(_activeHealthFilter)) ? '' : 'none';
    }
  });
};

window.toggleCardMore = function(btn) {
  const wrap  = btn.closest('.more-wrap');
  const panel = wrap?.querySelector('.more-panel');
  if (!panel) return;
  const isOpen = panel.classList.toggle('open');
  if (isOpen) {
    document.querySelectorAll('.more-panel.open').forEach(p => { if (p !== panel) p.classList.remove('open'); });
  }
};

document.addEventListener('click', e => {
  if (!e.target.closest('.more-wrap')) {
    document.querySelectorAll('.more-panel.open').forEach(p => p.classList.remove('open'));
  }
});

let _removeCard = null;

window.removeProject = function(btn) {
  _removeCard = btn.closest('.card');
  const project = _removeCard.dataset.project;
  const alias = getAlias(project);
  document.getElementById('confirm-remove-name').textContent = alias;
  document.getElementById('confirm-remove-modal').classList.add('open');
  document.body.style.overflow = 'hidden';
};

window.cancelRemoveProject = function(e) {
  if (e && e.target !== document.getElementById('confirm-remove-modal')) return;
  document.getElementById('confirm-remove-modal').classList.remove('open');
  document.body.style.overflow = '';
  _removeCard = null;
};

window.confirmRemoveProject = async function() {
  if (!_removeCard) return;
  const card = _removeCard;
  const project = card.dataset.project;
  const btn = card.querySelector('.btn-remove-project');
  document.getElementById('confirm-remove-modal').classList.remove('open');
  document.body.style.overflow = '';
  _removeCard = null;
  if (btn) btn.disabled = true;
  try {
    const r = await fetch('/api/remove-project', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project }),
    });
    if (r.ok) card.remove();
    else if (btn) btn.disabled = false;
  } catch(e) {
    console.error(e);
    if (btn) btn.disabled = false;
  }
};

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.getElementById('confirm-remove-modal').classList.contains('open')) {
    cancelRemoveProject();
  }
});

// ── View toggle (grid / list) — DevOps only ──────────────────────────────────
function _isSNContent() {
  const c = document.getElementById('content');
  return c && c.classList.contains('sn-content');
}

function _applyView(mode) {
  const content = document.getElementById('content');
  if (!content || _isSNContent()) return; // skip for SN dashboard
  const iconGrid = document.getElementById('iconViewGrid');
  const iconList = document.getElementById('iconViewList');
  if (mode === 'list') {
    content.className = content.className.replace('cards-grid', 'cards-list');
    if (iconGrid) iconGrid.style.display = 'none';
    if (iconList) iconList.style.display = '';
  } else {
    content.className = content.className.replace('cards-list', 'cards-grid');
    if (iconGrid) iconGrid.style.display = '';
    if (iconList) iconList.style.display = 'none';
  }
}

window.toggleView = function() {
  const content = document.getElementById('content');
  if (!content) return;
  const isGrid = content.classList.contains('cards-grid');
  const next = isGrid ? 'list' : 'grid';
  localStorage.setItem('dashView', next);
  _applyView(next);
};

// ── SN view toggle (grid / list) ─────────────────────────────────────────────
function _applySnView(mode) {
  const content = document.getElementById('content');
  if (!content || !_isSNContent()) return;
  const iconGrid = document.getElementById('iconViewGrid');
  const iconList = document.getElementById('iconViewList');
  if (mode === 'list') {
    content.classList.add('sn-view-list');
    if (iconGrid) iconGrid.style.display = 'none';
    if (iconList) iconList.style.display = '';
  } else {
    content.classList.remove('sn-view-list');
    if (iconGrid) iconGrid.style.display = '';
    if (iconList) iconList.style.display = 'none';
  }
}

window.toggleSnView = function() {
  const content = document.getElementById('content');
  if (!content) return;
  const isList = content.classList.contains('sn-view-list');
  const next = isList ? 'grid' : 'list';
  localStorage.setItem('snView', next);
  _applySnView(next);
};

window.hideSNGroup = function(btn) {
  const card = btn.closest('.sn-inc-card');
  if (!card) return;
  card.style.transition = 'opacity .2s';
  card.style.opacity = '0';
  setTimeout(() => card.remove(), 200);
};

window.reapplySnDismissed = function() {
  if (localStorage.getItem('sn-az-banner-dismissed') === '1') {
    const b = document.getElementById('snAzBanner');
    if (b) b.style.display = 'none';
  }
  if (localStorage.getItem('sn-az-cta-dismissed') === '1') {
    const c = document.getElementById('snAzCta');
    if (c) c.style.display = 'none';
  }
};

window.toggleSidebar = function() {
  const collapsed = document.body.classList.toggle('sidebar-collapsed');
  localStorage.setItem('sidebarCollapsed', collapsed ? '1' : '');
};

// Inicialização
initUpdater();
setTheme(localStorage.getItem('theme') || 'dark');
if (localStorage.getItem('sidebarCollapsed')) document.body.classList.add('sidebar-collapsed');
await initI18n();
applyTranslations();
fetch('/api/health-config').then(r => r.json()).then(setThresholds).catch(() => {});
initFilters();
initHealthBadges();
applyOrder();
applyAliases();
initDragOrder();
_applyView(localStorage.getItem('dashView') || 'grid');
_applySnView(localStorage.getItem('snView') || 'grid');
startTimer();

// Restaura a view ativa após reload (ex: troca de idioma)
if (localStorage.getItem('activeView') === 'tc') {
  localStorage.removeItem('activeView');
  openTeamCapacity();
}
if (localStorage.getItem('dashSource') === 'sn') toggleSource('sn');

// Highlight active language button
const activeLang = getLocale();
document.querySelectorAll('.btn-lang').forEach(btn => {
  btn.classList.toggle('active', btn.dataset.lang === activeLang);
});

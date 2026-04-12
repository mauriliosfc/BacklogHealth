import { initFilters, toggleDropdown, onCheckChange, clearFilter, applyFilter, toggleUS, initHealthBadges } from './modules/filters.js';
import { startTimer, doRefresh } from './modules/timer.js';
import { setTheme, toggleTheme } from './modules/theme.js';
import { openDetails, closeDetails, closeDetailsBtn, toggleMaximize, loadDetailData, _detailState } from './modules/detail.js';
import { openDaily, closeDaily, toggleDailyMaximize, dailyPrev, dailyNext, handleDailyKey, openDailyForSprint } from './modules/daily.js';
import { openBurndown, closeBurndown, closeBurndownOverlay, toggleBurndownMaximize, openBurndownFromDaily } from './modules/burndown.js';
import { initI18n, applyTranslations, setLocale, getLocale } from './modules/i18n.js';
import { openDeliveryPlan, closeDeliveryPlan, closeDeliveryPlanOverlay, toggleDeliveryPlanMaximize, toggleDeliveryFilter, applyDeliveryFilter } from './modules/deliveryPlan.js';
import { openCopilot, closeCopilotConfig, closeCopilotConfigOverlay, testCopilotConnection, saveCopilotConfig, openCopilotChat, closeCopilotChat, closeCopilotChatOverlay, toggleCopilotChatMaximize, toggleCopilotMinimize, toggleCopilotMaximize, clearCopilotChat, openCopilotSettings, copilotInputKeydown, sendCopilotMessage } from './modules/copilot.js';
import { getAlias, applyAliases, startRename } from './modules/alias.js';
import { applyOrder, initDragOrder } from './modules/cardOrder.js';
import { openTeamCapacity, showDashboardView, tcRefresh, tcChangeProject } from './modules/teamCapacity.js';
import { openFeedback, closeFeedback, closeFeedbackOverlay, submitFeedback, openFeedbackSuccess, closeFeedbackSuccess, closeFeedbackSuccessOverlay } from './modules/feedback.js';

// Expor funções ao window para inline handlers no HTML
window.toggleTheme       = toggleTheme;
window.doRefresh         = doRefresh;
window.toggleDropdown    = toggleDropdown;
window.onCheckChange     = onCheckChange;
window.clearFilter       = clearFilter;
window.toggleUS          = toggleUS;
window.openDetails       = openDetails;
window.closeDetails      = closeDetails;
window.closeDetailsBtn   = closeDetailsBtn;
window.toggleMaximize    = toggleMaximize;
window.loadDetailData    = (p, s) => loadDetailData(p !== undefined ? p : _detailState.project, s !== undefined ? s : _detailState.sprints);
// Expose state refs for inline HTML handlers
Object.defineProperty(window, '_detailProject', { get: () => _detailState.project });
Object.defineProperty(window, '_detailSprints',  { get: () => _detailState.sprints });
window.openDaily         = openDaily;
window.openDailyForSprint = openDailyForSprint;
window.closeDaily        = closeDaily;
window.toggleDailyMaximize = toggleDailyMaximize;
window.dailyPrev         = dailyPrev;
window.dailyNext         = dailyNext;
window.handleDailyKey    = handleDailyKey;
window.openBurndown      = openBurndown;
window.closeBurndown     = closeBurndown;
window.closeBurndownOverlay = closeBurndownOverlay;
window.toggleBurndownMaximize = toggleBurndownMaximize;
window.openBurndownFromDaily = openBurndownFromDaily;
window.setLocale              = setLocale;
window.openDeliveryPlan       = openDeliveryPlan;
window.closeDeliveryPlan      = closeDeliveryPlan;
window.closeDeliveryPlanOverlay = closeDeliveryPlanOverlay;
window.toggleDeliveryPlanMaximize = toggleDeliveryPlanMaximize;
window.toggleDeliveryFilter   = toggleDeliveryFilter;
window.applyDeliveryFilter    = applyDeliveryFilter;
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
window.openCopilotSettings      = openCopilotSettings;
window.copilotInputKeydown      = copilotInputKeydown;
window.sendCopilotMessage       = sendCopilotMessage;
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

// ── View toggle (grid / list) ────────────────────────────────────────────────
function _applyView(mode) {
  const content = document.getElementById('content');
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
  const isGrid = content.classList.contains('cards-grid');
  const next = isGrid ? 'list' : 'grid';
  localStorage.setItem('dashView', next);
  _applyView(next);
};

// Inicialização
setTheme(localStorage.getItem('theme') || 'dark');
await initI18n();
applyTranslations();
initFilters();
initHealthBadges();
applyOrder();
applyAliases();
initDragOrder();
_applyView(localStorage.getItem('dashView') || 'grid');
startTimer();

// Restaura a view ativa após reload (ex: troca de idioma)
if (localStorage.getItem('activeView') === 'tc') {
  localStorage.removeItem('activeView');
  openTeamCapacity();
}

// Highlight active language button
const activeLang = getLocale();
document.querySelectorAll('.btn-lang').forEach(btn => {
  btn.classList.toggle('active', btn.dataset.lang === activeLang);
});

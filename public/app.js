import { initFilters, toggleDropdown, onCheckChange, clearFilter, applyFilter, toggleUS, initHealthBadges } from './modules/filters.js';
import { startTimer, doRefresh } from './modules/timer.js';
import { setTheme, toggleTheme } from './modules/theme.js';
import { openDetails, closeDetails, closeDetailsBtn, toggleMaximize, loadDetailData, _detailState } from './modules/detail.js';
import { openDaily, closeDaily, toggleDailyMaximize, dailyPrev, dailyNext, handleDailyKey, openDailyForSprint } from './modules/daily.js';
import { openBurndown, closeBurndown, closeBurndownOverlay, toggleBurndownMaximize, openBurndownFromDaily } from './modules/burndown.js';
import { initI18n, applyTranslations, setLocale, getLocale } from './modules/i18n.js';
import { openDeliveryPlan, closeDeliveryPlan, closeDeliveryPlanOverlay, toggleDeliveryPlanMaximize, toggleDeliveryFilter, applyDeliveryFilter } from './modules/deliveryPlan.js';
import { openCopilot, closeCopilotConfig, closeCopilotConfigOverlay, testCopilotConnection, saveCopilotConfig, openCopilotChat, closeCopilotChat, closeCopilotChatOverlay, toggleCopilotChatMaximize, toggleCopilotMinimize, toggleCopilotMaximize, clearCopilotChat, openCopilotSettings, copilotInputKeydown, sendCopilotMessage } from './modules/copilot.js';
import { applyAliases, startRename } from './modules/alias.js';
import { applyOrder, initDragOrder } from './modules/cardOrder.js';

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

window.removeProject = async function(btn) {
  const card = btn.closest('.card');
  const project = card.dataset.project;
  if (!confirm(`Remover "${project}" do monitoramento?`)) return;
  btn.disabled = true;
  try {
    const r = await fetch('/api/remove-project', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project }),
    });
    if (r.ok) card.remove();
    else btn.disabled = false;
  } catch(e) {
    console.error(e);
    btn.disabled = false;
  }
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
startTimer();

// Highlight active language button
const activeLang = getLocale();
document.querySelectorAll('.btn-lang').forEach(btn => {
  btn.classList.toggle('active', btn.dataset.lang === activeLang);
});

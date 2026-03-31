import { initFilters, toggleDropdown, onCheckChange, clearFilter, applyFilter, toggleUS } from './modules/filters.js';
import { startTimer, doRefresh } from './modules/timer.js';
import { setTheme, toggleTheme } from './modules/theme.js';
import { openDetails, closeDetails, closeDetailsBtn, toggleMaximize, loadDetailData, _detailState } from './modules/detail.js';
import { openDaily, closeDaily, toggleDailyMaximize, dailyPrev, dailyNext, handleDailyKey } from './modules/daily.js';
import { openBurndown, closeBurndown, closeBurndownOverlay, toggleBurndownMaximize, openBurndownFromDaily } from './modules/burndown.js';

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

// Inicialização
setTheme(localStorage.getItem('theme') || 'dark');
initFilters();
startTimer();

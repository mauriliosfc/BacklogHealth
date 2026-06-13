import { initFilters } from './filters.js';
import { t } from './i18n.js';
import { applyTranslations } from './i18n.js';
import { applyAliases } from './alias.js';
import { applyOrder } from './cardOrder.js';

const INTERVAL = 300;
let remaining = INTERVAL;
let countdown;

function pad(n) { return String(n).padStart(2, '0'); }

export function startTimer() {
  clearInterval(countdown);
  remaining = INTERVAL;
  countdown = setInterval(() => {
    remaining--;
    const m = Math.floor(remaining / 60);
    const s = remaining % 60;
    document.getElementById('timer').textContent = t('timer_prefix') + ' ' + m + ':' + pad(s);
    if (remaining <= 0) doRefresh();
  }, 1000);
}

export async function doRefresh() {
  const btn     = document.getElementById('btnRefresh');
  const content = document.getElementById('content');
  if (!btn) return;
  btn.classList.add('loading');
  btn.title = t('btn_refreshing');
  if (content) content.classList.add('loading');
  document.getElementById('timer').textContent = t('timer_updating');
  try {
    const resp = await fetch('/refresh');
    const html = await resp.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const newContent = doc.getElementById('content');
    if (content && newContent) content.innerHTML = newContent.innerHTML;
    const newUpdate = doc.getElementById('lastUpdate');
    if (newUpdate) document.getElementById('lastUpdate').textContent = newUpdate.textContent;
    applyTranslations();
    initFilters();
    applyOrder();
    applyAliases();
    if (typeof window.reapplySnDismissed === 'function') window.reapplySnDismissed();
    if (typeof window.reapplyHealthFilter === 'function') window.reapplyHealthFilter();
    const savedView = localStorage.getItem('dashView') || 'grid';
    if (content && savedView === 'list' && content.classList.contains('cards-grid')) {
      content.classList.replace('cards-grid', 'cards-list');
    }
  } catch(e) {
    console.error('Erro ao atualizar:', e);
  }
  btn.classList.remove('loading');
  btn.title = t('btn_refresh');
  if (content) content.classList.remove('loading');
  startTimer();
}

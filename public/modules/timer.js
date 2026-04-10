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
  const btn = document.getElementById('btnRefresh');
  const content = document.getElementById('content');
  btn.classList.add('loading');
  btn.title = t('btn_refreshing');
  content.classList.add('loading');
  document.getElementById('timer').textContent = t('timer_updating');
  try {
    const resp = await fetch('/refresh');
    const html = await resp.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    document.getElementById('content').innerHTML = doc.getElementById('content').innerHTML;
    document.getElementById('lastUpdate').textContent = doc.getElementById('lastUpdate').textContent;
    applyTranslations();
    initFilters();
    applyOrder();
    applyAliases();
    const savedView = localStorage.getItem('dashView') || 'grid';
    const contentEl = document.getElementById('content');
    if (savedView === 'list' && contentEl.classList.contains('cards-grid')) {
      contentEl.classList.replace('cards-grid', 'cards-list');
    }
  } catch(e) {
    console.error('Erro ao atualizar:', e);
  }
  btn.classList.remove('loading');
  btn.title = t('btn_refresh');
  content.classList.remove('loading');
  startTimer();
}

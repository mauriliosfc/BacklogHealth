import { DEFAULT_THRESHOLDS, setThresholds, calcHealth } from './health.js';
import { CLOSED_STATES, ACTIVE_BUG_STATES } from './constants.js';
import { t } from './i18n.js';

export function openHealthConfig() {
  fetch('/api/health-config')
    .then(r => r.json())
    .then(cfg => _render(cfg))
    .catch(() => _render(DEFAULT_THRESHOLDS));
}

function _render(cfg) {
  document.getElementById('health-cfg-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'health-cfg-overlay';
  overlay.className = 'modal-overlay open';
  overlay.addEventListener('click', e => { if (e.target === overlay) closeHealthConfig(); });

  overlay.innerHTML = `
    <div class="modal-box hcfg-box">
      <div class="modal-head">
        <div>
          <div class="modal-title">${t('health_cfg_title')}</div>
          <div class="modal-sub">${t('health_cfg_sub')}</div>
        </div>
        <div class="modal-actions">
          <button class="modal-close" onclick="closeHealthConfig()">&#215;</button>
        </div>
      </div>
      <div class="modal-body hcfg-body">
        <div class="hcfg-group">
          <div class="hcfg-label">${t('health_cfg_no_est')}</div>
          <div class="hcfg-row">
            <span class="hcfg-badge hcfg-warn">${t('health_cfg_warn')}</span>
            <span class="hcfg-txt">${t('health_cfg_above')}</span>
            <input class="hcfg-input" id="hcfg-semEst-warn" type="number" min="1" max="99" value="${cfg.semEst.warn}">
            <span class="hcfg-txt">${t('health_cfg_pct_open')}</span>
          </div>
          <div class="hcfg-row">
            <span class="hcfg-badge hcfg-crit">${t('health_cfg_crit')}</span>
            <span class="hcfg-txt">${t('health_cfg_above')}</span>
            <input class="hcfg-input" id="hcfg-semEst-crit" type="number" min="2" max="100" value="${cfg.semEst.crit}">
            <span class="hcfg-txt">${t('health_cfg_pct_open')}</span>
          </div>
        </div>
        <div class="hcfg-group">
          <div class="hcfg-label">${t('health_cfg_no_resp')}</div>
          <div class="hcfg-row">
            <span class="hcfg-badge hcfg-warn">${t('health_cfg_warn')}</span>
            <span class="hcfg-txt">${t('health_cfg_above')}</span>
            <input class="hcfg-input" id="hcfg-semResp-warn" type="number" min="1" max="99" value="${cfg.semResp.warn}">
            <span class="hcfg-txt">${t('health_cfg_pct_open')}</span>
          </div>
        </div>
        <div class="hcfg-group">
          <div class="hcfg-label">${t('health_cfg_bugs')}</div>
          <div class="hcfg-row">
            <span class="hcfg-badge hcfg-warn">${t('health_cfg_warn')}</span>
            <span class="hcfg-txt">${t('health_cfg_above')}</span>
            <input class="hcfg-input" id="hcfg-bugs-warn" type="number" min="1" value="${cfg.bugs.warn}">
            <span class="hcfg-txt">${t('health_cfg_bugs_unit')}</span>
          </div>
          <div class="hcfg-row">
            <span class="hcfg-badge hcfg-crit">${t('health_cfg_crit')}</span>
            <span class="hcfg-txt">${t('health_cfg_above')}</span>
            <input class="hcfg-input" id="hcfg-bugs-crit" type="number" min="2" value="${cfg.bugs.crit}">
            <span class="hcfg-txt">${t('health_cfg_bugs_unit')}</span>
          </div>
        </div>
        <div id="hcfg-error" class="hcfg-error" style="display:none"></div>
        <div class="hcfg-footer">
          <button class="ca" onclick="closeHealthConfig()">${t('health_cfg_cancel')}</button>
          <button class="ca p" id="hcfg-save-btn" onclick="saveHealthConfigModal()">${t('health_cfg_save')}</button>
        </div>
      </div>
    </div>`;

  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';
}

export function closeHealthConfig() {
  document.getElementById('health-cfg-overlay')?.remove();
  document.body.style.overflow = '';
}

export async function saveHealthConfigModal() {
  const estWarn  = parseInt(document.getElementById('hcfg-semEst-warn')?.value  || '0', 10);
  const estCrit  = parseInt(document.getElementById('hcfg-semEst-crit')?.value  || '0', 10);
  const respWarn = parseInt(document.getElementById('hcfg-semResp-warn')?.value || '0', 10);
  const bugsWarn = parseInt(document.getElementById('hcfg-bugs-warn')?.value    || '0', 10);
  const bugsCrit = parseInt(document.getElementById('hcfg-bugs-crit')?.value    || '0', 10);

  const errEl   = document.getElementById('hcfg-error');
  const showErr = msg => { if (errEl) { errEl.textContent = msg; errEl.style.display = ''; } };
  const hideErr = ()  => { if (errEl) errEl.style.display = 'none'; };

  hideErr();
  if (estWarn >= estCrit)  { showErr(t('health_cfg_err_est'));  return; }
  if (bugsWarn >= bugsCrit) { showErr(t('health_cfg_err_bugs')); return; }

  const btn = document.getElementById('hcfg-save-btn');
  if (btn) btn.disabled = true;

  try {
    const r = await fetch('/api/health-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        semEst:  { warn: estWarn,  crit: estCrit  },
        semResp: { warn: respWarn },
        bugs:    { warn: bugsWarn, crit: bugsCrit },
      }),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      showErr(d.error || t('health_cfg_err_save'));
      if (btn) btn.disabled = false;
      return;
    }
    setThresholds({ semEst: { warn: estWarn, crit: estCrit }, semResp: { warn: respWarn }, bugs: { warn: bugsWarn, crit: bugsCrit } });
    _refreshAllHealthCards();
    closeHealthConfig();
  } catch (_) {
    showErr(t('health_cfg_err_save'));
    if (btn) btn.disabled = false;
  }
}

function _refreshAllHealthCards() {
  document.querySelectorAll('#content .card[data-project]').forEach(card => {
    const allItems    = JSON.parse(card.dataset.items || '[]');
    const workItemType = card.dataset.workitemtype || 'User Story';
    const ITEM_TYPES  = workItemType === 'Task'
      ? ['Task']
      : ['User Story', 'Product Backlog Item', 'Requirement'];
    const mainItems  = allItems.filter(i => ITEM_TYPES.includes(i.type));
    const openItems  = mainItems.filter(i => !CLOSED_STATES.includes(i.state));
    const semEst     = openItems.filter(i => i.pts == null || i.pts === 0).length;
    const semResp    = openItems.filter(i => !i.assigned).length;
    const bugs       = allItems.filter(i => i.type === 'Bug' && ACTIVE_BUG_STATES.includes(i.state)).length;
    const health     = calcHealth(openItems.length, semEst, semResp, bugs);
    const hbarEl     = card.querySelector('.health-hbar');
    if (hbarEl) hbarEl.className = 'health-hbar ' + health[1];
    const pillEl = card.querySelector('.card-health');
    if (pillEl) { pillEl.className = 'health-pill card-health ' + health[1]; pillEl.title = health[2]; }
  });
  window.reapplyHealthFilter?.();
}

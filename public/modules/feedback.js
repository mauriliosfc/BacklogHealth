import { t } from './i18n.js';

export function openFeedback() {
  document.getElementById('feedback-modal').classList.add('open');
  document.body.style.overflow = 'hidden';
}

export function closeFeedback() {
  document.getElementById('feedback-modal').classList.remove('open');
  document.body.style.overflow = '';
  _resetForm();
}

export function closeFeedbackOverlay(e) {
  if (e.target === document.getElementById('feedback-modal')) closeFeedback();
}

function _resetForm() {
  document.getElementById('fb-type').value = 'bug';
  document.getElementById('fb-title').value = '';
  document.getElementById('fb-desc').value = '';
  const statusEl = document.getElementById('fb-status');
  statusEl.textContent = '';
  statusEl.className = 'fb-status';
  const btn = document.getElementById('fb-submit');
  btn.disabled = false;
  btn.textContent = t('fb_submit');
}

export async function submitFeedback() {
  const type = document.getElementById('fb-type').value;
  const title = document.getElementById('fb-title').value.trim();
  const description = document.getElementById('fb-desc').value.trim();
  const statusEl = document.getElementById('fb-status');
  const btn = document.getElementById('fb-submit');

  if (!title || !description) {
    statusEl.textContent = t('fb_err_fill');
    statusEl.className = 'fb-status fb-error';
    return;
  }

  btn.disabled = true;
  btn.textContent = t('fb_submitting');
  statusEl.textContent = '';
  statusEl.className = 'fb-status';

  try {
    const r = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, title, description }),
    });
    const data = await r.json();
    if (data.ok) {
      statusEl.innerHTML = t('fb_ok') + (data.url ? ` <a href="${data.url}" target="_blank" class="fb-issue-link">#issue</a>` : '');
      statusEl.className = 'fb-status fb-success';
      setTimeout(closeFeedback, 3000);
    } else {
      statusEl.textContent = data.error || t('fb_err_generic');
      statusEl.className = 'fb-status fb-error';
      btn.disabled = false;
      btn.textContent = t('fb_submit');
    }
  } catch (e) {
    statusEl.textContent = t('fb_err_generic');
    statusEl.className = 'fb-status fb-error';
    btn.disabled = false;
    btn.textContent = t('fb_submit');
  }
}

// ── GitHub config (admin only, in settings) ───────────────────────────────────

export async function loadFeedbackConfig() {
  try {
    const r = await fetch('/api/feedback/config');
    const data = await r.json();
    const tokenEl = document.getElementById('gh-token');
    const repoEl = document.getElementById('gh-repo');
    if (tokenEl) tokenEl.value = data.token || '';
    if (repoEl) repoEl.value = data.repo || '';
  } catch (_) {}
}

export async function saveFeedbackConfig() {
  const token = (document.getElementById('gh-token')?.value || '').trim();
  const repo = (document.getElementById('gh-repo')?.value || '').trim();
  const statusEl = document.getElementById('gh-config-status');
  const btn = document.getElementById('btn-gh-save');

  btn.disabled = true;
  btn.textContent = t('fb_cfg_saving');

  try {
    const r = await fetch('/api/feedback/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, repo }),
    });
    const data = await r.json();
    if (data.ok) {
      statusEl.textContent = t('fb_cfg_saved');
      statusEl.className = 'fb-status fb-success';
    } else {
      statusEl.textContent = t('fb_err_generic');
      statusEl.className = 'fb-status fb-error';
    }
  } catch (_) {
    statusEl.textContent = t('fb_err_generic');
    statusEl.className = 'fb-status fb-error';
  }

  btn.disabled = false;
  btn.textContent = t('fb_cfg_save');
}

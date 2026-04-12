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

export function openFeedbackSuccess(url) {
  const link = document.getElementById('fb-success-link');
  if (link) { link.href = url || '#'; link.style.display = url ? '' : 'none'; }
  document.getElementById('feedback-success-modal').classList.add('open');
  document.body.style.overflow = 'hidden';
}

export function closeFeedbackSuccess() {
  document.getElementById('feedback-success-modal').classList.remove('open');
  document.body.style.overflow = '';
}

export function closeFeedbackSuccessOverlay(e) {
  if (e.target === document.getElementById('feedback-success-modal')) closeFeedbackSuccess();
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
      closeFeedback();
      openFeedbackSuccess(data.url);
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


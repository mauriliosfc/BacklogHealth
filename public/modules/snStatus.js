// Indicador de sessão do Service Now no modo MCP (login SSO/MFA).
// - Mostra um aviso flutuante enquanto o login está pendente (janela do MCP aberta), em erro
//   ou quando os componentes não estão instalados.
// - Quando a sessão conecta e a tela tem cards "conectando" ([data-sn-pending]), recarrega os dados.
// No modo API não faz nada (para de consultar após a primeira resposta).

import { t } from './i18n.js';

const BUSY_MS = 2000;
const IDLE_MS = 15000;
const BUSY    = ['updating', 'starting', 'connecting', 'awaiting_login'];

let timer     = null;
let lastState = null;
let el        = null;

function _tt(key, fallback, vars) {
  const v = t(key, vars || {});
  if (v !== key) return v;
  let msg = fallback;
  Object.entries(vars || {}).forEach(([k, val]) => { msg = msg.split('{{' + k + '}}').join(String(val)); });
  return msg;
}

function _ensureEl() {
  if (el) return el;
  el = document.createElement('div');
  el.className = 'snmcp-banner';
  el.setAttribute('role', 'status');
  el.innerHTML = '<span class="snmcp-banner-dot"></span><span class="snmcp-banner-text"></span><button type="button" class="snmcp-banner-btn" hidden></button>';
  el.querySelector('.snmcp-banner-btn').addEventListener('click', _onAction);
  document.body.appendChild(el);
  return el;
}

function _hide() { if (el) el.hidden = true; }

let _action = null;
async function _onAction() {
  if (_action === 'settings') { location.href = '/settings'; return; }
  if (_action === 'connect') {
    try { await fetch('/api/sn-mcp/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); } catch (_) {}
    _schedule(300);
  }
}

function _show(kind, text, action, label) {
  const b = _ensureEl();
  b.hidden = false;
  b.dataset.kind = kind;
  b.querySelector('.snmcp-banner-text').textContent = text;
  const btn = b.querySelector('.snmcp-banner-btn');
  _action = action;
  btn.hidden = !action;
  if (action) btn.textContent = label;
}

function _hasPending() {
  return !!document.querySelector('[data-sn-pending]');
}

function _render(st) {
  const pending = _hasPending();
  switch (st.state) {
    case 'awaiting_login':
      return _show('busy', _tt('snmcp_banner_awaiting', 'Service Now needs you to sign in. Complete the SSO/MFA login in the window that opened.'));
    case 'connecting':
    case 'starting':
      return _show('busy', _tt('snmcp_banner_connecting', 'Connecting to Service Now…'));
    case 'updating':
      return _show('busy', _tt('snmcp_conn_updating', 'Updating login components…'));
    case 'error':
      return _show('error', _tt('snmcp_banner_error', 'Could not connect to Service Now. {{msg}}', { msg: st.reason === 'cancelled' ? _tt('snmcp_banner_cancelled', 'The login window was closed.') : (st.message || '') }),
        'connect', _tt('snmcp_banner_reconnect', 'Reconnect'));
    case 'not_installed':
      return _show('error', _tt('snmcp_banner_not_installed', 'Service Now login components are not installed.'),
        'settings', _tt('snmcp_banner_settings', 'Open settings'));
    case 'stopped':
      if (pending) return _show('idle', _tt('snmcp_banner_stopped', 'Service Now is disconnected.'), 'connect', _tt('snmcp_banner_signin', 'Sign in'));
      return _hide();
    default:
      return _hide();
  }
}

async function _poll() {
  let st;
  try { st = await (await fetch('/api/sn-mcp/status')).json(); } catch (_) { return _schedule(IDLE_MS); }
  if (!st || st.mode !== 'mcp') { _hide(); return; }   // modo API: nada a acompanhar

  const becameConnected = st.state === 'connected' && lastState !== 'connected';
  lastState = st.state;
  _render(st);
  if (becameConnected && _hasPending() && typeof window.doRefresh === 'function') {
    // dá tempo do servidor reconstruir o cache SN-only antes de buscar
    setTimeout(() => window.doRefresh(), 800);
  }
  _schedule(BUSY.includes(st.state) ? BUSY_MS : IDLE_MS);
}

function _schedule(ms) {
  clearTimeout(timer);
  timer = setTimeout(_poll, ms);
}

export function initSnStatus() {
  _schedule(0);
}

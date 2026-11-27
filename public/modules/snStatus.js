// Indicador de sessão do Service Now no modo SSO (login SSO/MFA pelo Edge).
// - Mostra um aviso flutuante enquanto o login está pendente (janela do Edge aberta), em erro
//   ou quando o Microsoft Edge não foi encontrado.
// - Quando a sessão conecta e a tela tem cards "conectando" ([data-sn-pending]), recarrega os dados.
// - Várias instâncias: acompanha todas as instâncias em SSO; o aviso cita qual instância precisa
//   de atenção e "Reconectar" reconecta só ela.
// Sem instância em SSO não faz nada (para de consultar após a primeira resposta).

import { t } from './i18n.js';

const BUSY_MS = 2000;
const IDLE_MS = 15000;
const BUSY    = ['connecting', 'awaiting_login'];

let timer     = null;
let lastState = {};     // instanceId → último estado
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

let _action   = null;
let _actionId = '';
async function _onAction() {
  if (_action === 'settings') { location.href = '/settings'; return; }
  if (_action === 'connect') {
    const body = _actionId ? { instanceId: _actionId } : {};
    try { await fetch('/api/sn-mcp/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); } catch (_) {}
    _schedule(300);
  }
}

function _show(kind, text, action, label, instanceId) {
  const b = _ensureEl();
  b.hidden = false;
  b.dataset.kind = kind;
  b.querySelector('.snmcp-banner-text').textContent = text;
  const btn = b.querySelector('.snmcp-banner-btn');
  _action   = action;
  _actionId = instanceId || '';
  btn.hidden = !action;
  if (action) btn.textContent = label;
}

function _hasPending() {
  return !!document.querySelector('[data-sn-pending]');
}

// Prioridade do aviso: login pendente > conectando > erro > desconectado (com cards esperando)
function _rank(st, pending) {
  if (st.state === 'awaiting_login') return 4;
  if (st.state === 'connecting')     return 3;
  if (st.state === 'error')          return 2;
  if (st.state === 'stopped' && pending && st.dashboard) return 1;   // cards pendentes: instâncias do dashboard
  return 0;
}

function _render(statuses) {
  const pending = _hasPending();
  const top = statuses
    .map(st => ({ st, rank: _rank(st, pending) }))
    .filter(x => x.rank > 0)
    .sort((a, b) => b.rank - a.rank)[0];
  if (!top) return _hide();
  const st = top.st;
  // Com mais de uma instância em SSO, o aviso diz qual é
  const prefix = statuses.length > 1 && st.label ? st.label + ': ' : '';
  switch (st.state) {
    case 'awaiting_login':
      return _show('busy', prefix + _tt('snmcp_banner_awaiting', 'Service Now needs you to sign in. Complete the SSO/MFA login in the window that opened.'));
    case 'connecting':
      return _show('busy', prefix + _tt('snmcp_banner_connecting', 'Connecting to Service Now…'));
    case 'error':
      if (st.reason === 'edge_missing') {
        return _show('error', _tt('snmcp_conn_edge_missing', 'Microsoft Edge was not found on this computer. Install it to use the corporate sign-in.'));
      }
      return _show('error', prefix + _tt('snmcp_banner_error', 'Could not connect to Service Now. {{msg}}', { msg: st.reason === 'cancelled' ? _tt('snmcp_banner_cancelled', 'The login window was closed.') : (st.message || '') }),
        'connect', _tt('snmcp_banner_reconnect', 'Reconnect'), st.instanceId);
    case 'stopped':
      return _show('idle', prefix + _tt('snmcp_banner_stopped', 'Service Now is disconnected.'), 'connect', _tt('snmcp_banner_signin', 'Sign in'), st.instanceId);
    default:
      return _hide();
  }
}

async function _poll() {
  let data;
  try { data = await (await fetch('/api/sn-mcp/status?all=1')).json(); } catch (_) { return _schedule(IDLE_MS); }
  const statuses = (data && Array.isArray(data.statuses)) ? data.statuses : [];
  if (!statuses.length) { _hide(); return; }   // nenhuma instância em SSO: nada a acompanhar

  const becameConnected = statuses.some(st => st.state === 'connected' && lastState[st.instanceId] !== 'connected');
  lastState = Object.fromEntries(statuses.map(st => [st.instanceId, st.state]));
  _render(statuses);
  if (becameConnected && _hasPending() && typeof window.doRefresh === 'function') {
    // dá tempo do servidor reconstruir o cache SN-only antes de buscar
    setTimeout(() => window.doRefresh(), 800);
  }
  _schedule(statuses.some(st => BUSY.includes(st.state)) ? BUSY_MS : IDLE_MS);
}

function _schedule(ms) {
  clearTimeout(timer);
  timer = setTimeout(_poll, ms);
}

export function initSnStatus() {
  _schedule(0);
}

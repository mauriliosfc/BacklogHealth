// Painel de conexão do Service Now com login corporativo (SSO/MFA pelo Microsoft Edge).
// Componente compartilhado pelo setup, onboarding e modal de configuração SN.
//
//   const panel = mountSnMcpPanel(container, {
//     getInstance: () => '...',          // instância digitada no formulário que hospeda o painel
//     getInstanceId: () => '...',        // id da instância salva (várias instâncias); '' = nova/principal
//     initial:     { username, loginUrl },
//     onConnected: (status) => {},       // chamado ao concluir o login (ex.: salvar a config)
//   });
//
// Passos: 1) conta (ID do SSO)  2) entrar (login silencioso ou janela do Edge; o painel acompanha
// via polling do status). Não há nada para instalar: o login usa o Edge do Windows.

import { t } from './i18n.js';

const POLL_MS     = 1500;
const BUSY_STATES = ['connecting', 'awaiting_login'];

function _host(v) {
  return String(v || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '').toLowerCase();
}

function _tt(key, fallback, vars) {
  const v = t(key, vars || {});
  if (v !== key) return v;
  let msg = fallback;
  Object.entries(vars || {}).forEach(([k, val]) => { msg = msg.split('{{' + k + '}}').join(String(val)); });
  return msg;
}

function _template() {
  return `
  <div class="snmcp-panel">
    <p class="snmcp-hint">${_tt('snmcp_hint', 'Sign in with your corporate account (SSO/MFA). The app uses the Microsoft Edge already installed on Windows: there is nothing to install.')}</p>

    <div class="snmcp-step" data-step="account">
      <div class="snmcp-step-num">1</div>
      <div class="snmcp-step-body">
        <div class="snmcp-step-title">${_tt('snmcp_step_account', 'Your Service Now user')}</div>
        <div class="snmcp-step-desc">${_tt('snmcp_step_account_desc', 'The same ID the SSO page asks for. With it filled in, the login window goes straight to Microsoft.')}</div>
        <input type="text" class="snmcp-input" data-el="username" autocomplete="off"
               placeholder="${_tt('snmcp_username_placeholder', 'Your Service Now user ID')}">
        <details class="snmcp-adv">
          <summary>${_tt('snmcp_advanced', 'Advanced')}</summary>
          <label class="snmcp-adv-label">${_tt('snmcp_login_url_label', 'SSO login URL')}</label>
          <input type="text" class="snmcp-input" data-el="loginUrl" autocomplete="off" placeholder="https://empresa.service-now.com/login_with_sso.do?glide_sso_id=...">
          <div class="snmcp-adv-hint">${_tt('snmcp_login_url_hint', 'Optional. Use your SSO provider direct URL if your Service Now administrator provides one.')}</div>
        </details>
      </div>
    </div>

    <div class="snmcp-step" data-step="connect">
      <div class="snmcp-step-num">2</div>
      <div class="snmcp-step-body">
        <div class="snmcp-step-title">${_tt('snmcp_step_connect', 'Sign in')}</div>
        <div class="snmcp-step-desc" data-el="conn-desc"></div>
        <div class="snmcp-actions">
          <button type="button" class="snmcp-btn snmcp-btn--primary" data-act="connect">${_tt('snmcp_connect_btn', 'Sign in with Service Now')}</button>
          <button type="button" class="snmcp-btn snmcp-btn--ghost" data-act="logout" hidden>${_tt('snmcp_logout_btn', 'Sign out / switch account')}</button>
        </div>
      </div>
    </div>
  </div>`;
}

export function mountSnMcpPanel(root, { getInstance = () => '', getInstanceId = () => '', initial = {}, onConnected, onChange } = {}) {
  if (!root) return null;
  root.innerHTML = _template();
  const $  = sel => root.querySelector(`[data-el="${sel}"]`);
  const $a = act => root.querySelector(`[data-act="${act}"]`);
  const step = name => root.querySelector(`[data-step="${name}"]`);

  function _setValues({ username, loginUrl } = {}) {
    if (username !== undefined) $('username').value = username || '';
    if (loginUrl !== undefined) $('loginUrl').value = loginUrl || '';
    if (loginUrl) root.querySelector('.snmcp-adv').open = true;
  }
  _setValues(initial);
  ['username', 'loginUrl'].forEach(k => $(k).addEventListener('input', () => { onChange?.(); if (last) _render(last); }));

  let timer = null;
  let last  = null;
  let wantConnect = false;   // usuário clicou em "Entrar" nesta tela
  let warmed      = false;   // conferência da sessão salva já pedida nesta tela
  let localError  = '';

  function _setStep(name, cls) {
    const el = step(name);
    el.classList.remove('is-done', 'is-active', 'is-error', 'is-pending', 'is-disabled');
    el.classList.add(cls);
  }

  function _errorText(st) {
    switch (st.reason) {
      case 'cancelled':    return _tt('snmcp_conn_cancelled', 'The login window was closed before finishing. Click to try again.');
      case 'cooldown':     return _tt('snmcp_conn_cooldown', 'Please wait a few seconds before trying again.');
      case 'edge_missing': return _tt('snmcp_conn_edge_missing', 'Microsoft Edge was not found on this computer. Install it to use the corporate sign-in.');
      case 'network':      return _tt('snmcp_conn_network', 'Could not reach the sign-in page. Check your network or VPN and try again.');
      case 'timeout':      return _tt('snmcp_conn_timeout', 'The sign-in was not completed in time. Click to try again.');
      default:             return _tt('snmcp_conn_error', 'Could not connect: {{msg}}', { msg: st.message || '' });
    }
  }

  function _renderConnect(st) {
    const desc    = $('conn-desc');
    const btn     = $a('connect');
    const logout  = $a('logout');
    const typed   = _host(getInstance());
    const sameInstance = !st.instance || !typed || st.instance === typed;
    const state   = sameInstance ? st.state : 'stopped';

    btn.hidden = false;
    btn.disabled = false;
    logout.hidden = true;

    if (st.edgeAvailable === false) {
      _setStep('connect', 'is-error');
      desc.textContent = _tt('snmcp_conn_edge_missing', 'Microsoft Edge was not found on this computer. Install it to use the corporate sign-in.');
      btn.disabled = true;
      return;
    }
    if (localError) {
      _setStep('connect', 'is-error');
      desc.textContent = localError;
      return;
    }
    if (state === 'connected') {
      _setStep('connect', 'is-done');
      desc.textContent = st.user
        ? _tt('snmcp_conn_ok_user', 'Connected as {{user}}.', { user: st.user })
        : _tt('snmcp_conn_ok', 'Connected.');
      btn.hidden = true;
      logout.hidden = false;
      return;
    }
    if (BUSY_STATES.includes(state)) {
      _setStep('connect', 'is-active');
      btn.disabled = true;
      desc.textContent = state === 'awaiting_login'
        ? _tt('snmcp_conn_awaiting', 'A login window was opened. Complete the SSO/MFA sign-in there — this screen updates by itself.')
        : _tt('snmcp_conn_connecting', 'Connecting… if a login window opens, complete the sign-in there.');
      return;
    }
    if (state === 'error') {
      _setStep('connect', 'is-error');
      desc.textContent = _errorText(st);
      btn.textContent = _tt('snmcp_conn_retry', 'Try again');
      return;
    }
    _setStep('connect', 'is-pending');
    desc.textContent = $('username').value.trim() || $('loginUrl').value.trim()
      ? _tt('snmcp_conn_idle', 'If needed, a Microsoft Edge window opens for your company sign-in. Your session is kept, so you will not need to sign in every time.')
      : _tt('snmcp_conn_idle_no_user', 'Without your user, the login window will ask for your ID before going to Microsoft.');
    btn.textContent = _tt('snmcp_connect_btn', 'Sign in with Service Now');
  }

  function _render(st) {
    _renderConnect(st);
    _setStep('account', $('username').value.trim() ? 'is-done' : 'is-pending');
  }

  async function refresh() {
    clearTimeout(timer);
    let st;
    try {
      const r = await fetch('/api/sn-mcp/status?' + _statusQuery());
      st = await r.json();
    } catch (_) { return; }
    const typed     = _host(getInstance());
    const connected = st.state === 'connected' && (!st.instance || !typed || st.instance === typed);
    if (connected && wantConnect) {
      wantConnect = false;
      try { await onConnected?.(st); } catch (_) {}
    }
    last = st;
    _render(st);
    // Sessão salva de um uso anterior: confere em background (sem navegador) para já mostrar conectado
    if (!warmed && st.state === 'stopped' && typed) {
      warmed = true;
      _post('/api/sn-mcp/warmup', { instance: getInstance().trim(), ..._idParam(), ...getValues() })
        .then(() => setTimeout(refresh, 1500)).catch(() => {});
    }
    if (BUSY_STATES.includes(st.state) || wantConnect) timer = setTimeout(refresh, POLL_MS);
  }

  async function _post(url, body) {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
    return d;
  }

  function _idParam() {
    const id = getInstanceId();
    return id ? { instanceId: id } : {};
  }

  // Status da instância digitada (cada instância tem a sua sessão)
  function _statusQuery() {
    const q = new URLSearchParams(_idParam());
    const typed = getInstance().trim();
    if (typed) {
      q.set('instance', typed);
      const v = getValues();
      q.set('mcpUsername', v.mcpUsername);
      q.set('mcpLoginUrl', v.mcpLoginUrl);
    }
    return q.toString();
  }

  function getValues() {
    return {
      mcpUsername: $('username').value.trim(),
      mcpLoginUrl: $('loginUrl').value.trim(),
    };
  }

  $a('connect').addEventListener('click', async () => {
    localError = '';
    const instance = getInstance().trim();
    if (!instance) {
      localError = _tt('snmcp_err_instance', 'Fill in the instance first.');
      if (last) _render(last);
      return;
    }
    wantConnect = true;
    try {
      await _post('/api/sn-mcp/connect', { instance, ..._idParam(), ...getValues() });
    } catch (e) {
      wantConnect = false;
      localError = e.message;
    }
    setTimeout(refresh, 300);
  });

  $a('logout').addEventListener('click', async () => {
    localError = '';
    // Só a sessão desta instância (as outras continuam conectadas)
    const instance = getInstance().trim();
    try { await _post('/api/sn-mcp/disconnect', instance ? { instance, ..._idParam(), ...getValues() } : _idParam()); } catch (_) {}
    refresh();
  });

  refresh();

  return {
    refresh,
    getValues,
    setValues: _setValues,
    isConnected() {
      const typed = _host(getInstance());
      return !!last && last.state === 'connected' && (!last.instance || !typed || last.instance === typed);
    },
    stop() { clearTimeout(timer); },
  };
}

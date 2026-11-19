// Painel de conexão do Service Now via MCP (login corporativo SSO/MFA).
// Componente compartilhado pelo setup, onboarding e modal de configuração SN.
//
//   const panel = mountSnMcpPanel(container, {
//     getInstance: () => '...',          // instância digitada no formulário que hospeda o painel
//     initial:     { username, caBundle },
//     onConnected: (status) => {},       // chamado ao concluir o login (ex.: salvar a config)
//   });
//
// Passos: 1) componentes (instala uv/Python/MCP/Chromium)  2) conta (usuário SSO opcional)
//         3) entrar (o MCP abre a janela de login; o painel acompanha via polling do status)

import { t } from './i18n.js';

const POLL_MS      = 1500;
const BUSY_STATES  = ['updating', 'starting', 'connecting', 'awaiting_login'];
const STEP_KEYS    = {
  download_uv: 'snmcp_install_step_uv',
  python:      'snmcp_install_step_python',
  venv:        'snmcp_install_step_venv',
  packages:    'snmcp_install_step_packages',
  browser:     'snmcp_install_step_browser',
  extract:     'snmcp_install_step_extract',
};

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
    <p class="snmcp-hint">${_tt('snmcp_hint', 'Sign in with your corporate account (SSO/MFA). The app installs the login components once and opens a browser window for you to sign in.')}</p>

    <div class="snmcp-step" data-step="components">
      <div class="snmcp-step-num">1</div>
      <div class="snmcp-step-body">
        <div class="snmcp-step-title">${_tt('snmcp_step_components', 'Login components')}</div>
        <div class="snmcp-step-desc" data-el="comp-desc"></div>
        <div class="snmcp-progress" data-el="comp-progress" hidden><div class="snmcp-progress-bar" data-el="comp-bar"></div></div>
        <div class="snmcp-actions">
          <button type="button" class="snmcp-btn" data-act="install">${_tt('snmcp_install_btn', 'Install components')}</button>
        </div>
      </div>
    </div>

    <div class="snmcp-step" data-step="account">
      <div class="snmcp-step-num">2</div>
      <div class="snmcp-step-body">
        <div class="snmcp-step-title">${_tt('snmcp_step_account', 'Your Service Now user')}</div>
        <div class="snmcp-step-desc">${_tt('snmcp_step_account_desc', 'The same ID the SSO page asks for. With it filled in, the login window goes straight to Microsoft.')}</div>
        <input type="text" class="snmcp-input" data-el="username" autocomplete="off"
               placeholder="${_tt('snmcp_username_placeholder', 'Your Service Now user ID')}">
        <details class="snmcp-adv">
          <summary>${_tt('snmcp_advanced', 'Advanced')}</summary>
          <label class="snmcp-adv-label">${_tt('snmcp_browser_label', 'Login browser')}</label>
          <select class="snmcp-input" data-el="browser">
            <option value="edge">${_tt('snmcp_browser_edge', 'Microsoft Edge (recommended)')}</option>
            <option value="chromium">${_tt('snmcp_browser_chromium', 'Chromium (built-in)')}</option>
          </select>
          <label class="snmcp-adv-label">${_tt('snmcp_login_url_label', 'SSO login URL')}</label>
          <input type="text" class="snmcp-input" data-el="loginUrl" autocomplete="off" placeholder="https://empresa.service-now.com/login_with_sso.do?glide_sso_id=...">
          <div class="snmcp-adv-hint">${_tt('snmcp_login_url_hint', 'Optional. Use your SSO provider direct URL if your Service Now administrator provides one.')}</div>
          <label class="snmcp-adv-label">${_tt('snmcp_ca_label', 'CA certificate file (.pem)')}</label>
          <input type="text" class="snmcp-input" data-el="ca" autocomplete="off" placeholder="C:\\certs\\corporate-ca.pem">
          <div class="snmcp-adv-hint">${_tt('snmcp_ca_hint', 'Only needed if the installation fails because of a corporate proxy (e.g. Zscaler).')}</div>
        </details>
      </div>
    </div>

    <div class="snmcp-step" data-step="connect">
      <div class="snmcp-step-num">3</div>
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

export function mountSnMcpPanel(root, { getInstance = () => '', initial = {}, onConnected, onChange } = {}) {
  if (!root) return null;
  root.innerHTML = _template();
  const $  = sel => root.querySelector(`[data-el="${sel}"]`);
  const $a = act => root.querySelector(`[data-act="${act}"]`);
  const step = name => root.querySelector(`[data-step="${name}"]`);

  function _setValues({ username, caBundle, loginUrl, browser } = {}) {
    if (username !== undefined) $('username').value = username || '';
    if (caBundle !== undefined) $('ca').value       = caBundle || '';
    if (loginUrl !== undefined) $('loginUrl').value = loginUrl || '';
    if (browser  !== undefined) $('browser').value  = browser === 'chromium' ? 'chromium' : 'edge';
    if (caBundle || loginUrl || browser === 'chromium') root.querySelector('.snmcp-adv').open = true;
  }
  _setValues({ browser: 'edge', ...initial });
  ['username', 'ca', 'loginUrl'].forEach(k => $(k).addEventListener('input', () => { onChange?.(); if (last) _render(last); }));
  $('browser').addEventListener('change', () => onChange?.());

  let timer = null;
  let last  = null;
  let wantConnect = false;   // usuário clicou em "Entrar" nesta tela
  let warmed      = false;   // pré-aquecimento do MCP já pedido nesta tela
  let localError  = '';

  function _setStep(name, cls) {
    const el = step(name);
    el.classList.remove('is-done', 'is-active', 'is-error', 'is-pending', 'is-disabled');
    el.classList.add(cls);
  }

  function _renderComponents(info) {
    const ins  = info.install || {};
    const desc = $('comp-desc');
    const prog = $('comp-progress');
    const btn  = $a('install');
    prog.hidden = true;
    btn.hidden  = false;
    btn.disabled = false;

    if (info.platformSupported === false) {
      _setStep('components', 'is-disabled');
      desc.textContent = _tt('snmcp_components_unsupported', 'Available only on Windows.');
      btn.hidden = true;
      return false;
    }
    if (ins.running) {
      _setStep('components', 'is-active');
      const label = _tt(STEP_KEYS[ins.step] || 'snmcp_install_preparing', 'Preparing…');
      desc.textContent = _tt('snmcp_install_progress', '{{step}} ({{n}} of {{total}})', { step: label, n: ins.stepIndex || 1, total: ins.totalSteps || 5 });
      prog.hidden = false;
      const base = Math.max(0, (ins.stepIndex || 1) - 1) / (ins.totalSteps || 5);
      const part = (ins.progress != null ? ins.progress / 100 : 0.5) / (ins.totalSteps || 5);
      $('comp-bar').style.width = Math.round((base + part) * 100) + '%';
      btn.disabled = true;
      return false;
    }
    if (ins.error) {
      _setStep('components', 'is-error');
      desc.textContent = _tt('snmcp_install_error', 'Installation failed: {{msg}}', { msg: ins.error });
      btn.textContent = _tt('snmcp_install_retry', 'Try again');
      return !!info.installed;
    }
    if (info.installed && info.needsUpdate) {
      _setStep('components', 'is-active');
      desc.textContent = _tt('snmcp_components_update', 'Update available ({{from}} → {{to}}). It is applied automatically on the next sign-in.', { from: info.installedVersion, to: info.expectedVersion });
      btn.textContent = _tt('snmcp_update_btn', 'Update now');
      return true;
    }
    if (info.installed) {
      _setStep('components', 'is-done');
      desc.textContent = _tt('snmcp_components_ready', 'Ready (version {{v}}).', { v: info.installedVersion || '' });
      btn.hidden = true;
      return true;
    }
    _setStep('components', 'is-pending');
    desc.textContent = info.bundled
      ? _tt('snmcp_components_bundled', 'The components come with the app: preparing them takes about 1 minute and does not use the internet. Sign-in uses the Microsoft Edge already installed on Windows. No administrator rights needed.')
      : _tt('snmcp_components_missing', 'One-time download of about 80 MB (Python and login module). Sign-in uses the Microsoft Edge already installed on Windows. No administrator rights needed. On corporate machines it may take a few minutes.');
    btn.textContent = _tt('snmcp_install_btn', 'Install components');
    return false;
  }

  function _renderConnect(st, installed) {
    const desc    = $('conn-desc');
    const btn     = $a('connect');
    const logout  = $a('logout');
    const typed   = _host(getInstance());
    const sameInstance = !st.instance || !typed || st.instance === typed;
    const state   = sameInstance ? st.state : 'stopped';

    btn.hidden = false;
    btn.disabled = !installed;
    logout.hidden = true;

    if (!installed) {
      _setStep('connect', 'is-disabled');
      desc.textContent = _tt('snmcp_conn_need_components', 'Install the components first.');
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
        : state === 'updating'
          ? _tt('snmcp_conn_updating', 'Updating login components…')
          : _tt('snmcp_conn_connecting', 'Connecting… if a login window opens, complete the sign-in there.');
      return;
    }
    if (state === 'error') {
      _setStep('connect', 'is-error');
      desc.textContent = st.reason === 'cancelled'
        ? _tt('snmcp_conn_cancelled', 'The login window was closed before finishing. Click to try again.')
        : st.reason === 'cooldown'
          ? _tt('snmcp_conn_cooldown', 'Please wait a few seconds before trying again.')
          : _tt('snmcp_conn_error', 'Could not connect: {{msg}}', { msg: st.message || '' });
      btn.textContent = _tt('snmcp_conn_retry', 'Try again');
      return;
    }
    _setStep('connect', 'is-pending');
    desc.textContent = $('username').value.trim() || $('loginUrl').value.trim()
      ? _tt('snmcp_conn_idle', 'A browser window will open for your company sign-in. Your session is kept, so you will not need to sign in every time.')
      : _tt('snmcp_conn_idle_no_user', 'Without your user, the login window will ask for your ID before going to Microsoft.');
    btn.textContent = _tt('snmcp_connect_btn', 'Sign in with Service Now');
  }

  function _render(st) {
    const installed = _renderComponents(st.components || {});
    _renderConnect(st, installed);
    _setStep('account', installed ? 'is-done' : 'is-pending');
  }

  async function refresh() {
    clearTimeout(timer);
    let st;
    try {
      const r = await fetch('/api/sn-mcp/status');
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
    // Componentes prontos e processo parado: sobe o MCP em background para o "Entrar" ser rápido
    if (!warmed && st.components?.installed && !st.components?.needsUpdate && st.state === 'stopped' && typed) {
      warmed = true;
      _post('/api/sn-mcp/warmup', { instance: getInstance().trim(), ...getValues() }).catch(() => {});
    }
    const busy = (st.components?.install?.running) || BUSY_STATES.includes(st.state);
    if (busy || wantConnect) timer = setTimeout(refresh, POLL_MS);
  }

  async function _post(url, body) {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
    return d;
  }

  function getValues() {
    return {
      mcpUsername: $('username').value.trim(),
      mcpCaBundle: $('ca').value.trim(),
      mcpLoginUrl: $('loginUrl').value.trim(),
      mcpBrowser:  $('browser').value === 'chromium' ? 'chromium' : 'edge',
    };
  }

  $a('install').addEventListener('click', async () => {
    localError = '';
    try { await _post('/api/sn-mcp/install', { mcpCaBundle: getValues().mcpCaBundle, mcpBrowser: getValues().mcpBrowser }); } catch (e) { localError = e.message; }
    setTimeout(refresh, 300);
  });

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
      await _post('/api/sn-mcp/connect', { instance, ...getValues() });
    } catch (e) {
      wantConnect = false;
      localError = e.message;
    }
    setTimeout(refresh, 300);
  });

  $a('logout').addEventListener('click', async () => {
    localError = '';
    try { await _post('/api/sn-mcp/disconnect'); } catch (_) {}
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

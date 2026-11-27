import { t } from './i18n.js';
import { mountSnMcpPanel } from './snMcpPanel.js';

let _snOpen     = false;
let _snProject  = null;
let _snMode     = 'api';
let _mcpPanel   = null;
let _mcpInitial = { username: '', loginUrl: '' };
let _instances  = [];   // instâncias salvas (sem senha)
let _instanceId = '';   // instância exibida (do projeto, ou a principal)
let _hasPass    = false; // a instância exibida já tem senha salva

function _tt(key, fallback) {
  const v = t(key);
  return v !== key ? v : fallback;
}

export function openSnConfig(project) {
  const modal = document.getElementById('sn-config-modal');
  if (!modal) return;
  _snProject = project || null;

  const sub = document.getElementById('snm-subtitle');
  if (sub) sub.textContent = project || '';

  _setStatus(document.getElementById('snm-global-status'), '', '');
  _setStatus(document.getElementById('snm-proj-status'),   '', '');

  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
  _snOpen = true;
  _loadSnData(project);
}

export function closeSnConfig() {
  document.getElementById('sn-config-modal')?.classList.remove('open');
  document.body.style.overflow = '';
  _snOpen = false;
  _mcpPanel?.stop();
}

export function closeSnConfigOverlay(e) {
  if (e && e.target !== document.getElementById('sn-config-modal')) return;
  closeSnConfig();
}

// Alterna entre usuário/senha (API) e login corporativo SSO/MFA (MCP)
export function snConfigSetMode(mode) {
  _snMode = mode === 'mcp' ? 'mcp' : 'api';
  document.querySelectorAll('[data-snm-mode]').forEach(b => b.classList.toggle('active', b.dataset.snmMode === _snMode));
  document.querySelectorAll('#sn-config-modal [data-snm-api]').forEach(el => { el.style.display = _snMode === 'api' ? '' : 'none'; });
  const panelEl = document.getElementById('snm-mcp-panel');
  if (panelEl) panelEl.style.display = _snMode === 'mcp' ? '' : 'none';
  if (_snMode === 'mcp') {
    if (!_mcpPanel && panelEl) {
      _mcpPanel = mountSnMcpPanel(panelEl, {
        getInstance: () => document.getElementById('snm-instance')?.value || '',
        getInstanceId: () => _instanceId,
        initial:     _mcpInitial,
        onConnected: () => snConfigSaveGlobal(),
      });
    } else if (_mcpPanel) {
      _mcpPanel.setValues(_mcpInitial);
      _mcpPanel.refresh();
    }
  }
}

async function _loadSnData(project) {
  const [list, projCfg] = await Promise.all([
    fetch('/api/sn-instances').then(r => r.json()).catch(() => ({})),
    project
      ? fetch('/api/sn-config?' + new URLSearchParams({ project })).then(r => r.json()).catch(() => ({}))
      : Promise.resolve({}),
  ]);
  _instances  = Array.isArray(list.instances) ? list.instances : [];
  _instanceId = projCfg.instanceId || (_instances[0] && _instances[0].id) || '';
  _renderInstanceSelect(project);
  await _loadInstance(_instanceId);

  const elAg  = document.getElementById('snm-ag');
  const elAgN = document.getElementById('snm-ag-name');
  if (elAg)  elAg.value  = projCfg.assignmentGroup     || '';
  if (elAgN) elAgN.value = projCfg.assignmentGroupName || '';
}

// Com mais de uma instância e um projeto aberto: escolha de qual Service Now o projeto usa
function _renderInstanceSelect(project) {
  const wrap = document.getElementById('snm-inst-field');
  const sel  = document.getElementById('snm-inst-select');
  if (!wrap || !sel) return;
  const show = !!project && _instances.length > 1;
  wrap.style.display = show ? '' : 'none';
  if (!show) return;
  sel.innerHTML = '';
  _instances.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = (s.label || s.instance) + (s.label ? ' (' + s.instance + ')' : '');
    sel.appendChild(opt);
  });
  sel.value = _instanceId;
}

// Troca a instância do projeto: o grupo é da instância anterior, então é limpo
export async function snConfigSetInstance(id) {
  if (!id || id === _instanceId) return;
  _instanceId = id;
  const elAg  = document.getElementById('snm-ag');
  const elAgN = document.getElementById('snm-ag-name');
  if (elAg)  elAg.value  = '';
  if (elAgN) elAgN.value = '';
  _setStatus(document.getElementById('snm-proj-status'), '', _tt('snm_inst_changed', 'Salve o grupo para aplicar a troca de Service Now.'));
  await _loadInstance(id);
}

async function _loadInstance(id) {
  const globalCfg = await fetch('/api/sn-config?' + new URLSearchParams(id ? { instanceId: id } : {}))
    .then(r => r.json()).catch(() => ({}));

  const elInst = document.getElementById('snm-instance');
  const elUser = document.getElementById('snm-user');
  const elPass = document.getElementById('snm-pass');
  if (elInst) elInst.value = globalCfg.instance || '';
  if (elUser) elUser.value = globalCfg.user     || '';
  if (elPass) elPass.value = '';
  if (elPass && globalCfg.hasPass) elPass.placeholder = '•••••••• ' + _tt('snm_saved_suffix', '(salvo)');

  if (elPass && !globalCfg.hasPass) elPass.placeholder = '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022';
  _hasPass = !!globalCfg.hasPass;
  _mcpInitial = { username: globalCfg.mcpUsername || '', loginUrl: globalCfg.mcpLoginUrl || '' };
  snConfigSetMode(globalCfg.mode === 'mcp' ? 'mcp' : 'api');
}

export async function snConfigTest() {
  const instance = document.getElementById('snm-instance').value.trim();
  const user     = document.getElementById('snm-user').value.trim();
  const pass     = document.getElementById('snm-pass').value;
  const st       = document.getElementById('snm-global-status');
  const hasSavedPass = !!_instanceId && _hasPass;
  if (!instance || !user || (!pass && !hasSavedPass)) {
    _setStatus(st, 'error', _tt('sn_err_fill', 'Preencha instância, usuário e senha.'));
    return;
  }
  _setStatus(st, '', _tt('sn_testing', 'Testando…'));
  try {
    const r = await fetch('/api/sn-test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instance, user, pass, ...(_instanceId ? { instanceId: _instanceId } : {}) }),
    });
    const d = await r.json().catch(() => ({}));
    _setStatus(st, d.ok ? 'ok' : 'error', d.ok ? _tt('sn_ok', 'Conexão OK') : (d.error || _tt('snm_conn_error', 'Erro na conexão')));
  } catch (e) {
    _setStatus(st, 'error', e.message);
  }
}

export async function snConfigSaveGlobal() {
  const instance = document.getElementById('snm-instance').value.trim();
  const user     = document.getElementById('snm-user').value.trim();
  const pass     = document.getElementById('snm-pass').value;
  const st       = document.getElementById('snm-global-status');
  if (_snMode === 'mcp' && !instance) {
    _setStatus(st, 'error', _tt('snmcp_err_instance', 'Preencha a instância primeiro.'));
    return;
  }
  _setStatus(st, '', _tt('sn_saving', 'Salvando…'));
  const body = _snMode === 'mcp'
    ? { instance, mode: 'mcp', ...(_mcpPanel ? _mcpPanel.getValues() : {}) }
    : { instance, user, mode: 'api' };
  if (_snMode === 'api' && pass) body.pass = pass;
  if (_instanceId) body.instanceId = _instanceId;
  try {
    const r = await fetch('/api/sn-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { _setStatus(st, 'error', d.error || `HTTP ${r.status}`); return; }
    _setStatus(st, 'ok', _tt('sn_saved', 'Salvo!'));
    if (_snMode === 'api' && pass) {
      document.getElementById('snm-pass').value = '';
      document.getElementById('snm-pass').placeholder = '•••••••• ' + _tt('snm_saved_suffix', '(salvo)');
    }
  } catch (e) {
    _setStatus(st, 'error', e.message);
  }
}

export async function snConfigSaveProject() {
  const project             = _snProject;
  const assignmentGroup     = document.getElementById('snm-ag').value.trim();
  const assignmentGroupName = document.getElementById('snm-ag-name').value.trim();
  const st = document.getElementById('snm-proj-status');
  if (!project) { _setStatus(st, 'error', _tt('snm_no_project', 'Nenhum projeto selecionado.')); return; }
  _setStatus(st, '', _tt('sn_saving', 'Salvando…'));
  const body = { project, assignmentGroup, assignmentGroupName };
  if (_instances.length > 1 && _instanceId) body.instanceId = _instanceId;
  try {
    const r = await fetch('/api/sn-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { _setStatus(st, 'error', d.error || `HTTP ${r.status}`); return; }
    _setStatus(st, 'ok', _tt('sn_saved', 'Salvo!'));
  } catch (e) {
    _setStatus(st, 'error', e.message);
  }
}

function _setStatus(el, cls, msg) {
  if (!el) return;
  el.className = 'snm-status' + (cls ? ' ' + cls : '');
  el.textContent = msg;
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && _snOpen) closeSnConfig();
});

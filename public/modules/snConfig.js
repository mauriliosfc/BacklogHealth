let _snOpen   = false;
let _snProject = null;

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
}

export function closeSnConfigOverlay(e) {
  if (e && e.target !== document.getElementById('sn-config-modal')) return;
  closeSnConfig();
}

async function _loadSnData(project) {
  const [globalCfg, projCfg] = await Promise.all([
    fetch('/api/sn-config').then(r => r.json()).catch(() => ({})),
    project
      ? fetch('/api/sn-config?' + new URLSearchParams({ project })).then(r => r.json()).catch(() => ({}))
      : Promise.resolve({}),
  ]);

  const elInst = document.getElementById('snm-instance');
  const elUser = document.getElementById('snm-user');
  const elPass = document.getElementById('snm-pass');
  if (elInst) elInst.value = globalCfg.instance || '';
  if (elUser) elUser.value = globalCfg.user     || '';
  if (elPass) elPass.value = '';
  if (elPass && globalCfg.hasPass) elPass.placeholder = '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022 (salvo)';

  const elAg  = document.getElementById('snm-ag');
  const elAgN = document.getElementById('snm-ag-name');
  if (elAg)  elAg.value  = projCfg.assignmentGroup     || '';
  if (elAgN) elAgN.value = projCfg.assignmentGroupName || '';

}

export async function snConfigTest() {
  const instance = document.getElementById('snm-instance').value.trim();
  const user     = document.getElementById('snm-user').value.trim();
  const pass     = document.getElementById('snm-pass').value;
  const st       = document.getElementById('snm-global-status');
  if (!instance || !user || !pass) {
    _setStatus(st, 'error', 'Preencha instância, usuário e senha.');
    return;
  }
  _setStatus(st, '', 'Testando…');
  try {
    const r = await fetch('/api/sn-test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instance, user, pass }),
    });
    const d = await r.json().catch(() => ({}));
    _setStatus(st, d.ok ? 'ok' : 'error', d.ok ? 'Conexão OK' : (d.error || 'Erro na conexão'));
  } catch (e) {
    _setStatus(st, 'error', e.message);
  }
}

export async function snConfigSaveGlobal() {
  const instance = document.getElementById('snm-instance').value.trim();
  const user     = document.getElementById('snm-user').value.trim();
  const pass     = document.getElementById('snm-pass').value;
  const st       = document.getElementById('snm-global-status');
  _setStatus(st, '', 'Salvando…');
  const body = { instance, user };
  if (pass) body.pass = pass;
  try {
    const r = await fetch('/api/sn-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { _setStatus(st, 'error', d.error || `HTTP ${r.status}`); return; }
    _setStatus(st, 'ok', 'Salvo!');
    document.getElementById('snm-pass').value = '';
    document.getElementById('snm-pass').placeholder = '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022 (salvo)';
  } catch (e) {
    _setStatus(st, 'error', e.message);
  }
}

export async function snConfigSaveProject() {
  const project             = _snProject;
  const assignmentGroup     = document.getElementById('snm-ag').value.trim();
  const assignmentGroupName = document.getElementById('snm-ag-name').value.trim();
  const st = document.getElementById('snm-proj-status');
  if (!project) { _setStatus(st, 'error', 'Nenhum projeto selecionado.'); return; }
  _setStatus(st, '', 'Salvando…');
  const body = { project, assignmentGroup, assignmentGroupName };
  try {
    const r = await fetch('/api/sn-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { _setStatus(st, 'error', d.error || `HTTP ${r.status}`); return; }
    _setStatus(st, 'ok', 'Salvo!');
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

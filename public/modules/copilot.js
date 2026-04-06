import { t } from './i18n.js';

let _history = [];
let _richContext = null;
let _contextLoading = false;

// ── Config modal ──────────────────────────────────────────────────────────────

export async function openCopilot() {
  const resp = await fetch('/ai/config');
  const { configured } = await resp.json();
  if (configured) {
    openCopilotChat();
  } else {
    openCopilotConfig();
  }
}

export function openCopilotConfig() {
  document.getElementById('copilot-config-modal').classList.add('open');
  document.body.style.overflow = 'hidden';
}

export function closeCopilotConfig() {
  document.getElementById('copilot-config-modal').classList.remove('open');
  document.body.style.overflow = '';
}

export function closeCopilotConfigOverlay(e) {
  if (e.target === document.getElementById('copilot-config-modal')) closeCopilotConfig();
}

export async function testCopilotConnection() {
  const btn = document.getElementById('btnCopilotTest');
  const statusEl = document.getElementById('copilot-config-status');
  const payload = _getConfigFormValues();
  if (!payload.endpoint || !payload.apiKey || !payload.model) {
    statusEl.textContent = t('ai_err_fill');
    statusEl.className = 'copilot-config-status error';
    return;
  }
  btn.disabled = true;
  btn.textContent = t('ai_btn_testing');
  statusEl.textContent = '';
  statusEl.className = 'copilot-config-status';
  try {
    const resp = await fetch('/ai/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await resp.json();
    if (data.ok) {
      statusEl.textContent = t('ai_test_ok');
      statusEl.className = 'copilot-config-status ok';
    } else {
      statusEl.textContent = '❌ ' + data.error;
      statusEl.className = 'copilot-config-status error';
    }
  } catch (e) {
    statusEl.textContent = '❌ ' + e.message;
    statusEl.className = 'copilot-config-status error';
  }
  btn.disabled = false;
  btn.textContent = t('ai_btn_test');
}

export async function saveCopilotConfig() {
  const btn = document.getElementById('btnCopilotSave');
  const statusEl = document.getElementById('copilot-config-status');
  const payload = _getConfigFormValues();
  if (!payload.endpoint || !payload.apiKey || !payload.model) {
    statusEl.textContent = t('ai_err_fill');
    statusEl.className = 'copilot-config-status error';
    return;
  }
  btn.disabled = true;
  btn.textContent = t('ai_btn_saving');
  try {
    const resp = await fetch('/ai/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await resp.json();
    if (data.ok) {
      closeCopilotConfig();
      openCopilotChat();
    } else {
      statusEl.textContent = '❌ ' + data.error;
      statusEl.className = 'copilot-config-status error';
    }
  } catch (e) {
    statusEl.textContent = '❌ ' + e.message;
    statusEl.className = 'copilot-config-status error';
  }
  btn.disabled = false;
  btn.textContent = t('ai_btn_save');
}

function _getConfigFormValues() {
  return {
    endpoint:   document.getElementById('ai-endpoint').value.trim(),
    apiKey:     document.getElementById('ai-apikey').value.trim(),
    model:      document.getElementById('ai-model').value.trim(),
    apiVersion: document.getElementById('ai-apiversion').value.trim(),
  };
}

// ── Chat modal ────────────────────────────────────────────────────────────────

export function openCopilotChat() {
  _history = [];
  _richContext = null;
  const body = document.getElementById('copilot-chat-messages');
  body.innerHTML = '<div class="copilot-welcome">' + t('ai_welcome') + '</div>';
  document.getElementById('copilot-chat-modal').classList.add('open');
  document.body.style.overflow = 'hidden';
  document.getElementById('copilot-input').focus();
  _loadRichContext();
}

async function _loadRichContext() {
  if (_contextLoading) return;
  _contextLoading = true;
  const indicator = document.createElement('div');
  indicator.id = 'copilot-ctx-loading';
  indicator.className = 'copilot-ctx-status';
  indicator.textContent = '⏳ Carregando dados dos projetos...';
  document.getElementById('copilot-chat-messages').appendChild(indicator);
  try {
    // coleta filtros ativos do dashboard (localStorage)
    const filters = {};
    for (const card of document.querySelectorAll('#content .card[data-project]')) {
      const name = card.dataset.project;
      try { filters[name] = JSON.parse(localStorage.getItem('filter_' + name) || '[]'); } catch(_) { filters[name] = []; }
    }
    const resp = await fetch('/ai/context', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filters })
    });
    const data = await resp.json();
    if (data.projects) {
      _richContext = JSON.stringify(data, null, 2);
      indicator.textContent = '✅ Dados dos projetos carregados.';
      setTimeout(() => indicator.remove(), 2000);
    } else {
      indicator.textContent = '⚠️ Falha ao carregar dados: ' + (data.error || 'desconhecido');
    }
  } catch (e) {
    console.error('[copilot] context load error:', e.message);
    indicator.textContent = '⚠️ Erro: ' + e.message;
  }
  _contextLoading = false;
}

export function closeCopilotChat() {
  document.getElementById('copilot-chat-modal').classList.remove('open', 'maximized');
  document.getElementById('btnCopilotChatMax').textContent = '\u2922';
  document.body.style.overflow = '';
}

export function closeCopilotChatOverlay(e) {
  if (e.target === document.getElementById('copilot-chat-modal')) closeCopilotChat();
}

export function toggleCopilotChatMaximize() {
  const modal = document.getElementById('copilot-chat-modal');
  const btn   = document.getElementById('btnCopilotChatMax');
  const isMax = modal.classList.toggle('maximized');
  btn.textContent = isMax ? '\u2921' : '\u2922';
}

export function openCopilotSettings() {
  closeCopilotChat();
  openCopilotConfig();
}

export function copilotInputKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendCopilotMessage(); }
}

export async function sendCopilotMessage() {
  const input = document.getElementById('copilot-input');
  const message = input.value.trim();
  if (!message) return;
  input.value = '';
  input.disabled = true;
  document.getElementById('btnCopilotSend').disabled = true;

  _appendMessage('user', message);
  const thinkingId = _appendThinking();

  // aguarda o contexto rico se ainda estiver carregando
  if (_contextLoading) {
    await new Promise(resolve => {
      const check = setInterval(() => { if (!_contextLoading) { clearInterval(check); resolve(); } }, 200);
    });
  }
  const context = _richContext || _buildContext();

  try {
    const resp = await fetch('/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, history: _history, context })
    });
    const data = await resp.json();
    _removeThinking(thinkingId);
    if (data.reply) {
      _appendMessage('assistant', data.reply);
      _history.push({ role: 'user', content: message });
      _history.push({ role: 'assistant', content: data.reply });
      if (_history.length > 20) _history = _history.slice(-20);
    } else {
      _appendMessage('error', data.error || t('ai_err_generic'));
    }
  } catch (e) {
    _removeThinking(thinkingId);
    _appendMessage('error', e.message);
  }

  input.disabled = false;
  document.getElementById('btnCopilotSend').disabled = false;
  input.focus();
}

function _appendMessage(role, text) {
  const wrap = document.getElementById('copilot-chat-messages');
  const div = document.createElement('div');
  div.className = 'copilot-msg copilot-msg--' + role;
  const escaped = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const html = escaped
    .split('\n')
    .map(line => {
      if (/^### (.+)/.test(line))  return '<h4>' + line.replace(/^### /, '') + '</h4>';
      if (/^## (.+)/.test(line))   return '<h3>' + line.replace(/^## /, '') + '</h3>';
      if (/^# (.+)/.test(line))    return '<h3>' + line.replace(/^# /, '') + '</h3>';
      if (/^---+$/.test(line.trim())) return '<hr>';
      if (/^\d+\. (.+)/.test(line)) return '<div class="copilot-li">' + line + '</div>';
      if (/^[-*] (.+)/.test(line))  return '<div class="copilot-li">' + line.replace(/^[-*] /, '• ') + '</div>';
      if (line.trim() === '')       return '<br>';
      return '<span>' + line + '</span><br>';
    })
    .join('')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`(.*?)`/g, '<code>$1</code>');
  div.innerHTML = html;
  wrap.appendChild(div);
  wrap.scrollTop = wrap.scrollHeight;
  return div;
}

let _thinkingCounter = 0;
function _appendThinking() {
  const id = 'thinking-' + (++_thinkingCounter);
  const wrap = document.getElementById('copilot-chat-messages');
  const div = document.createElement('div');
  div.id = id;
  div.className = 'copilot-msg copilot-msg--thinking';
  div.innerHTML = '<span class="copilot-dots"><span></span><span></span><span></span></span>';
  wrap.appendChild(div);
  wrap.scrollTop = wrap.scrollHeight;
  return id;
}

function _removeThinking(id) {
  document.getElementById(id)?.remove();
}

function _buildContext() {
  const cards = Array.from(document.querySelectorAll('#content .card[data-project]'));
  if (!cards.length) return 'No project data available.';

  const projects = cards.map(card => {
    const name     = card.dataset.project;
    const itemType = card.dataset.workitemtype || 'User Story';
    const health   = card.querySelector('.card-health')?.textContent?.trim() || '?';
    const noEst    = parseInt(card.querySelector('.card-semest')?.textContent?.trim()) || 0;
    const noResp   = parseInt(card.querySelector('.card-semresp')?.textContent?.trim()) || 0;
    const bugs     = parseInt(card.querySelector('.card-bugs')?.textContent?.trim()) || 0;

    // items: [{iteration, type, state, pts, assigned}]
    let items = [];
    try { items = JSON.parse(card.dataset.items || '[]'); } catch(_) {}

    // iterMap: { "SprintName": { start, end, isCurrent } }
    let iterMap = {};
    try { iterMap = JSON.parse(card.dataset.itermap || '{}'); } catch(_) {}

    // sprint atual
    const currentSprint = Object.entries(iterMap).find(([, v]) => v.isCurrent);
    const currentSprintName = currentSprint?.[0] || null;
    const currentSprintDates = currentSprint
      ? { start: currentSprint[1].start, end: currentSprint[1].end }
      : null;

    // filtro ativo — normaliza para último segmento (igual ao backend)
    let rawFilter = [];
    try { rawFilter = JSON.parse(localStorage.getItem('filter_' + name) || '[]'); } catch(_) {}
    const activeFilter = rawFilter.map(f => f.split('\\').pop());
    const hasFilter = activeFilter.length > 0;
    const inFilter = sp => !hasFilter || activeFilter.includes(sp);

    // agregar por sprint
    const US_TYPES = ['User Story','Product Backlog Item','Requirement'];
    const CLOSED = ['Closed','Done','Resolved'];
    const usItems = items.filter(i => (US_TYPES.includes(i.type) || itemType === 'Task') && inFilter(i.iteration.split('\\').pop()));
    const sprintMap = {};
    for (const i of usItems) {
      const sp = i.iteration.split('\\').pop();
      if (!sprintMap[sp]) sprintMap[sp] = { total: 0, completed: 0, active: 0, points: 0 };
      sprintMap[sp].total++;
      if (CLOSED.includes(i.state)) sprintMap[sp].completed++;
      else if (['Active','In Progress','Doing'].includes(i.state)) sprintMap[sp].active++;
      if (i.pts) sprintMap[sp].points += i.pts;
    }

    // sprint efetiva: se filtro ativo e sprint atual não está no filtro, usa última do filtro
    const currentSprintShort = currentSprintName?.split('\\').pop() || null;
    const effectiveSprint = hasFilter
      ? (activeFilter.includes(currentSprintShort) ? currentSprintShort : activeFilter[activeFilter.length - 1])
      : currentSprintShort;

    // ordenar sprints por data
    const sprintSummary = Object.entries(sprintMap)
      .map(([sp, s]) => {
        const meta = Object.entries(iterMap).find(([k]) => k.endsWith('\\' + sp) || k === sp);
        return {
          sprint: sp,
          isCurrent: meta?.[1]?.isCurrent || false,
          start: meta?.[1]?.start || null,
          end:   meta?.[1]?.end   || null,
          total: s.total, completed: s.completed, active: s.active,
          points: s.points
        };
      })
      .sort((a, b) => (a.start || '').localeCompare(b.start || ''));

    // itens sem estimativa e sem responsável (abertos)
    const openUS = usItems.filter(i => !CLOSED.includes(i.state));
    const noEstimateItems = openUS.filter(i => !i.pts).map(i => ({ sprint: i.iteration.split('\\').pop() }));
    const noAssigneeItems = openUS.filter(i => !i.assigned).map(i => ({ sprint: i.iteration.split('\\').pop(), pts: i.pts }));

    return {
      name, health, workItemType: itemType,
      alerts: { noEstimateCount: noEst, noAssigneeCount: noResp, openBugsCount: bugs },
      activeSprintFilter: hasFilter ? activeFilter : null,
      currentSprint: effectiveSprint
        ? { name: effectiveSprint, start: currentSprintDates?.start, end: currentSprintDates?.end }
        : null,
      sprintSummary,
      noEstimateItems,
      noAssigneeItems,
    };
  });

  return JSON.stringify({ projects }, null, 2);
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    const configModal = document.getElementById('copilot-config-modal');
    const chatModal   = document.getElementById('copilot-chat-modal');
    if (configModal?.classList.contains('open')) closeCopilotConfig();
    if (chatModal?.classList.contains('open'))   closeCopilotChat();
  }
});

const { getCfg } = require('../config');
const { snGet }  = require('../servicenowClient');

// ── Helpers ──────────────────────────────────────────────────────────────────

function _snVal(v) {
  if (!v || typeof v === 'string') return v || '';
  return v.display_value || v.value || '';
}
function _snRaw(v) {
  if (!v || typeof v === 'string') return v || '';
  return v.value || v.display_value || '';
}
function escHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function _ageStr(dateStr) {
  if (!dateStr) return '';
  try {
    const diffH = Math.floor((Date.now() - new Date(dateStr).getTime()) / 3_600_000);
    if (diffH < 1)   return 'just now';
    if (diffH < 24)  return `${diffH}h ago`;
    const d = Math.floor(diffH / 24);
    return d === 1 ? '1 day ago' : `${d} days ago`;
  } catch (_) { return ''; }
}
function _initials(name) {
  return (name || '?')
    .split(/[\s\-_]+/)
    .map(w => w[0] || '')
    .join('')
    .toUpperCase()
    .slice(0, 2) || '??';
}

// ── MTTR helpers (exported for tests) ────────────────────────────────────────

function _calcMttr(incs) {
  let total = 0, count = 0;
  for (const inc of incs) {
    const opened   = _snRaw(inc.opened_at);
    const resolved = _snRaw(inc.resolved_at);
    if (!opened || !resolved) continue;
    const diff = new Date(resolved) - new Date(opened);
    if (diff > 0) { total += diff; count++; }
  }
  return count > 0 ? total / count / 3_600_000 : null; // hours
}

function _fmtMttr(hours) {
  if (hours == null) return '—';
  if (hours < 1)  return '< 1h';
  if (hours < 24) return `${Math.round(hours)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

// ── Data fetch ────────────────────────────────────────────────────────────────

async function fetchSNGroups(snCfg) {
  const groupNames = Array.isArray(snCfg.assignmentGroups) && snCfg.assignmentGroups.length > 0
    ? snCfg.assignmentGroups
    : null;

  const commonQs = [
    'sysparm_display_value=all',
    'sysparm_fields=number,short_description,priority,assignment_group,opened_at,sys_id',
    'sysparm_order_by=priority',
    'sysparm_order_by_direction=asc',
  ].join('&');

  // Same open-incident definition as monthly review: active + not Resolved(6)/Closed(7).
  // When groups are selected: one query per group so we never hit the pagination cap on
  // large tenants (a single query for all groups + in-memory filter loses incidents when
  // total active incidents exceed sysparm_limit).
  let incidents;
  if (groupNames) {
    const results = await Promise.all(
      groupNames.map(name => {
        const q = `assignment_group.name=${encodeURIComponent(name)}^active=true^state!=6^state!=7`;
        return snGet(snCfg, `table/incident?sysparm_query=${q}&${commonQs}&sysparm_limit=500`)
          .then(r => r.result || [])
          .catch(() => []);
      })
    );
    // Deduplicate by sys_id: the same incident could appear in multiple group
    // results if its assignment_group changed between requests.
    const seenIds = new Set();
    incidents = results.flat().filter(inc => {
      const id = _snRaw(inc.sys_id) || _snVal(inc.sys_id);
      if (!id || seenIds.has(id)) return false;
      seenIds.add(id);
      return true;
    });
  } else {
    const data = await snGet(snCfg, `table/incident?sysparm_query=active=true^state!=6^state!=7&${commonQs}&sysparm_limit=1000`);
    incidents = data.result || [];
  }

  const allowed = groupNames ? new Set(groupNames) : null;
  const groupMap = {};
  const host = (snCfg.instance || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');

  // Pre-populate selected groups so they always appear even with 0 incidents.
  if (allowed) {
    for (const groupName of allowed) {
      groupMap[groupName] = { name: groupName, p1: 0, p2: 0, p3: 0, total: 0, incidents: [] };
    }
  }

  for (const inc of incidents) {
    const groupName = _snVal(inc.assignment_group) || 'Unassigned';
    if (allowed && !allowed.has(groupName)) continue;
    if (!groupMap[groupName]) {
      groupMap[groupName] = { name: groupName, p1: 0, p2: 0, p3: 0, total: 0, incidents: [] };
    }
    const g = groupMap[groupName];
    const p = parseInt(_snVal(inc.priority) || '5', 10);
    if (p === 1)      g.p1++;
    else if (p === 2) g.p2++;
    else if (p === 3) g.p3++;
    g.total++;
    if (g.incidents.length < 3) {
      g.incidents.push({
        number:   _snRaw(inc.number),
        title:    _snVal(inc.short_description),
        priority: p,
        age:      _ageStr(_snRaw(inc.opened_at)),
        url:      `https://${host}/nav_to.do?uri=incident.do?sys_id=${_snRaw(inc.sys_id)}`,
      });
    }
  }

  const groups = Object.values(groupMap)
    .sort((a, b) => (b.p1 * 100 + b.p2 * 10 + b.p3) - (a.p1 * 100 + a.p2 * 10 + a.p3));

  const kpi = {
    totalOpen:    groups.reduce((s, g) => s + g.total, 0),
    totalP1:      groups.reduce((s, g) => s + g.p1, 0),
    totalP2:      groups.reduce((s, g) => s + g.p2, 0),
    totalP3:      groups.reduce((s, g) => s + g.p3, 0),
    activeGroups: groups.filter(g => g.total > 0).length,
  };

  return { groups, kpi };
}

// ── HTML builders ─────────────────────────────────────────────────────────────

function _incCardHTML(g) {
  const openCount  = g.total;
  const hbarColor  = g.p1 > 0 ? 'var(--c-red)' : g.p2 > 0 ? 'var(--c-yellow)' : 'var(--c-blue)';
  const avatarCls  = g.p1 > 0 ? 'sn-avatar-red' : g.p2 > 0 ? 'sn-avatar-yellow' : '';

  const incRows = g.incidents.map(inc => `
    <div class="sn-inc-row" onclick="window.open('${escHtml(inc.url)}','_blank')">
      <span class="sn-prio-badge sn-p${inc.priority}">P${inc.priority}</span>
      <div class="sn-inc-row-text">
        <div class="sn-inc-row-title">${escHtml(inc.title)}</div>
        <div class="sn-inc-row-meta">${escHtml(inc.number)} · ${escHtml(inc.age)}</div>
      </div>
    </div>`).join('');

  return `<div class="sn-inc-card" data-project="${escHtml(g.name)}" data-group="${escHtml(g.name)}">
  <div class="sn-inc-hbar" style="background:${hbarColor}"></div>
  <div class="sn-inc-head">
    <div class="sn-inc-avatar ${avatarCls} card-icon" title="Arrastar para reordenar">${escHtml(_initials(g.name))}</div>
    <div class="sn-inc-head-text">
      <div class="sn-inc-group-name card-project-title">${escHtml(g.name)}</div>
      <span class="sn-inc-open-badge">${openCount} open</span>
    </div>
  </div>
  <div class="sn-inc-stats-row">
    <div class="sn-stat-cell">
      <div class="sn-stat-val${g.p1 > 0 ? ' sn-stat-red' : ' sn-stat-muted'}">${g.p1}</div>
      <div class="sn-stat-lbl"><span class="sn-prio-badge sn-p1">P1</span></div>
    </div>
    <div class="sn-stat-sep"></div>
    <div class="sn-stat-cell">
      <div class="sn-stat-val${g.p2 > 0 ? ' sn-stat-yellow' : ' sn-stat-muted'}">${g.p2}</div>
      <div class="sn-stat-lbl"><span class="sn-prio-badge sn-p2">P2</span></div>
    </div>
    <div class="sn-stat-sep"></div>
    <div class="sn-stat-cell">
      <div class="sn-stat-val sn-stat-muted">${g.p3}</div>
      <div class="sn-stat-lbl"><span class="sn-prio-badge sn-p3">P3</span></div>
    </div>
  </div>
  <div class="sn-inc-list">${incRows}</div>
  <div class="card-footer">
    <div class="card-footer-actions">
      <button class="ca" type="button" onclick="openSNGroupIncidents(this)">Ver todos os incidentes</button>
      <button class="ca" type="button" onclick="openReport(this)">Monthly Review</button>
    </div>
    <span class="foot-sep"></span>
    <div class="more-wrap">
      <button class="btn-more" type="button" onclick="toggleCardMore(this)" title="Mais opcoes">
        <svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>
      </button>
      <div class="more-panel">
        <div class="more-item" onclick="startRename(this)">
          <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          <span>Renomear</span>
        </div>
        <div class="more-divider"></div>
        <div class="more-item danger" onclick="hideSNGroup(this)">
          <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
          <span>Ocultar</span>
        </div>
      </div>
    </div>
  </div>
</div>`;
}

function buildIncidentCardsHTML(groups) {
  if (!groups.length) {
    return '<div class="sn-empty-incidents">No active incidents found.</div>';
  }
  return `<div class="sn-inc-cards">${groups.map(g => _incCardHTML(g)).join('')}</div>`;
}

// ── Resolved incidents (this calendar month) ──────────────────────────────────

async function fetchSNResolved(snCfg, groupNames) {
  const now   = new Date();
  const y     = now.getFullYear();
  const m     = now.getMonth();
  const start = new Date(y, m, 1).toISOString().slice(0, 19) + 'Z';
  const end   = new Date(y, m + 1, 1).toISOString().slice(0, 19) + 'Z';

  const fields = 'sys_id,opened_at,resolved_at';
  const qs     = `sysparm_fields=${fields}&sysparm_display_value=all&sysparm_limit=1000`;
  const stateQ = 'state=6^ORstate=7';

  let incs;
  if (groupNames && groupNames.length > 0) {
    const results = await Promise.all(
      groupNames.map(name => {
        const q = `assignment_group.name=${encodeURIComponent(name)}^${stateQ}^resolved_at>=${start}^resolved_at<${end}`;
        return snGet(snCfg, `table/incident?sysparm_query=${q}&${qs}`)
          .then(r => r.result || [])
          .catch(() => []);
      })
    );
    const seen = new Set();
    incs = results.flat().filter(inc => {
      const id = _snRaw(inc.sys_id);
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  } else {
    const q = `${stateQ}^resolved_at>=${start}^resolved_at<${end}`;
    const data = await snGet(snCfg, `table/incident?sysparm_query=${q}&${qs}`);
    incs = data.result || [];
  }
  return incs;
}

// ── Public: called by dashboard.js buildAndCache ──────────────────────────────

async function fetchAndBuildCards() {
  const cfg        = getCfg();
  const snCfg      = cfg.servicenow;
  const groupNames = Array.isArray(snCfg?.assignmentGroups) && snCfg.assignmentGroups.length > 0
    ? snCfg.assignmentGroups : null;

  try {
    const [snData, resolvedIncs] = await Promise.all([
      fetchSNGroups(snCfg),
      fetchSNResolved(snCfg, groupNames).catch(() => []),
    ]);
    const { groups, kpi } = snData;
    kpi.resolvedThisMonth = resolvedIncs.length;
    kpi.mttr = _fmtMttr(_calcMttr(resolvedIncs));
    return { kpi, cardsHtml: buildIncidentCardsHTML(groups), error: null };
  } catch (err) {
    const errHtml = `<div class="sn-empty-incidents" style="color:var(--c-red)">
      Failed to load incidents: ${escHtml(err.message)}
    </div>`;
    return {
      kpi: { totalOpen: 0, totalP1: 0, totalP2: 0, totalP3: 0, activeGroups: 0, resolvedThisMonth: 0, mttr: '—' },
      cardsHtml: errHtml,
      error: err.message,
    };
  }
}

async function buildSnViewHtml() {
  const { kpi, cardsHtml } = await fetchAndBuildCards();
  return `<div class="sn-content">
    <div class="sn-kpi-bar">
      <div class="sn-kpi-stat">
        <div class="sn-kpi-lbl">
          <svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          Open Incidents
        </div>
        <div class="sn-kpi-val sn-kpi-val--red">${kpi.totalOpen}</div>
        <div class="sn-kpi-sub">${kpi.totalP1} P1 &middot; ${kpi.totalP2} P2 &middot; ${kpi.totalP3} P3</div>
      </div>
      <div class="sn-kpi-stat">
        <div class="sn-kpi-lbl">
          <svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>
          Active Groups
        </div>
        <div class="sn-kpi-val">${kpi.activeGroups}</div>
        <div class="sn-kpi-sub">with open incidents</div>
      </div>
      <div class="sn-kpi-stat">
        <div class="sn-kpi-lbl">
          <svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
          Resolved this month
        </div>
        <div class="sn-kpi-val">${kpi.resolvedThisMonth}</div>
        <div class="sn-kpi-sub">this month</div>
      </div>
      <div class="sn-kpi-stat">
        <div class="sn-kpi-lbl">
          <svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
          MTTR
        </div>
        <div class="sn-kpi-val">${kpi.mttr}</div>
        <div class="sn-kpi-sub">Mean Time to Resolve</div>
      </div>
    </div>
    ${cardsHtml}
  </div>`;
}

module.exports = { fetchSNGroups, fetchSNResolved, buildIncidentCardsHTML, fetchAndBuildCards, buildSnViewHtml, _calcMttr, _fmtMttr };

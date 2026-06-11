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
  const openCount = g.total;
  const hbarColor = g.p1 > 0 ? 'var(--c-red)' : g.p2 > 0 ? 'var(--c-yellow)' : 'var(--c-blue)';

  const incRows = g.incidents.map(inc => `
    <div class="sn-inc-row" onclick="window.open('${escHtml(inc.url)}','_blank')">
      <span class="sn-prio-badge sn-p${inc.priority}">P${inc.priority}</span>
      <div class="sn-inc-row-text">
        <div class="sn-inc-row-title">${escHtml(inc.title)}</div>
        <div class="sn-inc-row-meta">${escHtml(inc.number)} · ${escHtml(inc.age)}</div>
      </div>
    </div>`).join('');

  return `<div class="sn-inc-card" data-group="${escHtml(g.name)}">
  <div class="sn-inc-hbar" style="background:${hbarColor}"></div>
  <div class="sn-inc-head">
    <div class="sn-inc-avatar">${escHtml(_initials(g.name))}</div>
    <div class="sn-inc-head-text">
      <div class="sn-inc-group-name">${escHtml(g.name)}</div>
      <span class="sn-inc-open-badge">${openCount} open</span>
    </div>
  </div>
  <div class="sn-inc-prio-row">
    <div class="sn-prio-item"><span class="sn-prio-badge sn-p1">P1</span> <span class="sn-prio-num${g.p1 > 0 ? ' sn-p1-num' : ''}">${g.p1}</span></div>
    <span class="sn-prio-sep">·</span>
    <div class="sn-prio-item"><span class="sn-prio-badge sn-p2">P2</span> <span class="sn-prio-num${g.p2 > 0 ? ' sn-p2-num' : ''}">${g.p2}</span></div>
    <span class="sn-prio-sep">·</span>
    <div class="sn-prio-item"><span class="sn-prio-badge sn-p3">P3</span> <span class="sn-prio-num">${g.p3}</span></div>
  </div>
  <div class="sn-inc-list">${incRows}</div>
  <div class="sn-inc-foot">
    <button class="sn-inc-foot-link" onclick="openSNGroupIncidents(this)">View all ${openCount} →</button>
  </div>
</div>`;
}

function buildIncidentCardsHTML(groups) {
  if (!groups.length) {
    return '<div class="sn-empty-incidents">No active incidents found.</div>';
  }
  return `<div class="sn-inc-cards">${groups.map(g => _incCardHTML(g)).join('')}</div>`;
}

// ── Public: called by dashboard.js buildAndCache ──────────────────────────────

async function fetchAndBuildCards() {
  const cfg   = getCfg();
  const snCfg = cfg.servicenow;

  try {
    const { groups, kpi } = await fetchSNGroups(snCfg);
    return { kpi, cardsHtml: buildIncidentCardsHTML(groups), error: null };
  } catch (err) {
    const errHtml = `<div class="sn-empty-incidents" style="color:var(--c-red)">
      Failed to load incidents: ${escHtml(err.message)}
    </div>`;
    return { kpi: { totalOpen: 0, totalP1: 0, totalP2: 0, totalP3: 0, activeGroups: 0 }, cardsHtml: errHtml, error: err.message };
  }
}

module.exports = { fetchSNGroups, buildIncidentCardsHTML, fetchAndBuildCards };

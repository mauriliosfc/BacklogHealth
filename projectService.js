const { azureGet, azurePost } = require("./azureClient");
const { calcHealth }    = require("./utils/health");
const { paginatedItems } = require("./utils/paginate");
const { fetchIterMap }  = require("./utils/iterMap");

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d) {
  if (!d) return "";
  const date = d instanceof Date ? d : new Date(d);
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function fmtRange(iter) {
  if (!iter?.start && !iter?.end) return "";
  return `${fmtDate(iter.start)} – ${fmtDate(iter.end)}`;
}

// ── Azure DevOps data fetchers ────────────────────────────────────────────────

async function fetchProject(projectConfig) {
  const projectName  = typeof projectConfig === 'string' ? projectConfig : projectConfig.name;
  const team         = typeof projectConfig === 'string' ? undefined : (projectConfig.team || undefined);
  const displayName  = team ? `${projectName} - ${team}` : projectName;
  const workItemType = typeof projectConfig === 'string' ? 'User Story' : (projectConfig.workItemType || 'User Story');
  const isTaskMode   = workItemType === 'Task';

  try {
    const types = isTaskMode
      ? ['Task', 'Bug']
      : ['User Story', 'Product Backlog Item', 'Requirement', 'Bug'];

    const wiql = await azurePost(
      `${encodeURIComponent(projectName)}/_apis/wit/wiql?api-version=7.0`,
      { query: `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${projectName}' AND [System.WorkItemType] IN ('${types.join("','")}') AND [System.State] NOT IN ('Done','Removed') ORDER BY [System.ChangedDate] DESC` }
    );

    const allIds = (wiql.workItems || []).slice(0, 500).map(w => w.id);
    if (!allIds.length) return { project: displayName, items: [], sprint: null, error: null, workItemType };

    const estimateField = isTaskMode
      ? "Microsoft.VSTS.Scheduling.RemainingWork,Microsoft.VSTS.Scheduling.OriginalEstimate"
      : "Microsoft.VSTS.Scheduling.StoryPoints";

    const fields = `System.Id,System.Title,System.State,System.WorkItemType,System.AssignedTo,${estimateField},System.IterationPath,Microsoft.VSTS.Common.StackRank`;
    const [detailsValue, { map: iterMap, currentSprint }] = await Promise.all([
      paginatedItems(projectName, allIds, fields),
      fetchIterMap(projectName, team),
    ]);

    // When monitoring a specific team, restrict items to that team's sprints only
    const items = team
      ? detailsValue.filter(i => (i.fields?.['System.IterationPath'] || '') in iterMap)
      : detailsValue;

    return { project: displayName, items, sprint: currentSprint, iterMap, error: null, workItemType };
  } catch (e) {
    return { project: displayName, items: [], sprint: null, error: e.message, workItemType };
  }
}

async function fetchProjectDetail(identifier) {
  const { getProjectConfig } = require('./config.js');
  const projectConfig = getProjectConfig(identifier) || { name: identifier, workItemType: 'User Story' };
  const project      = projectConfig.name;
  const team         = projectConfig.team || undefined;
  const displayName  = projectConfig.displayName || identifier;
  const workItemType = projectConfig.workItemType || 'User Story';
  const isTaskMode   = workItemType === 'Task';

  try {
    const types = isTaskMode
      ? ['Task', 'Bug']
      : ['User Story', 'Product Backlog Item', 'Requirement', 'Bug'];

    const [mainWiql, taskWiql, bugWiql, { map: iterMap }] = await Promise.all([
      azurePost(`${encodeURIComponent(project)}/_apis/wit/wiql?api-version=7.0`,
        { query: `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${project}' AND [System.WorkItemType] IN ('${types.join("','")}') AND [System.State] NOT IN ('Done','Removed') ORDER BY [System.ChangedDate] DESC` }),
      azurePost(`${encodeURIComponent(project)}/_apis/wit/wiql?api-version=7.0`,
        { query: `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${project}' AND [System.WorkItemType] = 'Task' ORDER BY [System.ChangedDate] DESC` }),
      azurePost(`${encodeURIComponent(project)}/_apis/wit/wiql?api-version=7.0`,
        { query: `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${project}' AND [System.WorkItemType] = 'Bug' ORDER BY [System.ChangedDate] DESC` }),
      fetchIterMap(project, team),
    ]);

    const mainIds = (mainWiql.workItems || []).slice(0, 500).map(w => w.id);
    const taskIds = (taskWiql.workItems || []).slice(0, 500).map(w => w.id);
    const bugIds  = (bugWiql.workItems  || []).slice(0, 500).map(w => w.id);

    const estimateField = isTaskMode
      ? "Microsoft.VSTS.Scheduling.RemainingWork,Microsoft.VSTS.Scheduling.OriginalEstimate"
      : "Microsoft.VSTS.Scheduling.StoryPoints";

    const mainFields = `System.Id,System.Title,System.State,System.WorkItemType,System.AssignedTo,${estimateField},Microsoft.VSTS.Scheduling.CompletedWork,System.IterationPath`;
    const workFields = "Microsoft.VSTS.Scheduling.CompletedWork,System.IterationPath";

    const [rawItems, rawTaskItems, rawBugItems] = await Promise.all([
      mainIds.length ? paginatedItems(project, mainIds, mainFields) : Promise.resolve([]),
      taskIds.length ? paginatedItems(project, taskIds, workFields) : Promise.resolve([]),
      bugIds.length  ? paginatedItems(project, bugIds,  workFields) : Promise.resolve([]),
    ]);

    const taskItems = rawTaskItems.map(t => ({
      completedWork: t.fields?.["Microsoft.VSTS.Scheduling.CompletedWork"] || 0,
      iteration:     t.fields?.["System.IterationPath"] || "",
    }));

    const bugItems = rawBugItems.map(t => ({
      completedWork: t.fields?.["Microsoft.VSTS.Scheduling.CompletedWork"] || 0,
      iteration:     t.fields?.["System.IterationPath"] || "",
    }));

    return {
      project: displayName,
      iterMap,
      taskItems,
      bugItems,
      workItemType,
      items: rawItems.map(i => {
        let pts = null;
        if (isTaskMode) {
          pts = i.fields?.["Microsoft.VSTS.Scheduling.RemainingWork"];
          if (pts == null || pts === 0) {
            pts = i.fields?.["Microsoft.VSTS.Scheduling.OriginalEstimate"];
          }
        } else {
          pts = i.fields?.["Microsoft.VSTS.Scheduling.StoryPoints"] ?? null;
        }

        return {
          state:     i.fields?.["System.State"] || "",
          type:      i.fields?.["System.WorkItemType"] || "",
          pts,
          assigned:  i.fields?.["System.AssignedTo"]?.displayName || null,
          iteration: i.fields?.["System.IterationPath"] || "",
          title:     i.fields?.["System.Title"] || "",
        };
      }),
    };
  } catch (e) {
    return { project: displayName, items: [], iterMap: {}, error: e.message, workItemType };
  }
}

// ── Card HTML builder ─────────────────────────────────────────────────────────

const ICON_COLORS = ['#3b82f6','#8b5cf6','#f59e0b','#10b981','#ef4444','#06b6d4','#f97316','#ec4899','#14b8a6','#6366f1'];
function projectIconColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  return ICON_COLORS[h % ICON_COLORS.length];
}
function projectInitials(name) {
  const base = name.includes(' - ') ? name.split(' - ')[0] : name;
  return base.split(/[\s_\-]+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('').slice(0, 2) || '??';
}

function buildCardHTML(results) {
  return results.map(({ project, items, sprint, iterMap = {}, error, workItemType = 'User Story' }) => {
    if (error) return `
      <div class="card error">
        <h2>❌ ${project}</h2>
        <p style="color:#f87171">${error}</p>
      </div>`;

    const isTaskMode = workItemType === 'Task';
    const ITEM_TYPES = isTaskMode
      ? ["Task"]
      : ["User Story", "Product Backlog Item", "Requirement"];
    const CLOSED_STATES = ["Closed", "Done", "Resolved", "Removed"];

    const mainItems = items.filter(i => ITEM_TYPES.includes(i.fields?.["System.WorkItemType"]));
    const total = mainItems.length;
    const openItems = mainItems.filter(i => !CLOSED_STATES.includes(i.fields?.["System.State"]));

    // Calcular itens sem estimativa baseado no modo
    const semEst = openItems.filter(i => {
      if (isTaskMode) {
        const remainingWork = i.fields?.["Microsoft.VSTS.Scheduling.RemainingWork"];
        const originalEstimate = i.fields?.["Microsoft.VSTS.Scheduling.OriginalEstimate"];
        return (remainingWork == null || remainingWork === 0) && (originalEstimate == null || originalEstimate === 0);
      }
      return i.fields?.["Microsoft.VSTS.Scheduling.StoryPoints"] == null;
    }).length;

    const semResp = openItems.filter(i => !i.fields?.["System.AssignedTo"]).length;
    const ACTIVE_STATES = ["Active", "In Progress", "New"];
    const bugs = items.filter(i => i.fields?.["System.WorkItemType"] === "Bug" && ACTIVE_STATES.includes(i.fields?.["System.State"])).length;
    const health = calcHealth(total, semEst, semResp, bugs);

    // Labels dinâmicos baseados no modo
    const itemLabel = isTaskMode ? 'Tasks' : 'User Stories';
    const itemLabelKey = isTaskMode ? 'stat_tasks' : 'stat_us';
    const estimateLabel = isTaskMode ? 'Horas' : 'Story Points';

    const iterations = [...new Set(
      items.map(i => i.fields?.["System.IterationPath"]).filter(Boolean)
    )].sort();

    const options = iterations.map(it => {
      const label = it.includes("\\") ? it.split("\\").slice(1).join(" › ") : it;
      const isCurrent = sprint && (it === sprint || it.endsWith("\\" + sprint));
      const val = it.replace(/'/g, "&#39;").replace(/"/g, "&quot;");
      const iter = iterMap[it] || {};
      const dateRange = fmtRange(iter);
      return `
        <label class="option-row${isCurrent ? " is-current" : ""}">
          <input type="checkbox" value="${val}" onchange="onCheckChange(this)">
          <span class="option-text">
            <span class="option-name">${label}${isCurrent ? ` 📅 <span data-i18n="sprint_current">atual</span>` : ""}</span>
            ${dateRange ? `<span class="option-date">${dateRange}</span>` : ""}
          </span>
        </label>`;
    }).join("");

    const itemsJson = JSON.stringify(items.map(i => {
      let pts = null;
      if (isTaskMode) {
        pts = i.fields?.["Microsoft.VSTS.Scheduling.RemainingWork"];
        if (pts == null || pts === 0) {
          pts = i.fields?.["Microsoft.VSTS.Scheduling.OriginalEstimate"];
        }
      } else {
        pts = i.fields?.["Microsoft.VSTS.Scheduling.StoryPoints"] ?? null;
      }

      return {
        iteration: i.fields?.["System.IterationPath"] || "",
        type: i.fields?.["System.WorkItemType"] || "",
        state: i.fields?.["System.State"] || "",
        pts,
        assigned: !!i.fields?.["System.AssignedTo"],
      };
    })).replace(/</g, "\\u003c");

    const mainTotal = mainItems.length;
    const grouped = {};
    mainItems.forEach(i => {
      const key = i.fields?.["System.IterationPath"] || "Sem Sprint";
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(i);
    });
    const sortedGroups = Object.keys(grouped).sort((a, b) => {
      const aS = iterMap[a]?.start, bS = iterMap[b]?.start;
      if (aS && bS) return new Date(aS) - new Date(bS);
      return a.localeCompare(b);
    });

    const rows = sortedGroups.map(groupKey => {
      const groupItems = grouped[groupKey];
      const groupLabel = groupKey.includes("\\") ? groupKey.split("\\").slice(1).join(" › ") : groupKey;
      const isCurrent = sprint && (groupKey === sprint || groupKey.endsWith("\\" + sprint));
      const safeGroup = groupKey.replace(/"/g, "&quot;");
      const iter = iterMap[groupKey] || {};
      const dateRange = fmtRange(iter);
      const header = `<tr class="group-header${isCurrent ? " current-group" : ""}" data-group="${safeGroup}">
        <td colspan="5">
          <span class="group-label">${groupLabel}${isCurrent ? ` 📅 <span data-i18n="sprint_current">atual</span>` : ""}</span>
          ${dateRange ? `<span class="group-date">${dateRange}</span>` : ""}
          <span class="group-count">${groupItems.length} item${groupItems.length !== 1 ? "s" : ""}</span>
        </td>
      </tr>`;

      const itemRows = groupItems.map(i => {
        const state = i.fields?.["System.State"] || "?";
        const title = i.fields?.["System.Title"] || "";
        const assigned = i.fields?.["System.AssignedTo"]?.displayName || "—";

        let pts = null;
        let ptsDisplay = "";
        if (isTaskMode) {
          pts = i.fields?.["Microsoft.VSTS.Scheduling.RemainingWork"];
          if (pts == null || pts === 0) {
            pts = i.fields?.["Microsoft.VSTS.Scheduling.OriginalEstimate"];
          }
          ptsDisplay = pts != null ? pts + " hrs" : '<span class="badge yellow" data-i18n="badge_no_est">Sem estimativa</span>';
        } else {
          pts = i.fields?.["Microsoft.VSTS.Scheduling.StoryPoints"];
          ptsDisplay = pts != null ? pts + " pts" : '<span class="badge yellow" data-i18n="badge_no_est">Sem estimativa</span>';
        }

        const iteration = groupKey.replace(/"/g, "&quot;");
        const order = i.fields?.["Microsoft.VSTS.Common.StackRank"] ?? 999999;
        const stateClass = ["Active","In Progress","Doing"].includes(state) ? "blue"
          : ["Closed","Done","Resolved"].includes(state) ? "green"
          : ["Blocked","Impediment"].includes(state) ? "red" : "gray";
        return `
          <tr data-iteration="${iteration}" data-order="${order}">
            <td>${title}</td>
            <td><span class="badge ${stateClass}">${state}</span></td>
            <td>${ptsDisplay}</td>
            <td>${assigned === "—" ? '<span class="badge red" data-i18n="badge_no_resp">Sem responsável</span>' : assigned}</td>
          </tr>`;
      }).join("");

      return header + itemRows;
    }).join("");

    // ── Sprint progress bar ──────────────────────────────────────────────────
    let progressPct = 0, barVariant = 'green', sprintLabel = sprint || '';
    if (sprint) {
      const curMain = mainItems.filter(i => {
        const it = i.fields?.['System.IterationPath'] || '';
        return it === sprint || it.endsWith('\\' + sprint);
      });
      const curClosed = curMain.filter(i => CLOSED_STATES.includes(i.fields?.['System.State']));
      if (curMain.length > 0) {
        progressPct = Math.min(Math.round(curClosed.length / curMain.length * 100), 100);
        barVariant = progressPct >= 60 ? 'green' : progressPct >= 30 ? 'yellow' : 'red';
      }
    }
    const sprintBarHtml = sprint ? `
      <div class="sprint-bar-wrap">
        <div class="sprint-bar-info">
          <span class="sprint-bar-name sprint">📅 ${sprint}</span>
          <span class="sprint-bar-pct ${barVariant}">${progressPct}% <span data-i18n="sprint_progress">Progress</span></span>
        </div>
        <div class="sprint-bar-track">
          <div class="sprint-bar-fill ${barVariant}" style="width:${progressPct}%"></div>
        </div>
      </div>` : '';

    // ── Health pill ──────────────────────────────────────────────────────────
    const healthLabels = { green: 'Healthy', yellow: 'Attention', red: 'Critical' };
    const healthPill = `<span class="health-pill ${health[1]} card-health" title="${health[2]}"><span class="health-dot"></span>${healthLabels[health[1]] || health[0]}</span>`;

    // ── Collapsible section label ────────────────────────────────────────────
    const sectionProblems = semEst + semResp;
    const sectionLabel = `<span data-i18n="btn_view_items">View Items</span>`;
    const sectionBadge = health[1] === 'red'
      ? `<span class="badge red">${sectionProblems} <span data-i18n="us_section_required">Required</span></span>`
      : health[1] === 'yellow'
        ? `<span class="badge yellow">${semEst} <span data-i18n="us_section_pending">Pending</span></span>`
        : `<span class="badge green">${openItems.length} <span data-i18n="us_section_active">Active</span></span>`;

    // ── Project icon ─────────────────────────────────────────────────────────
    const iconColor = projectIconColor(project);
    const initials  = projectInitials(project);

    // ── Footer action button ─────────────────────────────────────────────────
    const actionBtn = health[1] === 'red'
      ? `<button class="btn-fix-health" type="button" onclick="openDetails(this)" data-i18n="btn_fix_health">Fix Backlog Health</button>`
      : `<button class="btn-detail btn-detail-main" type="button" onclick="openDetails(this)" data-i18n="btn_details">Project Details</button>`;

    return `
      <div class="card" data-project="${project.replace(/"/g, "&quot;")}" data-items='${itemsJson}' data-itermap='${JSON.stringify(iterMap).replace(/</g,"\\u003c").replace(/'/g,"&#39;")}' data-workitemtype="${workItemType}">

        <!-- header -->
        <div class="card-header">
          <div class="card-header-left">
            <div class="card-icon" style="background:${iconColor}">${initials}</div>
            <div class="card-header-info">
              <div class="card-name-row">
                <span class="drag-handle" data-i18n-title="btn_drag" title="Reordenar">⠿</span>
                <h2 class="card-project-title">${project}</h2>
                <button class="btn-rename" type="button" onclick="startRename(this)" data-i18n-title="btn_rename" title="Renomear projeto">✏️</button>
              </div>
            </div>
          </div>
          ${healthPill}
        </div>

        <!-- stats -->
        <div class="stats">
          <div class="stat"><div class="stat-label card-label" data-i18n="${itemLabelKey}">${itemLabel}</div><div class="stat-val card-total">${total}</div></div>
          <div class="stat"><div class="stat-label" data-i18n="stat_no_est">No Estimate</div><div class="stat-val ${semEst > 2 ? "warn" : ""} card-semest">${semEst}</div></div>
          <div class="stat"><div class="stat-label" data-i18n="stat_no_resp">No Assignee</div><div class="stat-val ${semResp > 2 ? "warn" : ""} card-semresp">${semResp}</div></div>
          <div class="stat"><div class="stat-label" data-i18n="stat_bugs">Open Bugs</div><div class="stat-val ${bugs > 3 ? "crit" : ""} card-bugs">${bugs}</div></div>
        </div>

        <!-- sprint progress -->
        ${sprintBarHtml}

        <!-- sprint filter (functional, compact) -->
        <div class="filter-bar">
          <label class="filter-label" data-i18n="filter_label">🔍 Sprint</label>
          <div class="custom-select">
            <button class="select-trigger" type="button" onclick="toggleDropdown(this)">
              <span class="select-value" data-i18n="all_sprints">All sprints</span>
              <span class="select-arrow">▾</span>
            </button>
            <div class="select-panel">
              <div class="select-options">${options}</div>
              <div class="select-footer">
                <button type="button" onclick="clearFilter(this)" data-i18n="clear_filter">✕ Clear</button>
              </div>
            </div>
          </div>
        </div>

        <!-- collapsible US section -->
        <div class="us-section">
          <button class="btn-us-toggle card-summary" type="button" onclick="toggleUS(this)">
            <span class="us-toggle-icon">▶</span>
            ${sectionLabel}
            <span class="us-toggle-count">${sectionBadge}</span>
          </button>
          <div class="us-table" hidden>
            <table>
              <thead><tr><th data-i18n="th_title">Title</th><th data-i18n="th_status">Status</th><th data-i18n="th_estimate">Estimate</th><th data-i18n="th_assignee">Assignee</th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>

        <!-- footer -->
        <div class="card-footer">
          <button class="btn-remove-footer" type="button" onclick="removeProject(this)" data-i18n-title="btn_remove_project" title="Remover projeto">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><path d="M1 3h10M4 3V2h4v1M2 3l.5 7.5a1 1 0 001 .5h5a1 1 0 001-.5L10 3"/></svg>
            <span data-i18n="btn_remove_short">Remove</span>
          </button>
          ${actionBtn}
        </div>
      </div>`;
  }).join("");
}

module.exports = { fetchProject, fetchProjectDetail, buildCardHTML, calcHealth, fmtDate };

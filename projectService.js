const { azureGet, azurePost } = require("./azureClient");

// ── Helpers ───────────────────────────────────────────────────────────────────

function calcHealth(total, semEst, semResp, bugs) {
  const reasons = [];
  if (bugs > 10) reasons.push(`${bugs} bugs abertos (crítico: >10)`);
  else if (bugs > 5) reasons.push(`${bugs} bugs abertos (alerta: >5)`);
  if (total > 0 && semEst > total * 0.5) reasons.push(`${Math.round(semEst / total * 100)}% das US sem estimativa (crítico: >50%)`);
  else if (total > 0 && semEst > total * 0.3) reasons.push(`${Math.round(semEst / total * 100)}% das US sem estimativa (alerta: >30%)`);
  if (total > 0 && semResp > total * 0.2) reasons.push(`${Math.round(semResp / total * 100)}% das US sem responsável (alerta: >20%)`);
  const tooltip = reasons.length ? reasons.join(" · ") : "Backlog bem estruturado";
  if (bugs > 10 || semEst > total * 0.5) return ["🔴 Crítico", "red", tooltip];
  if (semEst > total * 0.3 || semResp > total * 0.2 || bugs > 5) return ["🟡 Atenção", "yellow", tooltip];
  return ["🟢 Saudável", "green", tooltip];
}

function fmtDate(d) {
  if (!d) return "";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function fmtRange(iter) {
  if (!iter?.start && !iter?.end) return "";
  return `${fmtDate(iter.start)} – ${fmtDate(iter.end)}`;
}

// ── Azure DevOps data fetchers ────────────────────────────────────────────────

async function fetchProject(project) {
  try {
    const wiql = await azurePost(
      `${encodeURIComponent(project)}/_apis/wit/wiql?api-version=7.0`,
      { query: `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${project}' AND [System.WorkItemType] IN ('User Story','Bug','Task','Feature','Epic','Product Backlog Item') AND [System.State] NOT IN ('Done','Removed') ORDER BY [System.ChangedDate] DESC` }
    );

    const allIds = (wiql.workItems || []).slice(0, 500).map(w => w.id);
    if (!allIds.length) return { project, items: [], sprint: null, error: null };

    let detailsValue = [];
    for (let i = 0; i < allIds.length; i += 200) {
      const batch = allIds.slice(i, i + 200);
      const page = await azureGet(
        `${encodeURIComponent(project)}/_apis/wit/workitems?ids=${batch.join(",")}&fields=System.Id,System.Title,System.State,System.WorkItemType,System.AssignedTo,Microsoft.VSTS.Scheduling.StoryPoints,System.IterationPath&api-version=7.0`
      );
      detailsValue = detailsValue.concat(page.value || []);
    }
    const details = { value: detailsValue };

    let sprint = null;
    let iterMap = {};
    for (const teamName of [`${project} Team`, project]) {
      try {
        const sprintData = await azureGet(
          `${encodeURIComponent(project)}/${encodeURIComponent(teamName)}/_apis/work/teamsettings/iterations?api-version=7.0`
        );
        if (sprintData.value?.length) {
          (sprintData.value || []).forEach(it => {
            iterMap[it.path] = {
              start: it.attributes?.startDate ? new Date(it.attributes.startDate) : null,
              end:   it.attributes?.finishDate ? new Date(it.attributes.finishDate) : null,
              isCurrent: it.attributes?.timeFrame === "current",
            };
            if (it.attributes?.timeFrame === "current") sprint = it.name;
          });
          break;
        }
      } catch (_) {}
    }

    return { project, items: details.value || [], sprint, iterMap, error: null };
  } catch (e) {
    return { project, items: [], sprint: null, error: e.message };
  }
}

async function fetchProjectDetail(project) {
  try {
    const wiql = await azurePost(
      `${encodeURIComponent(project)}/_apis/wit/wiql?api-version=7.0`,
      { query: `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${project}' AND [System.WorkItemType] IN ('User Story','Bug','Task','Feature','Epic','Product Backlog Item') AND [System.State] NOT IN ('Done','Removed') ORDER BY [System.ChangedDate] DESC` }
    );
    const allIds = (wiql.workItems || []).slice(0, 500).map(w => w.id);

    let items = [];
    for (let i = 0; i < allIds.length; i += 200) {
      const batch = allIds.slice(i, i + 200);
      const details = await azureGet(
        `${encodeURIComponent(project)}/_apis/wit/workitems?ids=${batch.join(",")}&fields=System.Id,System.Title,System.State,System.WorkItemType,System.AssignedTo,Microsoft.VSTS.Scheduling.StoryPoints,Microsoft.VSTS.Scheduling.CompletedWork,System.IterationPath&api-version=7.0`
      );
      items = items.concat(details.value || []);
    }

    const [taskWiql, bugWiql, allWiql] = await Promise.all([
      azurePost(`${encodeURIComponent(project)}/_apis/wit/wiql?api-version=7.0`,
        { query: `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${project}' AND [System.WorkItemType] = 'Task' ORDER BY [System.ChangedDate] DESC` }),
      azurePost(`${encodeURIComponent(project)}/_apis/wit/wiql?api-version=7.0`,
        { query: `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${project}' AND [System.WorkItemType] = 'Bug' ORDER BY [System.ChangedDate] DESC` }),
      azurePost(`${encodeURIComponent(project)}/_apis/wit/wiql?api-version=7.0`,
        { query: `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${project}' AND [System.WorkItemType] IN ('User Story','Bug','Task','Feature','Epic','Product Backlog Item') AND [System.State] <> 'Removed' ORDER BY [System.ChangedDate] DESC` }),
    ]);

    const taskIds = (taskWiql.workItems || []).slice(0, 500).map(w => w.id);
    let taskItems = [];
    for (let i = 0; i < taskIds.length; i += 200) {
      const batch = taskIds.slice(i, i + 200);
      const details = await azureGet(
        `${encodeURIComponent(project)}/_apis/wit/workitems?ids=${batch.join(",")}&fields=Microsoft.VSTS.Scheduling.CompletedWork,System.IterationPath&api-version=7.0`
      );
      taskItems = taskItems.concat((details.value || []).map(t => ({
        completedWork: t.fields?.["Microsoft.VSTS.Scheduling.CompletedWork"] || 0,
        iteration:     t.fields?.["System.IterationPath"] || "",
      })));
    }

    const bugIds = (bugWiql.workItems || []).slice(0, 500).map(w => w.id);
    let bugItems = [];
    for (let i = 0; i < bugIds.length; i += 200) {
      const batch = bugIds.slice(i, i + 200);
      const details = await azureGet(
        `${encodeURIComponent(project)}/_apis/wit/workitems?ids=${batch.join(",")}&fields=Microsoft.VSTS.Scheduling.CompletedWork,System.IterationPath&api-version=7.0`
      );
      bugItems = bugItems.concat((details.value || []).map(t => ({
        completedWork: t.fields?.["Microsoft.VSTS.Scheduling.CompletedWork"] || 0,
        iteration:     t.fields?.["System.IterationPath"] || "",
      })));
    }

    const allIds2 = (allWiql.workItems || []).slice(0, 500).map(w => w.id);
    let allItems = [];
    for (let i = 0; i < allIds2.length; i += 200) {
      const batch = allIds2.slice(i, i + 200);
      const details = await azureGet(
        `${encodeURIComponent(project)}/_apis/wit/workitems?ids=${batch.join(",")}&fields=System.WorkItemType,System.State,System.IterationPath&api-version=7.0`
      );
      allItems = allItems.concat((details.value || []).map(i => ({
        type:      i.fields?.["System.WorkItemType"] || "",
        state:     i.fields?.["System.State"] || "",
        iteration: i.fields?.["System.IterationPath"] || "",
      })));
    }

    let iterMap = {};
    for (const teamName of [`${project} Team`, project]) {
      try {
        const sd = await azureGet(`${encodeURIComponent(project)}/${encodeURIComponent(teamName)}/_apis/work/teamsettings/iterations?api-version=7.0`);
        if (sd.value?.length) {
          sd.value.forEach(it => {
            iterMap[it.path] = { start: it.attributes?.startDate || null, end: it.attributes?.finishDate || null, isCurrent: it.attributes?.timeFrame === "current" };
          });
          break;
        }
      } catch (_) {}
    }

    return {
      project,
      iterMap,
      taskItems,
      bugItems,
      allItems,
      items: items.map(i => ({
        state:     i.fields?.["System.State"] || "",
        type:      i.fields?.["System.WorkItemType"] || "",
        pts:       i.fields?.["Microsoft.VSTS.Scheduling.StoryPoints"] ?? null,
        assigned:  i.fields?.["System.AssignedTo"]?.displayName || null,
        iteration: i.fields?.["System.IterationPath"] || "",
        title:     i.fields?.["System.Title"] || "",
      })),
    };
  } catch (e) {
    return { project, items: [], iterMap: {}, error: e.message };
  }
}

// ── Card HTML builder ─────────────────────────────────────────────────────────

function buildCardHTML(results) {
  return results.map(({ project, items, sprint, iterMap = {}, error }) => {
    if (error) return `
      <div class="card error">
        <h2>❌ ${project}</h2>
        <p style="color:#f87171">${error}</p>
      </div>`;

    const US_TYPES = ["User Story", "Product Backlog Item", "Requirement"];
    const CLOSED_STATES = ["Closed", "Done", "Resolved", "Removed"];
    const usOnlyItems = items.filter(i => US_TYPES.includes(i.fields?.["System.WorkItemType"]));
    const total = usOnlyItems.length;
    const openUS = usOnlyItems.filter(i => !CLOSED_STATES.includes(i.fields?.["System.State"]));
    const semEst = openUS.filter(i => i.fields?.["Microsoft.VSTS.Scheduling.StoryPoints"] == null).length;
    const semResp = openUS.filter(i => !i.fields?.["System.AssignedTo"]).length;
    const ACTIVE_STATES = ["Active", "In Progress", "New"];
    const bugs = items.filter(i => i.fields?.["System.WorkItemType"] === "Bug" && ACTIVE_STATES.includes(i.fields?.["System.State"])).length;
    const health = calcHealth(total, semEst, semResp, bugs);

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
            <span class="option-name">${label}${isCurrent ? " 📅 atual" : ""}</span>
            ${dateRange ? `<span class="option-date">${dateRange}</span>` : ""}
          </span>
        </label>`;
    }).join("");

    const itemsJson = JSON.stringify(items.map(i => ({
      iteration: i.fields?.["System.IterationPath"] || "",
      type: i.fields?.["System.WorkItemType"] || "",
      state: i.fields?.["System.State"] || "",
      pts: i.fields?.["Microsoft.VSTS.Scheduling.StoryPoints"] ?? null,
      assigned: !!i.fields?.["System.AssignedTo"],
    }))).replace(/</g, "\\u003c");

    const usTotal = usOnlyItems.length;
    const grouped = {};
    usOnlyItems.forEach(i => {
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
          <span class="group-label">${groupLabel}${isCurrent ? " 📅 atual" : ""}</span>
          ${dateRange ? `<span class="group-date">${dateRange}</span>` : ""}
          <span class="group-count">${groupItems.length} item${groupItems.length !== 1 ? "s" : ""}</span>
        </td>
      </tr>`;

      const itemRows = groupItems.map(i => {
        const state = i.fields?.["System.State"] || "?";
        const title = i.fields?.["System.Title"] || "";
        const assigned = i.fields?.["System.AssignedTo"]?.displayName || "—";
        const pts = i.fields?.["Microsoft.VSTS.Scheduling.StoryPoints"];
        const iteration = groupKey.replace(/"/g, "&quot;");
        const stateClass = ["Active","In Progress","Doing"].includes(state) ? "blue"
          : ["Closed","Done","Resolved"].includes(state) ? "green"
          : ["Blocked","Impediment"].includes(state) ? "red" : "gray";
        return `
          <tr data-iteration="${iteration}">
            <td>${title}</td>
            <td><span class="badge ${stateClass}">${state}</span></td>
            <td>${pts != null ? pts + " pts" : '<span class="badge yellow">Sem estimativa</span>'}</td>
            <td>${assigned === "—" ? '<span class="badge red">Sem responsável</span>' : assigned}</td>
          </tr>`;
      }).join("");

      return header + itemRows;
    }).join("");

    return `
      <div class="card" data-project="${project.replace(/"/g, "&quot;")}" data-items='${itemsJson}'>
        <div class="card-header">
          <div>
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
              <h2>${project}</h2>
              <button class="btn-detail" type="button" onclick="openDetails(this)">📊 Detalhes do projeto</button>
            </div>
            ${sprint ? `<span class="sprint">📅 ${sprint}</span>` : ""}
          </div>
          <span class="badge ${health[1]} big card-health" title="${health[2]}">${health[0]}</span>
        </div>
        <div class="filter-bar">
          <label class="filter-label">🔍 Sprint</label>
          <div class="custom-select">
            <button class="select-trigger" type="button" onclick="toggleDropdown(this)">
              <span class="select-value">Todas as sprints</span>
              <span class="select-arrow">▾</span>
            </button>
            <div class="select-panel">
              <div class="select-options">${options}</div>
              <div class="select-footer">
                <button type="button" onclick="clearFilter(this)">✕ Limpar seleção</button>
              </div>
            </div>
          </div>
        </div>
        <div class="stats">
          <div class="stat"><div class="stat-label">User Stories</div><div class="stat-val card-total">${total}</div></div>
          <div class="stat"><div class="stat-label">Sem Estimativa</div><div class="stat-val ${semEst > 2 ? "warn" : ""} card-semest">${semEst}</div></div>
          <div class="stat"><div class="stat-label">Sem Responsável</div><div class="stat-val ${semResp > 2 ? "warn" : ""} card-semresp">${semResp}</div></div>
          <div class="stat"><div class="stat-label">Bugs Abertos</div><div class="stat-val ${bugs > 3 ? "crit" : ""} card-bugs">${bugs}</div></div>
        </div>
        <div class="us-section">
          <button class="btn-us-toggle card-summary" type="button" onclick="toggleUS(this)">
            <span class="us-toggle-icon">▶</span>
            Visualizar User Stories
            <span class="us-toggle-count">(${usTotal})</span>
          </button>
          <div class="us-table" hidden>
            <table>
              <thead><tr><th>Título</th><th>Status</th><th>Estimativa</th><th>Responsável</th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>
      </div>`;
  }).join("");
}

module.exports = { fetchProject, fetchProjectDetail, buildCardHTML, calcHealth, fmtDate };

const { azureGet, azurePost } = require("./azureClient");
const { calcHealth }    = require("./utils/health");
const { paginatedItems } = require("./utils/paginate");
const { fetchIterMap }  = require("./utils/iterMap");
const { getCfg }        = require("./config");

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
    const [detailsValue, { map: iterMap, currentSprint }, planData] = await Promise.all([
      paginatedItems(projectName, allIds, fields),
      fetchIterMap(projectName, team),
      azureGet(`${encodeURIComponent(projectName)}/_apis/testplan/plans?api-version=7.0`).catch(() => null),
    ]);
    const testPlanCount = planData ? (planData.count || (planData.value || []).length) : 0;

    // When monitoring a specific team, restrict items to that team's sprints only
    const items = team
      ? detailsValue.filter(i => (i.fields?.['System.IterationPath'] || '') in iterMap)
      : detailsValue;

    return { project: displayName, items, sprint: currentSprint, iterMap, error: null, workItemType, testPlanCount };
  } catch (e) {
    return { project: displayName, items: [], sprint: null, error: e.message, workItemType };
  }
}

async function fetchProjectDetail(identifier) {
  const { getProjectConfig, getCfg } = require('./config.js');
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
    const workFields = "Microsoft.VSTS.Scheduling.CompletedWork,Microsoft.VSTS.Scheduling.OriginalEstimate,System.IterationPath";

    const [rawItems, rawTaskItems, rawBugItems] = await Promise.all([
      mainIds.length ? paginatedItems(project, mainIds, mainFields) : Promise.resolve([]),
      taskIds.length ? paginatedItems(project, taskIds, workFields) : Promise.resolve([]),
      bugIds.length  ? paginatedItems(project, bugIds,  workFields) : Promise.resolve([]),
    ]);

    const taskItems = rawTaskItems.map(t => ({
      completedWork:    t.fields?.["Microsoft.VSTS.Scheduling.CompletedWork"] || 0,
      originalEstimate: t.fields?.["Microsoft.VSTS.Scheduling.OriginalEstimate"] || 0,
      iteration:        t.fields?.["System.IterationPath"] || "",
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

        const baseUrl = getCfg().baseUrl || '';
        return {
          id:        i.id,
          url:       i.id && baseUrl ? `${baseUrl}/_workitems/edit/${i.id}` : "",
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

function buildCardHTML(results, baseUrl = '') {
  return results.map(({ project, items, sprint, iterMap = {}, error, workItemType = 'User Story', testPlanCount = 0 }) => {
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

    const totalPts = isTaskMode ? null : mainItems.reduce((sum, i) => {
      const pts = i.fields?.["Microsoft.VSTS.Scheduling.StoryPoints"];
      return sum + (pts != null ? pts : 0);
    }, 0);
    const closedCount = mainItems.filter(i => CLOSED_STATES.includes(i.fields?.["System.State"])).length;

    const health = calcHealth(openItems.length, semEst, semResp, bugs, getCfg().health);

    // Labels dinâmicos baseados no modo
    const itemLabel = isTaskMode ? 'Tasks' : 'User Stories';
    const itemLabelKey = isTaskMode ? 'stat_tasks' : 'stat_us';
    const estimateLabel = isTaskMode ? 'Horas' : 'Story Points';

    const iterations = [...new Set(
      items.map(i => i.fields?.["System.IterationPath"]).filter(Boolean)
    )].sort();

    const options = iterations.map(it => {
      const label = it.includes("\\") ? it.split("\\").pop() : it;
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
        id: i.id,
        title: i.fields?.["System.Title"] || "",
        url: i.id && baseUrl ? `${baseUrl}/_workitems/edit/${i.id}` : "",
        iteration: i.fields?.["System.IterationPath"] || "",
        type: i.fields?.["System.WorkItemType"] || "",
        state: i.fields?.["System.State"] || "",
        pts,
        assigned: !!i.fields?.["System.AssignedTo"],
        assignedTo: i.fields?.["System.AssignedTo"]?.displayName || "",
      };
    })).replace(/</g, "\\u003c").replace(/'/g, "&#39;");


    // ── Sprint progress bar ──────────────────────────────────────────────────
    let progressPct = 0, barVariant = 'green';
    let curSprintTotal = 0, curSprintClosed = 0;
    if (sprint) {
      const curMain = mainItems.filter(i => {
        const it = i.fields?.['System.IterationPath'] || '';
        return it === sprint || it.endsWith('\\' + sprint);
      });
      const curClosed = curMain.filter(i => CLOSED_STATES.includes(i.fields?.['System.State']));
      curSprintTotal  = curMain.length;
      curSprintClosed = curClosed.length;
      if (curMain.length > 0) {
        progressPct = Math.min(Math.round(curClosed.length / curMain.length * 100), 100);
        barVariant = progressPct >= 60 ? 'green' : progressPct >= 30 ? 'yellow' : 'red';
      }
    }
    const sprintBarHtml = sprint ? `
      <div class="card-prog">
        <div class="prog-row">
          <span class="prog-lbl" data-i18n="prog_closed_total">Closed / Total</span>
          <span class="prog-pct">${curSprintClosed} / ${curSprintTotal} · ${progressPct}%</span>
        </div>
        <div class="prog-track"><div class="prog-fill ${barVariant}" style="width:${progressPct}%"></div></div>
      </div>` : '';

    // ── Health pill ──────────────────────────────────────────────────────────
    const healthLabels = { green: 'Healthy', yellow: 'Attention', red: 'Critical' };
    const healthPill = `<span class="health-pill ${health[1]} card-health" title="${health[2]}"><span class="health-dot"></span>${healthLabels[health[1]] || health[0]}</span>`;

    // ── Project icon ─────────────────────────────────────────────────────────
    const iconColor = projectIconColor(project);
    const initials  = projectInitials(project);

    const actionBtn = `<button class="ca" type="button" onclick="openDetails(this)" data-i18n="btn_details">Details</button>`;

    const sprintDotColor = health[1] === 'red' ? 'var(--c-red2)' : health[1] === 'yellow' ? 'var(--c-yellow2)' : 'var(--c-green2)';

    // ── Sem sprint (itens sem iteração atribuída) ────────────────────────────
    const noSprint = openItems.filter(i => {
      const it = i.fields?.['System.IterationPath'] || '';
      return !it.includes('\\');
    }).length;
    const noSprintHtml = `<div class="card-issues"${noSprint === 0 ? ' style="display:none"' : ''}><div class="itag i" onclick="openCardStat(this,'noSprint')"><span class="no-sprint-val">${noSprint}</span>&nbsp;<span data-i18n="itag_no_sprint">sem sprint</span></div></div>`;

    return `
      <div class="card" data-project="${project.replace(/"/g, "&quot;")}" data-items='${itemsJson}' data-itermap='${JSON.stringify(iterMap).replace(/</g,"\\u003c").replace(/'/g,"&#39;")}' data-workitemtype="${workItemType}">

        <div class="health-hbar ${health[1]}"></div>

        <!-- header -->
        <div class="card-header">
          <div class="card-header-left">
            <div class="card-icon" style="background:${iconColor}">${initials}</div>
            <div class="card-header-info">
              <div class="card-name-row">
                <h2 class="card-project-title">${project}</h2>
              </div>
              <div class="card-sprint-row">
                <span class="sprint-dot" style="background:${sprintDotColor}"></span>
                <div class="custom-select card-sprint-select">
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
                <span class="card-sprint-type">· ${isTaskMode ? 'Task' : 'User Story'}</span>
              </div>
            </div>
          </div>
          ${healthPill}
        </div>

        <!-- stats -->
        <div class="card-stats">
          <div class="cstat" onclick="openCardStat(this,'us')">
            <div class="cstat-lbl" data-i18n="cstat_total">Total</div>
            <div class="cstat-val card-total">${total}</div>
            <div class="cstat-sub">${itemLabel.toLowerCase()}</div>
          </div>
          <div class="cstat" onclick="openCardStat(this,'bugs')">
            <div class="cstat-lbl" data-i18n="stat_bugs">Open Bugs</div>
            <div class="cstat-val ${bugs > 3 ? 'c' : bugs > 0 ? 'w' : 'g'} card-bugs">${bugs}</div>
            <div class="cstat-sub">${bugs === 0 ? `<span data-i18n="cstat_none">none active</span>` : `<span data-i18n="cstat_need_attention">need attention</span>`}</div>
          </div>
          <div class="cstat" onclick="openCardStat(this,'noEst')">
            <div class="cstat-lbl" data-i18n="stat_no_est">No Estimate</div>
            <div class="cstat-val ${semEst > 2 ? 'c' : semEst > 0 ? 'w' : 'g'} card-semest">${semEst}</div>
            <div class="cstat-sub">${semEst > 2 ? `<span data-i18n="cstat_above_limit">above limit</span>` : `<span data-i18n="cstat_within_limit">within limit</span>`}</div>
          </div>
          <div class="cstat" onclick="openCardStat(this,'noResp')">
            <div class="cstat-lbl" data-i18n="stat_no_resp">No Assignee</div>
            <div class="cstat-val ${semResp > 2 ? 'c' : semResp > 0 ? 'w' : 'g'} card-semresp">${semResp}</div>
            <div class="cstat-sub">${semResp === 0 ? `<span data-i18n="cstat_all_assigned">all assigned</span>` : `<span data-i18n="cstat_unassigned">unassigned</span>`}</div>
          </div>
        </div>

        <!-- sprint progress -->
        ${sprintBarHtml}

        <!-- issue tags -->
        ${noSprintHtml}

        <!-- footer -->
        <div class="card-footer">
          <div class="card-footer-actions">
            ${actionBtn}
            <button class="ca" type="button" onclick="openDailyForProject(this.closest('[data-project]').dataset.project)" data-i18n="btn_daily">Daily</button>
            <button class="ca" type="button" onclick="openBurndownFromDaily(this.closest('[data-project]').dataset.project)" data-i18n="btn_burndown">Burndown</button>
            <button class="ca" type="button" onclick="openUAT(this)" data-i18n="btn_uat">UAT</button>
            <button class="ca" type="button" onclick="openReport(this)" data-i18n="btn_monthly_review">Monthly Review</button>
          </div>
          <span class="foot-sep"></span>
          <div class="more-wrap">
            <button class="btn-more" type="button" onclick="toggleCardMore(this)" title="More options">
              <svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>
            </button>
            <div class="more-panel">
              <div class="more-item" onclick="startRename(this)">
                <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                <span data-i18n="btn_rename">Rename project</span>
              </div>
              <div class="more-divider"></div>
              <div class="more-item danger btn-remove-project" onclick="removeProject(this)">
                <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
                <span data-i18n="btn_remove_project">Remove project</span>
              </div>
            </div>
          </div>
        </div>
      </div>`;
  }).join("");
}

async function _fetchTestPoints(project, planId, suiteId) {
  let allPoints = [], skip = 0;
  const top = 1000;
  while (true) {
    let data;
    try {
      data = await azureGet(
        `${encodeURIComponent(project)}/_apis/testplan/Plans/${planId}/Suites/${suiteId}/TestPoint?isRecursive=true&$top=${top}&$skip=${skip}&api-version=7.0`
      );
    } catch (_) { break; }
    const pts = data.value || [];
    allPoints = allPoints.concat(pts);
    if (pts.length < top) break;
    skip += top;
    if (skip > 10000) break;
  }

  return allPoints;
}

async function fetchUATPlans(identifier) {
  const { getProjectConfig, getCfg } = require('./config.js');
  const projectConfig = getProjectConfig(identifier) || { name: identifier };
  const project  = projectConfig.name;
  const baseUrl  = getCfg().baseUrl || '';
  const data     = await azureGet(`${encodeURIComponent(project)}/_apis/testplan/plans?api-version=7.0`);
  const plans = await Promise.all((data.value || []).map(async p => {
    let passCount = 0, failCount = 0, blockedCount = 0, notExecutedCount = 0, points = [];
    const rootSuiteId = p.rootSuite && p.rootSuite.id;
    if (rootSuiteId) {
      try {
        const raw = await _fetchTestPoints(project, p.id, rootSuiteId);
        points = raw.map(pt => {
          const outcome = ((pt.results && pt.results.outcome) || pt.outcome || '').toLowerCase();
          if      (outcome === 'passed')  passCount++;
          else if (outcome === 'failed')  failCount++;
          else if (outcome === 'blocked') blockedCount++;
          else                            notExecutedCount++;
          const tcRef = pt.testCaseReference || pt.testCase || {};
          return {
            id:         pt.id,
            testCaseId: tcRef.id || null,
            name:       tcRef.name || '',
            tester:     (pt.tester  && pt.tester.displayName) || '',
            outcome,
            priority:   typeof pt.priority === 'number' ? pt.priority : 0,
          };
        });
      } catch (_) {}
    }
    const totalCount = passCount + failCount + blockedCount + notExecutedCount;
    return {
      id:              p.id,
      name:            p.name || '',
      iteration:       p.iteration || '',
      state:           p.state || '',
      startDate:       p.startDate || null,
      endDate:         p.endDate   || null,
      url:             p.id ? `${baseUrl}/${encodeURIComponent(project)}/_testPlans/execute?planId=${p.id}` : '',
      passCount,
      failCount,
      blockedCount,
      notExecutedCount,
      totalCount,
      points,
    };
  }));
  return { plans };
}

module.exports = { fetchProject, fetchProjectDetail, buildCardHTML, calcHealth, fmtDate, fetchUATPlans };

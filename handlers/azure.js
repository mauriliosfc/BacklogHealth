const { getCfg, getDisplayName } = require('../config');
const { azureGet } = require('../azureClient');
const { fetchProjectDetail, fetchUATPlans } = require('../projectService');
const { fetchTeamCapacity } = require('../teamCapacityService');
const { httpError } = require('./utils');

async function getDetail({ project }) {
  const cfg          = getCfg();
  const displayNames = (cfg.projects || []).map(p => getDisplayName(p));
  if (!project || !displayNames.includes(project)) httpError(400, 'Projeto não encontrado');
  return fetchProjectDetail(project);
}

async function getTeamCapacity({ project }) {
  return fetchTeamCapacity(project);
}

async function getUAT({ project }) {
  return fetchUATPlans(project);
}

async function getReportFields({ project }) {
  const cfg   = getCfg();
  const pcfg  = (cfg.projects || []).find(p => getDisplayName(p) === project);
  const proj  = pcfg?.name || project;
  const r     = await azureGet(`${encodeURIComponent(proj)}/_apis/wit/fields?api-version=7.0`);
  const STANDARD = new Set([
    'System.AreaPath',
    'System.IterationPath',
    'System.WorkItemType',
    'System.State',
    'System.AssignedTo',
    'System.Tags',
    'Microsoft.VSTS.Common.Priority',
    'Microsoft.VSTS.Common.ValueArea',
    'Microsoft.VSTS.Common.Activity',
  ]);
  const fields = (r.value || [])
    .filter(f => f.referenceName.startsWith('Custom.') || STANDARD.has(f.referenceName))
    .map(f => ({ ref: f.referenceName, label: f.name }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return { fields };
}

async function getUSStates({ project }) {
  const cfg  = getCfg();
  const pcfg = (cfg.projects || []).find(p => getDisplayName(p) === project);
  const proj = pcfg?.name || project;
  const type = pcfg?.workItemType || 'User Story';
  const r    = await azureGet(
    `${encodeURIComponent(proj)}/_apis/wit/workitemtypes/${encodeURIComponent(type)}/states?api-version=7.0`
  );
  return { states: (r.value || []).map(s => s.name) };
}

// Builds rich AI context from all project details. Mirrors the data shown
// in the detail modal so the AI can answer with the same depth.
async function getContext({ filters = {} } = {}) {
  const cfg          = getCfg();
  const displayNames = (cfg.projects || []).map(p => getDisplayName(p));
  const details      = await Promise.all(displayNames.map(id => fetchProjectDetail(id)));

  const US_TYPES = ['User Story', 'Product Backlog Item', 'Requirement'];
  const CLOSED   = ['Closed', 'Done', 'Resolved'];
  const ACTIVE   = ['Active', 'In Progress', 'Doing', 'Committed'];
  const r1       = v => Math.round(v * 10) / 10;

  const projects = details.map(data => {
    const { project, items, taskItems, bugItems, iterMap, workItemType } = data;
    const isTaskMode = workItemType === 'Task';

    const activeFilter = (filters[project] || []).map(f => f.split('\\').pop());
    const hasFilter    = activeFilter.length > 0;
    const spName       = iter => (iter || '').split('\\').pop();
    const inFilter     = sp => !hasFilter || activeFilter.includes(sp);

    const filteredItems = items.filter(i => inFilter(spName(i.iteration)));
    const filteredTasks = taskItems.filter(t => inFilter(spName(t.iteration)));
    const filteredBugs  = bugItems.filter(b => inFilter(spName(b.iteration)));

    const ITEM_TYPES  = isTaskMode ? ['Task'] : US_TYPES;
    const mainItems   = filteredItems.filter(i => ITEM_TYPES.includes(i.type));
    const mainTotal   = mainItems.length;

    const totalPts    = filteredItems.reduce((s, i) => s + (i.pts || 0), 0);
    const donePts     = filteredItems.filter(i => CLOSED.includes(i.state)).reduce((s, i) => s + (i.pts || 0), 0);
    const inProgress  = filteredItems.filter(i => ACTIVE.includes(i.state)).length;
    const newCount    = filteredItems.filter(i => i.state === 'New').length;
    const taskHrs     = r1(filteredTasks.reduce((s, t) => s + (t.completedWork || 0), 0));
    const bugHrs      = r1(filteredBugs.reduce((s, b) => s + (b.completedWork || 0), 0));
    const openBugsCount = items.filter(
      i => i.type === 'Bug' && ['Active', 'In Progress', 'New'].includes(i.state) && inFilter(spName(i.iteration))
    ).length;

    const mainClosed  = mainItems.filter(i => CLOSED.includes(i.state)).length;
    const mainUAT     = mainItems.filter(i => i.state === 'UAT').length;
    const mainNoEst   = mainItems.filter(i => !i.pts).length;
    const totalHrs    = taskHrs + bugHrs;
    const health = {
      completionRate:   mainTotal ? Math.round(mainClosed / mainTotal * 100) : 0,
      inUAT_pct:        mainTotal ? Math.round(mainUAT   / mainTotal * 100) : 0,
      inUAT_count:      mainUAT,
      bugRate_pct:      totalHrs  ? Math.round(bugHrs    / totalHrs  * 100) : 0,
      estimateCoverage: mainTotal ? Math.round((mainTotal - mainNoEst) / mainTotal * 100) : 0,
    };

    const byStatus = {};
    mainItems.forEach(i => { byStatus[i.state] = (byStatus[i.state] || 0) + 1; });
    const byStatusArr = Object.entries(byStatus)
      .sort((a, b) => b[1] - a[1])
      .map(([status, count]) => ({ status, count }));

    const byAssignee = {};
    mainItems.forEach(i => {
      const n = i.assigned || 'Sem responsável';
      byAssignee[n] = (byAssignee[n] || 0) + 1;
    });
    const byAssigneeArr = Object.entries(byAssignee)
      .sort((a, b) => b[1] - a[1]).slice(0, 15)
      .map(([assignee, count]) => ({ assignee, count }));

    const sprintMap = {};
    filteredItems.forEach(i => {
      const sp = spName(i.iteration) || 'Sem Sprint';
      if (!sprintMap[sp]) sprintMap[sp] = { us: 0, usClosed: 0, pts: 0, taskHrs: 0, bugHrs: 0 };
      if (ITEM_TYPES.includes(i.type)) {
        sprintMap[sp].us++;
        if (CLOSED.includes(i.state)) sprintMap[sp].usClosed++;
      }
      sprintMap[sp].pts += i.pts || 0;
    });
    filteredTasks.forEach(t => {
      const sp = spName(t.iteration) || 'Sem Sprint';
      if (sprintMap[sp]) sprintMap[sp].taskHrs += t.completedWork || 0;
    });
    filteredBugs.forEach(b => {
      const sp = spName(b.iteration) || 'Sem Sprint';
      if (sprintMap[sp]) sprintMap[sp].bugHrs += b.completedWork || 0;
    });

    const currentEntry      = Object.entries(iterMap).find(([, v]) => v.isCurrent);
    const currentSprintName = currentEntry?.[0] ? spName(currentEntry[0]) : null;

    const sprintDistribution = Object.entries(sprintMap)
      .map(([sprint, s]) => {
        const meta = Object.entries(iterMap).find(([k]) => spName(k) === sprint);
        return {
          sprint,
          isCurrent:     meta?.[1]?.isCurrent || false,
          start:         meta?.[1]?.start || null,
          end:           meta?.[1]?.end   || null,
          totalUS:       s.us,
          completedUS:   s.usClosed,
          completionPct: s.us ? Math.round(s.usClosed / s.us * 100) : 0,
          storyPoints:   r1(s.pts),
          taskHrs:       r1(s.taskHrs),
          bugHrs:        r1(s.bugHrs),
        };
      })
      .sort((a, b) => (a.start || '').localeCompare(b.start || ''));

    const effectiveSprint = hasFilter
      ? (activeFilter.includes(currentSprintName) ? currentSprintName : activeFilter[activeFilter.length - 1])
      : currentSprintName;
    const currentSprintItems = effectiveSprint
      ? mainItems.filter(i => spName(i.iteration) === effectiveSprint)
                 .map(i => ({ title: i.title, state: i.state, pts: i.pts, assignee: i.assigned }))
      : [];

    const openMain    = mainItems.filter(i => !CLOSED.includes(i.state));
    const noEstItems  = openMain.filter(i => !i.pts).map(i => ({ title: i.title, sprint: spName(i.iteration), assignee: i.assigned }));
    const noRespItems = openMain.filter(i => !i.assigned).map(i => ({ title: i.title, sprint: spName(i.iteration), pts: i.pts }));
    const openBugs    = items
      .filter(i => i.type === 'Bug' && ['Active', 'In Progress', 'New'].includes(i.state) && inFilter(spName(i.iteration)))
      .map(i => ({ title: i.title, state: i.state, sprint: spName(i.iteration) }));

    return {
      name: project,
      workItemType,
      activeSprintFilter: hasFilter ? activeFilter : null,
      summary: {
        totalItems:   filteredItems.length,
        userStories:  mainTotal,
        storyPoints:  r1(totalPts),
        deliveredPts: r1(donePts),
        inProgress,
        new:          newCount,
        noEstimate:   mainNoEst,
        taskHrs,
        bugHrs,
        openBugs:     openBugsCount,
      },
      healthIndicators:  health,
      byStatus:          byStatusArr,
      byAssignee:        byAssigneeArr,
      sprintDistribution,
      currentSprint: effectiveSprint ? {
        name:  effectiveSprint,
        start: currentEntry?.[1]?.start || null,
        end:   currentEntry?.[1]?.end   || null,
        items: currentSprintItems,
      } : null,
      noEstimateItems: noEstItems.slice(0, 30),
      noAssigneeItems: noRespItems.slice(0, 30),
      openBugs:        openBugs.slice(0, 30),
    };
  });

  return { projects };
}

module.exports = { getDetail, getTeamCapacity, getUAT, getReportFields, getUSStates, getContext };

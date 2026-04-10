const { azurePost }       = require('./azureClient');
const { paginatedItems }  = require('./utils/paginate');
const { fetchIterMap }    = require('./utils/iterMap');
const { getProjectConfig, getDisplayName, getCfg } = require('./config');

const r1 = v => Math.round(v * 10) / 10;
const spName = iter => (iter || '').split('\\').pop();

async function fetchTeamCapacity(identifier) {
  const cfg = getCfg();

  // Resolve project config
  let projectConfig = identifier ? getProjectConfig(identifier) : null;
  if (!projectConfig && cfg.projects?.length) projectConfig = cfg.projects[0];
  if (!projectConfig) throw new Error('No project configured');

  const project     = projectConfig.name;
  const team        = projectConfig.team;
  const displayName = getDisplayName(projectConfig);

  // Fetch tasks and iterMap in parallel
  const [taskWiql, { map: iterMap, currentSprint }] = await Promise.all([
    azurePost(
      `${encodeURIComponent(project)}/_apis/wit/wiql?api-version=7.0`,
      { query: `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${project}' AND [System.WorkItemType] = 'Task' ORDER BY [System.IterationPath] DESC` }
    ),
    fetchIterMap(project, team),
  ]);

  const taskIds = (taskWiql.workItems || []).slice(0, 500).map(w => w.id);

  let rawTasks = [];
  if (taskIds.length) {
    const fields = 'System.AssignedTo,Microsoft.VSTS.Scheduling.CompletedWork,Microsoft.VSTS.Scheduling.RemainingWork,System.IterationPath,System.State';
    rawTasks = await paginatedItems(project, taskIds, fields);
  }

  // If team-scoped, restrict to that team's sprint paths
  if (team) {
    const teamPaths = new Set(Object.keys(iterMap));
    rawTasks = rawTasks.filter(t => teamPaths.has(t.fields?.['System.IterationPath'] || ''));
  }

  // Ordered sprint list (with dates)
  const allSprints = Object.entries(iterMap)
    .filter(([, v]) => v.start)
    .sort((a, b) => (a[1].start || '').localeCompare(b[1].start || ''));

  // Index of current sprint
  let currentIdx = currentSprint
    ? allSprints.findIndex(([k]) => spName(k) === currentSprint)
    : -1;
  if (currentIdx < 0) currentIdx = allSprints.length - 1;

  // Last 5 sprints (including current)
  const startIdx     = Math.max(0, currentIdx - 4);
  const recentSprints = allSprints.slice(startIdx, currentIdx + 1).map(([k]) => spName(k));

  // Group tasks by developer × sprint
  const devMap = {};
  rawTasks.forEach(t => {
    const af = t.fields?.['System.AssignedTo'];
    if (!af) return;
    const devName = (typeof af === 'object' ? af.displayName : String(af)).trim();
    if (!devName) return;

    const completed = t.fields?.['Microsoft.VSTS.Scheduling.CompletedWork'] || 0;
    const remaining = t.fields?.['Microsoft.VSTS.Scheduling.RemainingWork']  || 0;
    const sprint    = spName(t.fields?.['System.IterationPath'] || '');

    if (!devMap[devName]) devMap[devName] = { name: devName, sprints: {} };
    const s = devMap[devName].sprints;
    if (!s[sprint]) s[sprint] = { completedWork: 0, remainingWork: 0, taskCount: 0 };
    s[sprint].completedWork += completed;
    s[sprint].remainingWork += remaining;
    s[sprint].taskCount     += 1;
  });

  // Only devs with activity in the recent window
  const effectiveCurrent = currentSprint || recentSprints[recentSprints.length - 1] || '';

  const developers = Object.values(devMap)
    .filter(dev => recentSprints.some(sp =>
      (dev.sprints[sp]?.completedWork || 0) + (dev.sprints[sp]?.remainingWork || 0) > 0
    ))
    .map(dev => {
      const cur = dev.sprints[effectiveCurrent] || { completedWork: 0, remainingWork: 0, taskCount: 0 };
      return {
        name: dev.name,
        currentSprint: {
          completedWork: r1(cur.completedWork),
          remainingWork: r1(cur.remainingWork),
          taskCount:     cur.taskCount,
        },
        history: recentSprints.map(sp => ({
          sprint:        sp,
          completedWork: r1(dev.sprints[sp]?.completedWork || 0),
        })),
      };
    })
    .sort((a, b) =>
      (b.currentSprint.completedWork + b.currentSprint.remainingWork) -
      (a.currentSprint.completedWork + a.currentSprint.remainingWork)
    );

  // Current sprint metadata
  const curMeta = currentSprint
    ? allSprints.find(([k]) => spName(k) === currentSprint)?.[1] || null
    : null;

  return {
    project: displayName,
    currentSprint: currentSprint ? {
      name:  currentSprint,
      start: curMeta?.start || null,
      end:   curMeta?.end   || null,
    } : null,
    recentSprints,
    developers,
  };
}

module.exports = { fetchTeamCapacity };

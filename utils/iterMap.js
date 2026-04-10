const { azureGet } = require("../azureClient");

// Flatten the classificationnodes tree into a list of { path, start, end }
// API path format: \ProjectName\Iteration\SprintName
// IterationPath format (System.IterationPath): ProjectName\SprintName
function flattenClassificationNodes(node) {
  const results = [];
  function walk(n) {
    if (n.attributes && (n.attributes.startDate || n.attributes.finishDate)) {
      // \AMS\Iteration\Sprint 108 -> AMS\Sprint 108
      const raw = (n.path || '').replace(/^\\/, '');
      const parts = raw.split('\\');
      // parts = ['AMS', 'Iteration', 'Sprint 108', ...]
      // skip parts[1] which is the root iteration node name (e.g. 'Iteration')
      if (parts.length >= 3) {
        const iterPath = parts[0] + '\\' + parts.slice(2).join('\\');
        results.push({ path: iterPath, start: n.attributes.startDate || null, end: n.attributes.finishDate || null });
      }
    }
    if (n.children) n.children.forEach(walk);
  }
  if (node.children) node.children.forEach(walk);
  return results;
}

async function fetchIterMap(project, team) {
  // If a specific team is provided, use the team settings endpoint first —
  // it returns accurate timeFrame:"current" without date math.
  if (team) {
    try {
      const sd = await azureGet(
        `${encodeURIComponent(project)}/${encodeURIComponent(team)}/_apis/work/teamsettings/iterations?api-version=7.0`
      );
      if (sd.value && sd.value.length) {
        const map = {};
        let currentSprint = null;
        sd.value.forEach(it => {
          map[it.path] = {
            start: it.attributes && it.attributes.startDate ? it.attributes.startDate : null,
            end:   it.attributes && it.attributes.finishDate ? it.attributes.finishDate : null,
            isCurrent: it.attributes && it.attributes.timeFrame === 'current',
          };
          if (it.attributes && it.attributes.timeFrame === 'current') currentSprint = it.name;
        });
        return { map, currentSprint };
      }
    } catch (_) {}
  }

  // No team specified (or team fetch failed): use classificationnodes — covers all teams,
  // no team-name guessing required, works with Work Items (Read) permission only.
  let classificationMap = null;
  try {
    const data = await azureGet(
      `${encodeURIComponent(project)}/_apis/wit/classificationnodes/iterations?$depth=10&api-version=7.0`
    );
    const iterations = flattenClassificationNodes(data);
    if (iterations.length) {
      const now = new Date();
      const today = now.toISOString().slice(0, 10);
      const map = {};
      let currentSprint = null;
      iterations.forEach(it => {
        const startDay = it.start ? it.start.slice(0, 10) : null;
        const endDay   = it.end   ? it.end.slice(0, 10)   : null;
        const isCurrent = startDay && endDay ? startDay <= today && today <= endDay : false;
        map[it.path] = { start: it.start, end: it.end, isCurrent };
        if (isCurrent) currentSprint = it.path.split('\\').pop();
      });
      if (currentSprint) return { map, currentSprint };
      // Map is built but no current sprint found by date math (e.g. gap between sprints).
      // Save the map and fall through to try teamsettings for an accurate currentSprint.
      classificationMap = { map, currentSprint: null };
    }
  } catch (_) {}

  // Try teamsettings/iterations with common team name conventions.
  // Used as last resort for the map, or as a fallback for currentSprint only
  // when classificationnodes found sprints but couldn't identify the current one by date.
  for (const teamName of [`${project} Team`, project]) {
    try {
      const sd = await azureGet(
        `${encodeURIComponent(project)}/${encodeURIComponent(teamName)}/_apis/work/teamsettings/iterations?api-version=7.0`
      );
      if (sd.value && sd.value.length) {
        const currentEntry = sd.value.find(it => it.attributes && it.attributes.timeFrame === 'current');
        const currentSprint = currentEntry ? currentEntry.name : null;
        // If we already have a map from classificationnodes, just fill in the currentSprint
        if (classificationMap) {
          if (currentSprint) {
            // Mark the matching entry in the existing map as current
            Object.keys(classificationMap.map).forEach(k => {
              classificationMap.map[k].isCurrent = k.endsWith('\\' + currentSprint) || k === currentSprint;
            });
          }
          return { map: classificationMap.map, currentSprint };
        }
        const map = {};
        sd.value.forEach(it => {
          map[it.path] = {
            start: it.attributes && it.attributes.startDate ? it.attributes.startDate : null,
            end:   it.attributes && it.attributes.finishDate ? it.attributes.finishDate : null,
            isCurrent: it.attributes && it.attributes.timeFrame === 'current',
          };
        });
        return { map, currentSprint };
      }
    } catch (_) {}
  }
  if (classificationMap) return classificationMap;
  return { map: {}, currentSprint: null };
}

module.exports = { fetchIterMap };

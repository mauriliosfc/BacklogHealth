const { azureGet } = require("../azureClient");

async function fetchIterMap(project) {
  for (const teamName of [`${project} Team`, project]) {
    try {
      const sd = await azureGet(
        `${encodeURIComponent(project)}/${encodeURIComponent(teamName)}/_apis/work/teamsettings/iterations?api-version=7.0`
      );
      if (sd.value && sd.value.length) {
        const map = {};
        let currentSprint = null;
        sd.value.forEach(it => {
          map[it.path] = {
            start: it.attributes && it.attributes.startDate ? it.attributes.startDate : null,
            end:   it.attributes && it.attributes.finishDate ? it.attributes.finishDate : null,
            isCurrent: it.attributes && it.attributes.timeFrame === "current",
          };
          if (it.attributes && it.attributes.timeFrame === "current") currentSprint = it.name;
        });
        return { map, currentSprint };
      }
    } catch (_) {}
  }
  return { map: {}, currentSprint: null };
}
module.exports = { fetchIterMap };

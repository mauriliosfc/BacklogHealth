const { azureGet } = require("../azureClient");

async function paginatedItems(project, ids, fields) {
  let results = [];
  for (let i = 0; i < ids.length; i += 200) {
    const batch = ids.slice(i, i + 200);
    const page = await azureGet(
      `${encodeURIComponent(project)}/_apis/wit/workitems?ids=${batch.join(",")}&fields=${fields}&api-version=7.0`
    );
    results = results.concat(page.value || []);
  }
  return results;
}
module.exports = { paginatedItems };

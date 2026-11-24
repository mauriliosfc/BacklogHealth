const { azureGet } = require("../azureClient");

// org: organização do projeto ({ baseUrl, pat }); sem ela, a principal
async function paginatedItems(project, ids, fields, org = null) {
  let results = [];
  for (let i = 0; i < ids.length; i += 200) {
    const batch = ids.slice(i, i + 200);
    const page = await azureGet(
      `${encodeURIComponent(project)}/_apis/wit/workitems?ids=${batch.join(",")}&fields=${fields}&api-version=7.0`,
      org
    );
    results = results.concat(page.value || []);
  }
  return results;
}
module.exports = { paginatedItems };

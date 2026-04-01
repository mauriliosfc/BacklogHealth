const https = require("https");
const { getCfg, getAuth } = require("./config");

function azureGet(url, redirectCount = 0) {
  const cfg = getCfg();
  if (!url.startsWith("http")) url = `${cfg.baseUrl}/${url}`;
  return new Promise((resolve, reject) => {
    const opts = { headers: { Authorization: `Basic ${getAuth()}`, "Content-Type": "application/json" } };
    https.get(url, opts, res => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && redirectCount < 5) {
        return resolve(azureGet(res.headers.location, redirectCount + 1));
      }
      let body = "";
      res.on("data", d => body += d);
      res.on("end", () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error("Parse error: " + body.slice(0, 200))); }
      });
    }).on("error", reject);
  });
}

function azurePost(path, payload) {
  const cfg = getCfg();
  const parsed = new URL(cfg.baseUrl);
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const opts = {
      hostname: parsed.hostname,
      path: parsed.pathname.replace(/\/$/, "") + "/" + path,
      method: "POST",
      headers: {
        Authorization: `Basic ${getAuth()}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
      },
    };
    const req = https.request(opts, res => {
      let body = "";
      res.on("data", d => body += d);
      res.on("end", () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error("Parse error: " + body.slice(0, 200))); }
      });
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

// GET autenticado com org/pat explícitos (não usa cfg) — usado no setup
function rawAzureGet(url, auth, redirectCount = 0) {
  if (!url.startsWith("http")) url = `https://dev.azure.com/${url}`;
  return new Promise((resolve, reject) => {
    const opts = { headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" } };
    https.get(url, opts, res => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && redirectCount < 5) {
        return resolve(rawAzureGet(res.headers.location, auth, redirectCount + 1));
      }
      let body = "";
      res.on("data", d => body += d);
      res.on("end", () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch (e) { reject(new Error("HTTP " + res.statusCode + ": " + body.slice(0, 200))); }
      });
    }).on("error", reject);
  });
}

module.exports = { azureGet, azurePost, rawAzureGet };

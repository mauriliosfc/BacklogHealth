const https = require("https");
const { getCfg, getAuth } = require("./config");

// PAT expirado, revogado ou sem permissão: o Azure responde 401 (às vezes 203 com
// a página de login) e corpo vazio — antes isso aparecia como "Parse error:".
const AUTH_ERROR_CODE = "AZURE_AUTH";
const AUTH_ERROR_MSG  = "Token de acesso (PAT) do Azure DevOps expirado ou inválido. Gere um novo token e atualize em Configurações.";

function isAuthStatus(status) {
  return status === 401 || status === 203;
}

// Resposta que não é JSON: erro HTTP legível (antes ia o HTML da página de erro no card)
function bodyError(status, body) {
  if (status === 404) return new Error(`Azure DevOps respondeu HTTP 404: organização ou projeto não encontrado.`);
  if (status >= 400) return new Error(`Azure DevOps respondeu HTTP ${status}.`);
  return new Error("Parse error: " + String(body || '').slice(0, 200));
}

function authError(status, org = null) {
  const label = org ? (org.label || org.org || '') : '';
  const err = new Error(label
    ? `Token de acesso (PAT) da organização "${label}" expirado ou inválido. Gere um novo token e atualize em Configurações.`
    : AUTH_ERROR_MSG);
  err.code   = AUTH_ERROR_CODE;
  err.status = status;
  if (org && org.id) err.orgId = org.id;
  return err;
}

// `org` ({ baseUrl, pat }) escolhe a organização; sem ela, usa a principal (campos do topo).
function _target(org) {
  if (org && org.baseUrl) {
    return { baseUrl: org.baseUrl, auth: Buffer.from(`:${org.pat || ''}`).toString("base64"), org };
  }
  return { baseUrl: getCfg().baseUrl, auth: getAuth(), org: null };
}

function _get(url, target, redirectCount) {
  return new Promise((resolve, reject) => {
    const opts = { headers: { Authorization: `Basic ${target.auth}`, "Content-Type": "application/json" } };
    https.get(url, opts, res => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && redirectCount < 5) {
        return resolve(_get(res.headers.location, target, redirectCount + 1));
      }
      if (isAuthStatus(res.statusCode)) { res.resume(); return reject(authError(res.statusCode, target.org)); }
      let body = "";
      res.on("data", d => body += d);
      res.on("end", () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(bodyError(res.statusCode, body)); }
      });
    }).on("error", reject);
  });
}

function azureGet(url, org = null) {
  const target = _target(org);
  if (!url.startsWith("http")) url = `${target.baseUrl}/${url}`;
  return _get(url, target, 0);
}

function azurePost(path, payload, org = null) {
  const target = _target(org);
  const parsed = new URL(target.baseUrl);
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const opts = {
      hostname: parsed.hostname,
      path: parsed.pathname.replace(/\/$/, "") + "/" + path,
      method: "POST",
      headers: {
        Authorization: `Basic ${target.auth}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
      },
    };
    const req = https.request(opts, res => {
      if (isAuthStatus(res.statusCode)) { res.resume(); return reject(authError(res.statusCode, target.org)); }
      let body = "";
      res.on("data", d => body += d);
      res.on("end", () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(bodyError(res.statusCode, body)); }
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
        catch (e) {
          // Erro sem corpo JSON (ex.: 401 vazio): devolve o status para o chamador tratar
          if (res.statusCode !== 200) return resolve({ status: res.statusCode, data: {} });
          reject(new Error("HTTP " + res.statusCode + ": " + body.slice(0, 200)));
        }
      });
    }).on("error", reject);
  });
}

module.exports = { azureGet, azurePost, rawAzureGet, AUTH_ERROR_CODE, AUTH_ERROR_MSG, isAuthStatus, authError };

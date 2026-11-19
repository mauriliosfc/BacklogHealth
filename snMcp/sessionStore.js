// Leitura da sessão autenticada que o mfa-servicenow-mcp grava em disco após o login SSO/MFA.
//
// O MCP salva `session_<host>_<user>.json` na pasta de sessão com, entre outras chaves:
//   cookie_header, user_agent, session_token (g_ck / X-UserToken), instance_url
// e usa exatamente esses três valores como headers nas chamadas REST (Cookie, User-Agent,
// X-UserToken). Reaproveitamos a mesma sessão para chamar a Table API direto do Node —
// em paralelo e com os mesmos parâmetros do modo API — deixando o MCP só com login/keep-alive.

const fs       = require('fs');
const nodePath = require('path');

function _host(v) {
  return String(v || '').trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase();
}

function createSessionStore({ fsImpl = fs } = {}) {
  const cache = new Map();   // file → { mtimeMs, data }

  // Arquivo de sessão mais recente da pasta cujo instance_url é o host pedido.
  function findSessionFile(dir, instance) {
    const want = _host(instance);
    let entries;
    try { entries = fsImpl.readdirSync(dir); } catch (_) { return null; }
    let best = null;
    for (const name of entries) {
      if (!/^session_.*\.json$/i.test(name)) continue;
      const file = nodePath.join(dir, name);
      let stat, data;
      try {
        stat = fsImpl.statSync(file);
        data = JSON.parse(fsImpl.readFileSync(file, 'utf8'));
      } catch (_) { continue; }
      if (!data || !data.cookie_header) continue;
      if (want && _host(data.instance_url) !== want) continue;
      if (!best || stat.mtimeMs > best.mtimeMs) best = { file, mtimeMs: stat.mtimeMs };
    }
    return best ? best.file : null;
  }

  function _read(file) {
    const stat = fsImpl.statSync(file);
    const hit  = cache.get(file);
    if (hit && hit.mtimeMs === stat.mtimeMs) return hit.data;
    const data = JSON.parse(fsImpl.readFileSync(file, 'utf8'));
    cache.set(file, { mtimeMs: stat.mtimeMs, data });
    return data;
  }

  // Headers da REST com a sessão SSO (relê o arquivo quando o MCP o regrava, ex.: novo login).
  function readSessionHeaders(file) {
    const data = _read(file);
    if (!data.cookie_header) throw new Error('Service Now session file has no cookies');
    const headers = { Cookie: data.cookie_header };
    if (data.user_agent)    headers['User-Agent']  = data.user_agent;
    if (data.session_token) headers['X-UserToken'] = data.session_token;
    return headers;
  }

  // O ServiceNow pode rotacionar o g_ck numa resposta. Grava o novo valor no arquivo do MCP
  // (escrita atômica, preservando as demais chaves) — o MCP adota token rotacionado do disco.
  function persistRotatedToken(file, token) {
    if (!file || !token) return false;
    let data;
    try { data = _read(file); } catch (_) { return false; }
    if (data.session_token === token) return false;
    const next = { ...data, session_token: token };
    const tmp  = `${file}.${process.pid}.tmp`;
    try {
      fsImpl.writeFileSync(tmp, JSON.stringify(next), 'utf8');
      fsImpl.renameSync(tmp, file);
    } catch (_) {
      try { fsImpl.rmSync(tmp, { force: true }); } catch (__) {}
      return false;
    }
    cache.delete(file);
    return true;
  }

  // Token rotacionado presente nos headers de resposta (Node entrega em minúsculas).
  function rotatedTokenFrom(responseHeaders) {
    if (!responseHeaders) return '';
    return String(responseHeaders['x-usertoken'] || responseHeaders['x-csrf-token'] || '').trim();
  }

  return { findSessionFile, readSessionHeaders, persistRotatedToken, rotatedTokenFrom };
}

module.exports = { createSessionStore, sessionStore: createSessionStore() };

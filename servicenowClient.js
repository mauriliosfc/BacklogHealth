const https = require('https');
const { getSnMode } = require('./utils/snMode');

// snCfg: { mode?: 'api'|'mcp', instance, user, pass, mcp? }
// path:  tudo depois de /api/now/ — ex.: 'table/incident?sysparm_query=...'
// Ambos os modos resolvem com o mesmo formato da Table API: { result: [...] }.
function snGet(snCfg, path) {
  if (getSnMode(snCfg) === 'mcp') {
    // require tardio: o modo API não carrega nada do MCP
    return require('./snMcp').get(snCfg, path);
  }
  return restGet(snCfg, path);
}

function _authError(msg) {
  const err = new Error(msg);
  err.code = 'SN_AUTH';
  return err;
}

// GET na REST do ServiceNow.
// - Modo API: Basic auth com usuário/senha.
// - Modo MCP: `headers` com a sessão SSO capturada pelo MCP (Cookie, User-Agent, X-UserToken).
// `onResponseHeaders` recebe os headers da resposta (usado para acompanhar rotação do X-UserToken).
function restGet(snCfg, path, { headers, onResponseHeaders } = {}) {
  const host = snCfg.instance.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  const url = `https://${host}/api/now/${path}`;
  const reqHeaders = headers
    ? { Accept: 'application/json', ...headers }
    : { Authorization: `Basic ${Buffer.from(`${snCfg.user}:${snCfg.pass}`).toString('base64')}`, Accept: 'application/json' };

  return new Promise((resolve, reject) => {
    https.get(url, { headers: reqHeaders }, res => {
      try { onResponseHeaders?.(res.headers || {}); } catch (_) {}
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        if (res.statusCode === 401) return reject(_authError('Service Now credentials invalid (401)'));
        // Sessão SSO expirada: a REST redireciona para a tela de login em vez de responder 401
        if (res.statusCode >= 300 && res.statusCode < 400) {
          const loc = String(res.headers?.location || '');
          if (headers || /login|logout|saml|sso/i.test(loc)) return reject(_authError(`Service Now session expired (HTTP ${res.statusCode})`));
          return reject(new Error(`Service Now HTTP ${res.statusCode}`));
        }
        if (res.statusCode === 403) return reject(new Error('Service Now permission denied (403)'));
        // 202 sem corpo: o ServiceNow recusou a transação por excesso de requisições simultâneas
        // na mesma sessão de usuário (comum com sessão SSO). 429: limite de taxa. Ambos: tentar de novo.
        if (res.statusCode === 202 || res.statusCode === 429) {
          const err = new Error(`Service Now busy (HTTP ${res.statusCode})`);
          err.code = 'SN_BUSY';
          err.retryAfterMs = (parseInt(res.headers?.['retry-after'], 10) || 0) * 1000;
          return reject(err);
        }
        if (res.statusCode !== 200) return reject(new Error(`Service Now HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
        try { resolve(JSON.parse(body)); }
        catch (e) {
          // HTML no lugar de JSON = página de login (sessão inválida)
          if (headers && /<html/i.test(body.slice(0, 500))) return reject(_authError('Service Now session expired (login page returned)'));
          reject(new Error('Parse error: ' + body.slice(0, 200)));
        }
      });
    }).on('error', reject);
  });
}

module.exports = { snGet, restGet };

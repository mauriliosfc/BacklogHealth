const https = require('https');

// GET against Service Now Table API using Basic auth.
// snCfg: { instance, user, pass }
function snGet(snCfg, path) {
  const url = `https://${snCfg.instance}/api/now/${path}`;
  const auth = Buffer.from(`${snCfg.user}:${snCfg.pass}`).toString('base64');
  return new Promise((resolve, reject) => {
    const opts = { headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' } };
    https.get(url, opts, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        if (res.statusCode === 401) return reject(new Error('Service Now credentials invalid (401)'));
        if (res.statusCode === 403) return reject(new Error('Service Now permission denied (403)'));
        if (res.statusCode !== 200) return reject(new Error(`Service Now HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error('Parse error: ' + body.slice(0, 200))); }
      });
    }).on('error', reject);
  });
}

module.exports = { snGet };

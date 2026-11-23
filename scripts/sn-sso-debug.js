#!/usr/bin/env node
// Diagnóstico do login SSO do Service Now, fora do app (ver docs/sn-sso.md).
//
// Uso: node scripts/sn-sso-debug.js <instancia> [usuario] [--window] [--profile <pasta>] [--keep]
//   --window   abre a janela do Edge (padrão: tenta sem janela)
//   --profile  pasta de perfil do Edge (padrão: perfil temporário novo; use a do app para testar
//              a sessão lembrada: %APPDATA%\backlog-health\sn-mcp\session-edge\profile_<...>)
//   --keep     não apaga o perfil temporário no fim
//
// Mostra cada passo do login, os cookies capturados (só nomes) e testa a Table API com a sessão.
// Não grava nada na sessão do app.

const fs       = require('fs');
const os       = require('os');
const nodePath = require('path');
const { runLogin } = require('../snMcp/edgeLogin');
const { restGet }  = require('../servicenowClient');

function parseArgs(argv) {
  const out = { instance: '', username: '', window: false, profile: '', keep: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--window') out.window = true;
    else if (a === '--keep') out.keep = true;
    else if (a === '--profile') out.profile = argv[++i] || '';
    else rest.push(a);
  }
  [out.instance = '', out.username = ''] = rest;
  return out;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args.instance) {
    console.error('Uso: node scripts/sn-sso-debug.js <instancia> [usuario] [--window] [--profile <pasta>] [--keep]');
    return 1;
  }
  const temp    = !args.profile;
  const profile = args.profile || fs.mkdtempSync(nodePath.join(os.tmpdir(), 'bh-sso-debug-'));
  const t0 = Date.now();
  const log = m => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);
  log(`perfil: ${profile}`);
  try {
    const r = await runLogin({ instance: args.instance, username: args.username, headless: !args.window, userDataDir: profile, log });
    log(`login ok em ${r.elapsedMs}ms | g_ck: ${r.sessionToken ? 'sim' : 'NÃO'} | cookies: ${r.cookieNames.join(', ')}`);
    if (r.missing.length) log(`faltando: ${r.missing.join(', ')}`);
    const headers = { Cookie: r.cookieHeader, 'User-Agent': r.userAgent, ...(r.sessionToken ? { 'X-UserToken': r.sessionToken } : {}) };
    const cfg = { instance: args.instance };
    await restGet(cfg, 'table/sys_user_preference?sysparm_limit=1&sysparm_fields=sys_id', { headers });
    log('sys_user_preference: 200');
    const inc = await restGet(cfg, 'table/incident?sysparm_limit=1&sysparm_fields=number', { headers });
    log(`incident: 200 (${(inc.result[0] || {}).number || 'sem registros'})`);
    log('RESULTADO: OK');
    return 0;
  } catch (e) {
    log(`FALHOU (${e.code || 'erro'}): ${e.message}`);
    return 2;
  } finally {
    if (temp && !args.keep) fs.rmSync(profile, { recursive: true, force: true });
  }
}

if (require.main === module) main().then(code => process.exit(code));

module.exports = { parseArgs, main };

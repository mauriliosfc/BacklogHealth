#!/usr/bin/env node
// Acompanha o mfa-servicenow-mcp original, de onde veio a lógica do login SSO (snMcp/).
//
// Uso: npm run check:sn-upstream [-- --to <versão>] [-- --from <versão>]
//
// 1. Consulta o PyPI e compara a última versão com a de referência (snMcp/upstream.json).
// 2. Se houver diferença, baixa as duas wheels (confere o SHA-256 do PyPI) e extrai só os arquivos
//    acompanhados (upstream.json → trackedFiles).
// 3. Gera build/sn-upstream/<de>..<para>.diff e .md com o resumo por arquivo e os casos portados
//    afetados (upstream.json → cases), para decidir o que portar. Procedimento: docs/sn-sso-upstream.md
//
// Sem dependências: https, crypto, tar.exe do Windows e git.

const fs       = require('fs');
const https    = require('https');
const crypto   = require('crypto');
const nodePath = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT          = nodePath.join(__dirname, '..');
const UPSTREAM_JSON = nodePath.join(ROOT, 'snMcp', 'upstream.json');
const OUT_DIR       = nodePath.join(ROOT, 'build', 'sn-upstream');

// --- funções puras (testadas) -------------------------------------------------------------------

function compareVersions(a, b) {
  const pa = String(a).split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

// Wheel pura Python (py3-none-any) do release; null se não houver.
function pickWheel(files) {
  const wheels = (files || []).filter(f => f.packagetype === 'bdist_wheel' && /\.whl$/i.test(f.filename) && !f.yanked);
  const w = wheels.find(f => /py3-none-any\.whl$/i.test(f.filename)) || wheels[0];
  return w ? { filename: w.filename, url: w.url, sha256: (w.digests || {}).sha256 || '' } : null;
}

function parseArgs(argv) {
  const out = { from: '', to: '' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--from') out.from = argv[++i] || '';
    else if (argv[i] === '--to') out.to = argv[++i] || '';
  }
  return out;
}

// "a/<pasta-de>/servicenow_mcp/x.py" → "servicenow_mcp/x.py"
function normalizeDiffPath(p) {
  const s = String(p || '').replace(/\\/g, '/');
  const i = s.indexOf('servicenow_mcp/');
  return i >= 0 ? s.slice(i) : s;
}

// Divide um diff unificado em { arquivo: [ { header, text } ] } (text = linhas +/- do hunk).
function splitDiffByFile(diffText) {
  const files = {};
  let current = null, hunk = null;
  for (const line of String(diffText || '').split(/\r?\n/)) {
    const m = line.match(/^diff --git a\/(\S+) b\/(\S+)/);
    if (m) { current = normalizeDiffPath(m[2]); files[current] = files[current] || []; hunk = null; continue; }
    if (!current) continue;
    if (line.startsWith('@@')) {
      hunk = { header: line.replace(/^@@[^@]*@@\s?/, ''), text: '' };
      files[current].push(hunk);
      continue;
    }
    if (hunk && /^[+-]/.test(line) && !/^(\+\+\+|---)\s/.test(line)) hunk.text += line.slice(1) + '\n';
  }
  return files;
}

// Casos do mapa afetados pelo diff: 'symbol' quando um símbolo listado aparece num trecho alterado
// (ou no cabeçalho da função do hunk); 'file' quando o arquivo mudou mas nenhum símbolo apareceu.
function affectedCases(diffByFile, cases) {
  const out = [];
  for (const c of cases || []) {
    const hits = [];
    let fileOnly = false;
    for (const up of c.upstream || []) {
      const hunks = diffByFile[up.file];
      if (!hunks || !hunks.length) continue;
      const found = (up.symbols || []).filter(sym => hunks.some(h => h.header.includes(sym) || h.text.includes(sym)));
      if (found.length) hits.push(...found.map(s => `${up.file}#${s}`));
      else fileOnly = true;
    }
    if (hits.length) out.push({ id: c.id, title: c.title, level: 'symbol', hits, node: c.node || [] });
    else if (fileOnly) out.push({ id: c.id, title: c.title, level: 'file', hits: [], node: c.node || [] });
  }
  return out;
}

function buildReport({ pkg, repository, from, to, diffByFile, affected, untouched }) {
  const lines = [];
  lines.push(`# ${pkg}: ${from} → ${to}`, '');
  lines.push(`Changelog: ${repository}/releases`, '');
  lines.push('## Arquivos acompanhados que mudaram', '');
  const changed = Object.entries(diffByFile).filter(([, h]) => h.length);
  if (!changed.length) lines.push('Nenhum.');
  for (const [f, hunks] of changed) lines.push(`- \`${f}\`: ${hunks.length} trecho(s)`);
  lines.push('', '## Casos portados afetados', '');
  if (!affected.length) lines.push('Nenhum caso do mapa foi tocado.');
  for (const a of affected) {
    lines.push(`- **${a.id}** ${a.title} — ${a.level === 'symbol' ? `símbolos: ${a.hits.map(h => `\`${h}\``).join(', ')}` : 'arquivo mudou, nenhum símbolo listado apareceu (revisar)'}`);
    if (a.node.length) lines.push(`  - Nosso código: ${a.node.map(n => `\`${n}\``).join(', ')}`);
  }
  if (untouched.length) lines.push('', `Sem mudança: ${untouched.join(', ')}`);
  lines.push('', 'Próximo passo: ler o .diff dos casos afetados e seguir docs/sn-sso-upstream.md.');
  return lines.join('\n') + '\n';
}

// --- rede, disco e processos -------------------------------------------------------------------

function httpsGet(url, { redirects = 5 } = {}) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'backlog-health-upstream-check' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume();
        return resolve(httpsGet(new URL(res.headers.location, url).toString(), { redirects: redirects - 1 }));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode} em ${url}`)); }
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

function systemTar() {
  const p = nodePath.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  return fs.existsSync(p) ? p : 'tar';
}

async function fetchVersionFiles(pkg, version, cacheDir) {
  const meta = JSON.parse((await httpsGet(`https://pypi.org/pypi/${pkg}/${version}/json`)).toString('utf8'));
  const wheel = pickWheel(meta.urls);
  if (!wheel) throw new Error(`Sem wheel para ${pkg} ${version}`);
  const dir = nodePath.join(cacheDir, version);
  const whl = nodePath.join(dir, wheel.filename);
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(whl)) {
    const buf = await httpsGet(wheel.url);
    const sha = crypto.createHash('sha256').update(buf).digest('hex');
    if (wheel.sha256 && sha !== wheel.sha256) throw new Error(`SHA-256 diferente para ${wheel.filename}`);
    fs.writeFileSync(whl, buf);
  }
  return { dir, whl };
}

function extractTracked(whl, destDir, tracked) {
  fs.rmSync(destDir, { recursive: true, force: true });
  fs.mkdirSync(destDir, { recursive: true });
  // tar extrai um membro de cada vez para não falhar se algum arquivo deixar de existir
  for (const f of tracked) {
    spawnSync(systemTar(), ['-xf', whl, '-C', destDir, f], { stdio: 'ignore' });
  }
}

function gitDiff(a, b) {
  const r = spawnSync('git', ['-c', 'core.autocrlf=false', 'diff', '--no-index', '--no-color', '-U3', '--function-context', a, b], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0 && r.status !== 1) throw new Error(`git diff falhou: ${r.stderr}`);
  return r.stdout || '';
}

async function main(argv = process.argv.slice(2)) {
  const cfg = JSON.parse(fs.readFileSync(UPSTREAM_JSON, 'utf8'));
  const args = parseArgs(argv);
  const from = args.from || cfg.referenceVersion;
  let to = args.to;
  if (!to) {
    const meta = JSON.parse((await httpsGet(`https://pypi.org/pypi/${cfg.package}/json`)).toString('utf8'));
    to = meta.info.version;
  }
  console.log(`${cfg.package}: referência ${from} | comparando com ${to}`);
  if (compareVersions(from, to) === 0) {
    console.log('Nada a fazer: a referência já é a versão mais recente.');
    return 0;
  }

  const cache = nodePath.join(OUT_DIR, 'cache');
  const a = await fetchVersionFiles(cfg.package, from, cache);
  const b = await fetchVersionFiles(cfg.package, to, cache);
  const srcA = nodePath.join(OUT_DIR, 'src', from);
  const srcB = nodePath.join(OUT_DIR, 'src', to);
  extractTracked(a.whl, srcA, cfg.trackedFiles);
  extractTracked(b.whl, srcB, cfg.trackedFiles);

  // Barras normais: com o caminho no formato do Windows o git diff --no-index devolve vazio
  const rel = p => nodePath.relative(ROOT, p).split(nodePath.sep).join('/');
  const diff = gitDiff(rel(srcA), rel(srcB));
  const diffByFile = splitDiffByFile(diff);
  const affected = affectedCases(diffByFile, cfg.cases);
  const untouched = cfg.trackedFiles.filter(f => !(diffByFile[f] || []).length);

  const base = nodePath.join(OUT_DIR, `${from}..${to}`);
  fs.writeFileSync(`${base}.diff`, diff, 'utf8');
  const report = buildReport({ pkg: cfg.package, repository: cfg.repository, from, to, diffByFile, affected, untouched });
  fs.writeFileSync(`${base}.md`, report, 'utf8');

  console.log('\n' + report);
  console.log(`Diff completo: ${nodePath.relative(ROOT, base)}.diff`);
  return 0;
}

if (require.main === module) {
  main().then(code => process.exit(code)).catch(e => { console.error('Erro:', e.message); process.exit(1); });
}

module.exports = { compareVersions, pickWheel, parseArgs, normalizeDiffPath, splitDiffByFile, affectedCases, buildReport };

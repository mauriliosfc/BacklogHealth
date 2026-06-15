#!/usr/bin/env node
// Uso: node scripts/release.js <versao>
// Variavel de ambiente obrigatoria: GITHUB_TOKEN
//
// O que faz:
//   1. Atualiza versao em package.json e links no README.md
//   2. git commit + tag + push
//   3. npm run electron:build
//   4. Cria GitHub Release e faz upload dos dois EXEs

const fs   = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const ROOT  = path.join(__dirname, '..');
const OWNER = 'mauriliosfc';
const REPO  = 'BacklogHealth';

// --- validacoes iniciais ---
const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('Uso: node scripts/release.js <versao>  (ex: 1.2.0)');
  process.exit(1);
}

const token = process.env.GITHUB_TOKEN;
if (!token) {
  console.error('Erro: GITHUB_TOKEN nao definido.');
  console.error('Execute: $env:GITHUB_TOKEN="seu-token"  (PowerShell)');
  process.exit(1);
}

// --- helpers ---
function run(cmd) {
  console.log(`> ${cmd}`);
  execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
}

function runOut(cmd) {
  return execSync(cmd, { cwd: ROOT }).toString().trim();
}

function ghRequest(options, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      ...options,
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'BacklogHealth-release-script',
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
        ...options.headers,
      },
    }, res => {
      let buf = '';
      res.on('data', d => (buf += d));
      res.on('end', () => resolve(JSON.parse(buf)));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function ghUpload(releaseId, filePath, name) {
  return new Promise((resolve, reject) => {
    const content = fs.readFileSync(filePath);
    const req = https.request({
      hostname: 'uploads.github.com',
      path: `/repos/${OWNER}/${REPO}/releases/${releaseId}/assets?name=${encodeURIComponent(name)}`,
      method: 'POST',
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'BacklogHealth-release-script',
        'Content-Type': 'application/octet-stream',
        'Content-Length': content.length,
      },
    }, res => {
      let buf = '';
      res.on('data', d => (buf += d));
      res.on('end', () => resolve(JSON.parse(buf)));
    });
    req.on('error', reject);
    req.write(content);
    req.end();
  });
}

// --- 1. atualiza package.json ---
console.log(`\n[1/4] Atualizando versao para ${version}`);
const pkgPath = path.join(ROOT, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const oldVersion = pkg.version;
pkg.version = version;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log(`    package.json: ${oldVersion} -> ${version}`);

// --- 2. atualiza README.md ---
const readmePath = path.join(ROOT, 'README.md');
let readme = fs.readFileSync(readmePath, 'utf8');
readme = readme
  .replace(
    /\*\*Versão atual: v[\d.]+\*\*/,
    `**Versão atual: v${version}**`
  )
  .replace(
    /\[Backlog Health Setup [\d.]+\.exe\]\([^)]+\)/,
    `[Backlog Health Setup ${version}.exe](https://github.com/${OWNER}/${REPO}/releases/download/v${version}/Backlog.Health.Setup.${version}.exe)`
  )
  .replace(
    /\[Backlog Health [\d.]+\.exe\]\([^)]+\)/,
    `[Backlog Health ${version}.exe](https://github.com/${OWNER}/${REPO}/releases/download/v${version}/Backlog.Health.${version}.exe)`
  );
fs.writeFileSync(readmePath, readme);
console.log(`    README.md atualizado com links para v${version}`);

// --- 3. git commit + tag + push ---
console.log(`\n[2/4] Commit, tag v${version} e push`);
run('git add package.json README.md');
run(`git commit -m "chore: bump version to ${version}"`);
run(`git tag v${version}`);
const branch = runOut('git rev-parse --abbrev-ref HEAD');
run(`git push origin ${branch}`);
run(`git push origin v${version}`);

// --- 4. build ---
console.log('\n[3/4] Build Electron');
run('npm run electron:build');

// --- 5. github release ---
console.log('\n[4/4] GitHub Release');

(async () => {
  const release = await ghRequest({
    hostname: 'api.github.com',
    path: `/repos/${OWNER}/${REPO}/releases`,
    method: 'POST',
  }, {
    tag_name: `v${version}`,
    name: `v${version}`,
    body: `Release v${version}`,
    draft: false,
    prerelease: false,
  });

  if (!release.id) {
    console.error('Falha ao criar release:', JSON.stringify(release, null, 2));
    process.exit(1);
  }
  console.log(`    Release criada: ${release.html_url}`);

  const distDir = path.join(ROOT, 'dist', 'electron');
  const assets = [
    `Backlog Health Setup ${version}.exe`,
    `Backlog Health ${version}.exe`,
  ];

  for (const name of assets) {
    const filePath = path.join(distDir, name);
    if (!fs.existsSync(filePath)) {
      console.warn(`    Arquivo nao encontrado, pulando: ${name}`);
      continue;
    }
    const sizeMB = (fs.statSync(filePath).size / 1024 / 1024).toFixed(1);
    process.stdout.write(`    Enviando ${name} (${sizeMB} MB)...`);
    const asset = await ghUpload(release.id, filePath, name);
    console.log(` OK`);
    console.log(`      ${asset.browser_download_url}`);
  }

  console.log(`\nRelease v${version} publicada com sucesso.\n`);
})().catch(err => {
  console.error(err);
  process.exit(1);
});

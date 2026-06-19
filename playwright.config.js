const { defineConfig } = require('@playwright/test');
const fs   = require('fs');
const path = require('path');

// Carrega .env.test automaticamente se existir (sem dependência externa)
const envFile = path.join(__dirname, '.env.test');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (key && !(key in process.env)) process.env[key] = val;
  }
}

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:3030',
    headless: !process.env.PWHEADED,
    launchOptions: { slowMo: process.env.PWSLOWMO ? +process.env.PWSLOWMO : 0 },
    screenshot: 'only-on-failure',
    video: 'off',
  },
  webServer: {
    command: 'node server.js',
    url: 'http://localhost:3030',
    reuseExistingServer: true,
    timeout: 15_000,
  },
});

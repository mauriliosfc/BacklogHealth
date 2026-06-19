// @ts-check
/**
 * Testes funcionais de onboarding — requerem credenciais reais em .env.test
 *
 * Variáveis obrigatórias:  TEST_AZ_ORG, TEST_AZ_PAT
 * Variáveis opcionais:     TEST_SN_INSTANCE, TEST_SN_USER, TEST_SN_PASS
 *
 * Copie .env.test.example → .env.test e preencha antes de rodar.
 */
const { test, expect } = require('@playwright/test');
const fs   = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', '..', 'config.json');

function _readCredentials() {
  let cfg = {};
  if (fs.existsSync(CONFIG_PATH)) {
    try { cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch (_) {}
  }
  return {
    azOrg:  process.env.TEST_AZ_ORG      || cfg.org                  || '',
    azPat:  process.env.TEST_AZ_PAT      || cfg.pat                  || '',
    snInst: process.env.TEST_SN_INSTANCE || cfg.servicenow?.instance || '',
    snUser: process.env.TEST_SN_USER     || cfg.servicenow?.user     || '',
    snPass: process.env.TEST_SN_PASS     || cfg.servicenow?.pass     || '',
  };
}

const { azOrg: AZ_ORG, azPat: AZ_PAT, snInst: SN_INST, snUser: SN_USER, snPass: SN_PASS }
  = _readCredentials();

const HAS_AZ = !!(AZ_ORG && AZ_PAT);
const HAS_SN = !!(SN_INST && SN_USER && SN_PASS);

// ── helpers ───────────────────────────────────────────────────────────────────

function buildProjectsRaw(projects = []) {
  return projects.map(p => {
    const parts = [p.name, p.workItemType || 'User Story'];
    if (p.team) parts.push(p.team);
    return parts.join(':');
  }).join(',');
}

// ── fixture: backup/restore de config ────────────────────────────────────────

let _origConfig = null;

test.beforeAll(async ({ request }) => {
  if (!HAS_AZ) return;
  if (fs.existsSync(CONFIG_PATH)) {
    _origConfig = fs.readFileSync(CONFIG_PATH, 'utf8');
  }
  await request.post('/api/disconnect');
});

test.afterAll(async ({ request }) => {
  if (!HAS_AZ) return;
  if (_origConfig !== null) {
    fs.writeFileSync(CONFIG_PATH, _origConfig, 'utf8');
    try {
      const cfg = JSON.parse(_origConfig);
      if (cfg.org && cfg.pat && Array.isArray(cfg.projects) && cfg.projects.length) {
        await request.post('/setup', {
          form: { org: cfg.org, pat: cfg.pat, projects: buildProjectsRaw(cfg.projects) },
        });
      }
    } catch (_) {}
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// FLUXO AZURE — modo Azure DevOps apenas (card A)
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Onboarding funcional — Azure DevOps', () => {
  test.skip(!HAS_AZ, 'Sem credenciais Azure — defina TEST_AZ_ORG e TEST_AZ_PAT no .env.test');

  test('fluxo completo: configurar Azure → selecionar projeto → dashboard', async ({ page }) => {
    // ── Screen 0: Welcome ──────────────────────────────────────────────────
    await page.goto('/onboarding');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('#screen0')).toBeVisible();

    await page.locator('#screen0 button[onclick="goTo(1)"]').click();

    // ── Screen 1: Selecionar "Azure DevOps" ───────────────────────────────
    await expect(page.locator('#screen1')).toBeVisible();
    await page.locator('#cardA').click();
    await expect(page.locator('#cardA')).toHaveClass(/selected-blue/);

    await page.locator('#screen1 button[onclick="goTo(2)"]').click();

    // ── Screen 2: Preencher credenciais Azure ──────────────────────────────
    await expect(page.locator('#screen2')).toBeVisible();
    await expect(page.locator('#panelAz')).toBeVisible();
    // painel SN deve estar oculto (modo Azure-only)
    await expect(page.locator('#panelSn')).toBeHidden();

    await page.locator('#azOrg').fill(AZ_ORG);
    await page.locator('#azPat').fill(AZ_PAT);

    // Clica "Test connection" e aguarda resultado
    await page.locator('#btnTestAz').click();
    await expect(page.locator('#btnTestAz')).toHaveClass(/testing/, { timeout: 3_000 });
    await expect(page.locator('#statusAz')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#statusAz')).toHaveClass(/success/, { timeout: 15_000 });
    const statusText = await page.locator('#statusAzText').textContent();
    console.log(`[AZ status] ${statusText}`);

    await page.locator('#screen2 button[onclick="goTo(3)"]').click();

    // ── Screen 3: Selecionar projetos ──────────────────────────────────────
    await expect(page.locator('#screen3')).toBeVisible();

    // Aguarda projetos carregarem (grid não vazio)
    await expect(page.locator('#projectsGrid .proj-card').first())
      .toBeVisible({ timeout: 20_000 });

    const projCount = await page.locator('#projectsGrid .proj-card').count();
    console.log(`[AZ projetos encontrados] ${projCount}`);
    expect(projCount).toBeGreaterThan(0);

    // Seleciona o primeiro projeto disponível
    const firstProj = page.locator('#projectsGrid .proj-card').first();
    const projName  = await firstProj.locator('.proj-name').textContent();
    await firstProj.click();
    await expect(firstProj).toHaveClass(/selected/, { timeout: 3_000 });
    console.log(`[AZ projeto selecionado] ${projName?.trim()}`);

    // Finaliza setup
    await page.locator('#screen3 button[onclick="goToOrFinish()"]').click();

    // ── Screen 5: Done ─────────────────────────────────────────────────────
    await expect(page.locator('#screen5')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.done-title')).toBeVisible();
    await expect(page.locator('.checkmark-circle')).toBeVisible();

    // Clica "Open Dashboard"
    await page.locator('button[onclick="openDashboard()"]').click();

    // ── Dashboard: verifica card do projeto ────────────────────────────────
    await page.waitForURL('/', { timeout: 15_000 });
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.card[data-project]').first()).toBeVisible({ timeout: 15_000 });

    const dashProjCount = await page.locator('.card[data-project]').count();
    console.log(`[Dashboard cards] ${dashProjCount}`);
    expect(dashProjCount).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// FLUXO COMPLETO — modo Azure + ServiceNow (card C "Both")
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Onboarding funcional — Azure + ServiceNow (Both)', () => {
  test.skip(!HAS_AZ || !HAS_SN,
    'Sem credenciais completas — defina TEST_AZ_* e TEST_SN_* no .env.test');

  test('fluxo completo: configurar Both → projetos → mapping SN → dashboard', async ({ page }) => {
    // ── Screen 0 ──────────────────────────────────────────────────────────
    await page.goto('/onboarding');
    await page.waitForLoadState('networkidle');
    await page.locator('#screen0 button[onclick="goTo(1)"]').click();

    // ── Screen 1: "Both" já selecionado por padrão ────────────────────────
    await expect(page.locator('#screen1')).toBeVisible();
    await expect(page.locator('#cardC')).toHaveClass(/selected-both/);
    await page.locator('#screen1 button[onclick="goTo(2)"]').click();

    // ── Screen 2: Preenche Azure E ServiceNow ─────────────────────────────
    await expect(page.locator('#screen2')).toBeVisible();
    await expect(page.locator('#panelAz')).toBeVisible();
    await expect(page.locator('#panelSn')).toBeVisible();

    // Azure
    await page.locator('#azOrg').fill(AZ_ORG);
    await page.locator('#azPat').fill(AZ_PAT);
    await page.locator('#btnTestAz').click();
    await expect(page.locator('#statusAz')).toHaveClass(/success/, { timeout: 15_000 });

    // ServiceNow
    await page.locator('#snInstance').fill(SN_INST);
    await page.locator('#snUser').fill(SN_USER);
    await page.locator('#snPass').fill(SN_PASS);
    await page.locator('#btnTestSn').click();
    await expect(page.locator('#statusSn')).toHaveClass(/success/, { timeout: 15_000 });

    await page.locator('#screen2 button[onclick="goTo(3)"]').click();

    // ── Screen 3: Projetos Azure + Grupos SN ─────────────────────────────
    await expect(page.locator('#screen3')).toBeVisible();

    // Aguarda e seleciona primeiro projeto Azure
    await expect(page.locator('#projectsGrid .proj-card').first()).toBeVisible({ timeout: 20_000 });
    await page.locator('#projectsGrid .proj-card').first().click();

    // Aguarda e seleciona primeiro grupo SN (se visível)
    const snSection = page.locator('#snGroupsSection');
    if (await snSection.isVisible()) {
      await expect(page.locator('#snGroupsList .sn-group-item').first()).toBeVisible({ timeout: 15_000 });
      await page.locator('#snGroupsList .sn-group-item').first().click();
    }

    await page.locator('#screen3 button[onclick="goToOrFinish()"]').click();

    // ── Screen 4: SN Mapping (se aparecer) ───────────────────────────────
    // isVisible() retorna imediatamente — usa waitFor para aguardar a animação de transição
    const screen4 = page.locator('#screen4');
    const screen4Visible = await screen4
      .waitFor({ state: 'visible', timeout: 3_000 })
      .then(() => true)
      .catch(() => false);
    if (screen4Visible) {
      const firstSelect = screen4.locator('.sn-map-select').first();
      if (await firstSelect.isVisible()) {
        await firstSelect.selectOption({ index: 1 });
      }
      await screen4.locator('button[onclick="finishSetup()"]').click();
    }

    // ── Screen 5: Done ────────────────────────────────────────────────────
    await expect(page.locator('#screen5')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.done-title')).toBeVisible();

    // Vai para o dashboard
    const dashBtn = page.locator('#screen5 button, #screen5 a').filter({ hasText: /dashboard|ir para/i }).first();
    await dashBtn.click();

    await page.waitForURL('/', { timeout: 15_000 });
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.card[data-project]').first()).toBeVisible({ timeout: 15_000 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TESTES NEGATIVOS — credenciais inválidas
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Onboarding funcional — credenciais inválidas', () => {
  test.skip(!HAS_AZ, 'Sem credenciais Azure para testar os erros');

  test('PAT inválido exibe status de erro na conexão Azure', async ({ page }) => {
    await page.goto('/onboarding');
    await page.waitForLoadState('networkidle');
    await page.locator('#screen0 button[onclick="goTo(1)"]').click();
    await page.locator('#cardA').click();
    await page.locator('#screen1 button[onclick="goTo(2)"]').click();

    await page.locator('#azOrg').fill(AZ_ORG);
    await page.locator('#azPat').fill('pat-invalido-12345');

    await page.locator('#btnTestAz').click();
    await expect(page.locator('#statusAz')).toHaveClass(/error/, { timeout: 15_000 });
  });

  test('Org inexistente exibe status de erro na conexão Azure', async ({ page }) => {
    await page.goto('/onboarding');
    await page.waitForLoadState('networkidle');
    await page.locator('#screen0 button[onclick="goTo(1)"]').click();
    await page.locator('#cardA').click();
    await page.locator('#screen1 button[onclick="goTo(2)"]').click();

    await page.locator('#azOrg').fill('org-que-nao-existe-xyzabc999');
    await page.locator('#azPat').fill(AZ_PAT);

    await page.locator('#btnTestAz').click();
    await expect(page.locator('#statusAz')).toHaveClass(/error/, { timeout: 15_000 });
  });
});

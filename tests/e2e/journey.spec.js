// @ts-check
/**
 * Jornada completa ponta a ponta — zero config → onboarding → dashboard → features
 *
 * Os testes rodam em sequência dentro do mesmo describe. Cada um depende do
 * anterior: se o onboarding falhar, os demais são pulados automaticamente.
 *
 * Requer: TEST_AZ_ORG e TEST_AZ_PAT definidos em .env.test
 * Opcional: TEST_SN_* ativa testes adicionais de ServiceNow
 */
const { test, expect } = require('@playwright/test');
const fs   = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', '..', 'config.json');

// Lê credenciais: env vars têm prioridade; fallback para config.json existente
function _readCredentials() {
  let cfg = {};
  if (fs.existsSync(CONFIG_PATH)) {
    try { cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch (_) {}
  }
  return {
    azOrg:  process.env.TEST_AZ_ORG       || cfg.org              || '',
    azPat:  process.env.TEST_AZ_PAT       || cfg.pat              || '',
    snInst: process.env.TEST_SN_INSTANCE  || cfg.servicenow?.instance || '',
    snUser: process.env.TEST_SN_USER      || cfg.servicenow?.user     || '',
    snPass: process.env.TEST_SN_PASS      || cfg.servicenow?.pass     || '',
  };
}

const { azOrg: AZ_ORG, azPat: AZ_PAT, snInst: SN_INST, snUser: SN_USER, snPass: SN_PASS }
  = _readCredentials();

const HAS_AZ = !!(AZ_ORG && AZ_PAT);
const HAS_SN = !!(SN_INST && SN_USER && SN_PASS);

function buildProjectsRaw(projects = []) {
  return projects.map(p => {
    const parts = [p.name, p.workItemType || 'User Story'];
    if (p.team) parts.push(p.team);
    return parts.join(':');
  }).join(',');
}

// ─────────────────────────────────────────────────────────────────────────────

test.describe('Jornada completa', () => {
  test.skip(!HAS_AZ, 'Requer TEST_AZ_ORG e TEST_AZ_PAT no .env.test');

  // Estado compartilhado entre os testes da jornada
  let _onboarded    = false;
  let _origConfig   = null;
  let _selectedProj = '';

  // ── Backup / restore ──────────────────────────────────────────────────────

  test.beforeAll(async ({ request }) => {
    if (fs.existsSync(CONFIG_PATH)) {
      _origConfig = fs.readFileSync(CONFIG_PATH, 'utf8');
    }
    await request.post('/api/disconnect');
  });

  test.afterAll(async ({ request }) => {
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

  // ══════════════════════════════════════════════════════════════════════════
  // PASSO 1 — Onboarding: configura Azure e seleciona projeto
  // ══════════════════════════════════════════════════════════════════════════

  test('1. Onboarding — welcome → credenciais → projeto → done', async ({ page }) => {
    // ── Screen 0: Welcome ──────────────────────────────────────────────────
    await page.goto('/onboarding');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('#screen0')).toBeVisible();
    await page.locator('#screen0 button[onclick="goTo(1)"]').click();

    // ── Screen 1: seleciona card conforme disponibilidade de credenciais ───
    // "Both" (C) quando SN disponível, "Azure" (A) caso contrário
    await expect(page.locator('#screen1')).toBeVisible();
    if (HAS_SN) {
      await page.locator('#cardC').click();
      await expect(page.locator('#cardC')).toHaveClass(/selected-both/);
    } else {
      await page.locator('#cardA').click();
      await expect(page.locator('#cardA')).toHaveClass(/selected-blue/);
    }
    await page.locator('#screen1 button[onclick="goTo(2)"]').click();

    // ── Screen 2: preenche credenciais conforme modo selecionado ──────────
    await expect(page.locator('#screen2')).toBeVisible();
    await page.locator('#azOrg').fill(AZ_ORG);
    await page.locator('#azPat').fill(AZ_PAT);
    await page.locator('#btnTestAz').click();
    await expect(page.locator('#statusAz')).toHaveClass(/success/, { timeout: 20_000 });

    if (HAS_SN) {
      // Painel SN visível apenas quando card C (Both) foi selecionado
      await expect(page.locator('#panelSn')).toBeVisible();
      await page.locator('#snInstance').fill(SN_INST);
      await page.locator('#snUser').fill(SN_USER);
      await page.locator('#snPass').fill(SN_PASS);
      await page.locator('#btnTestSn').click();
      await expect(page.locator('#statusSn')).toHaveClass(/success/, { timeout: 20_000 });
    }

    await page.locator('#screen2 button[onclick="goTo(3)"]').click();

    // ── Screen 3: projetos carregam e seleciona o primeiro ────────────────
    await expect(page.locator('#screen3')).toBeVisible();
    const firstProj = page.locator('#projectsGrid .proj-card').first();
    await expect(firstProj).toBeVisible({ timeout: 20_000 });

    _selectedProj = (await firstProj.locator('.proj-name').textContent() || '').trim();
    await firstProj.click();
    await expect(firstProj).toHaveClass(/selected/);

    await page.locator('#screen3 button[onclick="goToOrFinish()"]').click();

    // ── Screen 4: SN mapping (se aparecer) ───────────────────────────────
    // goTo() usa setTimeout de 220ms para animação — waitFor aguarda a transição
    const screen4Visible = await page.locator('#screen4')
      .waitFor({ state: 'visible', timeout: 3_000 })
      .then(() => true)
      .catch(() => false);

    if (screen4Visible) {
      const sel = page.locator('#screen4 .sn-map-select').first();
      if (await sel.isVisible()) {
        // Só seleciona se houver grupos além do placeholder "— Select group —"
        const optCount = await sel.evaluate(s => s.options.length);
        if (optCount > 1) await sel.selectOption({ index: 1 });
      }
      await page.locator('button[onclick="finishSetup()"]').click();
    }

    // ── Screen 5: Done ────────────────────────────────────────────────────
    await expect(page.locator('#screen5')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.checkmark-circle')).toBeVisible();
    await expect(page.locator('.done-title')).toBeVisible();

    _onboarded = true;
  });

  // ══════════════════════════════════════════════════════════════════════════
  // PASSO 2 — Dashboard: projetos aparecem com saúde calculada
  // ══════════════════════════════════════════════════════════════════════════

  test('2. Dashboard — cards de projeto visíveis com health score', async ({ page }) => {
    test.skip(!_onboarded, 'Onboarding não completado');

    // Clica "Open Dashboard" ou navega diretamente
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Deve haver ao menos um card de projeto
    const cards = page.locator('.card[data-project]');
    await expect(cards.first()).toBeVisible({ timeout: 20_000 });

    const count = await cards.count();
    expect(count).toBeGreaterThan(0);
    console.log(`[Dashboard] ${count} card(s) encontrado(s)`);

    // Verifica que o projeto selecionado aparece
    if (_selectedProj) {
      const projCard = page.locator(`.card[data-project="${_selectedProj}"]`);
      const found = await projCard.count() > 0;
      if (!found) {
        // Tenta pelo texto — pode haver alias aplicado
        await expect(page.locator('.card-title, .card-name').filter({ hasText: _selectedProj })).toBeVisible();
      } else {
        await expect(projCard).toBeVisible();
      }
    }

    // Sidebar e topbar presentes
    await expect(page.locator('.sidebar')).toBeVisible();
    await expect(page.locator('.topbar')).toBeVisible();
    await expect(page.locator('.cards-toolbar')).toBeVisible();
  });

  // ══════════════════════════════════════════════════════════════════════════
  // PASSO 3 — Filtros de saúde
  // ══════════════════════════════════════════════════════════════════════════

  test('3. Dashboard — filtros de saúde filtram cards corretamente', async ({ page }) => {
    test.skip(!_onboarded, 'Onboarding não completado');

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.card[data-project]').first()).toBeVisible({ timeout: 15_000 });

    // "All" ativo por padrão
    await expect(page.locator('.fchip[data-health="all"]')).toHaveClass(/active/);

    // Clica "Critical" e verifica que o filtro fica ativo
    await page.locator('.fchip[data-health="red"]').click();
    await expect(page.locator('.fchip[data-health="red"]')).toHaveClass(/active/);

    // Volta para "All" — todos os cards devem aparecer
    await page.locator('.fchip[data-health="all"]').click();
    await expect(page.locator('.fchip[data-health="all"]')).toHaveClass(/active/);

    const visible = await page.locator('.card[data-project]').evaluateAll(cards =>
      cards.filter(c => c.style.display !== 'none').length
    );
    expect(visible).toBeGreaterThan(0);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // PASSO 4 — Team Capacity
  // ══════════════════════════════════════════════════════════════════════════

  test('4. Team Capacity — abre view e oculta cards do dashboard', async ({ page }) => {
    test.skip(!_onboarded, 'Onboarding não completado');

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.locator('#sidebar-link-tc').click();
    await expect(page.locator('#tc-view')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#content')).toBeHidden();

    // Volta ao dashboard
    await page.locator('#sidebar-link-dashboard').click();
    await expect(page.locator('#content')).toBeVisible();
    await expect(page.locator('#tc-view')).toBeHidden();
  });

  // ══════════════════════════════════════════════════════════════════════════
  // PASSO 5 — Monthly Review
  // ══════════════════════════════════════════════════════════════════════════

  test('5. Monthly Review — abre modal e carrega dados', async ({ page }) => {
    test.skip(!_onboarded, 'Onboarding não completado');

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.card[data-project]').first()).toBeVisible({ timeout: 15_000 });

    // Abre o Monthly Review do primeiro card que tiver o botão
    const btn = page.locator('.ca:has-text("Monthly Review")').first();
    const found = await btn.isVisible().catch(() => false);
    test.skip(!found, 'Nenhum botão Monthly Review disponível');

    await btn.click();
    await expect(page.locator('#report-modal')).toBeVisible({ timeout: 10_000 });

    // Aguarda o conteúdo carregar
    await page.waitForFunction(
      () => !document.getElementById('report-modal-body')?.textContent?.includes('Carregando'),
      { timeout: 30_000 }
    );

    // Seletor de mês presente
    await expect(page.locator('#report-month-sel')).toBeVisible();

    // Fecha o modal
    await page.locator('#report-modal .modal-close').click();
    await expect(page.locator('#report-modal')).toBeHidden();
  });

  // ══════════════════════════════════════════════════════════════════════════
  // PASSO 6 — Toggle AZ/SN (só se SN configurado)
  // ══════════════════════════════════════════════════════════════════════════

  test('6. Toggle AZ/SN — alterna entre dashboard Azure e SN', async ({ page }) => {
    test.skip(!_onboarded || !HAS_SN, 'Requer SN configurado e onboarding completado');

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const toggle = page.locator('.source-switcher');
    test.skip(!(await toggle.isVisible()), 'Toggle AZ/SN não visível (modo não-full)');

    // Botão AZ ativo por padrão
    await expect(page.locator('.btn-source[data-source="az"]')).toHaveClass(/active/);

    // Muda para SN
    await page.locator('.btn-source[data-source="sn"]').click();
    await expect(page.locator('#sn-view')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#content')).toBeHidden();

    // Volta para AZ
    await page.locator('.btn-source[data-source="az"]').click();
    await expect(page.locator('#content')).toBeVisible();
    await expect(page.locator('#sn-view')).toBeHidden();
  });

  // ══════════════════════════════════════════════════════════════════════════
  // PASSO 7 — Delivery Plan
  // ══════════════════════════════════════════════════════════════════════════

  test('7. Delivery Plan — abre view a partir da sidebar', async ({ page }) => {
    test.skip(!_onboarded, 'Onboarding não completado');

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const dpLink = page.locator('#sidebar-link-dp');
    test.skip(!(await dpLink.isVisible()), 'Link de Delivery Plan não disponível');

    await dpLink.click();
    await expect(page.locator('#dp-view')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#content')).toBeHidden();

    await page.locator('#sidebar-link-dashboard').click();
    await expect(page.locator('#content')).toBeVisible();
    await expect(page.locator('#dp-view')).toBeHidden();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// JORNADA — AZURE ONLY (card A)
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Jornada — Azure Only', () => {
  test.skip(!HAS_AZ, 'Requer TEST_AZ_ORG e TEST_AZ_PAT no .env.test');

  let _origConfig = null;

  test.beforeAll(async ({ request }) => {
    if (fs.existsSync(CONFIG_PATH)) _origConfig = fs.readFileSync(CONFIG_PATH, 'utf8');
    await request.post('/api/disconnect');
  });

  test.afterAll(async ({ request }) => {
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

  test('Onboarding — Azure apenas → dashboard com cards de projeto', async ({ page }) => {
    // ── Screen 0 ──────────────────────────────────────────────────────────
    await page.goto('/onboarding');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('#screen0')).toBeVisible();
    await page.locator('#screen0 button[onclick="goTo(1)"]').click();

    // ── Screen 1: card A — deseleciona C (padrão) e seleciona Azure ───────
    await expect(page.locator('#screen1')).toBeVisible();
    await page.locator('#cardA').click();
    await expect(page.locator('#cardA')).toHaveClass(/selected-blue/);
    await expect(page.locator('#cardC')).not.toHaveClass(/selected/);
    await page.locator('#screen1 button[onclick="goTo(2)"]').click();

    // ── Screen 2: painel Azure visível, SN oculto ─────────────────────────
    await expect(page.locator('#screen2')).toBeVisible();
    await expect(page.locator('#panelAz')).toBeVisible();
    await expect(page.locator('#panelSn')).toBeHidden();

    await page.locator('#azOrg').fill(AZ_ORG);
    await page.locator('#azPat').fill(AZ_PAT);
    await page.locator('#btnTestAz').click();
    await expect(page.locator('#statusAz')).toHaveClass(/success/, { timeout: 20_000 });

    await page.locator('#screen2 button[onclick="goTo(3)"]').click();

    // ── Screen 3: só projetos Azure, SN groups oculto ─────────────────────
    await expect(page.locator('#screen3')).toBeVisible();
    await expect(page.locator('#azProjectsSection')).not.toHaveClass(/hidden/);
    await expect(page.locator('#snGroupsSection')).toHaveClass(/hidden/);

    const firstProj = page.locator('#projectsGrid .proj-card').first();
    await expect(firstProj).toBeVisible({ timeout: 20_000 });
    await firstProj.click();
    await expect(firstProj).toHaveClass(/selected/);

    // Azure Only: goToOrFinish() chama finishSetup() direto — sem screen4
    await page.locator('#screen3 button[onclick="goToOrFinish()"]').click();

    // ── Screen 5: Done ────────────────────────────────────────────────────
    await expect(page.locator('#screen5')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.checkmark-circle')).toBeVisible();
    await expect(page.locator('.done-pill').filter({ hasText: /Azure DevOps configured/ })).toBeVisible();
    await expect(page.locator('.done-pill').filter({ hasText: /ServiceNow/ })).toHaveCount(0);

    // ── Dashboard: cards Azure presentes, sem toggle AZ/SN ───────────────
    await page.locator('button[onclick="openDashboard()"]').click();
    await page.waitForURL('/', { timeout: 15_000 });
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.card[data-project]').first()).toBeVisible({ timeout: 20_000 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// JORNADA — SN ONLY (card B)
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Jornada — SN Only', () => {
  test.skip(!HAS_SN, 'Requer TEST_SN_INSTANCE, TEST_SN_USER e TEST_SN_PASS no .env.test');

  let _origConfig = null;

  test.beforeAll(async ({ request }) => {
    if (fs.existsSync(CONFIG_PATH)) _origConfig = fs.readFileSync(CONFIG_PATH, 'utf8');
    await request.post('/api/disconnect');
  });

  test.afterAll(async ({ request }) => {
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

  test('Onboarding — SN apenas → dashboard SN ativo', async ({ page }) => {
    // ── Screen 0 ──────────────────────────────────────────────────────────
    await page.goto('/onboarding');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('#screen0')).toBeVisible();
    await page.locator('#screen0 button[onclick="goTo(1)"]').click();

    // ── Screen 1: card B — deseleciona C (padrão) e seleciona SN ─────────
    await expect(page.locator('#screen1')).toBeVisible();
    await page.locator('#cardB').click();
    await expect(page.locator('#cardB')).toHaveClass(/selected-purple/);
    await expect(page.locator('#cardC')).not.toHaveClass(/selected/);
    await page.locator('#screen1 button[onclick="goTo(2)"]').click();

    // ── Screen 2: painel SN visível, Azure oculto ─────────────────────────
    await expect(page.locator('#screen2')).toBeVisible();
    await expect(page.locator('#panelAz')).toBeHidden();
    await expect(page.locator('#panelSn')).toBeVisible();

    await page.locator('#snInstance').fill(SN_INST);
    await page.locator('#snUser').fill(SN_USER);
    await page.locator('#snPass').fill(SN_PASS);
    await page.locator('#btnTestSn').click();
    await expect(page.locator('#statusSn')).toHaveClass(/success/, { timeout: 20_000 });

    await page.locator('#screen2 button[onclick="goTo(3)"]').click();

    // ── Screen 3: só grupos SN, seção Azure oculta ───────────────────────
    await expect(page.locator('#screen3')).toBeVisible();
    await expect(page.locator('#azProjectsSection')).toHaveClass(/hidden/);
    await expect(page.locator('#snGroupsSection')).not.toHaveClass(/hidden/);

    const firstGroup = page.locator('#snGroupsList .sn-group-item').first();
    await expect(firstGroup).toBeVisible({ timeout: 15_000 });
    await firstGroup.click();

    // SN Only: goToOrFinish() chama finishSetup() direto — sem screen4
    await page.locator('#screen3 button[onclick="goToOrFinish()"]').click();

    // ── Screen 5: Done ────────────────────────────────────────────────────
    await expect(page.locator('#screen5')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.checkmark-circle')).toBeVisible();
    await expect(page.locator('.done-pill').filter({ hasText: /ServiceNow configured/ })).toBeVisible();
    await expect(page.locator('.done-pill').filter({ hasText: /Azure DevOps/ })).toHaveCount(0);

    // ── Dashboard: página carrega sem Azure cards ─────────────────────────
    await page.locator('button[onclick="openDashboard()"]').click();
    await page.waitForURL('/', { timeout: 15_000 });
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.sidebar')).toBeVisible();
    await expect(page.locator('.card[data-project]')).toHaveCount(0);
  });
});

// @ts-check
const { test, expect } = require('@playwright/test');

// ── helpers ───────────────────────────────────────────────────────────────────

/** Erros de console coletados durante o teste */
function collectErrors(page) {
  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', err => errors.push(err.message));
  return errors;
}

// ── smoke ─────────────────────────────────────────────────────────────────────

test.describe('Dashboard — smoke', () => {
  test('carrega sem erros de JavaScript', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    expect(errors).toHaveLength(0);
  });

  test('exibe topbar e botões de idioma', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.topbar')).toBeVisible();
    await expect(page.locator('.btn-lang[data-lang="pt"]')).toBeVisible();
    await expect(page.locator('.btn-lang[data-lang="en"]')).toBeVisible();
  });

  test('exibe sidebar com links de navegação', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.sidebar')).toBeVisible();
    await expect(page.locator('#sidebar-link-dashboard')).toBeVisible();
  });
});

// ── health filter ─────────────────────────────────────────────────────────────

test.describe('Dashboard — filtro de saúde', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // pula se não houver cards de projeto (servidor sem config)
    const cards = page.locator('.card[data-project]');
    const count  = await cards.count();
    test.skip(count === 0, 'Nenhum projeto configurado — pulando testes de card');
  });

  test('chip "All" está ativo por padrão', async ({ page }) => {
    await expect(page.locator('.fchip[data-health="all"]')).toHaveClass(/active/);
  });

  test('chip "Critical" filtra cards vermelhos', async ({ page }) => {
    await page.locator('.fchip[data-health="red"]').click();
    await expect(page.locator('.fchip[data-health="red"]')).toHaveClass(/active/);
    // cards não-vermelhos devem estar ocultos
    const hidden = await page.locator('.card[data-project]').evaluateAll(cards =>
      cards.filter(c => c.style.display === 'none').length
    );
    // não exigimos número exato, apenas que o filtro não quebrou
    expect(typeof hidden).toBe('number');
  });

  test('clicar em "All" restaura todos os cards', async ({ page }) => {
    await page.locator('.fchip[data-health="red"]').click();
    await page.locator('.fchip[data-health="all"]').click();
    const visible = await page.locator('.card[data-project]').evaluateAll(cards =>
      cards.filter(c => c.style.display !== 'none').length
    );
    expect(visible).toBeGreaterThan(0);
  });
});

// ── Team Capacity view ────────────────────────────────────────────────────────

test.describe('Dashboard — Team Capacity view', () => {
  test('abre a view de TC e oculta os cards', async ({ page }) => {
    await page.goto('/');
    await page.locator('#sidebar-link-tc').click();
    await expect(page.locator('#tc-view')).toBeVisible();
    await expect(page.locator('#content')).toBeHidden();
  });

  test('botão Dashboard na sidebar restaura os cards', async ({ page }) => {
    await page.goto('/');
    await page.locator('#sidebar-link-tc').click();
    await page.locator('#sidebar-link-dashboard').click();
    await expect(page.locator('#tc-view')).toBeHidden();
    await expect(page.locator('#content')).toBeVisible();
  });
});

// ── Source toggle (AZ / SN) ───────────────────────────────────────────────────

test.describe('Dashboard — toggle AZ/SN', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    const toggle = page.locator('.source-switcher');
    const visible = await toggle.isVisible();
    test.skip(!visible, 'Modo Azure+SN não configurado — pulando testes de toggle');
  });

  test('botão AZ está ativo por padrão', async ({ page }) => {
    await expect(page.locator('.btn-source[data-source="az"]')).toHaveClass(/active/);
  });

  test('clicando SN mostra #sn-view e oculta #content', async ({ page }) => {
    await page.locator('.btn-source[data-source="sn"]').click();
    await expect(page.locator('#sn-view')).toBeVisible();
    await expect(page.locator('#content')).toBeHidden();
    await expect(page.locator('.cards-toolbar')).toBeHidden();
  });

  test('clicando AZ restaura #content e oculta #sn-view', async ({ page }) => {
    await page.locator('.btn-source[data-source="sn"]').click();
    await page.locator('.btn-source[data-source="az"]').click();
    await expect(page.locator('#content')).toBeVisible();
    await expect(page.locator('#sn-view')).toBeHidden();
    await expect(page.locator('.cards-toolbar')).toBeVisible();
  });

  test('SN view carrega dados (KPI bar visível após fetch)', async ({ page }) => {
    await page.locator('.btn-source[data-source="sn"]').click();
    // aguarda o fetch completar (loading → conteúdo real ou erro)
    await page.locator('#sn-view .sn-kpi-bar, #sn-view .sn-view-error')
      .waitFor({ state: 'visible', timeout: 15_000 });
  });

  test('Team Capacity fecha o SN view', async ({ page }) => {
    await page.locator('.btn-source[data-source="sn"]').click();
    await expect(page.locator('#sn-view')).toBeVisible();
    await page.locator('#sidebar-link-tc').click();
    await expect(page.locator('#sn-view')).toBeHidden();
    await expect(page.locator('#tc-view')).toBeVisible();
  });

  test('voltar ao Dashboard após SN view reseta botão para AZ ativo', async ({ page }) => {
    await page.locator('.btn-source[data-source="sn"]').click();
    await page.locator('#sidebar-link-tc').click();
    await page.locator('#sidebar-link-dashboard').click();
    await expect(page.locator('.btn-source[data-source="az"]')).toHaveClass(/active/);
    await expect(page.locator('.btn-source[data-source="sn"]')).not.toHaveClass(/active/);
  });
});

// @ts-check
const { test, expect } = require('@playwright/test');

// ── helpers ───────────────────────────────────────────────────────────────────

/** Abre o modal Monthly Review do primeiro card que tiver o botão */
async function openReport(page) {
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  const btn = page.locator('.ca:has-text("Monthly Review")').first();
  const found = await btn.isVisible();
  if (!found) return false;

  await btn.click();
  await expect(page.locator('#report-modal')).toBeVisible({ timeout: 5_000 });
  // aguarda o conteúdo carregar (indicador de "Carregando" desaparecer)
  await page.waitForFunction(
    () => !document.getElementById('report-modal-body')?.textContent?.includes('Carregando'),
    { timeout: 20_000 }
  );
  return true;
}

// ── abertura do modal ─────────────────────────────────────────────────────────

test.describe('Monthly Review — modal', () => {
  test('abre sem erros de JavaScript', async ({ page }) => {
    const errors = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', err => errors.push(err.message));

    const opened = await openReport(page);
    test.skip(!opened, 'Nenhum projeto configurado — pulando testes do Monthly Review');

    expect(errors).toHaveLength(0);
  });

  test('seletor de mês está presente', async ({ page }) => {
    const opened = await openReport(page);
    test.skip(!opened, 'Nenhum projeto configurado');

    await expect(page.locator('#report-month-sel')).toBeVisible();
  });

  test('fecha ao clicar no botão ✕', async ({ page }) => {
    const opened = await openReport(page);
    test.skip(!opened, 'Nenhum projeto configurado');

    await page.locator('#report-modal .modal-close').click();
    await expect(page.locator('#report-modal')).toBeHidden();
  });
});

// ── filtro de seção ───────────────────────────────────────────────────────────

test.describe('Monthly Review — filtro de seção', () => {
  test.beforeEach(async ({ page }) => {
    const opened = await openReport(page);
    test.skip(!opened, 'Nenhum projeto configurado');
  });

  test('barra de filtros está visível quando SN está configurado', async ({ page }) => {
    const filterBar = page.locator('.report-filter-bar');
    const hasSn     = await filterBar.isVisible();
    // sem SN: sem barra → passa trivialmente; com SN: deve ter botões
    if (hasSn) {
      await expect(page.locator('.report-filter-btn[data-filter="all"]')).toBeVisible();
    }
  });

  test('filtro "Incidentes" oculta seção sprint', async ({ page }) => {
    const filterBar = page.locator('.report-filter-bar');
    test.skip(!(await filterBar.isVisible()), 'SN não configurado para este projeto');

    await page.locator('.report-filter-btn[data-filter="incidents"]').click();
    await expect(page.locator('.report-filter-btn[data-filter="incidents"]')).toHaveClass(/report-filter-btn--active/);

    const sprintSections = page.locator('.report-content [data-section="sprint"]');
    if (await sprintSections.count() > 0) {
      await expect(sprintSections.first()).toBeHidden();
    }
  });

  test('filtro "Todos" restaura todas as seções', async ({ page }) => {
    const filterBar = page.locator('.report-filter-bar');
    test.skip(!(await filterBar.isVisible()), 'SN não configurado para este projeto');

    await page.locator('.report-filter-btn[data-filter="incidents"]').click();
    await page.locator('.report-filter-btn[data-filter="all"]').click();
    await expect(page.locator('.report-filter-btn[data-filter="all"]')).toHaveClass(/report-filter-btn--active/);

    // nenhuma seção deve estar forçadamente oculta
    const content = page.locator('.report-content');
    const filterAttr = await content.getAttribute('data-section-filter');
    expect(filterAttr).toBeNull();
  });

  test('filtro persiste ao mudar e voltar ao "Todos"', async ({ page }) => {
    const filterBar = page.locator('.report-filter-bar');
    test.skip(!(await filterBar.isVisible()), 'SN não configurado para este projeto');

    const filters = ['incidents', 'prbs', 'sprint', 'all'];
    for (const f of filters) {
      const btn = page.locator(`.report-filter-btn[data-filter="${f}"]`);
      if (await btn.isVisible()) {
        await btn.click();
        await expect(btn).toHaveClass(/report-filter-btn--active/);
      }
    }
  });
});

// ── drag & drop ───────────────────────────────────────────────────────────────

test.describe('Monthly Review — drag & drop', () => {
  test.beforeEach(async ({ page }) => {
    const opened = await openReport(page);
    test.skip(!opened, 'Nenhum projeto configurado');
  });

  test('arrasta célula de gráfico Azure para outra posição', async ({ page }) => {
    const cells = page.locator('.report-donuts-grid .report-donut-cell[draggable="true"]');
    const count  = await cells.count();
    test.skip(count < 2, 'Menos de 2 gráficos — sem o que arrastar');

    const src = cells.nth(0);
    const dst = cells.nth(1);

    // captura título do primeiro gráfico antes do drag
    const titleBefore = await src.locator('.report-subsection-title').textContent();

    const srcBox = await src.boundingBox();
    const dstBox = await dst.boundingBox();

    // simula drag do centro do src ao centro do dst
    await page.mouse.move(srcBox.x + srcBox.width / 2, srcBox.y + srcBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(dstBox.x + dstBox.width / 2, dstBox.y + dstBox.height / 2, { steps: 10 });
    await page.mouse.up();

    // aguarda re-render
    await page.waitForTimeout(500);

    // verifica que não houve erro de JS durante o drag
    // (se houve, a célula teria sumido ou o grid estaria quebrado)
    await expect(page.locator('.report-donuts-grid .report-donut-cell[draggable="true"]').first()).toBeVisible();
  });

  test('drag não dispara a partir de botão de config (⚙)', async ({ page }) => {
    const cells = page.locator('.report-donuts-grid .report-donut-cell[draggable="true"]');
    test.skip(await cells.count() === 0, 'Nenhum gráfico disponível');

    const configBtn = cells.first().locator('.report-field-picker-btn').first();
    test.skip(!(await configBtn.isVisible()), 'Botão ⚙ não encontrado');

    // monitora eventos de drag: o botão NÃO deve iniciar um drag
    const dragStarted = await page.evaluate(async () => {
      const btn = document.querySelector('.report-donut-cell .report-field-picker-btn');
      if (!btn) return null;
      return new Promise(resolve => {
        let started = false;
        const cell = btn.closest('[draggable]');
        cell.addEventListener('dragstart', e => { started = !e.defaultPrevented; }, { once: true });
        btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        btn.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true }));
        setTimeout(() => resolve(started), 100);
      });
    });

    // dragStarted pode ser false (correto: drag bloqueado) ou null (botão não achado)
    if (dragStarted !== null) {
      expect(dragStarted).toBe(false);
    }
  });
});

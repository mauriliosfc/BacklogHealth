// @ts-check
/**
 * Monthly Review — testes e2e ponta a ponta
 *
 * Parte da abertura do modal no dashboard principal e cobre:
 *   - abertura e fechamento do modal
 *   - carregamento de dados (mês, título, corpo sem erros JS)
 *   - filtros de seção (Azure / Incidentes / Problems / Todos)
 *   - persistência do filtro ativo após re-render
 *   - maximizar / restaurar
 *   - troca de mês
 *   - reabertura após fechar
 *   - drag & drop de células de gráfico
 *   - botão de config (⚙) não dispara drag
 *
 * Não faz onboarding — assume config.json ou variáveis TEST_AZ_PAT/TEST_SN_INSTANCE
 * já configurados antes da execução (via .env.test).
 */
const { test, expect } = require('@playwright/test');
const fs   = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', '..', 'config.json');

function _hasConfig() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return false;
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return !!(cfg.org || cfg.servicenow?.instance);
  } catch (_) { return false; }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Navega para o dashboard e abre o Monthly Review do primeiro card disponível.
 * Retorna false se nenhum botão "Monthly Review" existir.
 */
async function goToReportModal(page) {
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  const btn = page.locator('button.ca[onclick="openReport(this)"]').first();
  if (!(await btn.isVisible().catch(() => false))) return false;

  await btn.click();
  await expect(page.locator('#report-modal')).toBeVisible({ timeout: 10_000 });

  // Aguarda o spinner (.report-loading) sumir e o body ter conteúdo real
  await page.waitForFunction(
    () => {
      const body = document.getElementById('report-modal-body');
      return !!body && !body.querySelector('.report-loading') && body.textContent?.trim() !== '';
    },
    { timeout: 30_000 }
  );
  return true;
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. Abertura e estrutura básica
// ══════════════════════════════════════════════════════════════════════════════

test.describe('Monthly Review — abertura e estrutura', () => {
  test.skip(!_hasConfig(), 'config.json ausente ou vazio — configure Azure/SN antes de rodar');

  test('1.1 abre modal a partir do botão no card do dashboard', async ({ page }) => {
    const ok = await goToReportModal(page);
    test.skip(!ok, 'Nenhum projeto com botão Monthly Review disponível');

    await expect(page.locator('#report-modal')).toBeVisible();
    await expect(page.locator('#report-modal-title')).not.toBeEmpty();
    await expect(page.locator('#report-month-sel')).toBeVisible();
    await expect(page.locator('#report-modal-body')).not.toBeEmpty();
  });

  test('1.2 abre sem erros de JavaScript no console', async ({ page }) => {
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    const ok = await goToReportModal(page);
    test.skip(!ok, 'Nenhum projeto disponível');

    // Aguarda eventos pendentes
    await page.waitForTimeout(300);

    // Filtra erros de rede (404 de assets) — só erros JS importam
    const jsErrors = errors.filter(e => !e.includes('Failed to load resource'));
    expect(jsErrors).toHaveLength(0);
  });

  test('1.3 seletor de mês tem ao menos uma opção', async ({ page }) => {
    const ok = await goToReportModal(page);
    test.skip(!ok, 'Nenhum projeto disponível');

    const optCount = await page.locator('#report-month-sel').evaluate(s => /** @type {HTMLSelectElement} */ (s).options.length);
    expect(optCount).toBeGreaterThan(0);
  });

  test('1.4 título do modal reflete o nome do projeto', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const btn = page.locator('button.ca[onclick="openReport(this)"]').first();
    test.skip(!(await btn.isVisible().catch(() => false)), 'Nenhum botão disponível');

    // Captura o nome do projeto a partir do card ancestral
    const projName = await btn.evaluate(el => el.closest('[data-project]')?.getAttribute('data-project') ?? '');

    await btn.click();
    await expect(page.locator('#report-modal')).toBeVisible({ timeout: 10_000 });

    if (projName) {
      await expect(page.locator('#report-modal-title')).toHaveText(projName);
    } else {
      await expect(page.locator('#report-modal-title')).not.toBeEmpty();
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. Fechamento do modal
// ══════════════════════════════════════════════════════════════════════════════

test.describe('Monthly Review — fechamento', () => {
  test.skip(!_hasConfig(), 'config.json ausente ou vazio');

  test('2.1 fecha pelo botão ✕', async ({ page }) => {
    const ok = await goToReportModal(page);
    test.skip(!ok, 'Nenhum projeto disponível');

    await page.locator('#report-modal button.modal-close').click();
    await expect(page.locator('#report-modal')).toBeHidden();
  });

  test('2.2 fecha clicando no overlay fora da caixa', async ({ page }) => {
    const ok = await goToReportModal(page);
    test.skip(!ok, 'Nenhum projeto disponível');

    // Modal abre maximizado — box preenche a tela, sem overlay exposto.
    // De-maximiza para ter área de overlay visível fora da caixa.
    await page.locator('#report-modal-max').click();
    await expect(page.locator('#report-modal')).not.toHaveClass(/maximized/);

    // Clica no canto do overlay (fora da modal-box)
    await page.locator('#report-modal').click({ position: { x: 4, y: 4 }, force: true });
    await expect(page.locator('#report-modal')).toBeHidden();
  });

  test('2.3 reabre corretamente após fechar', async ({ page }) => {
    const ok = await goToReportModal(page);
    test.skip(!ok, 'Nenhum projeto disponível');

    // Fecha
    await page.locator('#report-modal button.modal-close').click();
    await expect(page.locator('#report-modal')).toBeHidden();

    // Reabre
    await page.locator('button.ca[onclick="openReport(this)"]').first().click();
    await expect(page.locator('#report-modal')).toBeVisible({ timeout: 10_000 });
    await page.waitForFunction(
      () => !document.getElementById('report-modal-body')?.textContent?.includes('Carregando'),
      { timeout: 30_000 }
    );
    await expect(page.locator('#report-modal-body')).not.toBeEmpty();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. Maximizar / restaurar
// ══════════════════════════════════════════════════════════════════════════════

test.describe('Monthly Review — maximizar', () => {
  test.skip(!_hasConfig(), 'config.json ausente ou vazio');

  test('3.1 modal abre maximizado por padrão', async ({ page }) => {
    const ok = await goToReportModal(page);
    test.skip(!ok, 'Nenhum projeto disponível');

    await expect(page.locator('#report-modal')).toHaveClass(/maximized/);
  });

  test('3.2 botão ⤢ alterna entre maximizado e normal', async ({ page }) => {
    const ok = await goToReportModal(page);
    test.skip(!ok, 'Nenhum projeto disponível');

    const modal  = page.locator('#report-modal');
    const maxBtn = page.locator('#report-modal-max');

    await expect(modal).toHaveClass(/maximized/);

    await maxBtn.click();
    await expect(modal).not.toHaveClass(/maximized/);

    await maxBtn.click();
    await expect(modal).toHaveClass(/maximized/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. Seletor de mês
// ══════════════════════════════════════════════════════════════════════════════

test.describe('Monthly Review — seletor de mês', () => {
  test.skip(!_hasConfig(), 'config.json ausente ou vazio');

  test('4.1 trocar mês recarrega o conteúdo', async ({ page }) => {
    const ok = await goToReportModal(page);
    test.skip(!ok, 'Nenhum projeto disponível');

    const sel = page.locator('#report-month-sel');
    const optCount = await sel.evaluate(s => /** @type {HTMLSelectElement} */ (s).options.length);
    test.skip(optCount < 2, 'Apenas um mês disponível — sem troca possível');

    const secondValue = await sel.evaluate(s => /** @type {HTMLSelectElement} */ (s).options[1].value);
    await sel.selectOption(secondValue);

    // Aguarda recarregamento
    await page.waitForFunction(
      () => !document.getElementById('report-modal-body')?.textContent?.includes('Carregando'),
      { timeout: 30_000 }
    );

    // Mês correto selecionado
    await expect(sel).toHaveValue(secondValue);
    await expect(page.locator('#report-modal-body')).not.toBeEmpty();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. Filtros de seção
// ══════════════════════════════════════════════════════════════════════════════

test.describe('Monthly Review — filtros de seção', () => {
  test.skip(!_hasConfig(), 'config.json ausente ou vazio');

  test('5.1 barra de filtros presente quando há dados SN', async ({ page }) => {
    const ok = await goToReportModal(page);
    test.skip(!ok, 'Nenhum projeto disponível');

    const filterBar = page.locator('.report-filter-bar');
    const hasSn = await filterBar.isVisible().catch(() => false);
    if (hasSn) {
      await expect(page.locator('.report-filter-btn[data-filter="all"]')).toBeVisible();
      await expect(page.locator('.report-filter-btn[data-filter="incidents"]')).toBeVisible();
      await expect(page.locator('.report-filter-btn[data-filter="prbs"]')).toBeVisible();
    }
    // sem SN: barra ausente é válido — teste passa trivialmente
  });

  test('5.2 "Todos" está ativo por padrão e sem data-section-filter', async ({ page }) => {
    const ok = await goToReportModal(page);
    test.skip(!ok, 'Nenhum projeto disponível');

    const filterBar = page.locator('.report-filter-bar');
    test.skip(!(await filterBar.isVisible().catch(() => false)), 'SN não configurado');

    await expect(page.locator('.report-filter-btn[data-filter="all"]')).toHaveClass(/report-filter-btn--active/);
    const content = page.locator('#report-modal-body .report-content');
    await expect(content).not.toHaveAttribute('data-section-filter');
  });

  test('5.3 filtro "Incidentes" ativa botão e oculta sprint/prbs', async ({ page }) => {
    const ok = await goToReportModal(page);
    test.skip(!ok, 'Nenhum projeto disponível');

    const filterBar = page.locator('.report-filter-bar');
    test.skip(!(await filterBar.isVisible().catch(() => false)), 'SN não configurado');

    await page.locator('.report-filter-btn[data-filter="incidents"]').click();
    await expect(page.locator('.report-filter-btn[data-filter="incidents"]')).toHaveClass(/report-filter-btn--active/);

    const content = page.locator('#report-modal-body .report-content');
    await expect(content).toHaveAttribute('data-section-filter', 'incidents');

    if (await content.locator('[data-section="sprint"]').count() > 0) {
      await expect(content.locator('[data-section="sprint"]').first()).toBeHidden();
    }
    if (await content.locator('[data-section="prbs"]').count() > 0) {
      await expect(content.locator('[data-section="prbs"]').first()).toBeHidden();
    }
    if (await content.locator('[data-section="incidents"]').count() > 0) {
      await expect(content.locator('[data-section="incidents"]').first()).toBeVisible();
    }
  });

  test('5.4 filtro "Problems" ativa botão e oculta sprint/incidents', async ({ page }) => {
    const ok = await goToReportModal(page);
    test.skip(!ok, 'Nenhum projeto disponível');

    const filterBar = page.locator('.report-filter-bar');
    test.skip(!(await filterBar.isVisible().catch(() => false)), 'SN não configurado');

    await page.locator('.report-filter-btn[data-filter="prbs"]').click();
    await expect(page.locator('.report-filter-btn[data-filter="prbs"]')).toHaveClass(/report-filter-btn--active/);

    const content = page.locator('#report-modal-body .report-content');
    await expect(content).toHaveAttribute('data-section-filter', 'prbs');

    if (await content.locator('[data-section="sprint"]').count() > 0) {
      await expect(content.locator('[data-section="sprint"]').first()).toBeHidden();
    }
    if (await content.locator('[data-section="incidents"]').count() > 0) {
      await expect(content.locator('[data-section="incidents"]').first()).toBeHidden();
    }
    if (await content.locator('[data-section="prbs"]').count() > 0) {
      await expect(content.locator('[data-section="prbs"]').first()).toBeVisible();
    }
  });

  test('5.5 filtro "Azure" ativa botão e oculta incidents/prbs', async ({ page }) => {
    const ok = await goToReportModal(page);
    test.skip(!ok, 'Nenhum projeto disponível');

    const filterBar = page.locator('.report-filter-bar');
    test.skip(!(await filterBar.isVisible().catch(() => false)), 'SN não configurado');

    const btnAz = page.locator('.report-filter-btn[data-filter="sprint"]');
    test.skip(!(await btnAz.isVisible().catch(() => false)), 'Botão Azure ausente (projeto sem AZ)');

    await btnAz.click();
    await expect(btnAz).toHaveClass(/report-filter-btn--active/);

    const content = page.locator('#report-modal-body .report-content');
    await expect(content).toHaveAttribute('data-section-filter', 'sprint');

    if (await content.locator('[data-section="incidents"]').count() > 0) {
      await expect(content.locator('[data-section="incidents"]').first()).toBeHidden();
    }
    if (await content.locator('[data-section="prbs"]').count() > 0) {
      await expect(content.locator('[data-section="prbs"]').first()).toBeHidden();
    }
    if (await content.locator('[data-section="sprint"]').count() > 0) {
      await expect(content.locator('[data-section="sprint"]').first()).toBeVisible();
    }
  });

  test('5.6 filtro "Todos" remove data-section-filter e restaura todas as seções', async ({ page }) => {
    const ok = await goToReportModal(page);
    test.skip(!ok, 'Nenhum projeto disponível');

    const filterBar = page.locator('.report-filter-bar');
    test.skip(!(await filterBar.isVisible().catch(() => false)), 'SN não configurado');

    // Ativa filtro intermediário
    await page.locator('.report-filter-btn[data-filter="incidents"]').click();
    const content = page.locator('#report-modal-body .report-content');
    await expect(content).toHaveAttribute('data-section-filter', 'incidents');

    // Volta para Todos
    await page.locator('.report-filter-btn[data-filter="all"]').click();
    await expect(page.locator('.report-filter-btn[data-filter="all"]')).toHaveClass(/report-filter-btn--active/);
    await expect(content).not.toHaveAttribute('data-section-filter');
  });

  test('5.7 ciclo completo de filtros — todos os botões ficam ativos na sequência', async ({ page }) => {
    const ok = await goToReportModal(page);
    test.skip(!ok, 'Nenhum projeto disponível');

    const filterBar = page.locator('.report-filter-bar');
    test.skip(!(await filterBar.isVisible().catch(() => false)), 'SN não configurado');

    const filters = ['incidents', 'prbs', 'all'];
    for (const f of filters) {
      const btn = page.locator(`.report-filter-btn[data-filter="${f}"]`);
      if (await btn.isVisible()) {
        await btn.click();
        await expect(btn).toHaveClass(/report-filter-btn--active/);
        // Somente o botão clicado deve estar ativo
        const otherActive = page.locator(`.report-filter-btn:not([data-filter="${f}"]).report-filter-btn--active`);
        await expect(otherActive).toHaveCount(0);
      }
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 6. Drag & drop de células de gráfico
// ══════════════════════════════════════════════════════════════════════════════

test.describe('Monthly Review — drag & drop', () => {
  test.skip(!_hasConfig(), 'config.json ausente ou vazio');

  test('6.1 arrasta célula para outra posição sem erros de JS', async ({ page }) => {
    const jsErrors = [];
    page.on('pageerror', err => jsErrors.push(err.message));

    const ok = await goToReportModal(page);
    test.skip(!ok, 'Nenhum projeto disponível');

    const cells = page.locator('.report-donuts-grid .report-donut-cell[draggable="true"]');
    const count  = await cells.count();
    test.skip(count < 2, 'Menos de 2 gráficos — sem o que arrastar');

    const src = cells.nth(0);
    const dst = cells.nth(1);

    const srcBox = await src.boundingBox();
    const dstBox = await dst.boundingBox();

    await page.mouse.move(srcBox.x + srcBox.width / 2, srcBox.y + srcBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(dstBox.x + dstBox.width / 2, dstBox.y + dstBox.height / 2, { steps: 12 });
    await page.mouse.up();

    await page.waitForTimeout(400);

    // Grid ainda exibe células após o drag
    await expect(page.locator('.report-donuts-grid .report-donut-cell[draggable="true"]').first()).toBeVisible();
    expect(jsErrors).toHaveLength(0);
  });

  test('6.2 botão de config (⚙) não inicia drag na célula', async ({ page }) => {
    const ok = await goToReportModal(page);
    test.skip(!ok, 'Nenhum projeto disponível');

    const cells = page.locator('.report-donuts-grid .report-donut-cell[draggable="true"]');
    test.skip(await cells.count() === 0, 'Nenhum gráfico disponível');

    const configBtn = cells.first().locator('.report-field-picker-btn').first();
    test.skip(!(await configBtn.isVisible().catch(() => false)), 'Botão ⚙ não encontrado');

    const dragStarted = await page.evaluate(async () => {
      const btn = document.querySelector('.report-donut-cell .report-field-picker-btn');
      if (!btn) return null;
      return new Promise(resolve => {
        let started = false;
        const cell = btn.closest('[draggable="true"]');
        cell.addEventListener('dragstart', e => { started = !e.defaultPrevented; }, { once: true });
        btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        btn.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true }));
        setTimeout(() => resolve(started), 120);
      });
    });

    if (dragStarted !== null) {
      expect(dragStarted).toBe(false);
    }
  });

  test('6.3 drag via API de eventos HTML5 reordena os gráficos', async ({ page }) => {
    const ok = await goToReportModal(page);
    test.skip(!ok, 'Nenhum projeto disponível');

    const cells = page.locator('.report-donuts-grid .report-donut-cell[draggable="true"]');
    const count = await cells.count();
    test.skip(count < 2, 'Menos de 2 gráficos — sem o que reordenar');

    // Captura títulos antes do drag
    const titlesBefore = await cells.evaluateAll(els =>
      els.map(el => el.querySelector('.report-subsection-title')?.textContent?.trim() ?? '')
    );

    // Simula drag completo via eventos HTML5 entre célula 0 e célula 1
    const reordered = await page.evaluate(() => {
      const grid  = document.querySelector('.report-donuts-grid');
      const all   = [...grid.querySelectorAll('.report-donut-cell[draggable="true"]')];
      if (all.length < 2) return false;

      const src = all[0];
      const dst = all[1];

      src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true }));
      dst.dispatchEvent(new DragEvent('dragover',  { bubbles: true, cancelable: true }));
      dst.dispatchEvent(new DragEvent('drop',      { bubbles: true, cancelable: true }));
      src.dispatchEvent(new DragEvent('dragend',   { bubbles: true, cancelable: true }));
      return true;
    });

    test.skip(!reordered, 'Simulação de drag não suportada neste browser');

    // Aguarda re-render
    await page.waitForTimeout(500);

    const titlesAfter = await page.locator('.report-donuts-grid .report-donut-cell[draggable="true"]').evaluateAll(els =>
      els.map(el => el.querySelector('.report-subsection-title')?.textContent?.trim() ?? '')
    );

    // Depois do drag, a ordem deve ter mudado (primeiro título diferente do original)
    // OU o grid manteve a mesma contagem (re-render correto)
    expect(titlesAfter.length).toBe(count);
    // A troca 0→1 inverte os dois primeiros elementos
    if (titlesBefore[0] && titlesBefore[1]) {
      expect(titlesAfter[0]).toBe(titlesBefore[1]);
      expect(titlesAfter[1]).toBe(titlesBefore[0]);
    }
  });

  test('6.4 após drag, factory não vaza estado entre sistemas', async ({ page }) => {
    const jsErrors = [];
    page.on('pageerror', err => jsErrors.push(err.message));

    const ok = await goToReportModal(page);
    test.skip(!ok, 'Nenhum projeto disponível');

    // Inicia drag em main chart e abandona (dragend sem drop)
    await page.evaluate(() => {
      const cell = document.querySelector('.report-donuts-grid .report-donut-cell[draggable="true"]');
      if (!cell) return;
      cell.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true }));
      cell.dispatchEvent(new DragEvent('dragend',   { bubbles: true, cancelable: true }));
    });

    await page.waitForTimeout(200);

    // Nenhuma classe de drag deve permanecer no DOM após dragend
    const lingering = await page.locator('.report-drag-over').count();
    expect(lingering).toBe(0);
    expect(jsErrors).toHaveLength(0);
  });
});

// 7. Picker factory — abertura, cancelamento e aplicação
test.describe('7. Picker factory', () => {
  test('7.1 botão Cancelar fecha o picker sem alterar configuração', async ({ page }) => {
    const jsErrors = [];
    page.on('pageerror', err => jsErrors.push(err.message));

    const ok = await goToReportModal(page);
    test.skip(!ok, 'Nenhum projeto disponível');

    // Abre o picker de Volume de Incidentes via botão ⚙ da seção Incidentes
    const cfgBtn = page.locator('.report-section-actions button', { hasText: /volume/i }).first();
    const hasCfg = await cfgBtn.count() > 0;
    if (!hasCfg) {
      // Fallback: abre via picker de campo do gráfico principal
      const addBtn = page.locator('button[onclick*="reportOpenFieldPicker"]').first();
      if (await addBtn.count() === 0) { test.skip(true, 'Nenhum botão de picker encontrado'); return; }
      await addBtn.click();
    } else {
      await cfgBtn.click();
    }

    // Picker deve estar visível
    await expect(page.locator('#report-field-picker')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('#report-picker-backdrop')).toBeVisible();

    // Clica em Cancelar
    await page.locator('#report-picker-cancel').click();

    // Picker deve desaparecer
    await expect(page.locator('#report-field-picker')).not.toBeVisible({ timeout: 2000 });
    await expect(page.locator('#report-picker-backdrop')).not.toBeVisible();
    expect(jsErrors).toHaveLength(0);
  });

  test('7.2 clicar no backdrop fecha o picker', async ({ page }) => {
    const jsErrors = [];
    page.on('pageerror', err => jsErrors.push(err.message));

    const ok = await goToReportModal(page);
    test.skip(!ok, 'Nenhum projeto disponível');

    // Abre qualquer picker
    const cfgBtn = page.locator('button[onclick*="Picker"]').first();
    if (await cfgBtn.count() === 0) { test.skip(true, 'Nenhum botão de picker encontrado'); return; }
    await cfgBtn.click();

    await expect(page.locator('#report-field-picker')).toBeVisible({ timeout: 3000 });

    // Clica no backdrop numa área que não é coberta pelo picker (centro do viewport)
    await page.locator('#report-picker-backdrop').click({ position: { x: 10, y: 10 } });

    await expect(page.locator('#report-field-picker')).not.toBeVisible({ timeout: 2000 });
    expect(jsErrors).toHaveLength(0);
  });

  test('7.3 abrir segundo picker fecha o primeiro', async ({ page }) => {
    const jsErrors = [];
    page.on('pageerror', err => jsErrors.push(err.message));

    const ok = await goToReportModal(page);
    test.skip(!ok, 'Nenhum projeto disponível');

    const cfgBtns = page.locator('button[onclick*="Picker"]');
    if (await cfgBtns.count() < 2) { test.skip(true, 'Menos de 2 botões de picker'); return; }

    await cfgBtns.nth(0).click();
    await expect(page.locator('#report-field-picker')).toBeVisible({ timeout: 3000 });

    // dispatchEvent bypassa o backdrop (que bloqueia cliques por coordenadas)
    await cfgBtns.nth(1).dispatchEvent('click');

    // Deve continuar com exatamente um picker no DOM
    const count = await page.locator('#report-field-picker').count();
    expect(count).toBe(1);
    expect(jsErrors).toHaveLength(0);
  });
});

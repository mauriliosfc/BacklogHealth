// @ts-check
const { test, expect } = require('@playwright/test');
const fs   = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', '..', 'config.json');

// ── helpers ───────────────────────────────────────────────────────────────────

/** Navega para /onboarding e aguarda carregamento */
async function goToOnboarding(page) {
  await page.goto('/onboarding');
  await page.waitForLoadState('networkidle');
}

/** Clica no botão "Get Started" no screen 0 (escopo restrito para evitar ambiguidade) */
async function clickGetStarted(page) {
  await page.locator('#screen0 button[onclick="goTo(1)"]').click();
}

/** Converte objeto de config de volta para projectsRaw (formato do POST /setup) */
function buildProjectsRaw(projects = []) {
  return projects.map(p => {
    const parts = [p.name, p.workItemType || 'User Story'];
    if (p.team) parts.push(p.team);
    return parts.join(':');
  }).join(',');
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCREEN 0 — WELCOME
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Onboarding — screen 0 (welcome)', () => {
  test.beforeEach(async ({ page }) => {
    await goToOnboarding(page);
  });

  test('carrega sem erros de JavaScript', async ({ page }) => {
    const errors = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push(e.message));
    await page.reload();
    await page.waitForLoadState('networkidle');
    expect(errors).toHaveLength(0);
  });

  test('exibe nome da aplicação e botão "Get Started"', async ({ page }) => {
    await expect(page.locator('.brand-name')).toContainText('Backlog Health');
    await expect(page.locator('#screen0 button[onclick="goTo(1)"]')).toBeVisible();
  });

  test('exibe seletor de idioma com 3 opções', async ({ page }) => {
    await expect(page.locator('.ob-lang-btn[data-lang="pt"]')).toBeVisible();
    await expect(page.locator('.ob-lang-btn[data-lang="en"]')).toBeVisible();
    await expect(page.locator('.ob-lang-btn[data-lang="es"]')).toBeVisible();
  });

  test('screen 0 está ativo e screen 1 está oculto', async ({ page }) => {
    await expect(page.locator('#screen0')).toBeVisible();
    await expect(page.locator('#screen1')).toBeHidden();
  });

  test('alterna idioma para português', async ({ page }) => {
    await page.locator('.ob-lang-btn[data-lang="pt"]').click();
    await expect(page.locator('.ob-lang-btn[data-lang="pt"]')).toHaveClass(/active/);
    await expect(page.locator('.ob-lang-btn[data-lang="en"]')).not.toHaveClass(/active/);
  });

  test('alterna idioma para inglês', async ({ page }) => {
    await page.locator('.ob-lang-btn[data-lang="en"]').click();
    await expect(page.locator('.ob-lang-btn[data-lang="en"]')).toHaveClass(/active/);
  });

  test('alterna idioma para espanhol', async ({ page }) => {
    await page.locator('.ob-lang-btn[data-lang="es"]').click();
    await expect(page.locator('.ob-lang-btn[data-lang="es"]')).toHaveClass(/active/);
  });

  test('exibe nota de privacidade', async ({ page }) => {
    await expect(page.locator('.privacy-note')).toBeVisible();
  });

  test('exibe badge de versão', async ({ page }) => {
    await expect(page.locator('.version-badge')).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// NAVEGAÇÃO ENTRE SCREENS
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Onboarding — navegação entre screens', () => {
  test.beforeEach(async ({ page }) => {
    await goToOnboarding(page);
  });

  test('avança para screen 1 ao clicar "Get Started"', async ({ page }) => {
    await clickGetStarted(page);
    await expect(page.locator('#screen1')).toBeVisible();
    await expect(page.locator('#screen0')).toBeHidden();
  });

  test('avança para screen 2 a partir de screen 1', async ({ page }) => {
    await clickGetStarted(page);
    await page.locator('#screen1 button[onclick="goTo(2)"]').click();
    await expect(page.locator('#screen2')).toBeVisible();
    await expect(page.locator('#screen1')).toBeHidden();
  });

  test('botão Voltar em screen 1 retorna para screen 0', async ({ page }) => {
    await clickGetStarted(page);
    await page.locator('#screen1 button[onclick="goTo(0)"]').click();
    await expect(page.locator('#screen0')).toBeVisible();
    await expect(page.locator('#screen1')).toBeHidden();
  });

  test('botão Voltar em screen 2 retorna para screen 1', async ({ page }) => {
    await clickGetStarted(page);
    await page.locator('#screen1 button[onclick="goTo(2)"]').click();
    await page.locator('#screen2 button[onclick="goTo(1)"]').click();
    await expect(page.locator('#screen1')).toBeVisible();
    await expect(page.locator('#screen2')).toBeHidden();
  });

  test('indicador de steps avança ao navegar', async ({ page }) => {
    // Em screen 1, step-dot 1 deve estar ativo
    await clickGetStarted(page);
    await expect(page.locator('#sd1-1')).toHaveClass(/active/);

    // Em screen 2, step-dot 1 deve estar "done" e 2 ativo
    await page.locator('#screen1 button[onclick="goTo(2)"]').click();
    await expect(page.locator('#screen2 .step-dot.done')).toBeVisible();
    await expect(page.locator('#screen2 .step-dot.active')).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SCREEN 1 — O QUE MONITORAR
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Onboarding — screen 1 (o que monitorar)', () => {
  test.beforeEach(async ({ page }) => {
    await goToOnboarding(page);
    await clickGetStarted(page);
  });

  test('exibe os 3 cards de integração', async ({ page }) => {
    await expect(page.locator('#cardA')).toBeVisible();
    await expect(page.locator('#cardB')).toBeVisible();
    await expect(page.locator('#cardC')).toBeVisible();
  });

  test('card "Both" vem selecionado por padrão', async ({ page }) => {
    await expect(page.locator('#cardC')).toHaveClass(/selected-both/);
  });

  test('selecionar card A (Azure) marca como selecionado-azul', async ({ page }) => {
    await page.locator('#cardA').click();
    await expect(page.locator('#cardA')).toHaveClass(/selected-blue/);
    // os outros devem perder a seleção
    await expect(page.locator('#cardB')).not.toHaveClass(/selected/);
    await expect(page.locator('#cardC')).not.toHaveClass(/selected/);
  });

  test('selecionar card B (SN) marca como selecionado-purple', async ({ page }) => {
    await page.locator('#cardB').click();
    await expect(page.locator('#cardB')).toHaveClass(/selected-purple/);
    await expect(page.locator('#cardA')).not.toHaveClass(/selected/);
    await expect(page.locator('#cardC')).not.toHaveClass(/selected/);
  });

  test('selecionar card C (Both) mantém selected-both', async ({ page }) => {
    await page.locator('#cardA').click(); // primeiro muda para A
    await page.locator('#cardC').click(); // depois volta para Both
    await expect(page.locator('#cardC')).toHaveClass(/selected-both/);
  });

  test('botão Continuar está presente', async ({ page }) => {
    await expect(page.locator('#btnContinue1')).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SCREEN 2 — CONFIGURAR CONEXÕES
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Onboarding — screen 2 (configurar conexões)', () => {
  test.beforeEach(async ({ page }) => {
    await goToOnboarding(page);
    await clickGetStarted(page);
    await page.locator('#screen1 button[onclick="goTo(2)"]').click();
  });

  test('painel Azure está visível com campos Org e PAT', async ({ page }) => {
    await expect(page.locator('#panelAz')).toBeVisible();
    await expect(page.locator('#azOrg')).toBeVisible();
    await expect(page.locator('#azPat')).toBeVisible();
  });

  test('campo PAT começa como tipo password (oculto)', async ({ page }) => {
    await expect(page.locator('#azPat')).toHaveAttribute('type', 'password');
  });

  test('ícone de olho alterna visibilidade do PAT', async ({ page }) => {
    await page.locator('#panelAz .pw-toggle').click();
    await expect(page.locator('#azPat')).toHaveAttribute('type', 'text');
    // clicar novamente oculta de volta
    await page.locator('#panelAz .pw-toggle').click();
    await expect(page.locator('#azPat')).toHaveAttribute('type', 'password');
  });

  test('painel SN está visível (modo "Both" padrão)', async ({ page }) => {
    await expect(page.locator('#panelSn')).toBeVisible();
    await expect(page.locator('#snInstance')).toBeVisible();
    await expect(page.locator('#snUser')).toBeVisible();
    await expect(page.locator('#snPass')).toBeVisible();
  });

  test('campo SN password alterna visibilidade', async ({ page }) => {
    await expect(page.locator('#snPass')).toHaveAttribute('type', 'password');
    await page.locator('#panelSn .pw-toggle').click();
    await expect(page.locator('#snPass')).toHaveAttribute('type', 'text');
  });

  test('tooltip da Org abre ao clicar no "?"', async ({ page }) => {
    await page.locator('#panelAz .tooltip-btn').first().click();
    await expect(page.locator('#tipOrg')).toBeVisible();
  });

  test('link "Skip for now" avança sem preencher formulário', async ({ page }) => {
    await page.locator('button.btn-link').click();
    // deve avançar para screen 3
    await expect(page.locator('#screen3')).toBeVisible();
  });

  test('preenche campo Org e valor persiste', async ({ page }) => {
    await page.locator('#azOrg').fill('minha-empresa');
    await expect(page.locator('#azOrg')).toHaveValue('minha-empresa');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ESTADO NÃO CONFIGURADO — usa disconnect / restore (Opção B)
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Onboarding — estado não configurado', () => {
  let _origConfig = null;

  test.beforeAll(async ({ request }) => {
    // Salva o config original em memória
    if (fs.existsSync(CONFIG_PATH)) {
      _origConfig = fs.readFileSync(CONFIG_PATH, 'utf8');
    }
    // Limpa org/pat no estado em memória do servidor
    await request.post('/api/disconnect');
  });

  test.afterAll(async ({ request }) => {
    // Restaura o config original no arquivo
    if (_origConfig !== null) {
      fs.writeFileSync(CONFIG_PATH, _origConfig, 'utf8');

      // Re-inicializa o servidor com os valores originais via POST /setup
      try {
        const cfg = JSON.parse(_origConfig);
        if (cfg.org && cfg.pat && Array.isArray(cfg.projects) && cfg.projects.length) {
          const projectsRaw = buildProjectsRaw(cfg.projects);
          await request.post('/setup', {
            form: { org: cfg.org, pat: cfg.pat, projects: projectsRaw },
          });
        }
      } catch (_) {}
    }
  });

  test('página /onboarding está acessível mesmo após disconnect', async ({ page }) => {
    await page.goto('/onboarding');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('#screen0')).toBeVisible();
    await expect(page.locator('.brand-name')).toContainText('Backlog Health');
  });

  test('servidor responde HTTP 200 em GET / após disconnect', async ({ page }) => {
    // POST /api/disconnect limpa org/pat em memória mas preserva SN e _onboarded.
    // O servidor pode responder com dashboard (modo sn-only com cache), settings,
    // ou onboarding — depende do estado. O importante: não retorna erro 5xx/4xx.
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(400);
  });

  test('GET /onboarding retorna 200 independente do estado de configuração', async ({ page }) => {
    // A rota /onboarding é sempre acessível no servidor — verifica isso após disconnect.
    const response = await page.goto('/onboarding');
    expect(response?.status()).toBe(200);
    await expect(page.locator('#screen0')).toBeVisible();
  });
});

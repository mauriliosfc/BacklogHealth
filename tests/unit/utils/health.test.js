const { calcHealth } = require('../../../utils/health');

describe('calcHealth', () => {

  // ── Status verde ────────────────────────────────────────────────────────────

  describe('Saudável', () => {
    test('backlog perfeito (zeros)', () => {
      const [status, color] = calcHealth(10, 0, 0, 0);
      expect(status).toBe('🟢 Saudável');
      expect(color).toBe('green');
    });

    test('total=0 não quebra (sem divisão por zero)', () => {
      const [status, color] = calcHealth(0, 0, 0, 0);
      expect(status).toBe('🟢 Saudável');
      expect(color).toBe('green');
    });

    test('exatamente nos limites sem disparar alerta — semEst=30%, semResp=20%, bugs=5', () => {
      // 3/10 = 30% semEst  → alerta é > 30%, então 30% não dispara
      // 2/10 = 20% semResp → alerta é > 20%, então 20% não dispara
      // bugs = 5            → alerta é > 5,  então 5 não dispara
      const [status] = calcHealth(10, 3, 2, 5);
      expect(status).toBe('🟢 Saudável');
    });
  });

  // ── Status amarelo ──────────────────────────────────────────────────────────

  describe('Atenção', () => {
    test('bugs > 5', () => {
      const [status, color] = calcHealth(10, 0, 0, 6);
      expect(status).toBe('🟡 Atenção');
      expect(color).toBe('yellow');
    });

    test('semEst entre 30% e 50% (31%)', () => {
      // 4/10 = 40% → alerta
      const [status] = calcHealth(10, 4, 0, 0);
      expect(status).toBe('🟡 Atenção');
    });

    test('semResp > 20% (30%)', () => {
      // 3/10 = 30% → alerta
      const [status] = calcHealth(10, 0, 3, 0);
      expect(status).toBe('🟡 Atenção');
    });

    test('combinação: semEst=31% + semResp=21% (dois alertas, nenhum crítico)', () => {
      const [status] = calcHealth(100, 31, 21, 0);
      expect(status).toBe('🟡 Atenção');
    });
  });

  // ── Status vermelho ─────────────────────────────────────────────────────────

  describe('Crítico', () => {
    test('bugs > 10', () => {
      const [status, color] = calcHealth(10, 0, 0, 11);
      expect(status).toBe('🔴 Crítico');
      expect(color).toBe('red');
    });

    test('semEst > 50% (6/10 = 60%)', () => {
      const [status] = calcHealth(10, 6, 0, 0);
      expect(status).toBe('🔴 Crítico');
    });

    test('semEst=51% prevalece sobre semResp=21% — resultado crítico', () => {
      const [status] = calcHealth(100, 51, 21, 0);
      expect(status).toBe('🔴 Crítico');
    });
  });

  // ── Tooltip ─────────────────────────────────────────────────────────────────

  describe('tooltip', () => {
    test('backlog saudável retorna mensagem padrão', () => {
      const [,, tooltip] = calcHealth(10, 0, 0, 0);
      expect(tooltip).toBe('Backlog bem estruturado');
    });

    test('bugs críticos incluídos no tooltip', () => {
      const [,, tooltip] = calcHealth(10, 0, 0, 11);
      expect(tooltip).toContain('bugs abertos (crítico');
    });

    test('bugs em alerta incluídos no tooltip', () => {
      const [,, tooltip] = calcHealth(10, 0, 0, 6);
      expect(tooltip).toContain('bugs abertos (alerta');
    });

    test('semEst crítico incluído no tooltip', () => {
      const [,, tooltip] = calcHealth(10, 6, 0, 0);
      expect(tooltip).toContain('sem estimativa (crítico');
    });

    test('semEst em alerta incluído no tooltip', () => {
      const [,, tooltip] = calcHealth(10, 4, 0, 0);
      expect(tooltip).toContain('sem estimativa (alerta');
    });

    test('semResp em alerta incluído no tooltip', () => {
      const [,, tooltip] = calcHealth(10, 0, 3, 0);
      expect(tooltip).toContain('sem responsável (alerta');
    });

    test('múltiplos problemas separados por " · "', () => {
      // bugs=6 + semEst=4/10=40% + semResp=3/10=30%
      const [,, tooltip] = calcHealth(10, 4, 3, 6);
      expect(tooltip.split(' · ').length).toBeGreaterThanOrEqual(2);
    });
  });

  // ── Percentuais no tooltip ──────────────────────────────────────────────────

  describe('percentuais calculados corretamente', () => {
    test('exibe 40% quando semEst=4/10', () => {
      const [,, tooltip] = calcHealth(10, 4, 0, 0);
      expect(tooltip).toContain('40%');
    });

    test('exibe 30% quando semResp=3/10', () => {
      const [,, tooltip] = calcHealth(10, 0, 3, 0);
      expect(tooltip).toContain('30%');
    });
  });
});

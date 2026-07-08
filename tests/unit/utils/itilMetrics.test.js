const {
  calcMttrByPriority,
  calcReopenRate,
  calcIncidentAgingBuckets,
  calcPrbKpis,
  calcPrbAgingBuckets,
  calcPrbByCategory,
  getIndicatorCatalog,
  resolveIndicatorCards,
} = require('../../../utils/itilMetrics');

// ── calcMttrByPriority ────────────────────────────────────────────────────────

describe('calcMttrByPriority', () => {
  const makeInc = (priority, openedAt, resolvedAt) => ({ priority, opened_at: openedAt, resolved_at: resolvedAt });

  test('retorna nulls quando lista vazia', () => {
    const r = calcMttrByPriority([]);
    expect(r.all).toBeNull();
    expect(r.p1).toBeNull();
    expect(r.p2).toBeNull();
    expect(r.p3).toBeNull();
  });

  test('calcula MTTR em horas corretamente', () => {
    const items = [
      makeInc('1', '2026-06-01T08:00:00Z', '2026-06-01T10:00:00Z'), // 2h
      makeInc('1', '2026-06-02T08:00:00Z', '2026-06-02T09:00:00Z'), // 1h
    ];
    const r = calcMttrByPriority(items);
    expect(r.p1).toBe(1.5);
    expect(r.countP1).toBe(2);
  });

  test('separa corretamente por prioridade', () => {
    const items = [
      makeInc('1', '2026-06-01T00:00:00Z', '2026-06-01T02:00:00Z'), // 2h P1
      makeInc('2', '2026-06-01T00:00:00Z', '2026-06-01T08:00:00Z'), // 8h P2
      makeInc('3', '2026-06-01T00:00:00Z', '2026-06-02T00:00:00Z'), // 24h P3
    ];
    const r = calcMttrByPriority(items);
    expect(r.p1).toBe(2);
    expect(r.p2).toBe(8);
    expect(r.p3).toBe(24);
    expect(r.all).toBe(Math.round((2 + 8 + 24) / 3 * 10) / 10);
  });

  test('ignora item com closed_at mas sem resolved_at', () => {
    const items = [{ priority: '2', opened_at: '2026-06-01T00:00:00Z', closed_at: '2026-06-01T04:00:00Z' }];
    const r = calcMttrByPriority(items);
    expect(r.p2).toBeNull();
  });

  test('ignora itens sem datas válidas', () => {
    const items = [
      makeInc('1', null, '2026-06-01T02:00:00Z'),
      makeInc('1', '2026-06-01T00:00:00Z', null),
      makeInc('1', '2026-06-01T00:00:00Z', '2026-06-01T01:00:00Z'), // válido
    ];
    const r = calcMttrByPriority(items);
    expect(r.p1).toBe(1);
    expect(r.countP1).toBe(1);
  });

  test('retorna null para prioridade sem dados', () => {
    const items = [makeInc('2', '2026-06-01T00:00:00Z', '2026-06-01T08:00:00Z')];
    const r = calcMttrByPriority(items);
    expect(r.p1).toBeNull();
    expect(r.p3).toBeNull();
    expect(r.p2).toBe(8);
  });

  test('lista nula não lança exceção', () => {
    expect(() => calcMttrByPriority(null)).not.toThrow();
  });
});

// ── calcReopenRate ────────────────────────────────────────────────────────────

describe('calcReopenRate', () => {
  test('retorna null quando sem incidentes fechados', () => {
    expect(calcReopenRate(3, 0)).toBeNull();
    expect(calcReopenRate(0, 0)).toBeNull();
  });

  test('calcula percentual com uma casa decimal', () => {
    expect(calcReopenRate(1, 20)).toBe(5);
    expect(calcReopenRate(3, 40)).toBe(7.5);
  });

  test('retorna 0 quando sem reaberturas', () => {
    expect(calcReopenRate(0, 50)).toBe(0);
  });

  test('pode ultrapassar 100% (reabertura múltipla)', () => {
    expect(calcReopenRate(60, 50)).toBe(120);
  });
});

// ── calcIncidentAgingBuckets ──────────────────────────────────────────────────

describe('calcIncidentAgingBuckets', () => {
  const nowIso   = new Date().toISOString();
  const ago = h  => new Date(Date.now() - h * 3600000).toISOString();

  test('retorna total zero quando lista vazia', () => {
    const r = calcIncidentAgingBuckets([], [4, 24, 72]);
    expect(r.total).toBe(0);
    expect(r.buckets).toHaveLength(4);
    r.buckets.forEach(b => expect(b.count).toBe(0));
  });

  test('distribui corretamente nos buckets padrão [4h, 24h, 72h]', () => {
    const items = [
      { opened_at: ago(2)   },  // < 4h
      { opened_at: ago(10)  },  // 4–24h
      { opened_at: ago(48)  },  // 24–72h
      { opened_at: ago(100) },  // > 72h
    ];
    const r = calcIncidentAgingBuckets(items);
    expect(r.buckets[0].count).toBe(1);
    expect(r.buckets[1].count).toBe(1);
    expect(r.buckets[2].count).toBe(1);
    expect(r.buckets[3].count).toBe(1);
    expect(r.total).toBe(4);
  });

  test('percentuais somam 100 quando total > 0', () => {
    const items = [{ opened_at: ago(1) }, { opened_at: ago(5) }, { opened_at: ago(30) }, { opened_at: ago(80) }];
    const r     = calcIncidentAgingBuckets(items);
    const sum   = r.buckets.reduce((s, b) => s + b.pct, 0);
    expect(sum).toBe(100);
  });

  test('ignora itens sem opened_at', () => {
    const items = [{ opened_at: null }, { opened_at: ago(1) }];
    const r     = calcIncidentAgingBuckets(items);
    expect(r.total).toBe(1);
  });

  test('usa thresholds customizados', () => {
    const items = [{ opened_at: ago(6) }, { opened_at: ago(20) }];
    const r     = calcIncidentAgingBuckets(items, [8, 16, 48]);
    expect(r.buckets[0].label).toBe('< 8h');
    expect(r.buckets[0].count).toBe(1); // 6h < 8h
    expect(r.buckets[1].count).toBe(0); // 20h não está entre 8–16h
  });
});

// ── calcPrbAgingBuckets ───────────────────────────────────────────────────────

describe('calcPrbAgingBuckets', () => {
  test('distribui por dias corretamente com thresholds padrão [15, 30, 60]', () => {
    const list = [
      { agingDays: 10 }, // < 15
      { agingDays: 20 }, // 15–30
      { agingDays: 45 }, // 30–60
      { agingDays: 90 }, // > 60
    ];
    const r = calcPrbAgingBuckets(list);
    expect(r.buckets[0].count).toBe(1);
    expect(r.buckets[1].count).toBe(1);
    expect(r.buckets[2].count).toBe(1);
    expect(r.buckets[3].count).toBe(1);
    expect(r.total).toBe(4);
  });

  test('retorna total zero para lista vazia', () => {
    const r = calcPrbAgingBuckets([]);
    expect(r.total).toBe(0);
    r.buckets.forEach(b => { expect(b.count).toBe(0); expect(b.pct).toBe(0); });
  });

  test('usa thresholds customizados', () => {
    const list = [{ agingDays: 5 }, { agingDays: 25 }];
    const r    = calcPrbAgingBuckets(list, [10, 20, 40]);
    expect(r.buckets[0].label).toBe('< 10d');
    expect(r.buckets[0].count).toBe(1);
    expect(r.buckets[2].count).toBe(1);
  });
});

// ── calcPrbKpis ───────────────────────────────────────────────────────────────

describe('calcPrbKpis', () => {
  const makeP = (overrides) => ({
    agingDays: 10,
    known_error: false,
    workaround_instructions: '',
    rca_complete: false,
    category: 'Software',
    ...overrides,
  });

  test('retorna zeros quando lista vazia', () => {
    const r = calcPrbKpis([]);
    expect(r.total).toBe(0);
    expect(r.knownErrorPct).toBeNull();
  });

  test('conta known_error = true corretamente', () => {
    const list = [makeP({ known_error: true }), makeP(), makeP({ known_error: 'true' })];
    const r    = calcPrbKpis(list);
    expect(r.knownErrorCount).toBe(2);
    expect(r.knownErrorPct).toBe(67);
  });

  test('conta workaround_instructions não vazio', () => {
    const list = [makeP({ workaround_instructions: 'Reiniciar serviço' }), makeP(), makeP({ workaround_instructions: '  ' })];
    const r    = calcPrbKpis(list);
    expect(r.withWorkaroundCount).toBe(1);
    expect(r.withWorkaroundPct).toBe(33);
  });

  test('conta rca_complete corretamente', () => {
    const list = [makeP({ rca_complete: true }), makeP({ rca_complete: 'true' }), makeP()];
    const r    = calcPrbKpis(list);
    expect(r.withRcaCount).toBe(2);
    expect(r.withRcaPct).toBe(67);
  });

  test('inclui agingBuckets no resultado', () => {
    const list = [makeP({ agingDays: 5 }), makeP({ agingDays: 20 })];
    const r    = calcPrbKpis(list);
    expect(r.agingBuckets).not.toBeNull();
    expect(r.agingBuckets.total).toBe(2);
  });

  test('lista nula não lança exceção', () => {
    expect(() => calcPrbKpis(null)).not.toThrow();
  });
});

// ── calcPrbByCategory ─────────────────────────────────────────────────────────

describe('calcPrbByCategory', () => {
  test('retorna lista vazia quando sem PRBs', () => {
    expect(calcPrbByCategory([])).toEqual([]);
  });

  test('agrupa por categoria e ordena por contagem desc', () => {
    const list = [
      { category: 'Infra' },
      { category: 'Software' },
      { category: 'Infra' },
      { category: 'Infra' },
      { category: 'Software' },
    ];
    const r = calcPrbByCategory(list);
    expect(r[0].category).toBe('Infra');
    expect(r[0].count).toBe(3);
    expect(r[1].category).toBe('Software');
    expect(r[1].count).toBe(2);
  });

  test('usa N/A para categoria ausente ou vazia', () => {
    const list = [{ category: '' }, { category: null }, { category: 'Rede' }];
    const r    = calcPrbByCategory(list);
    const naEntry = r.find(e => e.category === 'N/A');
    expect(naEntry?.count).toBe(2);
  });

  test('calcula percentual corretamente', () => {
    const list = [{ category: 'A' }, { category: 'A' }, { category: 'B' }];
    const r    = calcPrbByCategory(list);
    expect(r.find(e => e.category === 'A').pct).toBe(67);
    expect(r.find(e => e.category === 'B').pct).toBe(33);
  });
});

// ── getIndicatorCatalog ───────────────────────────────────────────────────────

describe('getIndicatorCatalog', () => {
  test('retorna array não vazio', () => {
    const catalog = getIndicatorCatalog();
    expect(catalog.length).toBeGreaterThan(0);
  });

  test('cada item tem as propriedades obrigatórias', () => {
    getIndicatorCatalog().forEach(item => {
      expect(item).toHaveProperty('id');
      expect(item).toHaveProperty('section');
      expect(item).toHaveProperty('label');
      expect(item).toHaveProperty('description');
      expect(item).toHaveProperty('defaultVisible');
    });
  });

  test('IDs são únicos', () => {
    const ids = getIndicatorCatalog().map(i => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('sections são somente incidents ou prbs', () => {
    getIndicatorCatalog().forEach(item => {
      expect(['incidents', 'prbs']).toContain(item.section);
    });
  });
});

// ── resolveIndicatorCards ─────────────────────────────────────────────────────

describe('resolveIndicatorCards', () => {
  test('retorna apenas cards da seção solicitada', () => {
    const r = resolveIndicatorCards('incidents', null);
    r.forEach(c => expect(c.section).toBe('incidents'));
  });

  test('aplica defaultVisible quando sem configuração salva', () => {
    const r = resolveIndicatorCards('prbs', null);
    r.forEach(c => {
      expect(typeof c.visible).toBe('boolean');
    });
  });

  test('aplica preferências salvas — visible e order', () => {
    const saved = [{ id: 'inc_total', visible: false, order: 99 }];
    const r     = resolveIndicatorCards('incidents', saved);
    const card  = r.find(c => c.id === 'inc_total');
    expect(card.visible).toBe(false);
    expect(card.order).toBe(99);
  });

  test('mantém cards do catálogo não presentes no savedCards com defaults', () => {
    const saved = [{ id: 'inc_p1', visible: false, order: 0 }];
    const r     = resolveIndicatorCards('incidents', saved);
    const total = r.find(c => c.id === 'inc_total');
    expect(total).toBeDefined();
    expect(total.visible).toBe(true); // default
  });

  test('resultado está ordenado por order asc', () => {
    const saved = [
      { id: 'inc_closed',  visible: true, order: 0 },
      { id: 'inc_total',   visible: true, order: 1 },
    ];
    const r = resolveIndicatorCards('incidents', saved);
    expect(r[0].id).toBe('inc_closed');
    expect(r[1].id).toBe('inc_total');
  });

  test('lista nula de savedCards não lança exceção', () => {
    expect(() => resolveIndicatorCards('prbs', null)).not.toThrow();
  });
});

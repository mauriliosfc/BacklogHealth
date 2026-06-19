// Pure ITIL metric calculations — no I/O, fully testable.
// All functions accept raw SN payloads and return plain objects.

// ── Helpers ───────────────────────────────────────────────────────────────────

function _diffDays(a, b) {
  if (!a || !b) return null;
  const ms = new Date(b) - new Date(a);
  return ms >= 0 ? ms / 86400000 : null;
}

function _diffHours(a, b) {
  if (!a || !b) return null;
  const ms = new Date(b) - new Date(a);
  return ms >= 0 ? ms / 3600000 : null;
}

function _avg(values) {
  const valid = values.filter(v => v !== null && v !== undefined && !isNaN(v));
  if (!valid.length) return null;
  return valid.reduce((s, v) => s + v, 0) / valid.length;
}

// ── Incident metrics ──────────────────────────────────────────────────────────

/**
 * Calculates MTTR broken down by priority from a list of closed incidents.
 * Each item must have: opened_at, resolved_at (or closed_at), priority (raw '1'/'2'/'3').
 * Returns hours (null when no data for that priority).
 */
function calcMttrByPriority(incClosedInPeriod) {
  const buckets = { p1: [], p2: [], p3: [], all: [] };

  (incClosedInPeriod || []).forEach(i => {
    const closedAt = i.resolved_at || i.closed_at;
    const hours    = _diffHours(i.opened_at, closedAt);
    if (hours === null) return;
    buckets.all.push(hours);
    const p = String(i.priority || '');
    if (p === '1') buckets.p1.push(hours);
    else if (p === '2') buckets.p2.push(hours);
    else if (p === '3') buckets.p3.push(hours);
  });

  const round1 = v => v === null ? null : Math.round(v * 10) / 10;
  return {
    p1:  round1(_avg(buckets.p1)),
    p2:  round1(_avg(buckets.p2)),
    p3:  round1(_avg(buckets.p3)),
    all: round1(_avg(buckets.all)),
    countP1: buckets.p1.length,
    countP2: buckets.p2.length,
    countP3: buckets.p3.length,
  };
}

/**
 * Calculates reopen rate: reopened / total closed in period.
 * reopenedCount: number of incidents with state reopened in the period.
 * closedCount: total closed in the period.
 * Returns percentage (0–100) or null when no closed incidents.
 */
function calcReopenRate(reopenedCount, closedCount) {
  if (!closedCount) return null;
  return Math.round((reopenedCount / closedCount) * 1000) / 10; // 1 decimal
}

/**
 * Calculates backlog aging distribution.
 * items: array of open incidents with opened_at.
 * thresholds: [h1, h2, h3] in hours — default [4, 24, 72].
 * Returns { buckets: [{label, count, pct}], total }.
 */
function calcIncidentAgingBuckets(items, thresholds) {
  const [t1, t2, t3] = (thresholds && thresholds.length === 3) ? thresholds : [4, 24, 72];
  const now    = Date.now();
  const labels = [`< ${t1}h`, `${t1}–${t2}h`, `${t2}–${t3}h`, `> ${t3}h`];
  const counts = [0, 0, 0, 0];

  (items || []).forEach(i => {
    if (!i.opened_at) return;
    const hours = (now - new Date(i.opened_at)) / 3600000;
    if      (hours < t1) counts[0]++;
    else if (hours < t2) counts[1]++;
    else if (hours < t3) counts[2]++;
    else                  counts[3]++;
  });

  const total = counts.reduce((s, v) => s + v, 0);
  return {
    total,
    buckets: labels.map((label, i) => ({
      label,
      count: counts[i],
      pct:   total > 0 ? Math.round((counts[i] / total) * 100) : 0,
    })),
  };
}

// ── PRB metrics ───────────────────────────────────────────────────────────────

/**
 * Calculates PRB KPIs from the full open PRB list.
 * Each item may have: known_error (bool/'true'), workaround_instructions (string),
 * rca_complete (bool/'true'), category, agingDays.
 * Returns counts and percentages.
 */
function calcPrbKpis(prbList) {
  const list   = prbList || [];
  const total  = list.length;
  if (!total) {
    return { total: 0, knownErrorCount: 0, knownErrorPct: null, withWorkaroundCount: 0, withWorkaroundPct: null, withRcaCount: 0, withRcaPct: null, agingBuckets: null };
  }

  let knownErrorCount    = 0;
  let withWorkaroundCount = 0;
  let withRcaCount        = 0;

  list.forEach(p => {
    if (p.known_error === true || p.known_error === 'true') knownErrorCount++;
    if (p.workaround_instructions && String(p.workaround_instructions).trim()) withWorkaroundCount++;
    if (p.rca_complete === true || p.rca_complete === 'true') withRcaCount++;
  });

  const pct = (n) => total > 0 ? Math.round((n / total) * 100) : null;

  return {
    total,
    knownErrorCount,
    knownErrorPct:      pct(knownErrorCount),
    withWorkaroundCount,
    withWorkaroundPct:  pct(withWorkaroundCount),
    withRcaCount,
    withRcaPct:         pct(withRcaCount),
    agingBuckets:       calcPrbAgingBuckets(list),
  };
}

/**
 * Calculates PRB aging distribution.
 * thresholds in days — default [15, 30, 60].
 * Returns { buckets: [{label, count, pct}], total }.
 */
function calcPrbAgingBuckets(list, thresholds) {
  const [t1, t2, t3] = (thresholds && thresholds.length === 3) ? thresholds : [15, 30, 60];
  const labels = [`< ${t1}d`, `${t1}–${t2}d`, `${t2}–${t3}d`, `> ${t3}d`];
  const counts = [0, 0, 0, 0];

  (list || []).forEach(p => {
    const days = p.agingDays ?? 0;
    if      (days < t1) counts[0]++;
    else if (days < t2) counts[1]++;
    else if (days < t3) counts[2]++;
    else                counts[3]++;
  });

  const total = counts.reduce((s, v) => s + v, 0);
  return {
    total,
    buckets: labels.map((label, i) => ({
      label,
      count: counts[i],
      pct:   total > 0 ? Math.round((counts[i] / total) * 100) : 0,
    })),
  };
}

/**
 * Calculates PRB category distribution from the open PRB list.
 * Returns array sorted by count desc: [{ category, count, pct }].
 */
function calcPrbByCategory(prbList) {
  const map = {};
  (prbList || []).forEach(p => {
    const cat = (p.category && String(p.category).trim()) || 'N/A';
    map[cat] = (map[cat] || 0) + 1;
  });
  const total = Object.values(map).reduce((s, v) => s + v, 0);
  return Object.entries(map)
    .map(([category, count]) => ({ category, count, pct: total > 0 ? Math.round((count / total) * 100) : 0 }))
    .sort((a, b) => b.count - a.count);
}

// ── Default indicator catalog ─────────────────────────────────────────────────

/**
 * Returns the default ordered list of indicator card definitions for each section.
 * Each entry: { id, section, label, description, defaultVisible }.
 */
function getIndicatorCatalog() {
  return [
    // Incidents — existing
    { id: 'inc_total',    section: 'incidents', label: 'Abertos no mês',         description: 'Total de incidentes abertos no período selecionado. Compara com o target mensal configurado.',            defaultVisible: true  },
    { id: 'inc_closed',   section: 'incidents', label: 'Encerrados no mês',       description: 'Incidentes resolvidos ou fechados dentro do período. Indica a capacidade de resolução da equipe.',        defaultVisible: true  },
    { id: 'inc_backlog',  section: 'incidents', label: 'Backlog aberto',           description: 'Total de incidentes em aberto no fim do período, independente de quando foram criados.',                  defaultVisible: true  },
    { id: 'inc_mttr',     section: 'incidents', label: 'Tempo médio resolução',    description: 'MTTR (Mean Time to Resolve): média de dias entre abertura e fechamento dos incidentes do período.',       defaultVisible: true  },
    { id: 'inc_p1',       section: 'incidents', label: 'P1 — Crítico',             description: 'Incidentes de prioridade máxima abertos no período. P1 indica impacto total no serviço.',                defaultVisible: true  },
    { id: 'inc_p2',       section: 'incidents', label: 'P2 — Alto',               description: 'Incidentes de alta prioridade. Impacto severo, exige resolução rápida conforme SLA.',                    defaultVisible: true  },
    { id: 'inc_p3',       section: 'incidents', label: 'P3 — Médio',              description: 'Incidentes de média prioridade. Impacto moderado, dentro do SLA estendido.',                             defaultVisible: true  },
    { id: 'inc_target',   section: 'incidents', label: 'vs Target',               description: 'Percentual do volume de incidentes em relação ao target mensal configurado. Acima de 100% = alerta.',     defaultVisible: true  },
    // Incidents — new ITIL
    { id: 'inc_mttr_p1',  section: 'incidents', label: 'MTTR P1 (horas)',          description: 'Tempo médio de resolução exclusivo para P1 em horas. Meta típica: < 2h. Calculado dos fechados no mês.', defaultVisible: false },
    { id: 'inc_mttr_p2',  section: 'incidents', label: 'MTTR P2 (horas)',          description: 'Tempo médio de resolução para P2 em horas. Meta típica: < 8h.',                                          defaultVisible: false },
    { id: 'inc_reopen',   section: 'incidents', label: 'Taxa de reabertura',        description: 'Percentual de incidentes que foram reabertos após fechamento. Meta: < 5%. Alta taxa indica resolução incompleta.', defaultVisible: false },
    // PRBs — existing
    { id: 'prb_opened',   section: 'prbs', label: 'Abertos no mês',               description: 'Problemas registrados no período. Crescimento contínuo indica que incidentes recorrentes não estão sendo tratados.', defaultVisible: true  },
    { id: 'prb_resolved', section: 'prbs', label: 'Resolvidos no mês',             description: 'Problemas com causa raiz identificada e solução permanente aplicada no período.',                        defaultVisible: true  },
    { id: 'prb_backlog',  section: 'prbs', label: 'Backlog acumulado',             description: 'Total de problemas em aberto. Backlog alto indica acúmulo de causas raiz não tratadas.',                 defaultVisible: true  },
    { id: 'prb_mttr',     section: 'prbs', label: 'Tempo médio resolução',         description: 'Média de dias entre abertura e resolução dos PRBs fechados no período. Meta típica: < 30 dias.',         defaultVisible: true  },
    // PRBs — new ITIL
    { id: 'prb_ke',       section: 'prbs', label: 'Known Errors',                  description: 'PRBs com causa conhecida mas sem solução permanente disponível. Permitem resolução mais rápida de novos incidentes via workaround.', defaultVisible: false },
    { id: 'prb_wa',       section: 'prbs', label: 'Com workaround (%)',            description: 'Percentual de PRBs abertos que possuem workaround documentado. Workarounds reduzem o MTTR de incidentes relacionados.', defaultVisible: false },
    { id: 'prb_rca',      section: 'prbs', label: 'RCA completo (%)',              description: 'Percentual de PRBs com Análise de Causa Raiz concluída. Sem RCA não é possível prevenir recorrência.',  defaultVisible: false },
  ];
}

/**
 * Merges saved user preferences with the catalog defaults.
 * savedCards: [{ id, visible, order }] from config.json (may be partial or null).
 * Returns full ordered list with user overrides applied.
 */
function resolveIndicatorCards(section, savedCards) {
  const catalog    = getIndicatorCatalog().filter(c => c.section === section);
  const savedMap   = {};
  (savedCards || []).forEach(c => { savedMap[c.id] = c; });

  return catalog
    .map((def, idx) => {
      const saved = savedMap[def.id];
      return {
        ...def,
        visible: saved ? saved.visible : def.defaultVisible,
        order:   saved?.order ?? idx,
      };
    })
    .sort((a, b) => a.order - b.order);
}

module.exports = {
  calcMttrByPriority,
  calcReopenRate,
  calcIncidentAgingBuckets,
  calcPrbKpis,
  calcPrbAgingBuckets,
  calcPrbByCategory,
  getIndicatorCatalog,
  resolveIndicatorCards,
};

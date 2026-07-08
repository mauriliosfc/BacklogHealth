// ── Monthly Review — estado compartilhado ────────────────────────────────────
// Objeto mutável único. Sub-módulos importam { S } e atribuem S.prop = valor.
// Não usar `export let` — bindings são read-only em módulos importadores.
export const S = {
  reportProject:      null,
  reportMonth:        null,
  reportCharts:       [],       // [{type, size, ref?, label?, chartStyle?, barColor?, months?}]
  agingState:         'In Review',
  agingCharts:        [{ size: 'md' }, { size: 'md' }],
  incidentMonths:     5,
  incidentTarget:     null,
  incidentGroupBy:    'cmdb_ci',
  heatmapMax:         0,
  heatmapTopN:        9,
  locationMonths:     6,
  agingBuckets:       [7, 14, 30, 60],
  prbMonths:          5,
  prbAgingBuckets:    [30, 60, 90, 180],
  deliveryStates:     ['Closed', 'Done', 'Resolved'],
  slaEnabled:         false,
  slaThresholds:      { p1: 4, p2: 8, p3: 72 },
  slaTargets:         { p1: 95, p2: 90, p3: 85 },
  pickerIdx:          -1,
  lastPayload:        null,
  activeSectionFilter: 'all',
  indicatorCards:     {},       // { incidents: [{id,visible,order}], prbs: [...] }
  indicatorCardsPerRow: {},     // { incidents: 4, prbs: 4 }
  indConfigSection:   null,     // 'incidents' | 'prbs' | null
  indDragSrcId:       null,
  indDragSrcSection:  null,
  incidentCharts:     [],       // [{type:'inc-volume'|'inc-bars'|..., size:'sm'|'md'|'lg'}]
  prbCharts:          [],       // [{type:'prb-evolution'|'prb-donut'|..., size:'sm'|'md'|'lg'}]
  incPickerIdx:       -1,
  prbPickerIdx:       -1,
  agingPickerIdx:     -1,
};

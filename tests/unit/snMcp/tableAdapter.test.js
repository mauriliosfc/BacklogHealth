const {
  PAGE_SIZE, parseSnPath, buildQuery, rowsOf, fillMissingFields, mergeDisplayValues,
  fetchAllRows, buildAggregateArgs, snMcpGet,
} = require('../../../snMcp/tableAdapter');

// ── Fake de sn_query que imita o comportamento do MCP real ───────────────────
// - máximo de 100 linhas por chamada
// - colunar a partir de 3 linhas
// - campos vazios omitidos
// - display_value=true troca valor bruto por rótulo (quando houver)
// - budget opcional corta a página antes do limite
function makeFakeMcp(records, { budget = Infinity, failWith = null } = {}) {
  const calls = [];
  const callTool = jest.fn(async (name, args) => {
    calls.push({ name, args });
    if (failWith) return failWith;
    if (name !== 'sn_query') return { success: true, result: { stats: { count: String(records.length) } } };
    const limit  = Math.min(args.limit ?? 20, 100);
    const offset = args.offset || 0;
    const fields = args.fields ? args.fields.split(',') : Object.keys(records[0] || {});
    const slice  = records.slice(offset, offset + Math.min(limit, budget)).map(rec => {
      const out = {};
      fields.forEach(f => {
        const cell = rec[f];
        const v = cell && typeof cell === 'object' ? (args.display_value ? cell.d : cell.v) : cell;
        if (v !== '' && v !== null && v !== undefined) out[f] = v;
      });
      return out;
    });
    const resp = { success: true, table: args.table, count: slice.length, total_count: args.include_count ? records.length : slice.length };
    if (slice.length >= 3) {
      const columns = [...new Set(slice.flatMap(r => Object.keys(r)))];
      resp.format  = 'columnar';
      resp.results = { columns, data: slice.map(r => columns.map(c => (c in r ? r[c] : null))) };
    } else {
      resp.results = slice;
    }
    return resp;
  });
  return { callTool, calls };
}

function makeIncidents(n) {
  return Array.from({ length: n }, (_, i) => ({
    sys_id:   `id${String(i).padStart(4, '0')}`,
    number:   `INC${i}`,
    priority: { v: String((i % 3) + 1), d: `${(i % 3) + 1} - Prioridade` },
    assignment_group: { v: `grp${i % 2}`, d: i % 2 ? 'Database' : 'Network' },
    short_description: i === 0 ? '' : `Incidente ${i}`,
  }));
}

// ── parseSnPath ───────────────────────────────────────────────────────────────

describe('parseSnPath', () => {
  test('decodifica query totalmente codificada (padrão do reportService)', () => {
    const q = 'assignment_group=abc^opened_at>=2026-01-01 00:00:00^NQactive=true';
    const p = parseSnPath(`table/incident?sysparm_query=${encodeURIComponent(q)}&sysparm_fields=sys_id,priority&sysparm_display_value=all&sysparm_limit=1000`);
    expect(p).toMatchObject({
      kind: 'table', table: 'incident', query: q,
      fields: ['sys_id', 'priority'], limit: 1000, offset: 0, displayValue: 'all',
    });
  });

  test('aceita query parcialmente codificada (padrão do sn-dashboard)', () => {
    const p = parseSnPath(`table/incident?sysparm_query=assignment_group.name=${encodeURIComponent('Network Ops')}^active=true^state!=6&sysparm_order_by=priority&sysparm_order_by_direction=asc&sysparm_limit=500`);
    expect(p.query).toBe('assignment_group.name=Network Ops^active=true^state!=6');
    expect(p.orderBy).toEqual({ field: 'priority', desc: false });
    expect(p.limit).toBe(500);
  });

  test('lê offset e usa limite padrão quando omitido', () => {
    const p = parseSnPath('table/sys_user_group?sysparm_fields=name,sys_id&sysparm_offset=2000');
    expect(p.offset).toBe(2000);
    expect(p.limit).toBe(10000);
    expect(p.displayValue).toBe('false');
  });

  test('reconhece rota de stats', () => {
    const p = parseSnPath('stats/incident?sysparm_query=active=true&sysparm_count=true&sysparm_group_by=priority');
    expect(p).toMatchObject({ kind: 'stats', table: 'incident', count: true, groupBy: 'priority' });
  });

  test('rejeita rotas não suportadas', () => {
    expect(() => parseSnPath('attachment/abc')).toThrow(/Unsupported/);
  });
});

// ── buildQuery ────────────────────────────────────────────────────────────────

describe('buildQuery', () => {
  test('adiciona sys_id como desempate de ordenação', () => {
    expect(buildQuery({ query: 'active=true', orderBy: null })).toBe('active=true^ORDERBYsys_id');
  });

  test('respeita ordenação pedida e direção desc', () => {
    expect(buildQuery({ query: 'a=1', orderBy: { field: 'priority', desc: true } }))
      .toBe('a=1^ORDERBYDESCpriority^ORDERBYsys_id');
  });

  test('não duplica sys_id quando já é o campo de ordenação', () => {
    expect(buildQuery({ query: '', orderBy: { field: 'sys_id', desc: false } })).toBe('ORDERBYsys_id');
  });

  test('remove ^ sobrando no fim da query', () => {
    expect(buildQuery({ query: 'a=1^', orderBy: null })).toBe('a=1^ORDERBYsys_id');
  });
});

// ── Normalização ──────────────────────────────────────────────────────────────

describe('rowsOf / fillMissingFields / mergeDisplayValues', () => {
  test('converte formato colunar em objetos', () => {
    const rows = rowsOf({ results: { columns: ['a', 'b'], data: [[1, null], [3, 4]] } });
    expect(rows).toEqual([{ a: 1, b: null }, { a: 3, b: 4 }]);
  });

  test('mantém lista de objetos como está', () => {
    expect(rowsOf({ results: [{ a: 1 }] })).toEqual([{ a: 1 }]);
    expect(rowsOf(null)).toEqual([]);
  });

  test('preenche campos omitidos com string vazia e converte valores para string', () => {
    expect(fillMissingFields([{ a: null, n: 5 }], ['a', 'b', 'n'])).toEqual([{ a: '', b: '', n: '5' }]);
  });

  test('mescla valor bruto e rótulo por sys_id', () => {
    const raw  = [{ sys_id: '1', priority: '1' }, { sys_id: '2', priority: '2' }];
    const disp = [{ sys_id: '2', priority: '2 - High' }, { sys_id: '1', priority: '1 - Critical' }];
    const out  = mergeDisplayValues(raw, disp, ['sys_id', 'priority']);
    expect(out[0].priority).toEqual({ value: '1', display_value: '1 - Critical' });
    expect(out[1].priority).toEqual({ value: '2', display_value: '2 - High' });
    expect(out[0].sys_id).toEqual({ value: '1', display_value: '1' });
  });
});

// ── fetchAllRows ──────────────────────────────────────────────────────────────

describe('fetchAllRows', () => {
  test('pagina de 100 em 100 até o limite pedido', async () => {
    const { callTool, calls } = makeFakeMcp(makeIncidents(350));
    const rows = await fetchAllRows(callTool, { table: 'incident', fields: 'sys_id' }, { limit: 1000 });
    expect(rows).toHaveLength(350);
    expect(calls).toHaveLength(4);
    expect(calls[0].args.include_count).toBe(true);
    expect(calls.map(c => c.args.offset).sort((a, b) => a - b)).toEqual([0, 100, 200, 300]);
    expect(new Set(rows.map(r => r.sys_id)).size).toBe(350);
  });

  test('respeita sysparm_limit como teto (mesmo corte silencioso da REST)', async () => {
    const { callTool } = makeFakeMcp(makeIncidents(500));
    const rows = await fetchAllRows(callTool, { table: 'incident', fields: 'sys_id' }, { limit: 200 });
    expect(rows).toHaveLength(200);
  });

  test('busca o restante quando o orçamento corta a página', async () => {
    const { callTool } = makeFakeMcp(makeIncidents(250), { budget: 40 });
    const rows = await fetchAllRows(callTool, { table: 'incident', fields: 'sys_id' }, { limit: 1000 });
    expect(rows).toHaveLength(250);
    expect(new Set(rows.map(r => r.sys_id)).size).toBe(250);
  });

  test('começa no offset informado', async () => {
    const { callTool } = makeFakeMcp(makeIncidents(150));
    const rows = await fetchAllRows(callTool, { table: 'incident', fields: 'sys_id' }, { offset: 100, limit: 2000 });
    expect(rows).toHaveLength(50);
    expect(rows[0].sys_id).toBe('id0100');
  });

  test('uma única chamada quando cabe numa página', async () => {
    const { callTool, calls } = makeFakeMcp(makeIncidents(2));
    const rows = await fetchAllRows(callTool, { table: 'incident', fields: 'sys_id' }, { limit: 1 });
    expect(rows).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });
});

// ── snMcpGet ──────────────────────────────────────────────────────────────────

describe('snMcpGet', () => {
  test('display_value=all devolve {value, display_value} como a REST', async () => {
    const { callTool, calls } = makeFakeMcp(makeIncidents(5));
    const { result } = await snMcpGet('table/incident?sysparm_fields=number,priority,assignment_group,short_description&sysparm_display_value=all&sysparm_limit=10', callTool);

    expect(result).toHaveLength(5);
    expect(result[1].priority).toEqual({ value: '2', display_value: '2 - Prioridade' });
    expect(result[1].assignment_group).toEqual({ value: 'grp1', display_value: 'Database' });
    // campo vazio vira {'' , ''} e sys_id auxiliar não vaza
    expect(result[0].short_description).toEqual({ value: '', display_value: '' });
    expect(result[0]).not.toHaveProperty('sys_id');
    // duas variantes: bruto e rótulo
    expect(calls.map(c => c.args.display_value).sort()).toEqual([false, true]);
    expect(calls[0].args.fields).toBe('number,priority,assignment_group,short_description,sys_id');
  });

  test('sem display_value devolve strings simples', async () => {
    const { callTool, calls } = makeFakeMcp(makeIncidents(3));
    const { result } = await snMcpGet('table/incident?sysparm_fields=sys_id,priority&sysparm_limit=1000', callTool);
    expect(result[0]).toEqual({ sys_id: 'id0000', priority: '1' });
    expect(calls[0].args.display_value).toBe(false);
    expect(calls[0].args.query).toBe('ORDERBYsys_id');
  });

  test('propaga erro do MCP e marca erro de sessão', async () => {
    const { callTool } = makeFakeMcp([], { failWith: { success: false, error: 'Browser session expired', error_type: 'auth_session_expired' } });
    await expect(snMcpGet('table/incident?sysparm_limit=1', callTool)).rejects.toMatchObject({ code: 'SN_AUTH' });
  });

  test('erro genérico do MCP vira Error com a mensagem', async () => {
    const { callTool } = makeFakeMcp([], { failWith: { success: false, message: 'unknown_query_fields' } });
    await expect(snMcpGet('table/incident?sysparm_limit=1', callTool)).rejects.toThrow(/unknown_query_fields/);
  });

  test('stats usa sn_aggregate e devolve o result bruto', async () => {
    const { callTool, calls } = makeFakeMcp(makeIncidents(7));
    const { result } = await snMcpGet('stats/incident?sysparm_query=active=true&sysparm_count=true', callTool);
    expect(calls[0]).toEqual({ name: 'sn_aggregate', args: { table: 'incident', aggregate: 'COUNT', query: 'active=true' } });
    expect(result).toEqual({ stats: { count: '7' } });
  });
});

describe('buildAggregateArgs', () => {
  test('converte sysparm_avg_fields em AVG', () => {
    expect(buildAggregateArgs(parseSnPath('stats/incident?sysparm_avg_fields=reassignment_count&sysparm_group_by=priority')))
      .toEqual({ table: 'incident', aggregate: 'AVG', field: 'reassignment_count', group_by: 'priority' });
  });

  test('rejeita mais de um campo agregado', () => {
    expect(() => buildAggregateArgs(parseSnPath('stats/incident?sysparm_sum_fields=a,b'))).toThrow(/single field/);
  });
});

test('PAGE_SIZE segue o limite do MCP', () => {
  expect(PAGE_SIZE).toBe(100);
});

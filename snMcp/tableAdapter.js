// Traduz um path da Table API do ServiceNow (o mesmo formato que snGet recebe no modo API)
// em chamadas às ferramentas MCP `sn_query` / `sn_aggregate` e devolve `{ result }` no mesmo
// formato da REST. Assim os callers (reportService, handlers/sn, handlers/sn-dashboard) não mudam.
//
// O que o adaptador compensa em relação à REST:
//   - sn_query devolve no máximo 100 linhas por chamada  → paginação por offset até sysparm_limit
//   - display_value só aceita bool (não existe "all")     → 2 consultas (false + true) mescladas em {value, display_value}
//   - resultado colunar a partir de 3 linhas              → reconvertido em objetos
//   - campos vazios são omitidos                          → preenchidos com '' para todo campo pedido
//   - orçamento de resposta pode cortar uma página        → busca o restante a partir do offset recebido
//
// Funções puras + `snMcpGet(path, callTool)`, onde `callTool(name, args)` resolve com o JSON da ferramenta.

const PAGE_SIZE     = 100;
const DEFAULT_LIMIT = 10000; // limite padrão da Table API quando sysparm_limit é omitido

// ── Parse ─────────────────────────────────────────────────────────────────────

function _splitFields(raw) {
  return String(raw || '').split(',').map(f => f.trim()).filter(Boolean);
}

function _toInt(raw, fallback) {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

// path: 'table/incident?sysparm_query=...&sysparm_fields=...' ou 'stats/incident?...'
function parseSnPath(path) {
  const str = String(path || '');
  const qIdx = str.indexOf('?');
  const route = (qIdx >= 0 ? str.slice(0, qIdx) : str).replace(/^\/+/, '');
  const qs    = qIdx >= 0 ? str.slice(qIdx + 1) : '';
  const [kind, table] = route.split('/');
  if (!['table', 'stats'].includes(kind) || !table) {
    throw new Error(`Unsupported Service Now path for MCP: ${route}`);
  }
  const params = new URLSearchParams(qs);
  const dvRaw  = String(params.get('sysparm_display_value') || 'false').toLowerCase();
  const displayValue = dvRaw === 'all' ? 'all' : dvRaw === 'true' ? 'true' : 'false';

  const orderField = params.get('sysparm_order_by') || params.get('sysparm_orderby') || '';
  const orderDir   = String(params.get('sysparm_order_by_direction') || '').toLowerCase();

  return {
    kind,
    table:   decodeURIComponent(table),
    query:   params.get('sysparm_query') || '',
    fields:  _splitFields(params.get('sysparm_fields')),
    limit:   _toInt(params.get('sysparm_limit'), DEFAULT_LIMIT),
    offset:  _toInt(params.get('sysparm_offset'), 0),
    displayValue,
    orderBy: orderField ? { field: orderField, desc: orderDir === 'desc' } : null,
    // stats
    count:   String(params.get('sysparm_count') || '').toLowerCase() === 'true',
    groupBy: params.get('sysparm_group_by') || '',
    sumFields: _splitFields(params.get('sysparm_sum_fields')),
    avgFields: _splitFields(params.get('sysparm_avg_fields')),
    minFields: _splitFields(params.get('sysparm_min_fields')),
    maxFields: _splitFields(params.get('sysparm_max_fields')),
  };
}

// Ordenação vai dentro da encoded query (a Table API ignora sysparm_order_by).
// sys_id como desempate garante páginas estáveis — sem isso, offsets podem repetir/pular linhas.
function buildQuery(parsed) {
  const clauses = [];
  if (parsed.query) clauses.push(parsed.query.replace(/\^+$/, ''));
  if (parsed.orderBy) clauses.push(`ORDERBY${parsed.orderBy.desc ? 'DESC' : ''}${parsed.orderBy.field}`);
  if (!parsed.orderBy || parsed.orderBy.field !== 'sys_id') clauses.push('ORDERBYsys_id');
  return clauses.join('^');
}

// ── Normalização de resposta ─────────────────────────────────────────────────

// Aceita `results` como lista de objetos ou como { columns, data } (formato colunar).
function rowsOf(resp) {
  const res = resp && resp.results;
  if (Array.isArray(res)) return res.filter(r => r && typeof r === 'object');
  if (res && typeof res === 'object' && Array.isArray(res.columns)) {
    const cols = res.columns.map(String);
    return (res.data || []).filter(Array.isArray).map(row => {
      const obj = {};
      cols.forEach((c, i) => { obj[c] = row[i]; });
      return obj;
    });
  }
  return [];
}

function _str(v) {
  if (v === null || v === undefined) return '';
  return typeof v === 'object' ? v : String(v);
}

// Garante que todo campo pedido exista (MCP omite campos vazios) e troca null por ''.
function fillMissingFields(rows, fields) {
  return rows.map(row => {
    const out = {};
    Object.keys(row).forEach(k => { out[k] = _str(row[k]); });
    fields.forEach(f => { if (!(f in out)) out[f] = ''; });
    return out;
  });
}

// Mescla as consultas display_value=false e =true no formato da REST com display_value=all.
function mergeDisplayValues(rawRows, dispRows, fields) {
  const dispById = new Map();
  dispRows.forEach((r, i) => dispById.set(r.sys_id ? String(r.sys_id) : `#${i}`, r));
  return rawRows.map((raw, i) => {
    const key  = raw.sys_id ? String(raw.sys_id) : `#${i}`;
    const disp = dispById.get(key) || {};
    const keys = new Set([...fields, ...Object.keys(raw)]);
    const out  = {};
    keys.forEach(k => {
      const value = _str(raw[k]);
      const dv    = k in disp ? _str(disp[k]) : value;
      out[k] = { display_value: dv, value };
    });
    return out;
  });
}

function _throwToolError(resp, table) {
  const msg = resp?.message || resp?.error || `sn_query failed on ${table}`;
  const err = new Error(`Service Now (MCP): ${msg}`);
  if (resp?.error_type === 'auth_session_expired') err.code = 'SN_AUTH';
  throw err;
}

// ── Paginação ─────────────────────────────────────────────────────────────────

async function _queryPage(callTool, base, offset, limit, includeCount) {
  const args = { ...base, offset, limit };
  if (includeCount) args.include_count = true;
  const resp = await callTool('sn_query', args);
  if (!resp || resp.success === false) _throwToolError(resp, base.table);
  const total = Number.isFinite(Number(resp.total_count)) && includeCount ? Number(resp.total_count) : null;
  return { rows: rowsOf(resp), total };
}

// Busca [offset, offset+size). Se o MCP devolver menos que o pedido (corte por orçamento),
// continua a partir do que chegou; para quando a página vem vazia.
async function _fetchRange(callTool, base, offset, size) {
  const out = [];
  let cursor = offset, remaining = size;
  while (remaining > 0) {
    const { rows } = await _queryPage(callTool, base, cursor, Math.min(PAGE_SIZE, remaining), false);
    if (!rows.length) break;
    out.push(...rows);
    cursor += rows.length;
    remaining -= rows.length;
  }
  return out;
}

// Retorna todas as linhas até `limit`, respeitando offset inicial.
async function fetchAllRows(callTool, base, { offset = 0, limit = DEFAULT_LIMIT } = {}) {
  if (limit <= 0) return [];
  const first = await _queryPage(callTool, base, offset, Math.min(PAGE_SIZE, limit), true);
  const rows  = [...first.rows];
  if (!first.rows.length) return rows;

  let cursor = offset + first.rows.length;
  const end  = first.total !== null ? Math.min(offset + limit, first.total) : offset + limit;
  if (cursor >= end) return rows;

  if (first.total === null) {
    rows.push(...await _fetchRange(callTool, base, cursor, end - cursor));
    return rows;
  }

  // Total conhecido: dispara as páginas restantes em paralelo (o cliente MCP limita a concorrência)
  const ranges = [];
  for (let o = cursor; o < end; o += PAGE_SIZE) ranges.push([o, Math.min(PAGE_SIZE, end - o)]);
  const pages = await Promise.all(ranges.map(([o, s]) => _fetchRange(callTool, base, o, s)));
  pages.forEach(p => rows.push(...p));
  return rows.slice(0, limit);
}

// ── Table ─────────────────────────────────────────────────────────────────────

async function runTableQuery(parsed, callTool) {
  const query  = buildQuery(parsed);
  const wanted = parsed.fields;
  const range  = { offset: parsed.offset, limit: parsed.limit };

  if (parsed.displayValue !== 'all') {
    const base = { table: parsed.table, query, display_value: parsed.displayValue === 'true' };
    if (wanted.length) base.fields = wanted.join(',');
    const rows = await fetchAllRows(callTool, base, range);
    return fillMissingFields(rows, wanted);
  }

  // display_value=all: sys_id é necessário para casar as duas consultas
  const needsSysId = wanted.length > 0 && !wanted.includes('sys_id');
  const fields     = needsSysId ? [...wanted, 'sys_id'] : wanted;
  const base       = { table: parsed.table, query };
  if (fields.length) base.fields = fields.join(',');

  const [raw, disp] = await Promise.all([
    fetchAllRows(callTool, { ...base, display_value: false }, range),
    fetchAllRows(callTool, { ...base, display_value: true  }, range),
  ]);
  const merged = mergeDisplayValues(fillMissingFields(raw, fields), fillMissingFields(disp, fields), fields);
  if (needsSysId) merged.forEach(r => { delete r.sys_id; });
  return merged;
}

// ── Stats ─────────────────────────────────────────────────────────────────────

function buildAggregateArgs(parsed) {
  const args = { table: parsed.table, aggregate: 'COUNT' };
  if (parsed.query)   args.query    = parsed.query;
  if (parsed.groupBy) args.group_by = parsed.groupBy;
  const pairs = [['SUM', parsed.sumFields], ['AVG', parsed.avgFields], ['MIN', parsed.minFields], ['MAX', parsed.maxFields]];
  const hit = pairs.find(([, f]) => f.length);
  if (hit) {
    if (hit[1].length > 1) throw new Error('MCP aggregate supports a single field per call');
    args.aggregate = hit[0];
    args.field     = hit[1][0];
  }
  return args;
}

async function runStatsQuery(parsed, callTool) {
  const resp = await callTool('sn_aggregate', buildAggregateArgs(parsed));
  if (!resp || resp.success === false) _throwToolError(resp, parsed.table);
  return resp.result;
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function snMcpGet(path, callTool) {
  const parsed = parseSnPath(path);
  const result = parsed.kind === 'stats'
    ? await runStatsQuery(parsed, callTool)
    : await runTableQuery(parsed, callTool);
  return { result };
}

module.exports = {
  PAGE_SIZE, DEFAULT_LIMIT,
  parseSnPath, buildQuery, rowsOf, fillMissingFields, mergeDisplayValues,
  fetchAllRows, runTableQuery, buildAggregateArgs, runStatsQuery, snMcpGet,
};

// Várias instâncias do Service Now (funções puras; config.js reexporta o que precisa).
//
// config.snInstances = [{ id, instance, label?, mode, user?, pass?, mcp?, assignmentGroups? }]
// A primeira é a principal. `config.servicenow` continua existindo e é o armazenamento canônico
// da principal: o dashboard do Service Now, o onboarding, getAppMode e versões antigas leem só ele.
// Ao normalizar, os campos de `servicenow` prevalecem sobre snInstances[0] (quem grava direto em
// `servicenow` não perde a alteração); sem `servicenow`, ele é recriado a partir de snInstances[0].

function normalizeHost(instance) {
  return String(instance || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '').toLowerCase();
}

// Id estável: primeiro trecho do host (ex.: "empresa" de empresa.service-now.com)
function snIdFor(instance) {
  const host = normalizeHost(instance);
  const base = (host.split('.')[0] || '').replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return base || 'sn';
}

function uniqueSnId(instance, existing = []) {
  const base = snIdFor(instance);
  const taken = new Set(existing.map(s => s && s.id));
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

function snLabel(sn) {
  return (sn && (sn.label || normalizeHost(sn.instance))) || '';
}

// Campos de conexão da principal que vão para `servicenow` (sem id/label, como sempre foi)
function _mirrorOf(sn) {
  if (!sn) return undefined;
  const { id, label, ...rest } = sn;
  return rest;
}

function normalizeSnInstances(data) {
  if (!data || typeof data !== 'object') return data;
  const legacy = data.servicenow && typeof data.servicenow === 'object' && data.servicenow.instance ? data.servicenow : null;
  let list = Array.isArray(data.snInstances) ? data.snInstances.filter(s => s && typeof s === 'object' && s.instance) : [];

  if (!list.length) {
    list = legacy ? [{ id: snIdFor(legacy.instance), ...legacy }] : [];
  } else if (legacy) {
    // `servicenow` é o armazenamento canônico da principal
    const head = list[0];
    list = [{ ...head, ...legacy, id: head.id, ...(head.label ? { label: head.label } : {}) }, ...list.slice(1)];
  }

  const seen = [];
  list = list.map(s => {
    const id = s.id && !seen.some(x => x.id === s.id) ? s.id : uniqueSnId(s.instance, seen);
    const out = { ...s, id };
    seen.push(out);
    return out;
  });

  data.snInstances = list;
  if (list[0]) data.servicenow = { ...(data.servicenow || {}), ..._mirrorOf(list[0]) };
  return data;
}

// Visão sem segredos, para telas e respostas da API
function snPublic(sn, extra = {}) {
  if (!sn) return null;
  return {
    id: sn.id,
    instance: sn.instance || '',
    label: sn.label || '',
    mode: sn.mode === 'mcp' ? 'mcp' : 'api',
    user: sn.user || '',
    hasPass: !!sn.pass,
    mcpUsername: (sn.mcp && sn.mcp.username) || '',
    mcpLoginUrl: (sn.mcp && sn.mcp.loginUrl) || '',
    ...extra,
  };
}

module.exports = { normalizeHost, snIdFor, uniqueSnId, snLabel, normalizeSnInstances, snPublic };

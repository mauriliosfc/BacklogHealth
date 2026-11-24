// Perfil do tipo de work item principal de um projeto.
//
// Tipos legados ('User Story' e 'Task') reproduzem exatamente o comportamento
// anterior a este módulo: mesma lista de tipos, mesmo campo de estimativa e
// states = null — quem consome mantém suas listas de estado literais via
// `profile.states?.done ?? <lista atual>`.
//
// Qualquer outro tipo (Issue, PBI escolhido pela nova tela, tipos customizados)
// usa o campo de estimativa e os estados resolvidos no setup e gravados no
// config do projeto (ver resolveTypeProfile em handlers/projects.js).

const FIELD = {
  storyPoints:      'Microsoft.VSTS.Scheduling.StoryPoints',
  effort:           'Microsoft.VSTS.Scheduling.Effort',
  size:             'Microsoft.VSTS.Scheduling.Size',
  remainingWork:    'Microsoft.VSTS.Scheduling.RemainingWork',
  originalEstimate: 'Microsoft.VSTS.Scheduling.OriginalEstimate',
};

const LEGACY_US_TYPES = ['User Story', 'Product Backlog Item', 'Requirement'];
const HOURS_FIELDS = [FIELD.remainingWork, FIELD.originalEstimate];

// Ordem de preferência ao detectar o campo de estimativa de um tipo novo
const ESTIMATE_CANDIDATES = [FIELD.storyPoints, FIELD.effort, FIELD.size, FIELD.originalEstimate];

// Usado quando um tipo novo foi salvo sem detecção (falha na API no setup)
const FALLBACK_ESTIMATE_FIELDS = [FIELD.storyPoints, FIELD.effort, FIELD.size];

// Exclusão aplicada na consulta principal dos tipos legados
const LEGACY_EXCLUDED_STATES = ['Done', 'Removed'];

const STATE_KINDS = ['new', 'active', 'done', 'removed'];

function isLegacyType(workItemType) {
  return !workItemType || workItemType === 'User Story' || workItemType === 'Task';
}

function _normalizeStates(states) {
  if (!states || typeof states !== 'object') return null;
  const out = {};
  STATE_KINDS.forEach(k => { out[k] = Array.isArray(states[k]) ? states[k].filter(s => typeof s === 'string' && s) : []; });
  return out;
}

function getWorkItemProfile(projectCfg) {
  const p  = projectCfg && typeof projectCfg === 'object' ? projectCfg : {};
  const wt = p.workItemType || 'User Story';

  if (wt === 'Task') {
    return {
      workItemType: 'Task', legacy: true, mainTypes: ['Task'],
      estimateFields: [FIELD.remainingWork, FIELD.originalEstimate],
      estimateUnit: 'hours', typeLabel: 'Task', states: null,
    };
  }
  if (wt === 'User Story') {
    return {
      workItemType: 'User Story', legacy: true, mainTypes: [...LEGACY_US_TYPES],
      estimateFields: [FIELD.storyPoints],
      estimateUnit: 'points', typeLabel: 'User Story', states: null,
    };
  }

  // estimateField: string = detectado; null = tipo sem campo de estimativa;
  // ausente = não detectado (tenta os campos de pontos mais comuns)
  let estimateFields;
  if (typeof p.estimateField === 'string' && p.estimateField) estimateFields = [p.estimateField];
  else if (p.estimateField === null) estimateFields = [];
  else estimateFields = [...FALLBACK_ESTIMATE_FIELDS];

  const estimateUnit = p.estimateUnit === 'hours' || p.estimateUnit === 'points'
    ? p.estimateUnit
    : (estimateFields.length === 1 && HOURS_FIELDS.includes(estimateFields[0]) ? 'hours' : 'points');

  return {
    workItemType: wt, legacy: false, mainTypes: [wt],
    estimateFields, estimateUnit, typeLabel: wt,
    states: _normalizeStates(p.states),
  };
}

// Valor da estimativa de um item (objeto `fields` da API).
// Legado Task: RemainingWork; se vazio ou 0, OriginalEstimate (pode ser undefined).
// Legado US: StoryPoints ?? null. Demais: primeiro campo não-nulo, senão null.
function readEstimate(fields, profile) {
  const f = fields || {};
  if (profile.legacy && profile.workItemType === 'Task') {
    const rw = f[FIELD.remainingWork];
    return (rw == null || rw === 0) ? f[FIELD.originalEstimate] : rw;
  }
  for (const name of profile.estimateFields) {
    if (f[name] != null) return f[name];
  }
  return null;
}

// true quando o item não tem estimativa (indicador "sem estimativa").
// Tipo sem campo de estimativa nunca conta como "sem estimativa".
function lacksEstimate(fields, profile) {
  const f = fields || {};
  if (profile.legacy && profile.workItemType === 'Task') {
    const rw = f[FIELD.remainingWork];
    const oe = f[FIELD.originalEstimate];
    return (rw == null || rw === 0) && (oe == null || oe === 0);
  }
  if (!profile.estimateFields.length) return false;
  return readEstimate(f, profile) == null;
}

// Estados excluídos da consulta principal do dashboard
function excludedStates(profile) {
  if (profile.states) return profile.states.removed;
  return LEGACY_EXCLUDED_STATES;
}

// Lista de estados de um tipo (states != null) ou o fallback literal do chamador
function statesOr(profile, kind, fallback) {
  if (!profile.states) return fallback;
  if (kind === 'closed') return [...profile.states.done, ...profile.states.removed];
  return profile.states[kind] || [];
}

// Escapa valores para listas WIQL: ['a', "b'c"] → "'a','b''c'"
function wiqlList(values) {
  return values.map(v => `'${String(v).replace(/'/g, "''")}'`).join(',');
}

// Subconjunto enviado ao navegador em data-profile
function clientProfile(profile) {
  return {
    workItemType:  profile.workItemType,
    legacy:        profile.legacy,
    mainTypes:     profile.mainTypes,
    estimateUnit:  profile.estimateUnit,
    hasEstimate:   profile.estimateFields.length > 0,
    typeLabel:     profile.typeLabel,
    states:        profile.states,
  };
}

// Agrupa os estados de um tipo pelas categorias do Azure
// (resposta de _apis/wit/workitemtypes/{type}/states)
function statesFromCategories(stateList) {
  const out = { new: [], active: [], done: [], removed: [] };
  (stateList || []).forEach(s => {
    if (!s || !s.name) return;
    switch (s.category) {
      case 'Proposed':   out.new.push(s.name); break;
      case 'InProgress':
      case 'Resolved':   out.active.push(s.name); break;
      case 'Completed':  out.done.push(s.name); break;
      case 'Removed':    out.removed.push(s.name); break;
      default: break;
    }
  });
  return out;
}

// Escolhe o campo de estimativa entre os campos do tipo
// (resposta de _apis/wit/workitemtypes/{type}/fields)
function pickEstimateField(fieldList) {
  const refs = new Set((fieldList || []).map(f => f && f.referenceName).filter(Boolean));
  const found = ESTIMATE_CANDIDATES.find(c => refs.has(c)) || null;
  return { estimateField: found, estimateUnit: found && HOURS_FIELDS.includes(found) ? 'hours' : 'points' };
}

module.exports = {
  FIELD, LEGACY_US_TYPES, LEGACY_EXCLUDED_STATES,
  isLegacyType, getWorkItemProfile, readEstimate, lacksEstimate,
  excludedStates, statesOr, wiqlList, clientProfile,
  statesFromCategories, pickEstimateField,
};

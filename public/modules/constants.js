export const US_TYPES = ['User Story', 'Product Backlog Item', 'Requirement'];
export const TASK_TYPES = ['Task'];
export const CLOSED_STATES = ['Closed', 'Done', 'Resolved', 'Removed'];
export const ACTIVE_BUG_STATES = ['Active', 'In Progress', 'New'];

export function isLegacyType(workItemType) {
  return !workItemType || workItemType === 'User Story' || workItemType === 'Task';
}

export function getItemTypes(workItemType) {
  if (workItemType === 'Task') return TASK_TYPES;
  if (isLegacyType(workItemType)) return US_TYPES;
  return [workItemType];
}

export function getEstimateField(workItemType) {
  return workItemType === 'Task'
    ? 'RemainingWork'
    : 'StoryPoints';
}

// Perfil do tipo principal — espelha clientProfile() de utils/workItemProfile.js.
// Tipos legados têm states = null: cada módulo mantém suas listas de estado atuais.
export function legacyProfile(workItemType) {
  const isTask = workItemType === 'Task';
  const wt = isTask ? 'Task' : (isLegacyType(workItemType) ? 'User Story' : workItemType);
  return {
    workItemType: wt,
    legacy:       isLegacyType(workItemType),
    mainTypes:    getItemTypes(workItemType),
    estimateUnit: isTask ? 'hours' : 'points',
    hasEstimate:  true,
    typeLabel:    wt,
    states:       null,
  };
}

// Perfil a partir do card do dashboard (data-profile, com fallback em data-workitemtype)
export function getProfile(card) {
  const raw = card?.dataset?.profile;
  if (raw) {
    try { return JSON.parse(raw); } catch (_) { /* HTML antigo em cache */ }
  }
  return legacyProfile(card?.dataset?.workitemtype || 'User Story');
}

// Perfil a partir da resposta de /detail
export function profileFromDetail(data) {
  return data?.profile || legacyProfile(data?.workItemType || 'User Story');
}

// Estados de um tipo com estados detectados, ou o fallback literal do chamador
export function profileStates(profile, kind, fallback) {
  const st = profile?.states;
  if (!st) return fallback;
  if (kind === 'closed') return [...(st.done || []), ...(st.removed || [])];
  return st[kind] || [];
}

export function closedStates(profile) {
  return profileStates(profile, 'closed', CLOSED_STATES);
}

export function isHoursProfile(profile) {
  return profile?.estimateUnit === 'hours';
}

// Título da lista de itens principais: legados usam as chaves i18n de sempre;
// tipos novos usam o nome do tipo como vem do Azure
export function mainItemsLabel(profile, t) {
  if (!profile || profile.legacy) return t(profile?.workItemType === 'Task' ? 'stat_tasks' : 'stat_us');
  return profile.typeLabel;
}

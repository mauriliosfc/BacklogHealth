export const US_TYPES = ['User Story', 'Product Backlog Item', 'Requirement'];
export const TASK_TYPES = ['Task'];
export const CLOSED_STATES = ['Closed', 'Done', 'Resolved', 'Removed'];
export const ACTIVE_BUG_STATES = ['Active', 'In Progress', 'New'];

export function getItemTypes(workItemType) {
  return workItemType === 'Task' ? TASK_TYPES : US_TYPES;
}

export function getEstimateField(workItemType) {
  return workItemType === 'Task'
    ? 'RemainingWork'
    : 'StoryPoints';
}

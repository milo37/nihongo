export type AxeFindingTarget = readonly (string | readonly string[])[]

export const axeFindingDispositionSelectors = {
  // Decorative ○/✕ mark before the wrong-note answer labels (JLP-812).
  answerMark: '.review-answer-mark',
  heroGradient: '.home-hero',
  optionReorderControl: '.ui-option-reorder-control',
  paginationCurrent: '.ui-pagination-current',
  tableSortIndicator: '.ui-table-sort-indicator'
} as const

export const createAxeFindingDispositionKey = (
  ruleId: string,
  target: AxeFindingTarget
): string => JSON.stringify([ruleId, target])

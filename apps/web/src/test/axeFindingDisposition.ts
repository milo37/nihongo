export type AxeFindingTarget = readonly (string | readonly string[])[]

export const axeFindingDispositionSelectors = {
  // Decorative ○/✕ mark before the wrong-note answer labels (JLP-812).
  answerMark:
    'li > strong.text-success-strong > span[aria-hidden="true"]:first-child, li > strong.text-danger > span[aria-hidden="true"]:first-child',
  optionReorderControl: '.ui-option-reorder-control',
  paginationCurrent: '.ui-pagination-current',
  tableSortIndicator: '.ui-table-sort-indicator'
} as const

export const createAxeFindingDispositionKey = (
  ruleId: string,
  target: AxeFindingTarget
): string => JSON.stringify([ruleId, target])

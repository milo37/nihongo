export type AxeFindingTarget = readonly (string | readonly string[])[]

export const axeFindingDispositionSelectors = {
  // Decorative ○/✕ mark before the wrong-note answer labels (JLP-812).
  answerMark: '.review-answer-mark',
  heroGradient: '.home-hero',
  // One character per manuscript square (B4): axe cannot size single SVG
  // glyphs, so their fill (currentColor) is measured as text instead.
  manuscriptGlyph: '.manuscript-sheet text',
  // The circled score can be one digit ("0"), too short for axe to size.
  resultScore: '.result-b4-number',
  optionReorderControl: '.ui-option-reorder-control',
  paginationCurrent: '.ui-pagination-current',
  tableSortIndicator: '.ui-table-sort-indicator'
} as const

export const createAxeFindingDispositionKey = (
  ruleId: string,
  target: AxeFindingTarget
): string => JSON.stringify([ruleId, target])

import type { QuestionReportSummary } from '@nihongo/contracts/admin/phase7'

export const adminReportReasonKey = {
  ANSWER_ERROR: 'enums.reportReasons.ANSWER_ERROR',
  EXPLANATION_ERROR: 'enums.reportReasons.EXPLANATION_ERROR',
  TYPO_OR_GRAMMAR: 'enums.reportReasons.TYPO_OR_GRAMMAR',
  AMBIGUOUS: 'enums.reportReasons.AMBIGUOUS',
  LEVEL_OR_TAXONOMY: 'enums.reportReasons.LEVEL_OR_TAXONOMY',
  OTHER: 'enums.reportReasons.OTHER'
} as const satisfies Record<QuestionReportSummary['reason'], string>

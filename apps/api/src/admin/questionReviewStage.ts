import type {
  AutoValidationResult,
  QuestionReviewStage
} from '@nihongo/contracts/admin/review'

type QuestionVersionStatus =
  | 'DRAFT'
  | 'IN_REVIEW'
  | 'CHANGES_REQUESTED'
  | 'APPROVED'
  | 'PUBLISHED'
  | 'RETIRED'

export const QUESTION_VERSION_STATUSES_BY_REVIEW_STAGE = {
  AUTO_VALIDATED: ['DRAFT', 'IN_REVIEW', 'CHANGES_REQUESTED'],
  REVIEWED: ['APPROVED'],
  PUBLISHED: ['PUBLISHED'],
  RETIRED: ['RETIRED']
} as const satisfies Record<
  QuestionReviewStage,
  readonly QuestionVersionStatus[]
>

export const toQuestionReviewStage = (
  status: QuestionVersionStatus
): QuestionReviewStage => {
  if (status === 'APPROVED') return 'REVIEWED'
  if (status === 'PUBLISHED') return 'PUBLISHED'
  if (status === 'RETIRED') return 'RETIRED'
  return 'AUTO_VALIDATED'
}

// Create, update and import reject invalid content before it is stored, so
// every stored version has passed automatic validation.
export const STORED_VERSION_AUTO_VALIDATION: AutoValidationResult = {
  passed: true,
  issues: []
}

import type { ReviewReconciliationResult } from './reviewReconciliationRepository.js'

interface ReviewReconciliationSuccessLog extends ReviewReconciliationResult {
  readonly batchSize: number
  readonly event: 'review.reconciliation.completed'
}

interface ReviewReconciliationFailureLog {
  readonly errorName: string
  readonly event: 'review.reconciliation.failed'
}

export const createReviewReconciliationSuccessLog = (
  batchSize: number,
  result: ReviewReconciliationResult
): ReviewReconciliationSuccessLog => ({
  event: 'review.reconciliation.completed',
  batchSize,
  ...result
})

export const createReviewReconciliationFailureLog = (
  error: unknown
): ReviewReconciliationFailureLog => ({
  event: 'review.reconciliation.failed',
  errorName: error instanceof Error ? error.name : 'UnknownError'
})

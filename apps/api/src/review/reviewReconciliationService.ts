import { z } from 'zod'
import type {
  ReviewReconciliationRepository,
  ReviewReconciliationResult
} from './reviewReconciliationRepository.js'

export const DEFAULT_REVIEW_RECONCILIATION_BATCH_SIZE = 100
export const MAX_REVIEW_RECONCILIATION_BATCH_SIZE = 500

const inputSchema = z
  .object({
    batchSize: z
      .number()
      .int()
      .min(1)
      .max(MAX_REVIEW_RECONCILIATION_BATCH_SIZE)
      .default(DEFAULT_REVIEW_RECONCILIATION_BATCH_SIZE)
  })
  .strict()

export interface ReviewReconciliationService {
  reconcile: (input?: {
    batchSize?: number
  }) => Promise<ReviewReconciliationResult>
}

export const createReviewReconciliationService = (
  repository: ReviewReconciliationRepository
): ReviewReconciliationService => ({
  reconcile: async (input = {}) => {
    const parsed = inputSchema.parse(input)
    return await repository.reconcile({ batchSize: parsed.batchSize })
  }
})

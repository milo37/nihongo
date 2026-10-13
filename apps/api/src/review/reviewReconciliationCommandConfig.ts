import { z } from 'zod'
import {
  DEFAULT_REVIEW_RECONCILIATION_BATCH_SIZE,
  MAX_REVIEW_RECONCILIATION_BATCH_SIZE
} from './reviewReconciliationService.js'

export const REVIEW_RECONCILIATION_CONFIRMATION =
  'RECONCILE_WRONG_NOTE_REVIEW_READ_ONLY'

const commandInputSchema = z
  .object({
    batchSize: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_REVIEW_RECONCILIATION_BATCH_SIZE)
      .default(DEFAULT_REVIEW_RECONCILIATION_BATCH_SIZE),
    confirmation: z.literal(REVIEW_RECONCILIATION_CONFIRMATION)
  })
  .strict()

export interface ReviewReconciliationCommandInput {
  readonly batchSize: number
}

export const parseReviewReconciliationCommandInput = (
  source: NodeJS.ProcessEnv
): ReviewReconciliationCommandInput => {
  const parsed = commandInputSchema.parse({
    batchSize: source.REVIEW_RECONCILIATION_BATCH_SIZE,
    confirmation: source.REVIEW_RECONCILIATION_CONFIRM
  })
  return { batchSize: parsed.batchSize }
}

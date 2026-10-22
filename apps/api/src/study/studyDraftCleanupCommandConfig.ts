import { z } from 'zod'
import {
  DEFAULT_STUDY_DRAFT_CLEANUP_BATCH_SIZE,
  MAX_STUDY_DRAFT_CLEANUP_BATCH_SIZE
} from './studyDraftCleanupService.js'

export const STUDY_DRAFT_CLEANUP_CONFIRMATION = 'DELETE_EXPIRED_STUDY_DRAFTS'

const inputSchema = z
  .object({
    batchSize: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_STUDY_DRAFT_CLEANUP_BATCH_SIZE)
      .default(DEFAULT_STUDY_DRAFT_CLEANUP_BATCH_SIZE),
    confirmation: z.literal(STUDY_DRAFT_CLEANUP_CONFIRMATION)
  })
  .strict()

export const parseStudyDraftCleanupCommandInput = (
  source: NodeJS.ProcessEnv
): { batchSize: number } => {
  const parsed = inputSchema.parse({
    batchSize: source.STUDY_DRAFT_CLEANUP_BATCH_SIZE,
    confirmation: source.STUDY_DRAFT_CLEANUP_CONFIRM
  })
  return { batchSize: parsed.batchSize }
}

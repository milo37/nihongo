import { z } from 'zod'
import {
  DEFAULT_STUDY_SESSION_CLEANUP_BATCH_SIZE,
  MAX_STUDY_SESSION_CLEANUP_BATCH_SIZE
} from './studySessionCleanupService.js'

export const STUDY_SESSION_CLEANUP_CONFIRMATION =
  'DELETE_EXPIRED_GUEST_STUDY_DATA'

const cleanupCommandInputSchema = z
  .object({
    batchSize: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_STUDY_SESSION_CLEANUP_BATCH_SIZE)
      .default(DEFAULT_STUDY_SESSION_CLEANUP_BATCH_SIZE),
    confirmation: z.literal(STUDY_SESSION_CLEANUP_CONFIRMATION)
  })
  .strict()

export interface StudySessionCleanupCommandInput {
  batchSize: number
}

export const parseStudySessionCleanupCommandInput = (
  source: NodeJS.ProcessEnv
): StudySessionCleanupCommandInput => {
  const parsed = cleanupCommandInputSchema.parse({
    batchSize: source.STUDY_CLEANUP_BATCH_SIZE,
    confirmation: source.STUDY_CLEANUP_CONFIRM
  })
  return { batchSize: parsed.batchSize }
}

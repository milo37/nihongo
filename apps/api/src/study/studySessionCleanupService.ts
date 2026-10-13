import { z } from 'zod'
import type {
  StudySessionCleanupBatchResult,
  StudySessionCleanupRepository
} from './studySessionCleanupRepository.js'

export const DEFAULT_STUDY_SESSION_CLEANUP_BATCH_SIZE = 100
export const MAX_STUDY_SESSION_CLEANUP_BATCH_SIZE = 500

const studySessionCleanupInputSchema = z
  .object({
    batchSize: z
      .number()
      .int()
      .min(1)
      .max(MAX_STUDY_SESSION_CLEANUP_BATCH_SIZE)
      .default(DEFAULT_STUDY_SESSION_CLEANUP_BATCH_SIZE)
  })
  .strict()

export interface StudySessionCleanupService {
  cleanup: (input?: {
    batchSize?: number
  }) => Promise<StudySessionCleanupBatchResult>
}

export const createStudySessionCleanupService = (
  repository: StudySessionCleanupRepository,
  now: () => Date = () => new Date()
): StudySessionCleanupService => ({
  cleanup: async (input = {}) => {
    const parsed = studySessionCleanupInputSchema.parse(input)
    return await repository.cleanupExpiredGuestStudyData({
      batchSize: parsed.batchSize,
      now: now()
    })
  }
})

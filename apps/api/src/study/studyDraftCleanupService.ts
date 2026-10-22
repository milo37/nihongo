import { z } from 'zod'
import type {
  StudyDraftCleanupRepository,
  StudyDraftCleanupResult
} from './studyDraftCleanupRepository.js'

export const DEFAULT_STUDY_DRAFT_CLEANUP_BATCH_SIZE = 100
export const MAX_STUDY_DRAFT_CLEANUP_BATCH_SIZE = 500

const inputSchema = z
  .object({
    batchSize: z
      .number()
      .int()
      .min(1)
      .max(MAX_STUDY_DRAFT_CLEANUP_BATCH_SIZE)
      .default(DEFAULT_STUDY_DRAFT_CLEANUP_BATCH_SIZE)
  })
  .strict()

export interface StudyDraftCleanupService {
  cleanup: (input?: { batchSize?: number }) => Promise<StudyDraftCleanupResult>
}

export const createStudyDraftCleanupService = (
  repository: StudyDraftCleanupRepository,
  now: () => Date = () => new Date()
): StudyDraftCleanupService => ({
  cleanup: async (input = {}) => {
    const parsed = inputSchema.parse(input)
    return await repository.cleanupExpiredStudyDrafts({
      batchSize: parsed.batchSize,
      now: now()
    })
  }
})

import { describe, expect, it, vi } from 'vitest'
import {
  parseStudyDraftCleanupCommandInput,
  STUDY_DRAFT_CLEANUP_CONFIRMATION
} from './studyDraftCleanupCommandConfig.js'
import type { StudyDraftCleanupRepository } from './studyDraftCleanupRepository.js'
import {
  createStudyDraftCleanupService,
  DEFAULT_STUDY_DRAFT_CLEANUP_BATCH_SIZE
} from './studyDraftCleanupService.js'

const NOW = new Date('2000-01-01T12:00:00.000Z')
const result = {
  expiredDraftBatchLimitReached: false,
  expiredDraftIdempotencyBatchLimitReached: false,
  expiredIdempotencyBatchLimitReached: false,
  expiredRetryIdempotencyBatchLimitReached: false,
  expiredTargetedReviewIdempotencyBatchLimitReached: false,
  expiredStudyDraftCount: 2,
  deletedDraftIdempotencyRecordCount: 3,
  deletedRetryIdempotencyRecordCount: 2,
  deletedTargetedReviewIdempotencyRecordCount: 0,
  oldestOverdueExpiresAt: '1999-12-30T12:00:00.000Z',
  overdueStudyDraftCount: 2,
  idempotencyOperationMetrics: [
    {
      operation: 'STUDY_DRAFT_SAVE' as const,
      activeRecordCount: 1,
      expiredRecordCount: 1,
      oldestActiveAgeSeconds: 30,
      oldestExpiredAgeSeconds: 60
    }
  ]
}

describe('StudyDraft cleanup service', () => {
  it('고정 clock과 기본 bounded batch를 repository에 전달한다', async () => {
    const cleanupExpiredStudyDrafts = vi.fn().mockResolvedValue(result)
    const repository: StudyDraftCleanupRepository = {
      cleanupExpiredStudyDrafts
    }

    await expect(
      createStudyDraftCleanupService(repository, () => NOW).cleanup()
    ).resolves.toEqual(result)
    expect(cleanupExpiredStudyDrafts).toHaveBeenCalledWith({
      batchSize: DEFAULT_STUDY_DRAFT_CLEANUP_BATCH_SIZE,
      now: NOW
    })
  })

  it.each([0, -1, 1.5, 501])(
    'batchSize %s를 repository 호출 전에 거부한다',
    async (batchSize) => {
      const cleanupExpiredStudyDrafts = vi.fn().mockResolvedValue(result)

      await expect(
        createStudyDraftCleanupService(
          { cleanupExpiredStudyDrafts },
          () => NOW
        ).cleanup({ batchSize })
      ).rejects.toThrow()
      expect(cleanupExpiredStudyDrafts).not.toHaveBeenCalled()
    }
  )
})

describe('StudyDraft cleanup command config', () => {
  it('정확한 confirmation과 bounded batch만 허용한다', () => {
    expect(
      parseStudyDraftCleanupCommandInput({
        STUDY_DRAFT_CLEANUP_CONFIRM: STUDY_DRAFT_CLEANUP_CONFIRMATION,
        STUDY_DRAFT_CLEANUP_BATCH_SIZE: '25'
      })
    ).toEqual({ batchSize: 25 })
    expect(
      parseStudyDraftCleanupCommandInput({
        STUDY_DRAFT_CLEANUP_CONFIRM: STUDY_DRAFT_CLEANUP_CONFIRMATION
      })
    ).toEqual({ batchSize: DEFAULT_STUDY_DRAFT_CLEANUP_BATCH_SIZE })
  })

  it.each([
    {},
    { STUDY_DRAFT_CLEANUP_CONFIRM: 'yes' },
    {
      STUDY_DRAFT_CLEANUP_CONFIRM: STUDY_DRAFT_CLEANUP_CONFIRMATION,
      STUDY_DRAFT_CLEANUP_BATCH_SIZE: '0'
    },
    {
      STUDY_DRAFT_CLEANUP_CONFIRM: STUDY_DRAFT_CLEANUP_CONFIRMATION,
      STUDY_DRAFT_CLEANUP_BATCH_SIZE: '501'
    }
  ])('unsafe command input을 fail closed한다', (source) => {
    expect(() => parseStudyDraftCleanupCommandInput(source)).toThrow()
  })
})

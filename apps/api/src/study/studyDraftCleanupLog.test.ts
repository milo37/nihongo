import { describe, expect, it } from 'vitest'
import {
  createStudyDraftCleanupFailureLog,
  createStudyDraftCleanupSuccessLog
} from './studyDraftCleanupLog.js'

const result = {
  expiredDraftBatchLimitReached: false,
  expiredDraftIdempotencyBatchLimitReached: true,
  expiredIdempotencyBatchLimitReached: true,
  expiredRetryIdempotencyBatchLimitReached: false,
  expiredTargetedReviewIdempotencyBatchLimitReached: false,
  expiredStudyDraftCount: 2,
  deletedDraftIdempotencyRecordCount: 500,
  deletedRetryIdempotencyRecordCount: 0,
  deletedTargetedReviewIdempotencyRecordCount: 0,
  oldestOverdueExpiresAt: '2000-01-01T00:00:00.000Z',
  overdueStudyDraftCount: 3,
  idempotencyOperationMetrics: [
    {
      operation: 'STUDY_DRAFT_SAVE' as const,
      activeRecordCount: 4,
      expiredRecordCount: 5,
      oldestActiveAgeSeconds: 60,
      oldestExpiredAgeSeconds: 120
    }
  ]
}

describe('StudyDraft cleanup logs', () => {
  it('aggregate cleanup metrics만 출력하고 principal·payload·key를 노출하지 않는다', () => {
    const log = createStudyDraftCleanupSuccessLog(500, result)

    expect(log).toEqual({
      event: 'study.expired_drafts.cleaned',
      batchSize: 500,
      ...result
    })
    expect(JSON.stringify(log)).not.toMatch(
      /answers|guestPrincipalId|idempotencyKey|principalId|requestHash|responseBody|userId/
    )
  })

  it('실패 로그에는 오류 이름만 남긴다', () => {
    const error = Object.assign(new Error('secret request payload'), {
      idempotencyKey: 'secret-key'
    })

    expect(createStudyDraftCleanupFailureLog(error)).toEqual({
      event: 'study.expired_drafts.cleanup_failed',
      errorName: 'Error'
    })
    expect(createStudyDraftCleanupFailureLog('secret')).toEqual({
      event: 'study.expired_drafts.cleanup_failed',
      errorName: 'UnknownError'
    })
  })
})

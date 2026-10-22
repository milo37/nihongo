import { describe, expect, it, vi } from 'vitest'
import {
  parseReviewReconciliationCommandInput,
  REVIEW_RECONCILIATION_CONFIRMATION
} from './reviewReconciliationCommandConfig.js'
import {
  createReviewReconciliationFailureLog,
  createReviewReconciliationSuccessLog
} from './reviewReconciliationLog.js'
import type {
  ReviewReconciliationRepository,
  ReviewReconciliationResult
} from './reviewReconciliationRepository.js'
import {
  createReviewReconciliationService,
  DEFAULT_REVIEW_RECONCILIATION_BATCH_SIZE
} from './reviewReconciliationService.js'
import { assertSafeReviewReconciliationTarget } from './reviewReconciliationTargetGuard.js'

const cleanResult: ReviewReconciliationResult = {
  scannedWrongNoteCount: 3,
  mismatchWrongNoteCount: 0,
  categories: [
    { category: 'EVENT_CHAIN', count: 0, oldestOccurredAt: null },
    {
      category: 'MATERIALIZED_WRONG_NOTE',
      count: 0,
      oldestOccurredAt: null
    },
    { category: 'REVIEW_SCHEDULE', count: 0, oldestOccurredAt: null },
    { category: 'EVIDENCE_PIN', count: 0, oldestOccurredAt: null },
    { category: 'SOURCE_MODE', count: 0, oldestOccurredAt: null }
  ]
}

describe('review reconciliation service and command boundary', () => {
  it('기본/max batch를 repository에 전달하고 범위 밖 입력을 거부한다', async () => {
    const reconcile = vi.fn().mockResolvedValue(cleanResult)
    const repository: ReviewReconciliationRepository = { reconcile }
    const service = createReviewReconciliationService(repository)

    await expect(service.reconcile()).resolves.toEqual(cleanResult)
    expect(reconcile).toHaveBeenLastCalledWith({
      batchSize: DEFAULT_REVIEW_RECONCILIATION_BATCH_SIZE
    })
    await expect(service.reconcile({ batchSize: 500 })).resolves.toEqual(
      cleanResult
    )
    expect(reconcile).toHaveBeenLastCalledWith({ batchSize: 500 })

    for (const batchSize of [0, 1.5, 501]) {
      await expect(service.reconcile({ batchSize })).rejects.toThrow()
    }
  })

  it('정확한 read-only confirmation만 허용한다', () => {
    expect(
      parseReviewReconciliationCommandInput({
        REVIEW_RECONCILIATION_CONFIRM: REVIEW_RECONCILIATION_CONFIRMATION,
        REVIEW_RECONCILIATION_BATCH_SIZE: '25'
      })
    ).toEqual({ batchSize: 25 })
    expect(() =>
      parseReviewReconciliationCommandInput({
        REVIEW_RECONCILIATION_CONFIRM: 'yes'
      })
    ).toThrow()
  })

  it('aggregate category와 oldest instant만 log하고 식별자·payload를 누출하지 않는다', () => {
    const log = createReviewReconciliationSuccessLog(100, {
      ...cleanResult,
      mismatchWrongNoteCount: 1,
      categories: [
        {
          category: 'EVENT_CHAIN',
          count: 1,
          oldestOccurredAt: '2026-08-21T00:00:00.000Z'
        }
      ]
    })
    expect(JSON.stringify(log)).not.toMatch(
      /answer|idempotency|memo|payload|questionId|requestHash|userId|wrongNoteId/i
    )
    expect(createReviewReconciliationFailureLog(new Error('secret'))).toEqual({
      event: 'review.reconciliation.failed',
      errorName: 'Error'
    })
  })

  it('loopback의 exact test/dev target만 허용하고 production은 차단한다', () => {
    const testUrl =
      'postgresql://nihongo:secret@127.0.0.1:55432/phase5_reconcile_test'
    const developmentUrl =
      'postgresql://nihongo:secret@127.0.0.1:55432/phase5_reconcile_dev'

    expect(() =>
      assertSafeReviewReconciliationTarget({
        databaseUrl: testUrl,
        nodeEnvironment: 'test'
      })
    ).not.toThrow()
    expect(() =>
      assertSafeReviewReconciliationTarget({
        databaseUrl: developmentUrl,
        nodeEnvironment: 'development'
      })
    ).not.toThrow()
    expect(() =>
      assertSafeReviewReconciliationTarget({
        databaseUrl: testUrl,
        nodeEnvironment: 'production'
      })
    ).toThrow()
  })
})

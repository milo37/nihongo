import 'dotenv/config'
import { runStudyCleanupCommand } from './studyCleanupCommandRunner.js'
import { createPrismaStudyDraftCleanupRepository } from './studyDraftCleanupRepository.js'
import {
  createStudyDraftCleanupService,
  DEFAULT_STUDY_DRAFT_CLEANUP_BATCH_SIZE,
  MAX_STUDY_DRAFT_CLEANUP_BATCH_SIZE
} from './studyDraftCleanupService.js'

runStudyCleanupCommand({
  batchSizeVariable: 'STUDY_DRAFT_CLEANUP_BATCH_SIZE',
  confirmationVariable: 'STUDY_DRAFT_CLEANUP_CONFIRM',
  confirmation: 'DELETE_EXPIRED_STUDY_DRAFTS',
  defaultBatchSize: DEFAULT_STUDY_DRAFT_CLEANUP_BATCH_SIZE,
  maxBatchSize: MAX_STUDY_DRAFT_CLEANUP_BATCH_SIZE,
  dryRunVariable: 'STUDY_DRAFT_CLEANUP_DRY_RUN',
  successEvent: 'study.expired_drafts.cleaned',
  failureEvent: 'study.expired_drafts.cleanup_failed',
  allowProduction: true,
  cleanup: async (client, batchSize, dryRun) =>
    await createStudyDraftCleanupService(
      createPrismaStudyDraftCleanupRepository(client)
    ).cleanup({ batchSize, dryRun }),
  describe: (result) => ({
    expiredDraftBatchLimitReached: result.expiredDraftBatchLimitReached,
    expiredDraftIdempotencyBatchLimitReached:
      result.expiredDraftIdempotencyBatchLimitReached,
    expiredIdempotencyBatchLimitReached:
      result.expiredIdempotencyBatchLimitReached,
    expiredRetryIdempotencyBatchLimitReached:
      result.expiredRetryIdempotencyBatchLimitReached,
    expiredTargetedReviewIdempotencyBatchLimitReached:
      result.expiredTargetedReviewIdempotencyBatchLimitReached,
    expiredStudyDraftCount: result.expiredStudyDraftCount,
    deletedDraftIdempotencyRecordCount:
      result.deletedDraftIdempotencyRecordCount,
    deletedRetryIdempotencyRecordCount:
      result.deletedRetryIdempotencyRecordCount,
    deletedTargetedReviewIdempotencyRecordCount:
      result.deletedTargetedReviewIdempotencyRecordCount,
    oldestOverdueExpiresAt: result.oldestOverdueExpiresAt,
    overdueStudyDraftCount: result.overdueStudyDraftCount,
    idempotencyOperationMetrics: result.idempotencyOperationMetrics.map(
      (metric) => ({
        activeRecordCount: metric.activeRecordCount,
        expiredRecordCount: metric.expiredRecordCount,
        oldestActiveAgeSeconds: metric.oldestActiveAgeSeconds,
        oldestExpiredAgeSeconds: metric.oldestExpiredAgeSeconds,
        operation: metric.operation
      })
    )
  })
})

import 'dotenv/config'
import { z } from 'zod'
import { parseApiEnvironment } from '../config/env.js'
import { createDatabaseRuntime } from '../db/database.js'
import {
  assertSafeDevelopmentDatabase,
  assertSafeTestDatabase
} from '../db/databaseTargetGuard.js'
import {
  createPrismaStudyDraftCleanupRepository,
  type StudyDraftCleanupResult
} from './studyDraftCleanupRepository.js'
import {
  createStudyDraftCleanupService,
  DEFAULT_STUDY_DRAFT_CLEANUP_BATCH_SIZE,
  MAX_STUDY_DRAFT_CLEANUP_BATCH_SIZE
} from './studyDraftCleanupService.js'

const run = async (): Promise<void> => {
  const input = z
    .object({
      batchSize: z.coerce
        .number()
        .int()
        .min(1)
        .max(MAX_STUDY_DRAFT_CLEANUP_BATCH_SIZE)
        .default(DEFAULT_STUDY_DRAFT_CLEANUP_BATCH_SIZE),
      confirmation: z.literal('DELETE_EXPIRED_STUDY_DRAFTS')
    })
    .strict()
    .parse({
      batchSize: process.env.STUDY_DRAFT_CLEANUP_BATCH_SIZE,
      confirmation: process.env.STUDY_DRAFT_CLEANUP_CONFIRM
    })
  const environment = parseApiEnvironment(process.env)
  const target = {
    databaseUrl: environment.DATABASE_URL,
    nodeEnvironment: environment.NODE_ENV,
    productionDatabaseUrl: process.env.PRODUCTION_DATABASE_URL
  }
  if (environment.NODE_ENV === 'test') assertSafeTestDatabase(target)
  else if (environment.NODE_ENV === 'development')
    assertSafeDevelopmentDatabase(target)
  else
    throw new Error(
      'Production cleanup requires a separately approved exact-target runbook.'
    )

  const database = createDatabaseRuntime(
    environment.DATABASE_URL,
    environment.ADMIN_CMS_MODE === 'technical'
      ? { migrationProfile: 'current', startupRole: 'nihongo_app' }
      : {}
  )
  let result: StudyDraftCleanupResult
  try {
    await database.checkReadiness()
    result = await createStudyDraftCleanupService(
      createPrismaStudyDraftCleanupRepository(database.client)
    ).cleanup({ batchSize: input.batchSize })
  } finally {
    await database.disconnect()
  }
  process.stdout.write(
    `${JSON.stringify({
      event: 'study.expired_drafts.cleaned',
      batchSize: input.batchSize,
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
    })}\n`
  )
}

void run().catch(() => {
  process.stderr.write(
    `${JSON.stringify({ event: 'study.expired_drafts.cleanup_failed' })}\n`
  )
  process.exitCode = 1
})

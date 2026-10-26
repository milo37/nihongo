import 'dotenv/config'
import { z } from 'zod'
import { parseApiEnvironment } from '../config/env.js'
import { createDatabaseRuntime } from '../db/database.js'
import {
  assertSafeDevelopmentDatabase,
  assertSafeTestDatabase
} from '../db/databaseTargetGuard.js'
import {
  createPrismaStudySessionCleanupRepository,
  type StudySessionCleanupBatchResult
} from './studySessionCleanupRepository.js'
import {
  createStudySessionCleanupService,
  DEFAULT_STUDY_SESSION_CLEANUP_BATCH_SIZE,
  MAX_STUDY_SESSION_CLEANUP_BATCH_SIZE
} from './studySessionCleanupService.js'

const run = async (): Promise<void> => {
  const input = z
    .object({
      batchSize: z.coerce
        .number()
        .int()
        .min(1)
        .max(MAX_STUDY_SESSION_CLEANUP_BATCH_SIZE)
        .default(DEFAULT_STUDY_SESSION_CLEANUP_BATCH_SIZE),
      confirmation: z.literal('DELETE_EXPIRED_GUEST_STUDY_DATA')
    })
    .strict()
    .parse({
      batchSize: process.env.STUDY_CLEANUP_BATCH_SIZE,
      confirmation: process.env.STUDY_CLEANUP_CONFIRM
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
  let result: StudySessionCleanupBatchResult
  try {
    await database.checkReadiness()
    result = await createStudySessionCleanupService(
      createPrismaStudySessionCleanupRepository(database.client)
    ).cleanup({ batchSize: input.batchSize })
  } finally {
    await database.disconnect()
  }
  process.stdout.write(
    `${JSON.stringify({
      event: 'study.expired_guest_data.cleaned',
      batchSize: input.batchSize,
      deletedGuestPrincipalCount: result.deletedGuestPrincipalCount,
      deletedIdempotencyRecordCount: result.deletedIdempotencyRecordCount,
      deletedStudySessionCount: result.deletedStudySessionCount,
      guestPrincipalBatchLimitReached: result.guestPrincipalBatchLimitReached,
      idempotencyRecordBatchLimitReached:
        result.idempotencyRecordBatchLimitReached,
      studySessionBatchLimitReached: result.studySessionBatchLimitReached
    })}\n`
  )
}

void run().catch(() => {
  process.stderr.write(
    `${JSON.stringify({ event: 'study.expired_guest_data.cleanup_failed' })}\n`
  )
  process.exitCode = 1
})

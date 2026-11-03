import 'dotenv/config'
import { runStudyCleanupCommand } from './studyCleanupCommandRunner.js'
import { createPrismaStudySessionCleanupRepository } from './studySessionCleanupRepository.js'
import {
  createStudySessionCleanupService,
  DEFAULT_STUDY_SESSION_CLEANUP_BATCH_SIZE,
  MAX_STUDY_SESSION_CLEANUP_BATCH_SIZE
} from './studySessionCleanupService.js'

runStudyCleanupCommand({
  batchSizeVariable: 'STUDY_CLEANUP_BATCH_SIZE',
  confirmationVariable: 'STUDY_CLEANUP_CONFIRM',
  confirmation: 'DELETE_EXPIRED_GUEST_STUDY_DATA',
  defaultBatchSize: DEFAULT_STUDY_SESSION_CLEANUP_BATCH_SIZE,
  maxBatchSize: MAX_STUDY_SESSION_CLEANUP_BATCH_SIZE,
  successEvent: 'study.expired_guest_data.cleaned',
  failureEvent: 'study.expired_guest_data.cleanup_failed',
  cleanup: async (client, batchSize) =>
    await createStudySessionCleanupService(
      createPrismaStudySessionCleanupRepository(client)
    ).cleanup({ batchSize }),
  describe: (result) => ({
    deletedGuestPrincipalCount: result.deletedGuestPrincipalCount,
    deletedIdempotencyRecordCount: result.deletedIdempotencyRecordCount,
    deletedStudySessionCount: result.deletedStudySessionCount,
    guestPrincipalBatchLimitReached: result.guestPrincipalBatchLimitReached,
    idempotencyRecordBatchLimitReached:
      result.idempotencyRecordBatchLimitReached,
    studySessionBatchLimitReached: result.studySessionBatchLimitReached
  })
})

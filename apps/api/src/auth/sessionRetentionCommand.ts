import 'dotenv/config'
import { runStudyCleanupCommand } from '../study/studyCleanupCommandRunner.js'
import {
  DEFAULT_EXPIRED_SESSION_BATCH_SIZE,
  deleteExpiredSessions,
  MAX_EXPIRED_SESSION_BATCH_SIZE
} from './sessionRetention.js'

runStudyCleanupCommand({
  batchSizeVariable: 'EXPIRED_SESSION_CLEANUP_BATCH_SIZE',
  confirmationVariable: 'EXPIRED_SESSION_CLEANUP_CONFIRM',
  confirmation: 'DELETE_EXPIRED_SESSIONS',
  defaultBatchSize: DEFAULT_EXPIRED_SESSION_BATCH_SIZE,
  maxBatchSize: MAX_EXPIRED_SESSION_BATCH_SIZE,
  dryRunVariable: 'EXPIRED_SESSION_CLEANUP_DRY_RUN',
  successEvent: 'auth.expired_sessions.deleted',
  failureEvent: 'auth.expired_sessions.cleanup_failed',
  allowProduction: true,
  cleanup: async (client, batchSize, dryRun) =>
    await deleteExpiredSessions(client, { batchSize, dryRun }),
  describe: (result) => ({
    eligibleCount: result.eligibleCount,
    deletedCount: result.deletedCount,
    hasMore: result.hasMore
  })
})

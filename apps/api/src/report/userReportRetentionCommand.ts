import 'dotenv/config'
import { runStudyCleanupCommand } from '../study/studyCleanupCommandRunner.js'
import {
  DEFAULT_USER_REPORT_RETENTION_BATCH_SIZE,
  MAX_USER_REPORT_RETENTION_BATCH_SIZE,
  redactExpiredUserReportDescriptions
} from './userReportRetention.js'

runStudyCleanupCommand({
  batchSizeVariable: 'USER_REPORT_RETENTION_BATCH_SIZE',
  confirmationVariable: 'USER_REPORT_RETENTION_CONFIRM',
  confirmation: 'REDACT_EXPIRED_USER_REPORTS',
  defaultBatchSize: DEFAULT_USER_REPORT_RETENTION_BATCH_SIZE,
  maxBatchSize: MAX_USER_REPORT_RETENTION_BATCH_SIZE,
  dryRunVariable: 'USER_REPORT_RETENTION_DRY_RUN',
  successEvent: 'report.expired_descriptions.redacted',
  failureEvent: 'report.expired_descriptions.redaction_failed',
  cleanup: async (client, batchSize, dryRun) =>
    await redactExpiredUserReportDescriptions(client, { batchSize, dryRun }),
  describe: (result) => ({
    eligibleCount: result.eligibleCount,
    redactedCount: result.redactedCount,
    hasMore: result.hasMore
  })
})

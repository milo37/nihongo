import 'dotenv/config'
import { parseApiEnvironment } from '../config/env.js'
import { createDatabaseRuntime } from '../db/database.js'
import { parseReviewReconciliationCommandInput } from './reviewReconciliationCommandConfig.js'
import {
  createReviewReconciliationFailureLog,
  createReviewReconciliationSuccessLog
} from './reviewReconciliationLog.js'
import { createPrismaReviewReconciliationRepository } from './reviewReconciliationRepository.js'
import { createReviewReconciliationService } from './reviewReconciliationService.js'
import { assertSafeReviewReconciliationTarget } from './reviewReconciliationTargetGuard.js'

const run = async (): Promise<void> => {
  const input = parseReviewReconciliationCommandInput(process.env)
  const environment = parseApiEnvironment(process.env)
  assertSafeReviewReconciliationTarget({
    databaseUrl: environment.DATABASE_URL,
    nodeEnvironment: environment.NODE_ENV,
    productionDatabaseUrl: process.env.PRODUCTION_DATABASE_URL
  })
  const database = createDatabaseRuntime(environment.DATABASE_URL)

  try {
    await database.checkReadiness()
    const service = createReviewReconciliationService(
      createPrismaReviewReconciliationRepository(database.client)
    )
    const result = await service.reconcile({ batchSize: input.batchSize })
    process.stdout.write(
      `${JSON.stringify(
        createReviewReconciliationSuccessLog(input.batchSize, result)
      )}\n`
    )
    if (result.mismatchWrongNoteCount > 0) {
      process.exitCode = 1
    }
  } finally {
    await database.disconnect()
  }
}

void run().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify(createReviewReconciliationFailureLog(error))}\n`
  )
  process.exitCode = 1
})

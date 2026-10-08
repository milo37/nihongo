import 'dotenv/config'
import { parseApiEnvironment } from '../config/env.js'
import { createDatabaseRuntime } from '../db/database.js'
import { parseStudyDraftCleanupCommandInput } from './studyDraftCleanupCommandConfig.js'
import {
  createStudyDraftCleanupFailureLog,
  createStudyDraftCleanupSuccessLog
} from './studyDraftCleanupLog.js'
import { createPrismaStudyDraftCleanupRepository } from './studyDraftCleanupRepository.js'
import { createStudyDraftCleanupService } from './studyDraftCleanupService.js'
import { assertSafeStudySessionCleanupTarget } from './studySessionCleanupTargetGuard.js'

const run = async (): Promise<void> => {
  const input = parseStudyDraftCleanupCommandInput(process.env)
  const environment = parseApiEnvironment(process.env)
  assertSafeStudySessionCleanupTarget({
    databaseUrl: environment.DATABASE_URL,
    nodeEnvironment: environment.NODE_ENV,
    productionDatabaseUrl: process.env.PRODUCTION_DATABASE_URL
  })
  const database = createDatabaseRuntime(environment.DATABASE_URL)

  try {
    await database.checkReadiness()
    const result = await createStudyDraftCleanupService(
      createPrismaStudyDraftCleanupRepository(database.client)
    ).cleanup(input)
    process.stdout.write(
      `${JSON.stringify(
        createStudyDraftCleanupSuccessLog(input.batchSize, result)
      )}\n`
    )
  } finally {
    await database.disconnect()
  }
}

void run().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify(createStudyDraftCleanupFailureLog(error))}\n`
  )
  process.exitCode = 1
})

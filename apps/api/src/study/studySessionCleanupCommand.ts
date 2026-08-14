import 'dotenv/config'
import { parseApiEnvironment } from '../config/env.js'
import { createDatabaseRuntime } from '../db/database.js'
import { parseStudySessionCleanupCommandInput } from './studySessionCleanupCommandConfig.js'
import { createPrismaStudySessionCleanupRepository } from './studySessionCleanupRepository.js'
import { createStudySessionCleanupService } from './studySessionCleanupService.js'
import { assertSafeStudySessionCleanupTarget } from './studySessionCleanupTargetGuard.js'

const run = async (): Promise<void> => {
  const input = parseStudySessionCleanupCommandInput(process.env)
  const environment = parseApiEnvironment(process.env)
  assertSafeStudySessionCleanupTarget({
    databaseUrl: environment.DATABASE_URL,
    nodeEnvironment: environment.NODE_ENV,
    productionDatabaseUrl: process.env.PRODUCTION_DATABASE_URL
  })
  const database = createDatabaseRuntime(environment.DATABASE_URL)

  try {
    await database.checkReadiness()
    const service = createStudySessionCleanupService(
      createPrismaStudySessionCleanupRepository(database.client)
    )
    const result = await service.cleanup({ batchSize: input.batchSize })
    process.stdout.write(
      `${JSON.stringify({
        event: 'study.expired_guest_data.cleaned',
        batchSize: input.batchSize,
        ...result
      })}\n`
    )
  } finally {
    await database.disconnect()
  }
}

void run().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({
      event: 'study.expired_guest_data.cleanup_failed',
      errorName: error instanceof Error ? error.name : 'UnknownError'
    })}\n`
  )
  process.exitCode = 1
})

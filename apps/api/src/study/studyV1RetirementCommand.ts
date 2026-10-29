import 'dotenv/config'
import { z } from 'zod'
import { parseApiEnvironment } from '../config/env.js'
import { createDatabaseRuntime } from '../db/database.js'
import { createPrismaStudyV1RetirementRepository } from './studyV1RetirementRepository.js'
import { createStudyV1RetirementClient } from './studyV1RetirementClient.js'

const run = async (): Promise<void> => {
  const sessionIds = z
    .array(z.uuid())
    .min(1)
    .max(500)
    .parse(process.env.STUDY_V1_RETIRE_SESSION_IDS?.split(','))
  const environment = parseApiEnvironment(process.env)
  const retirementClient = createStudyV1RetirementClient({
    nodeEnvironment: environment.NODE_ENV,
    runtimeDatabaseUrl: environment.DATABASE_URL,
    migrationDatabaseUrl: process.env.PHASE7_MIGRATION_DATABASE_URL,
    productionDatabaseUrl: process.env.PRODUCTION_DATABASE_URL
  })
  const database = createDatabaseRuntime(environment.DATABASE_URL, {
    migrationProfile: 'current',
    startupRole: 'nihongo_app'
  })
  try {
    await database.checkReadiness()
    const result =
      await createPrismaStudyV1RetirementRepository(retirementClient).retire(
        sessionIds
      )
    process.stdout.write(
      `${JSON.stringify({ event: 'study.v1.retirement.completed', ...result })}\n`
    )
  } finally {
    await Promise.all([database.disconnect(), retirementClient.$disconnect()])
  }
}

void run().catch(() => {
  process.stderr.write(
    `${JSON.stringify({ event: 'study.v1.retirement.failed' })}\n`
  )
  process.exitCode = 1
})

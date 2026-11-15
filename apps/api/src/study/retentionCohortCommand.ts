import dotenv from 'dotenv'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { createDatabaseRuntime } from '../db/database.js'
import {
  assertExactProductionDatabaseTarget,
  assertSafeDevelopmentDatabase,
  assertSafeTestDatabase
} from '../db/databaseTargetGuard.js'
import { countRetentionCohorts } from './retentionCohort.js'

export const parseRetentionCohortCommandInput = (source: NodeJS.ProcessEnv) => {
  const input = z
    .object({
      databaseUrl: z.string().min(1),
      productionDatabaseUrl: z.string().min(1).optional(),
      environment: z.enum(['TEST', 'DEVELOPMENT', 'PRODUCTION']),
      confirmation: z.literal('COUNT_RETENTION_COHORTS')
    })
    .strict()
    .parse({
      databaseUrl: source.DATABASE_URL,
      productionDatabaseUrl: source.PRODUCTION_DATABASE_URL,
      environment: source.RETENTION_ENVIRONMENT,
      confirmation: source.RETENTION_CONFIRM
    })
  const target = {
    databaseUrl: input.databaseUrl,
    productionDatabaseUrl: input.productionDatabaseUrl
  }
  if (input.environment === 'TEST')
    assertSafeTestDatabase({ ...target, nodeEnvironment: 'test' })
  else if (input.environment === 'DEVELOPMENT')
    assertSafeDevelopmentDatabase({ ...target, nodeEnvironment: 'development' })
  else assertExactProductionDatabaseTarget(target)
  return input
}

/** #1042: one daily run; exit code 0 when the counts are written. */
export const runRetentionCohortCommand = async (
  source: NodeJS.ProcessEnv,
  now: () => Date = () => new Date()
): Promise<0 | 1> => {
  try {
    const input = parseRetentionCohortCommandInput(source)
    const database = createDatabaseRuntime(input.databaseUrl, {
      migrationProfile: 'current',
      startupRole: 'nihongo_app'
    })
    let written: number
    try {
      await database.checkReadiness()
      ;({ written } = await countRetentionCohorts(database.client, now()))
    } finally {
      await database.disconnect()
    }
    process.stdout.write(
      `${JSON.stringify({ event: 'study.retention_cohort.counted', written })}\n`
    )
    return 0
  } catch {
    process.stderr.write(
      `${JSON.stringify({ event: 'study.retention_cohort.failed' })}\n`
    )
    return 1
  }
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  dotenv.config({ quiet: true })
  void runRetentionCohortCommand(process.env).then((code) => {
    process.exitCode = code
  })
}

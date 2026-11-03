import { z } from 'zod'
import { parseApiEnvironment } from '../config/env.js'
import { createDatabaseRuntime, type DatabaseRuntime } from '../db/database.js'
import {
  assertSafeDevelopmentDatabase,
  assertSafeTestDatabase
} from '../db/databaseTargetGuard.js'

/** Settings that differ between the batch cleanup commands. */
export interface StudyCleanupCommandSettings<Result> {
  batchSizeVariable: string
  confirmationVariable: string
  confirmation: string
  defaultBatchSize: number
  maxBatchSize: number
  successEvent: string
  failureEvent: string
  cleanup: (
    client: DatabaseRuntime['client'],
    batchSize: number
  ) => Promise<Result>
  describe: (result: Result) => Record<string, unknown>
}

const run = async <Result>(
  settings: StudyCleanupCommandSettings<Result>
): Promise<void> => {
  const input = z
    .object({
      batchSize: z.coerce
        .number()
        .int()
        .min(1)
        .max(settings.maxBatchSize)
        .default(settings.defaultBatchSize),
      confirmation: z.literal(settings.confirmation)
    })
    .strict()
    .parse({
      batchSize: process.env[settings.batchSizeVariable],
      confirmation: process.env[settings.confirmationVariable]
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
  let result: Result
  try {
    await database.checkReadiness()
    result = await settings.cleanup(database.client, input.batchSize)
  } finally {
    await database.disconnect()
  }
  process.stdout.write(
    `${JSON.stringify({
      event: settings.successEvent,
      batchSize: input.batchSize,
      ...settings.describe(result)
    })}\n`
  )
}

export const runStudyCleanupCommand = <Result>(
  settings: StudyCleanupCommandSettings<Result>
): void => {
  void run(settings).catch(() => {
    process.stderr.write(
      `${JSON.stringify({ event: settings.failureEvent })}\n`
    )
    process.exitCode = 1
  })
}

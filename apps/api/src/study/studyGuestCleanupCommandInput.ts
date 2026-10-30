import { z } from 'zod'
import {
  assertExactProductionDatabaseTarget,
  assertSafeDevelopmentDatabase,
  assertSafeTestDatabase
} from '../db/databaseTargetGuard.js'

const inputSchema = z
  .object({
    databaseUrl: z.string().min(1),
    productionDatabaseUrl: z.string().min(1).optional(),
    environment: z.enum(['TEST', 'DEVELOPMENT', 'PRODUCTION']),
    dryRun: z.enum(['true', 'false']).default('true'),
    confirmation: z.string().optional(),
    batchSize: z.coerce.number().int().min(1).max(500).default(100),
    maxBatches: z.coerce.number().int().min(1).max(100).default(10),
    maxDurationMs: z.coerce.number().int().min(1).max(300_000).default(30_000)
  })
  .strict()

export const parseStudyGuestCleanupCommandInput = (
  source: NodeJS.ProcessEnv
) => {
  const input = inputSchema.parse({
    databaseUrl: source.GUEST_CLEANUP_DATABASE_URL,
    productionDatabaseUrl: source.PRODUCTION_DATABASE_URL,
    environment: source.GUEST_CLEANUP_ENVIRONMENT,
    dryRun: source.GUEST_CLEANUP_DRY_RUN,
    confirmation: source.GUEST_CLEANUP_CONFIRM,
    batchSize: source.GUEST_CLEANUP_BATCH_SIZE,
    maxBatches: source.GUEST_CLEANUP_MAX_BATCHES,
    maxDurationMs: source.GUEST_CLEANUP_MAX_DURATION_MS
  })
  if (
    input.dryRun === 'false' &&
    input.confirmation !== 'CLEANUP_EXPIRED_GUEST_DATA'
  ) {
    throw new Error('Guest cleanup confirmation is required.')
  }
  const target = {
    databaseUrl: input.databaseUrl,
    productionDatabaseUrl: input.productionDatabaseUrl
  }
  if (input.environment === 'TEST') {
    assertSafeTestDatabase({ ...target, nodeEnvironment: 'test' })
  } else if (input.environment === 'DEVELOPMENT') {
    assertSafeDevelopmentDatabase({ ...target, nodeEnvironment: 'development' })
  } else {
    assertExactProductionDatabaseTarget(target)
  }
  return {
    databaseUrl: input.databaseUrl,
    environment: input.environment,
    dryRun: input.dryRun === 'true',
    batchSize: input.batchSize,
    maxBatches: input.maxBatches,
    maxDurationMs: input.maxDurationMs
  }
}

import dotenv from 'dotenv'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { createRoleDatabaseRuntime } from '../db/database.js'
import {
  assertExactProductionDatabaseTarget,
  assertSafeDevelopmentDatabase,
  assertSafeTestDatabase
} from '../db/databaseTargetGuard.js'
import {
  createSsoAccountErasureWorker,
  runSsoAccountErasureBatch,
  ssoAccountErasureEnvironmentSchema,
  type SsoAccountErasureRunResult
} from './ssoAccountRepository.js'
import {
  runSsoProviderRevokeBatch,
  unavailableSsoProviderRevokeAdapter,
  type SsoProviderRevokeAdapter,
  type SsoProviderRevokeRunResult
} from './ssoProviderRevoke.js'

const PROVIDER_LEASE_SECONDS = 300

export const parseSsoAccountErasureCommandInput = (
  source: NodeJS.ProcessEnv
) => {
  const input = z
    .object({
      databaseUrl: z.string().min(1),
      productionDatabaseUrl: z.string().min(1),
      environment: ssoAccountErasureEnvironmentSchema,
      batchSize: z.coerce.number().int().min(1).max(100).default(20),
      confirmation: z.literal('ERASE_DELETION_PENDING_ACCOUNTS')
    })
    .strict()
    .parse({
      databaseUrl: source.ERASURE_WORKER_DATABASE_URL,
      productionDatabaseUrl: source.PRODUCTION_DATABASE_URL,
      environment: source.ACCOUNT_ERASURE_ENVIRONMENT,
      batchSize: source.ACCOUNT_ERASURE_BATCH_SIZE,
      confirmation: source.ACCOUNT_ERASURE_CONFIRM
    })
  const target = {
    databaseUrl: input.databaseUrl,
    productionDatabaseUrl: input.productionDatabaseUrl
  }
  if (input.environment === 'TEST')
    assertSafeTestDatabase({ ...target, nodeEnvironment: 'test' })
  else if (input.environment === 'DEVELOPMENT')
    assertSafeDevelopmentDatabase({
      ...target,
      nodeEnvironment: 'development'
    })
  else assertExactProductionDatabaseTarget(target)
  return input
}

export const runSsoAccountErasureCommand = async (
  source: NodeJS.ProcessEnv,
  // Production has no credentialed adapter yet, so it fails before any DB access.
  revoke?: SsoProviderRevokeAdapter
): Promise<0 | 1> => {
  try {
    // SET ROLE and the DB capability are checked again before queue access.
    const input = parseSsoAccountErasureCommandInput(source)
    if (input.environment === 'PRODUCTION' && revoke === undefined)
      throw new Error('Production provider revoke capability is absent.')
    const database = createRoleDatabaseRuntime(
      input.databaseUrl,
      'nihongo_erasure_worker'
    )
    let providers: SsoProviderRevokeRunResult
    let result: SsoAccountErasureRunResult
    try {
      const worker = createSsoAccountErasureWorker(database.client)
      providers = await runSsoProviderRevokeBatch(
        worker,
        revoke ?? unavailableSsoProviderRevokeAdapter,
        input.environment,
        input.batchSize,
        PROVIDER_LEASE_SECONDS
      )
      result = await runSsoAccountErasureBatch(
        worker,
        input.environment,
        input.batchSize
      )
    } finally {
      await database.disconnect()
    }
    process.stdout.write(
      `${JSON.stringify({ event: 'auth.account_erasure.ran', batchSize: input.batchSize, providers, ...result })}\n`
    )
    return providers.failed > 0 ||
      providers.unavailable > 0 ||
      providers.deferred > 0 ||
      providers.claimLimitReached ||
      result.failedIds.length > 0 ||
      result.providerCleanupPendingIds.length > 0 ||
      result.batchLimitReached
      ? 1
      : 0
  } catch {
    process.stderr.write(
      `${JSON.stringify({ event: 'auth.account_erasure.failed' })}\n`
    )
    return 1
  }
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  dotenv.config({ quiet: true })
  void runSsoAccountErasureCommand(process.env).then((code) => {
    process.exitCode = code
  })
}

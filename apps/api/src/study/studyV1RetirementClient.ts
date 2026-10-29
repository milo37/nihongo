import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../generated/prisma/client.js'
import {
  createPostgresStartupOptions,
  getPostgresSchema
} from '../db/databaseOptions.js'
import {
  assertSafePhase7MigrationDatabase,
  assertSafeTestDatabase
} from '../db/databaseTargetGuard.js'

interface RetirementConnectionInput {
  nodeEnvironment: string | undefined
  runtimeDatabaseUrl: string | undefined
  migrationDatabaseUrl: string | undefined
  productionDatabaseUrl: string | undefined
}

export const createStudyV1RetirementClient = (
  input: RetirementConnectionInput
): PrismaClient => {
  assertSafeTestDatabase({
    nodeEnvironment: input.nodeEnvironment,
    databaseUrl: input.runtimeDatabaseUrl,
    productionDatabaseUrl: input.productionDatabaseUrl
  })
  assertSafePhase7MigrationDatabase(input)
  if (!input.migrationDatabaseUrl)
    throw new Error('Retirement migration URL is required.')
  const schema = getPostgresSchema(input.migrationDatabaseUrl)
  if (!schema) throw new Error('Retirement schema is required.')
  const url = new URL(input.migrationDatabaseUrl)
  const allowed = new Set([
    'schema',
    'options',
    'sslmode',
    'sslrootcert',
    'sslcert',
    'sslkey'
  ])
  if ([...url.searchParams.keys()].some((key) => !allowed.has(key))) {
    throw new Error('Retirement connection override is not allowed.')
  }
  url.searchParams.delete('schema')
  url.searchParams.delete('options')
  const adapter = new PrismaPg(
    {
      connectionString: url.toString(),
      options: createPostgresStartupOptions(schema, 'nihongo_phase7_migration'),
      connectionTimeoutMillis: 3_000,
      query_timeout: 2_500,
      statement_timeout: 2_500,
      max: 1
    },
    { schema }
  )
  return new PrismaClient({ adapter })
}

import { Client } from 'pg'
import { z } from 'zod'
import { assertSafeMigrationDatabase } from './databaseTargetGuard.js'
import {
  createPostgresStartupOptions,
  getPostgresSchema
} from './databaseOptions.js'

export type OperatorEnvironment = 'TEST' | 'DEVELOPMENT' | 'PRODUCTION'

const targetSchema = z.object({
  NODE_ENV: z.enum(['test', 'development', 'production']),
  DEPLOYMENT_ENVIRONMENT: z
    .enum(['LOCAL', 'TEST', 'DEVELOPMENT', 'STAGING', 'PRODUCTION'])
    .optional(),
  MIGRATION_DATABASE_URL: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  PRODUCTION_DATABASE_URL: z.string().min(1)
})

// pg query parameters can override the URL identity validated by the guards.
const allowedParameters = new Set([
  'schema',
  'options',
  'sslmode',
  'sslrootcert',
  'sslcert',
  'sslkey'
])

/**
 * Validates an operator command's database target and builds its client.
 * Every target connects as the environment's migration login with the
 * nihongo_migration startup role. `allowStaging` lets one command also run on
 * a STAGING deployment, which uses the PRODUCTION database contract and so
 * reports the PRODUCTION environment (JLP-734).
 */
export const createOperatorDatabaseClient = (
  source: NodeJS.ProcessEnv,
  { allowStaging = false }: { readonly allowStaging?: boolean } = {}
): { client: Client; environment: OperatorEnvironment; schema: string } => {
  const input = targetSchema.parse(source)
  const environment: OperatorEnvironment =
    input.NODE_ENV === 'production'
      ? 'PRODUCTION'
      : input.NODE_ENV === 'test'
        ? 'TEST'
        : 'DEVELOPMENT'
  // Operator commands are defined for PRODUCTION only; STAGING is refused
  // like the account erasure command unless the command allows it.
  const deployment = input.DEPLOYMENT_ENVIRONMENT
  if (
    environment === 'PRODUCTION'
      ? deployment !== 'PRODUCTION' &&
        !(allowStaging && deployment === 'STAGING')
      : deployment !== undefined &&
        !(environment === 'TEST'
          ? deployment === 'TEST'
          : deployment === 'LOCAL' || deployment === 'DEVELOPMENT')
  ) {
    throw new Error('OPERATOR_ENVIRONMENT_INVALID')
  }
  assertSafeMigrationDatabase({
    nodeEnvironment: input.NODE_ENV,
    migrationDatabaseUrl: input.MIGRATION_DATABASE_URL,
    runtimeDatabaseUrl: input.DATABASE_URL,
    productionDatabaseUrl: input.PRODUCTION_DATABASE_URL
  })
  const schema = getPostgresSchema(input.MIGRATION_DATABASE_URL)
  if (!schema) throw new Error('OPERATOR_SCHEMA_INVALID')
  const url = new URL(input.MIGRATION_DATABASE_URL)
  if ([...url.searchParams.keys()].some((key) => !allowedParameters.has(key))) {
    throw new Error('OPERATOR_CONNECTION_OVERRIDE_INVALID')
  }
  url.searchParams.delete('schema')
  url.searchParams.delete('options')
  const client = new Client({
    connectionString: url.toString(),
    options: createPostgresStartupOptions(schema, 'nihongo_migration'),
    connectionTimeoutMillis: 5000,
    query_timeout: 15000,
    statement_timeout: 10000
  })
  return { client, environment, schema }
}

/** Runs one READ COMMITTED transaction; commits only when `commit` is true. */
export const runOperatorTransaction = async <T>(
  client: Client,
  work: (client: Client) => Promise<{ commit: boolean; value: T }>
): Promise<T> => {
  let transactionOpen = false
  try {
    await client.connect()
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED')
    transactionOpen = true
    await client.query("SET LOCAL lock_timeout = '5s'")
    const { commit, value } = await work(client)
    await client.query(commit ? 'COMMIT' : 'ROLLBACK')
    transactionOpen = false
    return value
  } catch (error: unknown) {
    if (transactionOpen) {
      try {
        await client.query('ROLLBACK')
      } catch {
        /* Preserve the failure without exposing database details. */
      }
    }
    throw error
  } finally {
    await client.end()
  }
}

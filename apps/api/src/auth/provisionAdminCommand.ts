import dotenv from 'dotenv'
import { Client } from 'pg'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { assertSafePhase7MigrationDatabase } from '../db/databaseTargetGuard.js'
import {
  createPostgresStartupOptions,
  getPostgresSchema
} from '../db/databaseOptions.js'

const inputSchema = z.object({
  NODE_ENV: z.enum(['test', 'development']),
  ADMIN_PROVISION_CONFIRM: z.literal('PROVISION_FIRST_GOOGLE_ADMIN'),
  ADMIN_PROVISION_USER_ID: z.uuid(),
  ADMIN_PROVISION_GOOGLE_SUBJECT: z
    .string()
    .min(1)
    .max(255)
    .refine(
      (value) =>
        value.trim() === value &&
        [...value].every((character) => {
          const code = character.codePointAt(0) ?? 0
          return code >= 32 && code !== 127
        })
    ),
  ADMIN_PROVISION_EXPECTED_GENERATION: z
    .string()
    .regex(/^[1-9][0-9]{0,9}$/u)
    .transform(Number)
    .pipe(z.number().int().min(1).max(2147483646)),
  PHASE7_MIGRATION_DATABASE_URL: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  PRODUCTION_DATABASE_URL: z.string().min(1),
  DEPLOYMENT_ENV: z.enum(['LOCAL', 'TEST', 'DEVELOPMENT']).optional()
})

export const runProvisionAdminCommand = async (
  source: NodeJS.ProcessEnv
): Promise<void> => {
  try {
    const input = inputSchema.parse(source)
    if (
      input.DEPLOYMENT_ENV !== undefined &&
      !(input.NODE_ENV === 'test'
        ? input.DEPLOYMENT_ENV === 'TEST'
        : input.DEPLOYMENT_ENV === 'LOCAL' ||
          input.DEPLOYMENT_ENV === 'DEVELOPMENT')
    ) {
      throw new Error('ADMIN_PROVISION_ENVIRONMENT_INVALID')
    }
    assertSafePhase7MigrationDatabase({
      nodeEnvironment: input.NODE_ENV,
      migrationDatabaseUrl: input.PHASE7_MIGRATION_DATABASE_URL,
      runtimeDatabaseUrl: input.DATABASE_URL,
      productionDatabaseUrl: input.PRODUCTION_DATABASE_URL
    })
    const schema = getPostgresSchema(input.PHASE7_MIGRATION_DATABASE_URL)
    if (!schema) throw new Error('ADMIN_PROVISION_SCHEMA_INVALID')
    const url = new URL(input.PHASE7_MIGRATION_DATABASE_URL)
    // pg query parameters can override the URL identity validated above.
    const allowedParameters = new Set([
      'schema',
      'options',
      'sslmode',
      'sslrootcert',
      'sslcert',
      'sslkey'
    ])
    if (
      [...url.searchParams.keys()].some((key) => !allowedParameters.has(key))
    ) {
      throw new Error('ADMIN_PROVISION_CONNECTION_OVERRIDE_INVALID')
    }
    url.searchParams.delete('schema')
    url.searchParams.delete('options')
    const client = new Client({
      connectionString: url.toString(),
      options: createPostgresStartupOptions(schema, 'nihongo_phase7_migration'),
      connectionTimeoutMillis: 5000,
      query_timeout: 15000,
      statement_timeout: 10000
    })
    let transactionOpen = false
    let generation: number | undefined
    try {
      await client.connect()
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED')
      transactionOpen = true
      await client.query("SET LOCAL lock_timeout = '5s'")
      const result = await client.query<{ authorityGeneration: number }>(
        'SELECT "phase7_bootstrap_first_google_admin"($1::uuid,$2::text,$3::integer,$4::text,$5::"AdminAuditEnvironment") AS "authorityGeneration"',
        [
          input.ADMIN_PROVISION_USER_ID,
          input.ADMIN_PROVISION_GOOGLE_SUBJECT,
          input.ADMIN_PROVISION_EXPECTED_GENERATION,
          schema,
          input.NODE_ENV === 'test' ? 'TEST' : 'DEVELOPMENT'
        ]
      )
      const returned = result.rows[0]?.authorityGeneration
      if (
        result.rows.length !== 1 ||
        returned !== input.ADMIN_PROVISION_EXPECTED_GENERATION + 1
      ) {
        throw new Error('ADMIN_PROVISION_RESULT_INVALID')
      }
      await client.query('COMMIT')
      transactionOpen = false
      generation = returned
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
    process.stdout.write(
      `${JSON.stringify({ event: 'first_google_admin_provisioned', authorityGeneration: generation })}\n`
    )
  } catch {
    process.stderr.write(
      `${JSON.stringify({ event: 'first_google_admin_provision_failed' })}\n`
    )
    process.exitCode = 1
  }
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  dotenv.config({ quiet: true })
  void runProvisionAdminCommand(process.env)
}

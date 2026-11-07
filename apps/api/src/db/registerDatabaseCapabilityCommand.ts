import dotenv from 'dotenv'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { DATABASE_CAPABILITY_SQL } from './databaseCapability.js'
import {
  createOperatorDatabaseClient,
  runOperatorTransaction
} from './operatorDatabase.js'

const inputSchema = z.object({
  DATABASE_CAPABILITY_CONFIRM: z
    .literal('REGISTER_DATABASE_CAPABILITY')
    .optional()
})

const write = (
  stream: NodeJS.WriteStream,
  value: Record<string, unknown>
): void => {
  stream.write(`${JSON.stringify(value)}\n`)
}

/**
 * Records which environment this database serves, so admin re-authentication
 * and commands accept it. Without DATABASE_CAPABILITY_CONFIRM it only reports
 * the current row.
 */
export const runRegisterDatabaseCapabilityCommand = async (
  source: NodeJS.ProcessEnv
): Promise<void> => {
  try {
    const input = inputSchema.parse(source)
    const execute = input.DATABASE_CAPABILITY_CONFIRM !== undefined
    // STAGING runs the PRODUCTION database contract and its API audits as
    // PRODUCTION, so its capability row is PRODUCTION too (JLP-734).
    const { client, environment } = createOperatorDatabaseClient(source, {
      allowStaging: true
    })
    const event = await runOperatorTransaction<Record<string, unknown>>(
      client,
      async (database) => {
        const current = await database.query<{ environment: string }>(
          'SELECT "environment"::text AS "environment" FROM "DatabaseCapability" WHERE "id" = 1'
        )
        const registered = current.rows[0]?.environment ?? null
        if (!execute) {
          return {
            commit: false,
            value: {
              event: 'database_capability_dry_run',
              environment,
              registered
            }
          }
        }
        const result = await database.query(DATABASE_CAPABILITY_SQL, [
          environment
        ])
        if (result.rowCount !== 1) {
          throw new Error('DATABASE_CAPABILITY_TARGET_INVALID')
        }
        return {
          commit: true,
          value: {
            event: 'database_capability_registered',
            environment,
            previous: registered,
            occurredAt: new Date().toISOString()
          }
        }
      }
    )
    write(process.stdout, event)
  } catch {
    write(process.stderr, { event: 'database_capability_register_failed' })
    process.exitCode = 1
  }
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  dotenv.config({ quiet: true })
  void runRegisterDatabaseCapabilityCommand(process.env)
}

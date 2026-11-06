import dotenv from 'dotenv'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import {
  createOperatorDatabaseClient,
  runOperatorTransaction
} from '../db/operatorDatabase.js'

const inputSchema = z.object({
  ADMIN_PROVISION_EMAIL: z.email().max(320),
  ADMIN_PROVISION_CONFIRM: z.literal('PROVISION_FIRST_GOOGLE_ADMIN').optional(),
  ADMIN_PROVISION_EXPECTED_GENERATION: z
    .string()
    .regex(/^[1-9][0-9]{0,9}$/u)
    .transform(Number)
    .pipe(z.number().int().min(1).max(2147483646))
    .optional()
})

interface TargetRow {
  readonly userId: string
  readonly role: string
  readonly accountStatus: string
  readonly deleted: boolean
  readonly authorityGeneration: number
  readonly googleSubjects: string[]
  readonly activeAdminCount: number
}

// The migration role reads User/Account only as their owner, then returns to
// nihongo_migration because the bootstrap function requires that caller.
const TARGET_SQL = `SELECT u."id"::text AS "userId", u."role"::text AS "role",
    u."accountStatus"::text AS "accountStatus",
    u."deletedAt" IS NOT NULL AS "deleted",
    u."authorityGeneration" AS "authorityGeneration",
    ARRAY(SELECT a."accountId" FROM "Account" a
      WHERE a."userId" = u."id" AND a."providerId" = 'google'
      ORDER BY a."id") AS "googleSubjects",
    (SELECT count(*)::integer FROM "User" admin
      WHERE admin."role" = 'ADMIN' AND admin."accountStatus" = 'ACTIVE')
      AS "activeAdminCount"
  FROM "User" u WHERE lower(u."email") = lower($1)`

const BOOTSTRAP_SQL =
  'SELECT "bootstrap_first_google_admin"($1::uuid,$2::text,$3::integer,$4::text,$5::"AdminAuditEnvironment") AS "authorityGeneration"'

const refusal = (target: TargetRow | undefined): string | null => {
  if (!target) return 'TARGET_NOT_FOUND'
  if (target.activeAdminCount > 0) return 'ADMIN_ALREADY_EXISTS'
  if (
    target.role !== 'USER' ||
    target.accountStatus !== 'ACTIVE' ||
    target.deleted
  )
    return 'TARGET_NOT_ACTIVE_USER'
  if (target.googleSubjects.length !== 1) return 'GOOGLE_LINK_REQUIRED'
  return null
}

const write = (
  stream: NodeJS.WriteStream,
  value: Record<string, unknown>
): void => {
  stream.write(`${JSON.stringify(value)}\n`)
}

/**
 * Makes the first ADMIN from a server shell, never over HTTP. Without
 * ADMIN_PROVISION_CONFIRM it only reports the target. With it, the
 * authorityGeneration from that report must still match.
 */
export const runProvisionAdminCommand = async (
  source: NodeJS.ProcessEnv
): Promise<void> => {
  try {
    const input = inputSchema.parse(source)
    const expectedGeneration = input.ADMIN_PROVISION_EXPECTED_GENERATION
    const execute = input.ADMIN_PROVISION_CONFIRM !== undefined
    if (execute && expectedGeneration === undefined) {
      throw new Error('ADMIN_PROVISION_GENERATION_REQUIRED')
    }
    const { client, environment, schema } = createOperatorDatabaseClient(source)
    const emailSha256 = createHash('sha256')
      .update(input.ADMIN_PROVISION_EMAIL.toLowerCase())
      .digest('hex')
    const report = await runOperatorTransaction<
      { failed: boolean } & Record<string, unknown>
    >(client, async (database) => {
      await database.query('SET LOCAL ROLE nihongo_owner')
      const found = await database.query<TargetRow>(TARGET_SQL, [
        input.ADMIN_PROVISION_EMAIL
      ])
      await database.query('SET LOCAL ROLE nihongo_migration')
      if (found.rows.length > 1) {
        throw new Error('ADMIN_PROVISION_TARGET_AMBIGUOUS')
      }
      const target = found.rows[0]
      const reason = refusal(target)
      const identity = target
        ? {
            targetUserId: target.userId,
            authorityGeneration: target.authorityGeneration
          }
        : {}
      if (!target || reason !== null || !execute) {
        return {
          commit: false,
          value: {
            failed: execute,
            event: execute
              ? 'first_google_admin_provision_failed'
              : 'first_google_admin_dry_run',
            environment,
            emailSha256,
            eligible: reason === null,
            ...(reason === null ? {} : { reason }),
            ...identity
          }
        }
      }
      const result = await database.query<{ authorityGeneration: number }>(
        BOOTSTRAP_SQL,
        [
          target.userId,
          target.googleSubjects[0],
          expectedGeneration,
          schema,
          environment
        ]
      )
      const returned = result.rows[0]?.authorityGeneration
      if (
        result.rows.length !== 1 ||
        returned !== (expectedGeneration ?? 0) + 1
      ) {
        throw new Error('ADMIN_PROVISION_RESULT_INVALID')
      }
      return {
        commit: true,
        value: {
          failed: false,
          event: 'first_google_admin_provisioned',
          environment,
          emailSha256,
          targetUserId: target.userId,
          authorityGeneration: returned,
          occurredAt: new Date().toISOString()
        }
      }
    })
    const { failed, ...event } = report
    write(failed ? process.stderr : process.stdout, event)
    if (failed) process.exitCode = 1
  } catch {
    write(process.stderr, { event: 'first_google_admin_provision_failed' })
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

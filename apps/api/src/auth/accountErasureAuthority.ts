import { createHash, randomUUID } from 'node:crypto'
import type { Prisma, PrismaClient } from '../generated/prisma/client.js'
import { adminAuditContentDigest } from '../admin/adminRepositoryCommon.js'
import {
  accountFreshProofIsValid,
  accountSessionContext
} from './ssoAccountAuthority.js'
import { deletionScheduledAtSql, erasureDueSql } from './erasureGrace.js'

/**
 * Account erasure in the API transaction (#504 P7 PR4a).
 *
 * This keeps erase_user(_unchecked), the User delete trigger
 * anonymize_question_creator_on_user_delete, complete_sso_account_erasure,
 * list_sso_account_erasures, sso_account_erasure_status,
 * redact_expired_report_descriptions and (#504 P7 PR4b-2)
 * request_sso_account_erasure step for step: the same checks, the
 * same lock order, the same tombstones and audit rows, and the same SQLSTATE
 * and message on failure. Failures are raised inside PostgreSQL so the existing
 * error mapping sees the same database error. The database allows the
 * nihongo_app writes only for a User whose erasure is confirmed
 * (user_erasure_confirmed).
 */

type Transaction = Prisma.TransactionClient
type Queryable = Pick<PrismaClient, '$queryRawUnsafe' | '$executeRawUnsafe'>
export type ErasureEnvironment = 'TEST' | 'DEVELOPMENT' | 'PRODUCTION'

/** Marks the TEST-only direct erasure of one User in this transaction. */
const TEST_ERASURE_SETTING = 'nihongo.test_erasure_user'

const OPEN_VERSION_STATUSES = `('DRAFT','IN_REVIEW','CHANGES_REQUESTED','APPROVED')`

/** Not started: no provider cleanup claim yet and every provider PENDING. */
const ERASURE_NOT_STARTED = `r."leaseToken" IS NULL
  AND r."leaseExpiresAt" IS NULL
  AND r."activeProvider" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(r."providerCleanup") AS x
    WHERE x->>'status' IS DISTINCT FROM 'PENDING'
  )`

const raise = async (
  client: Pick<PrismaClient, '$executeRawUnsafe'>,
  sqlState: '22023' | '23514' | '42501',
  message: string
): Promise<never> => {
  await client.$executeRawUnsafe(
    `DO $raise$ BEGIN RAISE EXCEPTION USING ERRCODE = '${sqlState}', MESSAGE = '${message}'; END $raise$`
  )
  throw new Error('PostgreSQL did not raise the erasure failure.')
}

const requireCapability = async (
  client: Pick<PrismaClient, '$executeRawUnsafe'>,
  environment: ErasureEnvironment
): Promise<void> => {
  // The check returns void, which Prisma cannot read as a column.
  await client.$executeRawUnsafe(
    `SELECT "require_database_capability"($1::"AdminAuditEnvironment")`,
    environment
  )
}

const requireTargetDatabase = async (
  client: Queryable,
  environment: ErasureEnvironment,
  message: string
): Promise<void> => {
  const rows = await client.$queryRawUnsafe<Array<{ matches: boolean }>>(
    `SELECT NOT (($1 = 'TEST' AND current_database() !~ '_test$')
       OR ($1 = 'DEVELOPMENT' AND current_database() !~ '_dev$')) AS matches`,
    environment
  )
  if (rows[0]?.matches !== true) await raise(client, '42501', message)
}

// #504 P8-1: the baseline starts with V1 issuance active; the activation
// checks the SQL made are gone.
const subjectActorDigest = (userId: string): string =>
  createHash('sha256')
    .update(
      Buffer.concat([
        Buffer.from('nihongo-actor-subject-v1', 'utf8'),
        Buffer.from([0]),
        Buffer.from(userId.toLowerCase(), 'utf8')
      ])
    )
    .digest('hex')

interface AuditRow {
  readonly afterRowVersion: number | null
  readonly afterState: string | null
  readonly beforeRowVersion: number | null
  readonly beforeState: string | null
  readonly changedFields: readonly string[]
  readonly environment: ErasureEnvironment
  readonly metadata: Record<string, unknown>
  readonly occurredAt: Date
  readonly operationId: string
  readonly requestId: string
  readonly targetId: string
  readonly targetType: 'QUESTION_VERSION' | 'USER_ERASURE'
}

const insertSystemAudit = async (
  transaction: Transaction,
  row: AuditRow
): Promise<void> => {
  const contentDigest = adminAuditContentDigest({
    operationId: row.operationId,
    command: 'AUTHOR_ERASURE_ABANDON',
    targetType: row.targetType,
    targetId: row.targetId,
    beforeState: row.beforeState,
    afterState: row.afterState,
    beforeRowVersion: row.beforeRowVersion,
    afterRowVersion: row.afterRowVersion,
    changedFields: row.changedFields,
    metadata: row.metadata
  } as Parameters<typeof adminAuditContentDigest>[0])
  await transaction.$executeRawUnsafe(
    `INSERT INTO "AdminAuditLog" (
       "command", "targetType", "targetId", "actorKind", "actorUserId",
       "actorId", "actorRole", "actorLabel", "actorSystemLabel",
       "beforeState", "afterState", "beforeRowVersion", "afterRowVersion",
       "changedFields", "metadata", "contentDigest", "operationId",
       "requestId", "environment", "occurredAt"
     ) VALUES (
       'AUTHOR_ERASURE_ABANDON', $1::"AdminAuditTargetType", $2::uuid,
       'SYSTEM', NULL, NULL, 'SYSTEM', NULL, 'ACCOUNT_ERASURE',
       $3::text, $4::text, $5::integer, $6::integer, $7::jsonb, $8::jsonb,
       $9, $10::uuid, $11::uuid, $12::"AdminAuditEnvironment",
       $13::timestamptz
     )`,
    row.targetType,
    row.targetId,
    row.beforeState,
    row.afterState,
    row.beforeRowVersion,
    row.afterRowVersion,
    JSON.stringify(row.changedFields),
    JSON.stringify(row.metadata),
    contentDigest,
    row.operationId,
    row.requestId,
    row.environment,
    row.occurredAt
  )
}

/** The author tombstones and cleanup of the old User delete trigger. */
const tombstoneErasedUser = async (
  transaction: Transaction,
  userId: string,
  environment: ErasureEnvironment
): Promise<void> => {
  const operationId = randomUUID()
  const requestId = randomUUID()
  const eventRows = await transaction.$queryRawUnsafe<Array<{ at: Date }>>(
    `SELECT clock_timestamp()::timestamptz(3) AS at`
  )
  const eventTime = eventRows[0]!.at

  const versions = await transaction.$queryRawUnsafe<
    Array<{
      id: string
      questionId: string
      rowVersion: number
      status: string
    }>
  >(
    `SELECT version."id", version."questionId", version."status"::text AS status,
       version."rowVersion"
     FROM "QuestionVersion" AS version
     WHERE version."createdByActorId" = $1::uuid
       AND version."status" IN ${OPEN_VERSION_STATUSES}
     ORDER BY version."questionId", version."id"
     FOR UPDATE`,
    userId
  )
  for (const version of versions) {
    await transaction.$executeRawUnsafe(
      `UPDATE "QuestionVersion"
       SET "status" = 'RETIRED',
           "retirementKind" = 'AUTHOR_ERASURE_ABANDONED',
           "retiredAt" = $2::timestamptz,
           "updatedAt" = $2::timestamptz,
           "rowVersion" = $3::integer + 1,
           "createdByUserId" = NULL,
           "createdByLabelSnapshot" = 'DELETED_ADMIN'
       WHERE "id" = $1::uuid`,
      version.id,
      eventTime,
      version.rowVersion
    )
    await transaction.$executeRawUnsafe(
      `INSERT INTO "ContentReview" (
         "questionId", "questionVersionId", "action", "fromState", "toState",
         "actorKind", "actorUserId", "actorId", "actorRole", "actorLabel",
         "actorSystemLabel", "counterpartUserId", "counterpartActorId",
         "counterpartRole", "counterpartLabel", "reason", "comment",
         "operationId", "requestId", "occurredAt"
       ) VALUES (
         $1::uuid, $2::uuid, 'AUTHOR_ERASURE_ABANDONED',
         $3::"QuestionVersionStatus", 'RETIRED',
         'SYSTEM', NULL, NULL, 'SYSTEM', NULL, 'ACCOUNT_ERASURE',
         NULL, $4::uuid, 'ADMIN', 'DELETED_ADMIN', 'AUTHOR_ERASURE', NULL,
         $5::uuid, $6::uuid, $7::timestamptz
       )`,
      version.questionId,
      version.id,
      version.status,
      userId,
      operationId,
      requestId,
      eventTime
    )
    await insertSystemAudit(transaction, {
      afterRowVersion: version.rowVersion + 1,
      afterState: 'RETIRED',
      beforeRowVersion: version.rowVersion,
      beforeState: version.status,
      changedFields: ['VERSION_STATUS', 'AUTHOR_TOMBSTONE'],
      environment,
      metadata: { kind: 'NONE_V1' },
      occurredAt: eventTime,
      operationId,
      requestId,
      targetId: version.id,
      targetType: 'QUESTION_VERSION'
    })
  }

  await transaction.$executeRawUnsafe(
    `UPDATE "QuestionVersion"
     SET "createdByUserId" = NULL,
         "createdByLabelSnapshot" = 'DELETED_ADMIN',
         "rowVersion" = "rowVersion" + 1,
         "updatedAt" = $2::timestamptz
     WHERE "createdByActorId" = $1::uuid AND "createdByUserId" = $1::uuid`,
    userId,
    eventTime
  )
  await transaction.$executeRawUnsafe(
    `UPDATE "Question"
     SET "createdByUserId" = NULL,
         "createdByLabelSnapshot" = 'DELETED_ADMIN',
         "rowVersion" = "rowVersion" + 1,
         "updatedAt" = $2::timestamptz
     WHERE "createdByActorId" = $1::uuid`,
    userId,
    eventTime
  )
  await transaction.$executeRawUnsafe(
    `UPDATE "Question"
     SET "rowVersion" = "rowVersion" + 1, "updatedAt" = $2::timestamptz
     WHERE "createdByActorId" IS DISTINCT FROM $1::uuid
       AND "id" IN (
         SELECT DISTINCT "questionId" FROM "QuestionVersion"
         WHERE "retirementKind" = 'AUTHOR_ERASURE_ABANDONED'
           AND "retiredAt" = $2::timestamptz
       )`,
    userId,
    eventTime
  )
  await transaction.$executeRawUnsafe(
    `UPDATE "ContentReview"
     SET "actorUserId" = CASE WHEN "actorId" = $1::uuid THEN NULL ELSE "actorUserId" END,
         "actorLabel" = CASE WHEN "actorId" = $1::uuid THEN
           CASE "actorRole" WHEN 'ADMIN' THEN 'DELETED_ADMIN'::"AccountActorLabel"
             ELSE 'DELETED_USER'::"AccountActorLabel" END ELSE "actorLabel" END,
         "counterpartUserId" = CASE WHEN "counterpartActorId" = $1::uuid
           THEN NULL ELSE "counterpartUserId" END,
         "counterpartLabel" = CASE WHEN "counterpartActorId" = $1::uuid THEN
           CASE "counterpartRole" WHEN 'ADMIN' THEN 'DELETED_ADMIN'::"AccountActorLabel"
             ELSE 'DELETED_USER'::"AccountActorLabel" END ELSE "counterpartLabel" END
     WHERE "actorId" = $1::uuid OR "counterpartActorId" = $1::uuid`,
    userId
  )
  await transaction.$executeRawUnsafe(
    `UPDATE "AdminAuditLog"
     SET "actorUserId" = NULL,
         "actorLabel" = CASE "actorRole"
           WHEN 'ADMIN' THEN 'DELETED_ADMIN'::"AccountActorLabel"
           ELSE 'DELETED_USER'::"AccountActorLabel" END
     WHERE "actorId" = $1::uuid`,
    userId
  )
  await transaction.$executeRawUnsafe(
    `UPDATE "QuestionReport"
     SET "reporterUserId" = CASE WHEN "reporterActorId" = $1::uuid
           THEN NULL ELSE "reporterUserId" END,
         "reporterLabel" = CASE WHEN "reporterActorId" = $1::uuid THEN
           CASE "reporterRole" WHEN 'ADMIN' THEN 'DELETED_ADMIN'::"AccountActorLabel"
             ELSE 'DELETED_USER'::"AccountActorLabel" END ELSE "reporterLabel" END,
         "description" = CASE WHEN "reporterActorId" = $1::uuid
           THEN NULL ELSE "description" END,
         "assigneeUserId" = CASE WHEN "assigneeActorId" = $1::uuid
           THEN NULL ELSE "assigneeUserId" END,
         "assigneeLabel" = CASE WHEN "assigneeActorId" = $1::uuid
           THEN 'DELETED_ADMIN'::"AccountActorLabel" ELSE "assigneeLabel" END,
         "rowVersion" = "rowVersion" + 1,
         "updatedAt" = $2::timestamptz
     WHERE "reporterActorId" = $1::uuid OR "assigneeActorId" = $1::uuid`,
    userId,
    eventTime
  )

  if (versions.length > 0) {
    const metadata = {
      kind: 'AUTHOR_ERASURE_V1',
      subjectActorDigest: subjectActorDigest(userId),
      abandonedCount: versions.length
    }
    await insertSystemAudit(transaction, {
      afterRowVersion: null,
      afterState: null,
      beforeRowVersion: null,
      beforeState: null,
      changedFields: ['AUTHOR_TOMBSTONE'],
      environment,
      metadata,
      occurredAt: eventTime,
      operationId,
      requestId,
      targetId: operationId,
      targetType: 'USER_ERASURE'
    })
  }

  await transaction.$executeRawUnsafe(
    `DELETE FROM "Session" WHERE "userId" = $1::uuid`,
    userId
  )
  await transaction.$executeRawUnsafe(
    `DELETE FROM "Verification" WHERE "resetUserId" = $1::uuid`,
    userId
  )
}

const LOCK_STATEMENTS = [
  // Canonical final-erasure lock order shared with reset/password/auth paths.
  `SELECT 1 FROM "Verification" WHERE "resetUserId" = $1::uuid
   ORDER BY "id" FOR UPDATE`,
  `SELECT 1 FROM "Account" WHERE "userId" = $1::uuid ORDER BY "id" FOR UPDATE`,
  `SELECT 1 FROM "Session" WHERE "userId" = $1::uuid ORDER BY "id" FOR UPDATE`,
  `SELECT 1 FROM "Question"
   WHERE "createdByActorId" = $1::uuid
     OR "id" IN (
       SELECT "questionId" FROM "QuestionVersion"
       WHERE "createdByActorId" = $1::uuid
     )
   ORDER BY "id" FOR UPDATE`,
  `SELECT 1 FROM "QuestionVersion" WHERE "createdByActorId" = $1::uuid
   ORDER BY "questionId", "id" FOR UPDATE`,
  `SELECT 1 FROM "ContentReview"
   WHERE "actorId" = $1::uuid OR "counterpartActorId" = $1::uuid
   ORDER BY "id" FOR UPDATE`,
  `SELECT 1 FROM "AdminAuditLog" WHERE "actorId" = $1::uuid
   ORDER BY "id" FOR UPDATE`,
  `SELECT 1 FROM "QuestionReport"
   WHERE "reporterActorId" = $1::uuid OR "assigneeActorId" = $1::uuid
   ORDER BY "id" FOR UPDATE`
]

/**
 * erase_user_unchecked: erases one User whose erasure the database
 * confirms. Returns false when the User does not exist.
 */
const eraseConfirmedUser = async (
  transaction: Transaction,
  userId: string,
  environment: ErasureEnvironment
): Promise<boolean> => {
  await requireCapability(transaction, environment)
  await requireTargetDatabase(
    transaction,
    environment,
    'Erasure environment does not match the approved DB target.'
  )
  const target = await transaction.$queryRawUnsafe<unknown[]>(
    `SELECT 1 FROM "User" WHERE "id" = $1::uuid FOR UPDATE`,
    userId
  )
  if (target.length !== 1) return false
  for (const statement of LOCK_STATEMENTS)
    await transaction.$queryRawUnsafe(statement, userId)

  await tombstoneErasedUser(transaction, userId, environment)
  const deleted = await transaction.$executeRawUnsafe(
    `DELETE FROM "User" WHERE "id" = $1::uuid`,
    userId
  )
  if (deleted !== 1)
    await raise(
      transaction,
      '23514',
      'Owned erasure did not delete exactly one User.'
    )
  return true
}

/** erase_user: the TEST-only direct erasure of one User. */
export const eraseUserForTest = async (
  transaction: Transaction,
  userId: string,
  environment: ErasureEnvironment
): Promise<boolean> => {
  if (environment !== 'TEST')
    await raise(
      transaction,
      '42501',
      'Direct erasure is TEST-only; use the provider-first erasure queue.'
    )
  // The database accepts this marker only in a TEST database with a TEST
  // capability (user_erasure_confirmed).
  await transaction.$queryRawUnsafe(
    `SELECT set_config('${TEST_ERASURE_SETTING}', $1::uuid::text, true)`,
    userId
  )
  return eraseConfirmedUser(transaction, userId, environment)
}

const ALL_PROVIDERS_COMPLETED = `jsonb_array_length(r."providerCleanup") > 0
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(r."providerCleanup") AS x
    WHERE x->>'status' IS DISTINCT FROM 'COMPLETED'
  )`

/**
 * complete_sso_account_erasure: erases the User of a request whose
 * provider cleanup has completed. Returns true once the request is DELETED.
 */
export const completeSsoAccountErasure = async (
  transaction: Transaction,
  requestId: string,
  environment: ErasureEnvironment
): Promise<boolean> => {
  await requireCapability(transaction, environment)
  const first = await transaction.$queryRawUnsafe<
    Array<{ appStatus: string; ready: boolean; userId: string | null }>
  >(
    `SELECT r."userId", r."appStatus", ${ALL_PROVIDERS_COMPLETED} AS ready
     FROM "SsoAccountErasureRequest" AS r WHERE r."id" = $1::uuid`,
    requestId
  )
  const request = first[0]
  if (!request || !request.ready) return false
  if (request.appStatus === 'DELETED') return true
  await transaction.$queryRawUnsafe(
    `SELECT 1 FROM "User" WHERE "id" = $1::uuid FOR UPDATE`,
    request.userId
  )
  const locked = (
    await transaction.$queryRawUnsafe<
      Array<{
        appStatus: string
        due: boolean
        pending: boolean
        ready: boolean
        userId: string | null
      }>
    >(
      `SELECT r."userId", r."appStatus", ${ALL_PROVIDERS_COMPLETED} AS ready,
         ${erasureDueSql('r')} AS due,
         EXISTS (
           SELECT 1 FROM "User" AS target
           WHERE target."id" = r."userId"
             AND target."accountStatus" = 'DELETION_PENDING'
         ) AS pending
       FROM "SsoAccountErasureRequest" AS r WHERE r."id" = $1::uuid
       FOR UPDATE OF r`,
      requestId
    )
  )[0]
  if (!locked) return false
  if (locked.appStatus === 'DELETED') return locked.ready
  if (!locked.userId || !locked.ready || !locked.pending || !locked.due)
    return false
  if (!(await eraseConfirmedUser(transaction, locked.userId, environment)))
    return false
  await transaction.$executeRawUnsafe(
    `UPDATE "SsoAccountErasureRequest"
     SET "appStatus" = 'DELETED', "completedAt" = clock_timestamp()
     WHERE "id" = $1::uuid`,
    requestId
  )
  return true
}

/** list_sso_account_erasures: the erasure worker queue. */
export const listSsoAccountErasures = async (
  client: Queryable,
  batchLimit: number,
  environment: ErasureEnvironment
): Promise<unknown> => {
  await requireCapability(client, environment)
  if (!Number.isInteger(batchLimit) || batchLimit < 1 || batchLimit > 100)
    await raise(client, '22023', 'Invalid erasure batch limit.')
  const rows = await client.$queryRawUnsafe<Array<{ result: unknown }>>(
    `SELECT coalesce(jsonb_agg(jsonb_build_object(
         'id', q."id", 'appStatus', q."appStatus",
         'providerCleanup', q."providerCleanup"
       ) ORDER BY q.pending DESC, q."createdAt", q."id"), '[]'::jsonb) AS result
     FROM (
       SELECT r."id", r."appStatus", r."providerCleanup", r."createdAt",
         r."appStatus" = 'DELETION_PENDING' AS pending
       FROM "SsoAccountErasureRequest" AS r
       -- JLP-845: a request joins the queue once its grace period ends; a
       -- CANCELLED (restored) request never does.
       WHERE (r."appStatus" = 'DELETION_PENDING' AND ${erasureDueSql('r')})
         OR (r."appStatus" = 'DELETED' AND EXISTS (
           SELECT 1 FROM jsonb_array_elements(r."providerCleanup") AS x
           WHERE x->>'status' IS DISTINCT FROM 'COMPLETED'
         ))
       ORDER BY r."appStatus" = 'DELETION_PENDING' DESC, r."createdAt", r."id"
       LIMIT $1::integer
     ) AS q`,
    batchLimit
  )
  return rows[0]?.result
}

/** sso_account_erasure_status: the receipt status, or null. */
export const ssoAccountErasureStatus = async (
  client: Pick<PrismaClient, '$queryRawUnsafe'>,
  receiptDigest: string
): Promise<unknown> => {
  await client.$queryRawUnsafe(`SELECT "require_runtime_ready"() AS ready`)
  const rows = await client.$queryRawUnsafe<Array<{ result: unknown }>>(
    `SELECT jsonb_build_object(
         'appStatus', r."appStatus", 'providerCleanup', r."providerCleanup",
         'deletionScheduledAt', CASE WHEN r."appStatus" = 'CANCELLED' THEN NULL
           ELSE ${deletionScheduledAtSql('r')} END
       ) AS result
     FROM "SsoAccountErasureRequest" AS r
     WHERE r."receiptDigest" = $1 AND r."receiptExpiresAt" > clock_timestamp()`,
    receiptDigest
  )
  return rows[0]?.result ?? null
}

/** redact_expired_report_descriptions: returns the redacted count. */
export const redactExpiredReportDescriptions = async (
  transaction: Transaction,
  batchLimit: number,
  environment: ErasureEnvironment
): Promise<number> => {
  await requireCapability(transaction, environment)
  if (!Number.isInteger(batchLimit) || batchLimit < 1 || batchLimit > 100)
    await raise(
      transaction,
      '22023',
      'Report redaction batch limit is out of bounds.'
    )
  await requireTargetDatabase(
    transaction,
    environment,
    'Report redaction environment does not match the DB target.'
  )
  return transaction.$executeRawUnsafe(
    `WITH event AS (SELECT clock_timestamp()::timestamptz(3) AS at),
     candidates AS MATERIALIZED (
       SELECT report."id"
       FROM "QuestionReport" AS report, event
       WHERE report."status" IN ('RESOLVED', 'DISMISSED')
         AND report."resolvedAt" IS NOT NULL
         AND report."resolvedAt" <= event.at - INTERVAL '180 days'
         AND report."description" IS NOT NULL
       ORDER BY report."id"
       FOR UPDATE OF report SKIP LOCKED
       LIMIT $1::integer
     )
     UPDATE "QuestionReport" AS report
     SET "description" = NULL,
         "rowVersion" = report."rowVersion" + 1,
         "updatedAt" = event.at
     FROM candidates, event
     WHERE report."id" = candidates."id"`,
    batchLimit
  )
}

type SsoAccountErasureRequestResult =
  | {
      readonly code:
        | 'AUTHENTICATION_REQUIRED'
        | 'SSO_FRESH_REQUIRED'
        | 'SSO_ACCOUNT_DELETION_BLOCKED'
        | 'SSO_LAST_ADMIN_DELETION_BLOCKED'
    }
  | {
      readonly appStatus: 'DELETION_PENDING'
      readonly deletionScheduledAt: string
      readonly providerCleanup: unknown
      readonly userId: string
    }

/**
 * request_sso_account_erasure: records the provider-first erasure
 * request and sets the User DELETION_PENDING, which revokes every Session.
 * The database fills the provider cleanup list and receipt expiry itself.
 */
export const requestSsoAccountErasure = async (
  client: Pick<PrismaClient, '$transaction'>,
  rawToken: string,
  proofDigest: string | null,
  receiptDigest: string
): Promise<SsoAccountErasureRequestResult> =>
  client.$transaction(async (transaction) => {
    await transaction.$queryRawUnsafe(
      `SELECT "require_runtime_ready"() AS ready`
    )
    const first = await accountSessionContext(transaction, rawToken)
    if (!first) return { code: 'AUTHENTICATION_REQUIRED' }
    // An ADMIN locks every ACTIVE ADMIN in id order first, so two admins
    // leaving at once cannot both pass the last-admin check below.
    if (first.role === 'ADMIN')
      await transaction.$queryRawUnsafe(
        `SELECT 1 FROM "User"
         WHERE "role" = 'ADMIN' AND "accountStatus" = 'ACTIVE'
         ORDER BY "id" FOR UPDATE`
      )
    await transaction.$queryRawUnsafe(
      `SELECT 1 FROM "User" WHERE "id" = $1::uuid FOR UPDATE`,
      first.userId
    )
    const actor = await accountSessionContext(transaction, rawToken)
    if (!actor) return { code: 'AUTHENTICATION_REQUIRED' }
    if (!(await accountFreshProofIsValid(transaction, rawToken, proofDigest)))
      return { code: 'SSO_FRESH_REQUIRED' }
    const blocked = await transaction.$queryRawUnsafe<unknown[]>(
      `SELECT 1 FROM "QuestionVersion"
       WHERE "createdByActorId" = $1::uuid
         AND "status" IN ${OPEN_VERSION_STATUSES}
       LIMIT 1`,
      actor.userId
    )
    if (blocked.length > 0) return { code: 'SSO_ACCOUNT_DELETION_BLOCKED' }
    // JLP-841: the service must keep one ACTIVE ADMIN.
    const lastAdmin = await transaction.$queryRawUnsafe<unknown[]>(
      `SELECT 1 FROM "User" AS self
       WHERE self."id" = $1::uuid
         AND self."role" = 'ADMIN' AND self."accountStatus" = 'ACTIVE'
         AND NOT EXISTS (
           SELECT 1 FROM "User" AS other
           WHERE other."role" = 'ADMIN' AND other."accountStatus" = 'ACTIVE'
             AND other."id" <> self."id"
         )`,
      actor.userId
    )
    if (lastAdmin.length > 0) return { code: 'SSO_LAST_ADMIN_DELETION_BLOCKED' }
    if (!/^[0-9a-f]{64}$/u.test(receiptDigest))
      await raise(transaction, '22023', 'Invalid private erasure receipt.')
    await transaction.$queryRawUnsafe(
      `SELECT 1 FROM "Account" WHERE "userId" = $1::uuid ORDER BY "id" FOR UPDATE`,
      actor.userId
    )
    // The request trigger replaces the cleanup list, expiry and state.
    const inserted = await transaction.$queryRawUnsafe<
      Array<{ deletionScheduledAt: string; providerCleanup: unknown }>
    >(
      `INSERT INTO "SsoAccountErasureRequest" AS r (
         "userId", "receiptDigest", "providerCleanup", "receiptExpiresAt"
       ) VALUES ($1::uuid, $2, '[]'::jsonb, clock_timestamp())
       RETURNING r."providerCleanup",
         ${deletionScheduledAtSql('r')} AS "deletionScheduledAt"`,
      actor.userId,
      receiptDigest
    )
    // The User trigger accepts ACTIVE to DELETION_PENDING only with the
    // request just inserted, then revokes every Session of the User.
    await transaction.$executeRawUnsafe(
      `UPDATE "User" SET "accountStatus" = 'DELETION_PENDING'
       WHERE "id" = $1::uuid`,
      actor.userId
    )
    await transaction.$executeRawUnsafe(
      `DELETE FROM "SsoAccountFreshProof" WHERE "userId" = $1::uuid`,
      actor.userId
    )
    await transaction.$executeRawUnsafe(
      `DELETE FROM "SsoAccountFreshTransaction" WHERE "userId" = $1::uuid`,
      actor.userId
    )
    return {
      appStatus: 'DELETION_PENDING',
      deletionScheduledAt: inserted[0]!.deletionScheduledAt,
      providerCleanup: inserted[0]?.providerCleanup,
      userId: actor.userId
    }
  })

export interface RestorableErasure {
  readonly authorityGeneration: number
  readonly deletionScheduledAt: string
  readonly requestId: string
  readonly userId: string
}

/**
 * JLP-845: the DELETION_PENDING User of a verified provider identity whose
 * erasure has not started, or null. Called only after resolve_sso_identity
 * returned ACCOUNT_UNAVAILABLE for that identity.
 */
export const findRestorableErasure = async (
  client: Pick<PrismaClient, '$queryRawUnsafe'>,
  provider: string,
  accountId: string
): Promise<RestorableErasure | null> => {
  const rows = await client.$queryRawUnsafe<RestorableErasure[]>(
    `SELECT u."id"::text AS "userId", u."authorityGeneration",
       r."id"::text AS "requestId",
       ${deletionScheduledAtSql('r')} AS "deletionScheduledAt"
     FROM "Account" AS a
     JOIN "User" AS u ON u."id" = a."userId"
     JOIN "SsoAccountErasureRequest" AS r ON r."userId" = u."id"
     WHERE a."providerId" = $1 AND a."accountId" = $2
       AND u."accountStatus" = 'DELETION_PENDING' AND u."deletedAt" IS NULL
       AND r."appStatus" = 'DELETION_PENDING'
       AND ${ERASURE_NOT_STARTED}`,
    provider,
    accountId
  )
  return rows.length === 1 ? rows[0]! : null
}

export type RestoreSsoAccountResult =
  | {
      readonly code:
        | 'SSO_ACCOUNT_RESTORE_UNAVAILABLE'
        | 'SSO_ACCOUNT_RESTORE_TOO_LATE'
    }
  | {
      readonly authorityGeneration: number
      readonly role: 'USER' | 'ADMIN'
      readonly userId: string
    }

/**
 * JLP-845: restores the member's own DELETION_PENDING account. The restore
 * proof names the request and the authority generation it was issued for, so
 * it works once: the restore steps the generation. The User trigger cancels
 * the request in the same statement and refuses once erasure has started.
 */
export const restoreSsoAccount = async (
  client: Pick<PrismaClient, '$transaction'>,
  proof: Omit<RestorableErasure, 'deletionScheduledAt'>
): Promise<RestoreSsoAccountResult> =>
  client.$transaction(async (transaction) => {
    await transaction.$queryRawUnsafe(
      `SELECT "require_runtime_ready"() AS ready`
    )
    // Same lock order as erasure: the User, then its request.
    const users = await transaction.$queryRawUnsafe<
      Array<{ accountStatus: string; authorityGeneration: number }>
    >(
      `SELECT "accountStatus"::text AS "accountStatus", "authorityGeneration"
       FROM "User" WHERE "id" = $1::uuid AND "deletedAt" IS NULL FOR UPDATE`,
      proof.userId
    )
    const user = users[0]
    if (!user) return { code: 'SSO_ACCOUNT_RESTORE_TOO_LATE' }
    if (
      user.accountStatus !== 'DELETION_PENDING' ||
      user.authorityGeneration !== proof.authorityGeneration
    )
      return { code: 'SSO_ACCOUNT_RESTORE_UNAVAILABLE' }
    const requests = await transaction.$queryRawUnsafe<
      Array<{ appStatus: string; notStarted: boolean }>
    >(
      `SELECT r."appStatus", ${ERASURE_NOT_STARTED} AS "notStarted"
       FROM "SsoAccountErasureRequest" AS r
       WHERE r."id" = $1::uuid AND r."userId" = $2::uuid
       FOR UPDATE OF r`,
      proof.requestId,
      proof.userId
    )
    const request = requests[0]
    if (!request || request.appStatus !== 'DELETION_PENDING')
      return { code: 'SSO_ACCOUNT_RESTORE_UNAVAILABLE' }
    if (!request.notStarted) return { code: 'SSO_ACCOUNT_RESTORE_TOO_LATE' }
    const restored = await transaction.$queryRawUnsafe<
      Array<{ authorityGeneration: number; role: 'USER' | 'ADMIN' }>
    >(
      `UPDATE "User" SET "accountStatus" = 'ACTIVE'
       WHERE "id" = $1::uuid AND "accountStatus" = 'DELETION_PENDING'
       RETURNING "authorityGeneration", "role"::text AS "role"`,
      proof.userId
    )
    if (restored.length !== 1)
      await raise(
        transaction,
        '23514',
        'Account restore did not restore one User.'
      )
    return { userId: proof.userId, ...restored[0]! }
  })

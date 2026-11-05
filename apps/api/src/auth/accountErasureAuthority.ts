import { createHash, randomUUID } from 'node:crypto'
import type { Prisma, PrismaClient } from '../generated/prisma/client.js'
import { adminAuditContentDigest } from '../admin/adminRepositoryCommon.js'
import { reauthenticationTokenDigest } from './adminFreshAuthority.js'

/**
 * Account erasure in the API transaction (#504 P7 PR4a).
 *
 * This keeps phase7_erase_user(_unchecked), the User delete trigger
 * anonymize_question_creator_on_user_delete, phase7_complete_sso_account_erasure,
 * phase7_list_sso_account_erasures, phase7_sso_account_erasure_status,
 * phase7_redact_expired_report_descriptions and (#504 P7 PR4b-2)
 * phase7_request_sso_account_erasure step for step: the same checks, the
 * same lock order, the same tombstones and audit rows, and the same SQLSTATE
 * and message on failure. Failures are raised inside PostgreSQL so the existing
 * error mapping sees the same database error. The database allows the
 * nihongo_app writes only for a User whose erasure is confirmed
 * (phase7_user_erasure_confirmed).
 */

type Transaction = Prisma.TransactionClient
type Queryable = Pick<PrismaClient, '$queryRawUnsafe' | '$executeRawUnsafe'>
export type ErasureEnvironment = 'TEST' | 'DEVELOPMENT' | 'PRODUCTION'

/** Marks the TEST-only direct erasure of one User in this transaction. */
const TEST_ERASURE_SETTING = 'nihongo.phase7_test_erasure_user'

const OPEN_VERSION_STATUSES = `('DRAFT','IN_REVIEW','CHANGES_REQUESTED','APPROVED')`

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
    `SELECT "phase7_require_database_capability"($1::"AdminAuditEnvironment")`,
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

// Activation is one-way false to true (protect_phase7_auth_issuer_activation),
// so a read without a lock gives the same answer as the old FOR SHARE.
const requireActivation = async (
  client: Queryable,
  message: string
): Promise<void> => {
  const rows = await client.$queryRawUnsafe<Array<{ active: boolean }>>(
    `SELECT "legacyIssuerDisabled" AS active FROM "AuthIssuerActivation"
     WHERE "id" = 1`
  )
  if (rows[0]?.active !== true) await raise(client, '42501', message)
}

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
 * phase7_erase_user_unchecked: erases one User whose erasure the database
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
  await requireActivation(
    transaction,
    'Erasure requires completed V1 issuer activation.'
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

/** phase7_erase_user: the TEST-only direct erasure of one User. */
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
  // capability (phase7_user_erasure_confirmed).
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
 * phase7_complete_sso_account_erasure: erases the User of a request whose
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
        pending: boolean
        ready: boolean
        userId: string | null
      }>
    >(
      `SELECT r."userId", r."appStatus", ${ALL_PROVIDERS_COMPLETED} AS ready,
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
  if (!locked.userId || !locked.ready || !locked.pending) return false
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

/** phase7_list_sso_account_erasures: the erasure worker queue. */
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
       WHERE r."appStatus" = 'DELETION_PENDING'
         OR EXISTS (
           SELECT 1 FROM jsonb_array_elements(r."providerCleanup") AS x
           WHERE x->>'status' IS DISTINCT FROM 'COMPLETED'
         )
       ORDER BY r."appStatus" = 'DELETION_PENDING' DESC, r."createdAt", r."id"
       LIMIT $1::integer
     ) AS q`,
    batchLimit
  )
  return rows[0]?.result
}

/** phase7_sso_account_erasure_status: the receipt status, or null. */
export const ssoAccountErasureStatus = async (
  client: Pick<PrismaClient, '$queryRawUnsafe'>,
  receiptDigest: string
): Promise<unknown> => {
  await client.$queryRawUnsafe(
    `SELECT "phase7_require_runtime_ready"() AS ready`
  )
  const rows = await client.$queryRawUnsafe<Array<{ result: unknown }>>(
    `SELECT jsonb_build_object(
         'appStatus', r."appStatus", 'providerCleanup', r."providerCleanup"
       ) AS result
     FROM "SsoAccountErasureRequest" AS r
     WHERE r."receiptDigest" = $1 AND r."receiptExpiresAt" > clock_timestamp()`,
    receiptDigest
  )
  return rows[0]?.result ?? null
}

/** phase7_redact_expired_report_descriptions: returns the redacted count. */
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
  await requireActivation(
    transaction,
    'Report redaction requires completed V1 activation.'
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

// phase7_sso_account_session: the active V1 Session of a raw token.
const accountSession = async (
  transaction: Transaction,
  rawToken: string
): Promise<{ userId: string } | undefined> =>
  (
    await transaction.$queryRawUnsafe<Array<{ userId: string }>>(
      `SELECT target_user."id" AS "userId"
       FROM "Session" AS session
       JOIN "User" AS target_user ON target_user."id" = session."userId"
       WHERE session."token" = $1
         AND session."issuerProtocolVersion" = 'PHASE7_V1'
         AND session."authorizationState" = 'ACTIVE'
         AND session."authorityGeneration" = target_user."authorityGeneration"
         AND target_user."accountStatus" = 'ACTIVE'
         AND target_user."deletedAt" IS NULL
         AND session."expiresAt" > clock_timestamp()
         AND session."createdAt" + INTERVAL '30 days' > clock_timestamp()`,
      rawToken
    )
  )[0]

// phase7_sso_account_proof_valid with phase7_sso_account_context_valid for an
// ACCOUNT_FRESH proof: verified in the last 5 minutes, unexpired, and bound to
// this Session, its User authority and a still linked provider account.
const accountFreshProofIsValid = async (
  transaction: Transaction,
  rawToken: string,
  proofDigest: string | null
): Promise<boolean> => {
  if (proofDigest === null) return false
  const rows = await transaction.$queryRawUnsafe<
    Array<{ tokenDigest: string; token: string }>
  >(
    `SELECT proof."context"->>'tokenDigest' AS "tokenDigest", session."token"
     FROM "SsoAccountFreshProof" AS proof
     JOIN "User" AS target_user
       ON target_user."id" = (proof."context"->>'userId')::uuid
     JOIN "Session" AS session
       ON session."id" = (proof."context"->>'sessionId')::uuid
      AND session."userId" = target_user."id"
     WHERE proof."proofDigest" = $2
       AND proof."context"->>'purpose' = 'ACCOUNT_FRESH'
       AND proof."verifiedAt" IS NOT NULL
       AND proof."verifiedAt" + INTERVAL '5 minutes' > clock_timestamp()
       AND proof."expiresAt" > clock_timestamp()
       AND session."token" = $1
       AND target_user."role"::text = proof."context"->>'role'
       AND target_user."authorityGeneration" =
         (proof."context"->>'authorityGeneration')::integer
       AND proof."context"->>'provider' IN ('apple', 'google')
       AND session."issuerProtocolVersion" = 'PHASE7_V1'
       AND session."authorizationState" = 'ACTIVE'
       AND session."authorityGeneration" = target_user."authorityGeneration"
       AND target_user."accountStatus" = 'ACTIVE'
       AND target_user."deletedAt" IS NULL
       AND session."expiresAt" > clock_timestamp()
       AND session."createdAt" + INTERVAL '30 days' > clock_timestamp()
       AND EXISTS (
         SELECT 1 FROM "Account" AS account
         WHERE account."userId" = target_user."id"
           AND account."providerId" = proof."context"->>'provider'
           AND account."accountId" = proof."context"->>'accountId'
       )`,
    rawToken,
    proofDigest
  )
  return rows.some(
    (row) => reauthenticationTokenDigest(row.token) === row.tokenDigest
  )
}

export type SsoAccountErasureRequestResult =
  | {
      readonly code:
        | 'AUTHENTICATION_REQUIRED'
        | 'SSO_FRESH_REQUIRED'
        | 'SSO_ACCOUNT_DELETION_BLOCKED'
    }
  | {
      readonly appStatus: 'DELETION_PENDING'
      readonly providerCleanup: unknown
    }

/**
 * phase7_request_sso_account_erasure: records the provider-first erasure
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
      `SELECT "phase7_require_runtime_ready"() AS ready`
    )
    const first = await accountSession(transaction, rawToken)
    if (!first) return { code: 'AUTHENTICATION_REQUIRED' }
    await transaction.$queryRawUnsafe(
      `SELECT 1 FROM "User" WHERE "id" = $1::uuid FOR UPDATE`,
      first.userId
    )
    const actor = await accountSession(transaction, rawToken)
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
    if (!/^[0-9a-f]{64}$/u.test(receiptDigest))
      await raise(transaction, '22023', 'Invalid private erasure receipt.')
    await transaction.$queryRawUnsafe(
      `SELECT 1 FROM "Account" WHERE "userId" = $1::uuid ORDER BY "id" FOR UPDATE`,
      actor.userId
    )
    // The request trigger replaces the cleanup list, expiry and state.
    const inserted = await transaction.$queryRawUnsafe<
      Array<{ providerCleanup: unknown }>
    >(
      `INSERT INTO "SsoAccountErasureRequest" (
         "userId", "receiptDigest", "providerCleanup", "receiptExpiresAt"
       ) VALUES ($1::uuid, $2, '[]'::jsonb, clock_timestamp())
       RETURNING "providerCleanup"`,
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
      providerCleanup: inserted[0]?.providerCleanup
    }
  })

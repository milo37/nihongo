import { adminSessionFreshSql } from '../auth/adminFreshSql.js'
import { ADMIN_FRESH_WINDOW_SQL } from '../auth/adminFreshWindow.js'
import { randomUUID } from 'node:crypto'
import type { Prisma } from '../generated/prisma/client.js'
import type { BegunOperationRow } from './adminRepositoryCommon.js'
import { v1PrincipalQuery } from '../auth/ownedSessionAuthority.js'

/**
 * Admin operation authority in the API transaction (#504 P7 PR2).
 *
 * This keeps the retired begin_admin_operation and the commit re-check
 * of finish_admin_operation step for step: the same isolation per
 * command, the same lock order (referenced Users by id, then the actor
 * Session, all FOR UPDATE; #504 P7 PR4b-1 removed the Session family), the
 * same authority
 * conditions and the same SQLSTATE and message on failure. Failures are raised
 * inside PostgreSQL so the existing error mapping sees the same database error.
 * #504 P7 PR4c-1: begin records a OperationIntent row in its transaction
 * and finish deletes it; the deferred OperationIntent_must_finish
 * trigger refuses a commit that still holds the row, so a command that skips
 * finish cannot commit.
 */

type AuditEnvironment = 'TEST' | 'DEVELOPMENT' | 'PRODUCTION'

const FRESH_COMMANDS = new Set([
  'APPROVAL',
  'APPROVAL_WITHDRAWAL',
  'PUBLICATION',
  'RETIREMENT',
  'QUESTION_ARCHIVE',
  'REVIEW_REQUEST_BATCH',
  'IMPORT_APPLY',
  'EXPORT',
  'REPORT_RESOLUTION'
])
const SERIALIZABLE_COMMANDS = new Set([
  'QUESTION_CREATE',
  'QUESTION_VERSION_CREATE',
  'QUESTION_VERSION_UPDATE',
  'PUBLICATION',
  'IMPORT_APPLY'
])

const STALE_AUTHORITY = 'Operation authority is stale or insufficient.'

// Every deferred verifier the SQL finish flushed before its last authority check.
const DEFERRED_CONTENT_CONSTRAINTS = [
  'QuestionOption_questionVersionId_label_key',
  'QuestionOption_questionVersionId_ordinal_key',
  'QuestionVersion_id_correctOptionId_fkey',
  'Question_id_currentPublishedVersionId_fkey',
  'Question_deferred_aggregate',
  'QuestionVersion_deferred_question_aggregate',
  'QuestionVersion_deferred_full_content',
  'QuestionOption_deferred_full_content',
  'QuestionVersionTag_deferred_full_content',
  'QuestionReport_deferred_remediation',
  'User_deferred_credential_totality',
  'Account_deferred_credential_totality'
]

interface CapturedOperation {
  readonly actorUserId: string
  readonly capturedAt: number
  readonly generation: number
  /** A server operator command (JLP-828): no Session, no SSO fresh proof. */
  readonly operator: boolean
  readonly rawSessionToken: string
  readonly requiresFresh: boolean
  readonly sessionId: string
  readonly transactionId: string
}

const capturedOperations = new Map<string, CapturedOperation>()
// A transaction that fails before finish never removes its entry.
const CAPTURE_RETENTION_MS = 10 * 60 * 1000

const pruneCapturedOperations = (now: number): void => {
  for (const [operationId, operation] of capturedOperations)
    if (now - operation.capturedAt > CAPTURE_RETENTION_MS)
      capturedOperations.delete(operationId)
}

/** Raises in PostgreSQL so callers keep mapping the same SQLSTATE and message. */
const raise = async (
  transaction: Prisma.TransactionClient,
  sqlState: '22023' | '25001' | '42501',
  message: string
): Promise<never> => {
  await transaction.$executeRawUnsafe(
    `DO $raise$ BEGIN RAISE EXCEPTION USING ERRCODE = '${sqlState}', MESSAGE = '${message}'; END $raise$`
  )
  throw new Error('PostgreSQL did not raise the admin operation failure.')
}

const currentTransactionId = async (
  transaction: Prisma.TransactionClient
): Promise<string> => {
  const rows = await transaction.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT txid_current()::text AS id`
  )
  const id = rows[0]?.id
  if (!id) throw new Error('Admin operation transaction is unavailable.')
  return id
}

const assertIsolation = async (
  transaction: Prisma.TransactionClient,
  command: string
): Promise<void> => {
  const rows = await transaction.$queryRawUnsafe<Array<{ isolation: string }>>(
    `SELECT current_setting('transaction_isolation') AS isolation`
  )
  const isolation = rows[0]?.isolation
  if (SERIALIZABLE_COMMANDS.has(command)) {
    if (isolation !== 'serializable')
      await raise(
        transaction,
        '25001',
        'Content mutation requires SERIALIZABLE isolation.'
      )
  } else if (command === 'EXPORT') {
    if (isolation !== 'repeatable read')
      await raise(
        transaction,
        '25001',
        'Export requires REPEATABLE READ isolation.'
      )
  } else if (isolation !== 'read committed') {
    await raise(
      transaction,
      '25001',
      'Admin operation requires READ COMMITTED isolation.'
    )
  }
}

const hasAuthority = async (
  transaction: Prisma.TransactionClient,
  operation: Omit<
    CapturedOperation,
    'capturedAt' | 'generation' | 'transactionId'
  > & {
    readonly generation: number | null
  }
): Promise<boolean> => {
  if (operation.operator) {
    const actors = await transaction.$queryRawUnsafe<Array<{ ok: number }>>(
      `SELECT 1 AS ok FROM "User" AS actor
       WHERE actor."id" = $1::uuid
         AND actor."role" = 'ADMIN'
         AND actor."accountStatus" = 'ACTIVE'
         AND ($2::integer IS NULL OR actor."authorityGeneration" = $2::integer)`,
      operation.actorUserId,
      operation.generation
    )
    return actors.length === 1
  }
  const rows = await transaction.$queryRawUnsafe<Array<{ ok: number }>>(
    `SELECT 1 AS ok
     FROM "User" AS actor
     JOIN "Session" AS session
       ON session."userId" = actor."id" AND session."id" = $2::uuid
     WHERE actor."id" = $1::uuid
       AND actor."role" = 'ADMIN'
       AND actor."accountStatus" = 'ACTIVE'
       AND ($3::integer IS NULL OR actor."authorityGeneration" = $3::integer)
       AND session."authorizationState" = 'ACTIVE'
       AND session."issuerProtocolVersion" = 'OWNED_V1'
       AND session."authorityGeneration" = actor."authorityGeneration"
       AND session."expiresAt" > clock_timestamp()
       AND session."createdAt" + INTERVAL '30 days' > clock_timestamp()
       AND (NOT $4::boolean
         OR session."createdAt" + ${ADMIN_FRESH_WINDOW_SQL} > clock_timestamp())`,
    operation.actorUserId,
    operation.sessionId,
    operation.generation,
    operation.requiresFresh
  )
  if (rows.length !== 1) return false
  if (!operation.requiresFresh) return true
  const fresh = await transaction.$queryRawUnsafe<Array<{ fresh: boolean }>>(
    `SELECT ${adminSessionFreshSql('$1')} AS fresh`,
    operation.rawSessionToken
  )
  return fresh[0]?.fresh === true
}

export const beginAdminOperation = async (
  transaction: Prisma.TransactionClient,
  input: {
    readonly auditEnvironment: AuditEnvironment
    readonly command: string
    /** Set only for an operator authority (operatorAdminAuthority.ts). */
    readonly operatorActorId?: string | null
    readonly rawSessionToken: string
    readonly referencedUserIds: readonly string[]
  }
): Promise<BegunOperationRow> => {
  const operator = Boolean(input.operatorActorId)
  const principal = operator
    ? [{ sessionId: '', userId: input.operatorActorId as string }]
    : await transaction.$queryRawUnsafe<
        Array<{ sessionId: string; userId: string }>
      >(
        `SELECT principal."sessionId", principal."userId"
     FROM (${v1PrincipalQuery('$1')}) AS principal`,
        input.rawSessionToken
      )
  const actor = principal.length === 1 ? principal[0] : undefined
  if (!actor) return raise(transaction, '42501', STALE_AUTHORITY)

  await assertIsolation(transaction, input.command)
  // The check returns void, which Prisma cannot read as a column.
  await transaction.$executeRawUnsafe(
    `SELECT "require_database_capability"($1::"AdminAuditEnvironment")`,
    input.auditEnvironment
  )

  const referenced = [...input.referencedUserIds]
  if (
    referenced.length < 1 ||
    (input.command !== 'EXPORT' && referenced.length > 512)
  )
    await raise(transaction, '22023', 'Referenced User set is invalid.')
  const canonicalUserIds = [...new Set(referenced)].toSorted()
  if (
    canonicalUserIds.length !== referenced.length ||
    !canonicalUserIds.includes(actor.userId)
  )
    await raise(
      transaction,
      '22023',
      'Referenced User set must be unique and include the actor.'
    )

  // Lock every referenced User in canonical id order before the actor Session
  // or any domain aggregate.
  const lockedUsers = await transaction.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT "id" FROM "User" WHERE "id" = ANY($1::uuid[]) ORDER BY "id"
     FOR UPDATE`,
    canonicalUserIds
  )
  if (lockedUsers.length !== canonicalUserIds.length)
    await raise(transaction, '42501', 'A referenced User is unavailable.')

  if (!operator) {
    const session = await transaction.$queryRawUnsafe<unknown[]>(
      `SELECT 1 FROM "Session"
     WHERE "id" = $1::uuid AND "userId" = $2::uuid
     FOR UPDATE`,
      actor.sessionId,
      actor.userId
    )
    if (session.length !== 1)
      await raise(transaction, '42501', 'Operation Session is unavailable.')
  }

  const requiresFresh = FRESH_COMMANDS.has(input.command)
  const authority = {
    actorUserId: actor.userId,
    generation: null,
    operator,
    rawSessionToken: input.rawSessionToken,
    requiresFresh,
    sessionId: actor.sessionId
  }
  if (!(await hasAuthority(transaction, authority)))
    await raise(transaction, '42501', STALE_AUTHORITY)
  const generationRows = await transaction.$queryRawUnsafe<
    Array<{ generation: number }>
  >(
    `SELECT "authorityGeneration" AS generation FROM "User" WHERE "id" = $1::uuid`,
    actor.userId
  )
  const generation = generationRows[0]?.generation
  if (generation === undefined)
    return raise(transaction, '42501', STALE_AUTHORITY)

  const operationId = randomUUID()
  // The database fills the backend and transaction of this row itself.
  await transaction.$executeRawUnsafe(
    `INSERT INTO "OperationIntent" ("operationId", "command", "environment")
     VALUES ($1::uuid, $2::"AdminAuditCommand", $3::"AdminAuditEnvironment")`,
    operationId,
    input.command,
    input.auditEnvironment
  )
  const now = Date.now()
  pruneCapturedOperations(now)
  capturedOperations.set(operationId, {
    ...authority,
    capturedAt: now,
    generation,
    transactionId: await currentTransactionId(transaction)
  })
  return { operationId, actorUserId: actor.userId }
}

/** The commit-time re-check that finish_admin_operation performed. */
export const finishAdminOperation = async (
  transaction: Prisma.TransactionClient,
  operationId: string
): Promise<void> => {
  const operation = capturedOperations.get(operationId)
  capturedOperations.delete(operationId)
  if (
    !operation ||
    operation.transactionId !== (await currentTransactionId(transaction))
  )
    return raise(transaction, '42501', 'Trusted operation is absent.')

  // Flush the deferred content verifiers so the authority re-check below is
  // the final validation step of the command.
  await transaction.$executeRawUnsafe(
    `SET CONSTRAINTS ${DEFERRED_CONTENT_CONSTRAINTS.map(
      (name) => `"${name}"`
    ).join(', ')} IMMEDIATE`
  )
  const consumed = await transaction.$executeRawUnsafe(
    `DELETE FROM "OperationIntent" WHERE "operationId" = $1::uuid`,
    operationId
  )
  if (consumed !== 1)
    await raise(transaction, '42501', 'Trusted operation is absent.')
  await transaction.$executeRawUnsafe(
    `SET CONSTRAINTS "OperationIntent_must_finish" IMMEDIATE`
  )
  if (!(await hasAuthority(transaction, operation)))
    await raise(transaction, '42501', 'Authority expired before commit.')
}

import type { PrismaClient } from '../generated/prisma/client.js'
import {
  type AdminFreshClient,
  raise,
  requireRuntimeReady,
  reauthenticationTokenDigest,
  readIntent,
  type AdminFreshRotation,
  reauthenticationAuditDigest
} from './adminFreshShared.js'
import type { FinalizedReauthentication } from './adminFreshAuthority.js'

export interface ReconciledReauthentication extends FinalizedReauthentication {
  state: string
}

/**
 * reconcile_reauthentication: the exact FINALIZED rotation of an intent,
 * with its audit row, while the replacement still holds authority.
 */
export const reconcileReauthentication = async (
  client: Pick<PrismaClient, '$queryRawUnsafe'>,
  intentId: string,
  rawNewToken: string
): Promise<ReconciledReauthentication[]> => {
  await requireRuntimeReady(client)
  const rows = await client.$queryRawUnsafe<
    Array<
      ReconciledReauthentication & {
        auditBeforeState: string
        auditDigest: string
        operationId: string
        stagedTokenDigest: string
      }
    >
  >(
    `SELECT intent."state"::TEXT AS state, session."id", session."createdAt",
       session."expiresAt", session."authorityGeneration",
       intent."operationId", intent."stagedTokenDigest",
       audit."beforeState" AS "auditBeforeState",
       audit."contentDigest" AS "auditDigest"
     FROM "ReauthenticationIntent" AS intent
     JOIN "Session" AS session
       ON session."id" = intent."stagedSessionId"
      AND session."userId" = intent."userId"
     JOIN "User" AS target_user ON target_user."id" = session."userId"
     JOIN "AdminAuditLog" AS audit
       ON audit."operationId" = intent."operationId"
      AND audit."command" = 'REAUTHENTICATION'
      AND audit."targetType" = 'ADMIN_SESSION'
      AND audit."targetId" = intent."operationId"
      AND audit."actorKind" = 'ACCOUNT'
      AND audit."actorUserId" = intent."userId"
      AND audit."actorId" = intent."userId"
      AND audit."actorRole" = 'ADMIN'
      AND audit."actorLabel" = 'ACTIVE_ADMIN'
      AND audit."actorSystemLabel" IS NULL
      AND audit."beforeState" IN ('SESSION_FRESH', 'SESSION_STALE')
      AND audit."afterState" = 'SESSION_FRESH'
      AND audit."beforeRowVersion" IS NULL
      AND audit."afterRowVersion" IS NULL
      AND audit."changedFields" = '["SESSION_ROTATION"]'::jsonb
      AND audit."metadata" =
        '{"kind":"REAUTHENTICATION_V1","rotation":"OLD_REVOKED_NEW_ISSUED"}'::jsonb
      AND audit."requestId" = intent."requestId"
      AND audit."environment" = intent."environment"
     WHERE intent."id" = $1::uuid
       AND intent."state" = 'FINALIZED'
       AND session."token" = $2
       AND session."issuerProtocolVersion" = 'OWNED_V1'
       AND session."authorizationState" = 'ACTIVE'
       AND session."authorityGeneration" = intent."capturedAuthorityGeneration"
       AND target_user."authorityGeneration" = intent."capturedAuthorityGeneration"
       AND target_user."role" = 'ADMIN'
       AND target_user."accountStatus" = 'ACTIVE'
       AND session."expiresAt" > clock_timestamp()
       AND session."createdAt" + INTERVAL '30 days' > clock_timestamp()
     LIMIT 1`,
    intentId,
    rawNewToken
  )
  return rows
    .filter(
      (row) =>
        row.stagedTokenDigest === reauthenticationTokenDigest(rawNewToken) &&
        row.auditDigest ===
          reauthenticationAuditDigest(row.operationId, row.auditBeforeState)
    )
    .map(({ state, id, createdAt, expiresAt, authorityGeneration }) => ({
      state,
      id,
      createdAt,
      expiresAt,
      authorityGeneration
    }))
}

/**
 * reconcile_sso_admin_fresh: the proof's rotation committed, so a lost
 * commit response is not a failure.
 */
export const reconcileAdminFresh = async (
  client: AdminFreshClient,
  proofDigest: string,
  rawNewToken: string
): Promise<AdminFreshRotation[]> => {
  await requireRuntimeReady(client)
  const proofs = await client.$queryRawUnsafe<
    Array<{
      callbackURL: string
      completedSessionId: string | null
      intentId: string
      userId: string
    }>
  >(
    `SELECT "callbackURL"::TEXT AS "callbackURL", "completedSessionId",
       "context"->>'intentId' AS "intentId", "context"->>'userId' AS "userId"
     FROM "SsoAdminFreshProof"
     WHERE "proofDigest" = $1 AND "expiresAt" > clock_timestamp()`,
    proofDigest
  )
  const proof = proofs[0]
  if (!proof) return []
  const rotations = await reconcileReauthentication(
    client,
    proof.intentId,
    rawNewToken
  )
  return rotations
    .filter(
      (rotation) =>
        rotation.state === 'FINALIZED' &&
        rotation.id === proof.completedSessionId
    )
    .map(({ state: _state, ...rotation }) => ({
      ...rotation,
      userId: proof.userId,
      callbackURL: proof.callbackURL
    }))
}

/** abort_reauthentication: drop an unfinished intent and its staged Session. */
export const abortReauthentication = async (
  client: AdminFreshClient,
  intentId: string
): Promise<boolean> =>
  client.$transaction(async (transaction) => {
    await requireRuntimeReady(transaction)
    const first = await readIntent(transaction, intentId, false)
    if (!first) return true
    if (first.state === 'FINALIZED') return false
    await transaction.$queryRawUnsafe(
      `SELECT 1 FROM "User" WHERE "id" = $1::uuid FOR UPDATE`,
      first.userId
    )
    if (first.stagedSessionId)
      await transaction.$queryRawUnsafe(
        `SELECT 1 FROM "Session" WHERE "id" = $1::uuid FOR UPDATE`,
        first.stagedSessionId
      )
    const intent = await readIntent(transaction, intentId, true)
    if (!intent) return true
    if (intent.state === 'FINALIZED') return false
    if (intent.stagedSessionId)
      await transaction.$executeRawUnsafe(
        `DELETE FROM "Session"
         WHERE "id" = $1::uuid AND "userId" = $2::uuid
           AND "authorizationState" = 'PENDING_REAUTH'`,
        intent.stagedSessionId,
        intent.userId
      )
    const removed = await transaction.$executeRawUnsafe(
      `DELETE FROM "ReauthenticationIntent"
       WHERE "id" = $1::uuid AND "state" <> 'FINALIZED'`,
      intent.id
    )
    if (removed !== 1)
      await raise(
        transaction,
        '40001',
        'Reauthentication abort intent CAS failed.'
      )
    return true
  })

/** cancel_sso_admin_fresh_proof. */
export const cancelAdminFreshProof = async (
  client: AdminFreshClient,
  proofDigest: string
): Promise<boolean> => {
  await requireRuntimeReady(client)
  const proofs = await client.$queryRawUnsafe<
    Array<{ completedSessionId: string | null; intentId: string }>
  >(
    `SELECT "completedSessionId", "context"->>'intentId' AS "intentId"
     FROM "SsoAdminFreshProof" WHERE "proofDigest" = $1`,
    proofDigest
  )
  const proof = proofs[0]
  if (!proof) return true
  if (proof.completedSessionId !== null) return false
  if (!(await abortReauthentication(client, proof.intentId))) return false
  await client.$executeRawUnsafe(
    `DELETE FROM "SsoAdminFreshProof"
     WHERE "proofDigest" = $1 AND "completedSessionId" IS NULL`,
    proofDigest
  )
  return true
}

export interface ReauthenticationCleanup {
  pendingSessionsDeleted: number
  intentsDeleted: number
  evidenceDeleted: number
}

export const CLEANUP_CANDIDATE = `(
    ("state" IN ('PREPARED', 'STAGED') AND "expiresAt" <= $2::timestamptz)
    OR ("state" = 'FINALIZED'
      AND "finalizedAt" <= $2::timestamptz - INTERVAL '15 minutes')
  )`

/** cleanup_reauthentication: one bounded batch. */
export const cleanupReauthentication = async (
  client: AdminFreshClient,
  maximumRows: number
): Promise<ReauthenticationCleanup> =>
  client.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe(
      `SELECT "require_database_capability"(NULL)`
    )
    if (
      !Number.isSafeInteger(maximumRows) ||
      maximumRows < 1 ||
      maximumRows > 1000
    )
      await raise(
        transaction,
        '22023',
        'Reauthentication cleanup batch size is invalid.'
      )
    const checkedAt = (
      await transaction.$queryRawUnsafe<Array<{ now: Date }>>(
        `SELECT clock_timestamp()::timestamptz(3) AS now`
      )
    )[0]!.now
    const candidates = await transaction.$queryRawUnsafe<
      Array<{
        id: string
        stagedSessionId: string | null
        userId: string
      }>
    >(
      `SELECT "id", "userId", "stagedSessionId"
       FROM "ReauthenticationIntent"
       WHERE ${CLEANUP_CANDIDATE.replaceAll('$2', '$1')}
       ORDER BY "userId", "id" LIMIT $2`,
      checkedAt,
      maximumRows
    )
    const intentIds = candidates.map(({ id }) => id)
    const sessionIds = candidates.flatMap(({ stagedSessionId }) =>
      stagedSessionId ? [stagedSessionId] : []
    )
    // The finalizer's lock order; every predicate is re-checked below.
    await transaction.$queryRawUnsafe(
      `SELECT 1 FROM "User"
       WHERE "id" IN (
         SELECT "userId" FROM "ReauthenticationIntent"
         WHERE "id" = ANY($1::uuid[])
       )
       ORDER BY "id" FOR UPDATE`,
      intentIds
    )
    await transaction.$queryRawUnsafe(
      `SELECT 1 FROM "Session" WHERE "id" = ANY($1::uuid[])
       ORDER BY "userId", "id" FOR UPDATE`,
      sessionIds
    )
    await transaction.$queryRawUnsafe(
      `SELECT 1 FROM "ReauthenticationIntent"
       WHERE "id" = ANY($1::uuid[])
       ORDER BY "userId", "id" FOR UPDATE`,
      intentIds
    )
    const pendingSessionsDeleted = await transaction.$executeRawUnsafe(
      `DELETE FROM "Session" AS session
       USING "ReauthenticationIntent" AS intent
       WHERE intent."id" = ANY($1::uuid[])
         AND ((intent."state" IN ('PREPARED', 'STAGED')
             AND intent."expiresAt" <= $2::timestamptz)
           OR (intent."state" = 'FINALIZED'
             AND intent."finalizedAt" <= $2::timestamptz - INTERVAL '15 minutes'))
         AND session."id" = intent."stagedSessionId"
         AND session."userId" = intent."userId"
         AND session."authorizationState" = 'PENDING_REAUTH'`,
      intentIds,
      checkedAt
    )
    const intentsDeleted = await transaction.$executeRawUnsafe(
      `DELETE FROM "ReauthenticationIntent"
       WHERE "id" = ANY($1::uuid[]) AND ${CLEANUP_CANDIDATE}`,
      intentIds,
      checkedAt
    )
    const evidenceDeleted = await transaction.$executeRawUnsafe(
      `DELETE FROM "AuthorityRevocationEvidence"
       WHERE "tokenDigest" IN (
         SELECT "tokenDigest" FROM "AuthorityRevocationEvidence"
         WHERE "expiresAt" <= $1::timestamptz
         ORDER BY "tokenDigest" LIMIT $2
       )`,
      checkedAt,
      maximumRows
    )
    return { pendingSessionsDeleted, intentsDeleted, evidenceDeleted }
  })

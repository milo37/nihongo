import {
  type AdminFreshClient,
  type Transaction,
  type AdminFreshContextValue,
  raise,
  requireRuntimeReady,
  reauthenticationTokenDigest,
  contextIsValid,
  readIntent,
  REAUTHENTICATION_METADATA,
  replacementHoldsAuthority,
  type AdminFreshRotation,
  reauthenticationAuditDigest,
  type FinalizedReauthentication
} from './adminFreshShared.js'

/**
 * SSO ADMIN_FRESH re-authentication in the API (#504 P7 PR3b-1).
 *
 * These replace prepare_sso_admin_fresh (with
 * prepare_reauthentication), the SSO fresh transaction and proof
 * functions, complete_sso_admin_fresh (with
 * stage_reauthentication_session, finalize_reauthentication and
 * confirm_v1_session_issuance), the cancel, abort, reconcile and cleanup
 * functions, and sso_admin_session_is_fresh, step for step: the same
 * lock order (User, then the Sessions in id order, then the intent), the same
 * conditions and the same SQLSTATE on failure. #504 P7 PR4b-1: there is no
 * Session family or rotation fence; the replacement Session ends the old one.
 * The Session and delete-limit triggers validate every row the API writes.
 */

export type {
  AdminFreshClient,
  AdminFreshContextValue
} from './adminFreshShared.js'
export {
  adminSessionFreshSql,
  reauthenticationTokenDigest
} from './adminFreshShared.js'
export {
  prepareAdminFresh,
  prepareReauthentication
} from './adminFreshPrepare.js'
export {
  consumeAdminFreshTransaction,
  createAdminFreshTransaction,
  stageAdminFreshProof
} from './adminFreshProof.js'
export {
  abortReauthentication,
  cancelAdminFreshProof,
  cleanupReauthentication,
  reconcileAdminFresh,
  reconcileReauthentication
} from './adminFreshRecovery.js'

interface StagedReauthenticationSession {
  id: string
  expiresAt: Date
  createdAt: Date
  updatedAt: Date
  userId: string
}

/**
 * stage_reauthentication_session inside the caller's transaction: the
 * PENDING_REAUTH replacement of a PREPARED intent. Returns null when the
 * intent or its old Session no longer qualifies.
 */
export const stageReauthentication = async (
  transaction: Transaction,
  input: {
    readonly intentId: string
    readonly sessionId: string
    readonly rawNewToken: string
    readonly userId: string
    readonly expiresAt: Date
    readonly ipAddress: string | null
    readonly userAgent: string | null
  }
): Promise<StagedReauthenticationSession | null> => {
  await transaction.$executeRawUnsafe(
    `SELECT "require_database_capability"(NULL)`
  )
  await requireRuntimeReady(transaction)
  if (input.rawNewToken === '') return null
  const first = await readIntent(transaction, input.intentId, false)
  if (!first) return null
  await transaction.$queryRawUnsafe(
    `SELECT 1 FROM "User" WHERE "id" = $1::uuid FOR UPDATE`,
    first.userId
  )
  const intent = await readIntent(transaction, input.intentId, true)
  if (!intent) return null
  const qualifies = await transaction.$queryRawUnsafe<
    Array<{ ready: boolean; token: string }>
  >(
    `SELECT old_session."token",
       $4::timestamptz > clock_timestamp()
         AND $5::timestamptz >= clock_timestamp() + INTERVAL '23 hours 55 minutes'
         AND $5::timestamptz <= clock_timestamp() + INTERVAL '24 hours 5 minutes'
         AS ready
     FROM "User" AS target_user
     JOIN "Session" AS old_session
       ON old_session."id" = $2::uuid
      AND old_session."userId" = target_user."id"
     WHERE target_user."id" = $1::uuid
       AND target_user."authorityGeneration" = $3::integer
       AND target_user."role" = 'ADMIN'
       AND target_user."accountStatus" = 'ACTIVE'
       AND old_session."issuerProtocolVersion" = 'OWNED_V1'
       AND old_session."authorizationState" = 'ACTIVE'
       AND old_session."authorityGeneration" = $3::integer
       AND old_session."expiresAt" > clock_timestamp()
       AND old_session."createdAt" + INTERVAL '30 days' > clock_timestamp()`,
    intent.userId,
    intent.oldSessionId,
    intent.capturedAuthorityGeneration,
    intent.expiresAt,
    input.expiresAt
  )
  if (
    intent.state !== 'PREPARED' ||
    intent.userId !== input.userId ||
    !qualifies.some(
      (row) =>
        row.ready &&
        reauthenticationTokenDigest(row.token) === intent.oldTokenDigest
    )
  )
    return null
  // The Session trigger accepts PENDING_REAUTH only for this PREPARED intent
  // and sets the 1 day expiry and server times.
  const staged = await transaction.$queryRawUnsafe<
    StagedReauthenticationSession[]
  >(
    `INSERT INTO "Session" (
       "id", "expiresAt", "token", "createdAt", "updatedAt", "ipAddress",
       "userAgent", "userId", "authorityGeneration", "issuerProtocolVersion",
       "authorizationState"
     ) VALUES (
       $1::uuid, $2::timestamptz, $3, clock_timestamp(), clock_timestamp(),
       left(COALESCE($4, ''), 512), left(COALESCE($5, ''), 512), $6::uuid,
       $7::integer, 'OWNED_V1', 'PENDING_REAUTH'
     )
     RETURNING "id", "expiresAt", "createdAt", "updatedAt", "userId"`,
    input.sessionId,
    input.expiresAt,
    input.rawNewToken,
    input.ipAddress,
    input.userAgent,
    intent.userId,
    intent.capturedAuthorityGeneration
  )
  const updated = await transaction.$executeRawUnsafe(
    `UPDATE "ReauthenticationIntent"
     SET "state" = 'STAGED', "stagedSessionId" = $2::uuid,
         "stagedTokenDigest" = $3
     WHERE "id" = $1::uuid AND "state" = 'PREPARED'`,
    intent.id,
    input.sessionId,
    reauthenticationTokenDigest(input.rawNewToken)
  )
  if (updated !== 1)
    await raise(
      transaction,
      '40001',
      'Reauthentication intent was already consumed.'
    )
  return staged[0] ?? null
}

/**
 * finalize_reauthentication inside the caller's transaction: activate
 * the staged Session, delete the old one, write the REAUTHENTICATION audit row, and re-check authority before and after the
 * intent becomes FINALIZED. Every failure raises.
 */
export const finalizeReauthentication = async (
  transaction: Transaction,
  intentId: string,
  rawNewToken: string
): Promise<FinalizedReauthentication> => {
  await transaction.$executeRawUnsafe(
    `SELECT "require_database_capability"(NULL)`
  )
  await requireRuntimeReady(transaction)
  if (rawNewToken === '')
    return raise(
      transaction,
      '22023',
      'Reauthentication finalization proof is invalid.'
    )
  const first = await readIntent(transaction, intentId, false)
  if (!first)
    return raise(
      transaction,
      '42501',
      'Reauthentication finalization intent is unavailable.'
    )
  await transaction.$queryRawUnsafe(
    `SELECT 1 FROM "User" WHERE "id" = $1::uuid FOR UPDATE`,
    first.userId
  )
  await transaction.$queryRawUnsafe(
    `SELECT 1 FROM "Session"
     WHERE "id" = ANY($1::uuid[]) AND "userId" = $2::uuid
     ORDER BY "id" FOR UPDATE`,
    [
      first.oldSessionId,
      ...(first.stagedSessionId ? [first.stagedSessionId] : [])
    ],
    first.userId
  )
  const intent = await readIntent(transaction, intentId, true)
  if (!intent)
    return raise(
      transaction,
      '42501',
      'Reauthentication finalization intent is unavailable.'
    )
  const live = (
    await transaction.$queryRawUnsafe<Array<{ live: boolean }>>(
      `SELECT $1::timestamptz > clock_timestamp() AS live`,
      intent.expiresAt
    )
  )[0]?.live
  if (
    intent.state !== 'STAGED' ||
    !live ||
    intent.stagedTokenDigest !== reauthenticationTokenDigest(rawNewToken) ||
    !intent.stagedSessionId
  )
    return raise(
      transaction,
      '42501',
      'Reauthentication finalization intent proof failed.'
    )
  const sessions = await transaction.$queryRawUnsafe<
    Array<{ beforeState: string; ready: boolean; token: string }>
  >(
    `SELECT old_session."token",
       CASE WHEN old_session."createdAt" + INTERVAL '5 minutes' > clock_timestamp()
         THEN 'SESSION_FRESH' ELSE 'SESSION_STALE' END AS "beforeState",
       pending."expiresAt" - pending."createdAt" = INTERVAL '1 day'
         AND pending."authorityGeneration" = $4::integer
         AND old_session."expiresAt" > clock_timestamp()
         AND old_session."createdAt" + INTERVAL '30 days' > clock_timestamp()
         AND pending."expiresAt" > clock_timestamp()
         AND EXISTS (
           SELECT 1 FROM "User" AS target_user
           WHERE target_user."id" = $1::uuid
             AND target_user."authorityGeneration" = $4::integer
             AND target_user."role" = $5::"UserRole"
             AND target_user."accountStatus" = $6::"UserAccountStatus"
         ) AS ready
     FROM "Session" AS old_session
     JOIN "Session" AS pending
       ON pending."id" = $3::uuid AND pending."userId" = $1::uuid
      AND pending."token" = $7
      AND pending."authorizationState" = 'PENDING_REAUTH'
      AND pending."issuerProtocolVersion" = 'OWNED_V1'
     WHERE old_session."id" = $2::uuid AND old_session."userId" = $1::uuid
       AND old_session."issuerProtocolVersion" = 'OWNED_V1'
       AND old_session."authorizationState" = 'ACTIVE'`,
    intent.userId,
    intent.oldSessionId,
    intent.stagedSessionId,
    intent.capturedAuthorityGeneration,
    intent.capturedRole,
    intent.capturedAccountStatus,
    rawNewToken
  )
  const pair = sessions[0]
  if (
    !pair ||
    !pair.ready ||
    reauthenticationTokenDigest(pair.token) !== intent.oldTokenDigest
  )
    return raise(
      transaction,
      '42501',
      'Reauthentication finalization authority proof failed.'
    )
  const activated = await transaction.$queryRawUnsafe<
    Array<{ createdAt: Date; expiresAt: Date }>
  >(
    `UPDATE "Session" SET "authorizationState" = 'ACTIVE'
     WHERE "id" = $1::uuid AND "token" = $2
       AND "authorizationState" = 'PENDING_REAUTH'
     RETURNING "createdAt", "expiresAt"`,
    intent.stagedSessionId,
    rawNewToken
  )
  const activatedSession = activated[0]
  if (!activatedSession)
    return raise(transaction, '40001', 'Pending Session activation CAS failed.')
  const deleted = await transaction.$executeRawUnsafe(
    `DELETE FROM "Session"
     WHERE "id" = $1::uuid AND "userId" = $2::uuid
       AND "issuerProtocolVersion" = 'OWNED_V1'
       AND "authorizationState" = 'ACTIVE' AND "token" = $3
       AND "authorityGeneration" = $4::integer`,
    intent.oldSessionId,
    intent.userId,
    pair.token,
    intent.capturedAuthorityGeneration
  )
  if (deleted !== 1)
    await raise(
      transaction,
      '40001',
      'Reauthentication old Session exact CAS failed.'
    )
  await transaction.$executeRawUnsafe(
    `INSERT INTO "AdminAuditLog" (
       "command", "targetType", "targetId", "actorKind", "actorUserId",
       "actorId", "actorRole", "actorLabel", "actorSystemLabel",
       "beforeState", "afterState", "beforeRowVersion", "afterRowVersion",
       "changedFields", "metadata", "contentDigest", "operationId",
       "requestId", "environment", "occurredAt"
     ) VALUES (
       'REAUTHENTICATION', 'ADMIN_SESSION', $1, 'ACCOUNT', $2::uuid,
       $2::uuid, 'ADMIN', 'ACTIVE_ADMIN', NULL, $3, 'SESSION_FRESH', NULL,
       NULL, '["SESSION_ROTATION"]'::jsonb, $4::jsonb, $5, $1::uuid,
       $6::uuid, $7::"AdminAuditEnvironment", clock_timestamp()
     )`,
    intent.operationId,
    intent.userId,
    pair.beforeState,
    JSON.stringify(REAUTHENTICATION_METADATA),
    reauthenticationAuditDigest(intent.operationId, pair.beforeState),
    intent.requestId,
    intent.environment
  )
  if (
    !(await replacementHoldsAuthority(
      transaction,
      intent,
      intent.stagedSessionId,
      rawNewToken
    ))
  )
    await raise(
      transaction,
      '42501',
      'Reauthentication authority expired before commit.'
    )
  const finalized = await transaction.$executeRawUnsafe(
    `UPDATE "ReauthenticationIntent"
     SET "state" = 'FINALIZED', "finalizedAt" = clock_timestamp()
     WHERE "id" = $1::uuid AND "state" = 'STAGED'`,
    intent.id
  )
  if (finalized !== 1)
    await raise(
      transaction,
      '40001',
      'Reauthentication finalization intent CAS failed.'
    )
  if (
    !(await replacementHoldsAuthority(
      transaction,
      intent,
      intent.stagedSessionId,
      rawNewToken
    ))
  )
    await raise(
      transaction,
      '42501',
      'Reauthentication authority expired before commit.'
    )
  return {
    id: intent.stagedSessionId,
    createdAt: activatedSession.createdAt,
    expiresAt: activatedSession.expiresAt,
    authorityGeneration: intent.capturedAuthorityGeneration
  }
}

/**
 * complete_sso_admin_fresh: stage, finalize and confirm the rotation of
 * a staged proof, and mark the proof complete, all in one transaction.
 */
export const completeAdminFresh = async (
  client: AdminFreshClient,
  input: {
    readonly proofDigest: string
    readonly rawOldToken: string
    readonly newSessionId: string
    readonly rawNewToken: string
    readonly ipAddress: string
    readonly userAgent: string
  }
): Promise<AdminFreshRotation[]> =>
  client.$transaction(async (transaction) => {
    await requireRuntimeReady(transaction)
    const readProof = async (lock: boolean) =>
      (
        await transaction.$queryRawUnsafe<
          Array<{
            callbackURL: string
            completedSessionId: string | null
            context: AdminFreshContextValue
            live: boolean
          }>
        >(
          `SELECT "callbackURL", "completedSessionId", "context",
             "expiresAt" > clock_timestamp() AS live
           FROM "SsoAdminFreshProof" WHERE "proofDigest" = $1${lock ? ' FOR UPDATE' : ''}`,
          input.proofDigest
        )
      )[0]
    const unlocked = await readProof(false)
    if (!unlocked || unlocked.completedSessionId !== null) return []
    await transaction.$queryRawUnsafe(
      `SELECT 1 FROM "User" WHERE "id" = $1::uuid FOR UPDATE`,
      unlocked.context.userId
    )
    const proof = await readProof(true)
    if (
      !proof ||
      proof.completedSessionId !== null ||
      !proof.live ||
      !(await contextIsValid(transaction, proof.context))
    )
      return []
    const oldSession = await transaction.$queryRawUnsafe<unknown[]>(
      `SELECT 1 FROM "Session"
       WHERE "id" = $1::uuid AND "userId" = $2::uuid AND "token" = $3`,
      proof.context.sessionId,
      proof.context.userId,
      input.rawOldToken
    )
    if (oldSession.length !== 1) return []
    const expiresAt = (
      await transaction.$queryRawUnsafe<Array<{ at: Date }>>(
        `SELECT clock_timestamp() + INTERVAL '1 day' AS at`
      )
    )[0]!.at
    const staged = await stageReauthentication(transaction, {
      intentId: proof.context.intentId,
      sessionId: input.newSessionId,
      rawNewToken: input.rawNewToken,
      userId: proof.context.userId,
      expiresAt,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent
    })
    if (staged?.id !== input.newSessionId)
      await raise(transaction, '42501', 'SSO staging rejected.')
    const replacement = await finalizeReauthentication(
      transaction,
      proof.context.intentId,
      input.rawNewToken
    )
    if (
      replacement.id !== input.newSessionId ||
      !(await confirmIssuedSession(transaction, {
        token: input.rawNewToken,
        sessionId: input.newSessionId,
        userId: proof.context.userId,
        authorityGeneration: proof.context.authorityGeneration
      }))
    )
      await raise(transaction, '42501', 'SSO rotation confirmation rejected.')
    await transaction.$executeRawUnsafe(
      `UPDATE "SsoAdminFreshProof"
       SET "completedSessionId" = $2::uuid, "completedAt" = $3::timestamptz,
           "expiresAt" = least(
             $3::timestamptz + INTERVAL '5 minutes', $4::timestamptz
           )
       WHERE "proofDigest" = $1`,
      input.proofDigest,
      input.newSessionId,
      replacement.createdAt,
      replacement.expiresAt
    )
    return [
      {
        ...replacement,
        userId: proof.context.userId,
        callbackURL: proof.callbackURL
      }
    ]
  })

// confirm_v1_session_issuance for an ADMIN replacement, in the same
// transaction: the active Session keeps the captured authority.
const confirmIssuedSession = async (
  transaction: Transaction,
  input: {
    readonly token: string
    readonly sessionId: string
    readonly userId: string
    readonly authorityGeneration: number
  }
): Promise<boolean> =>
  (
    await transaction.$queryRawUnsafe<unknown[]>(
      `SELECT 1
       FROM "User" AS target_user
       JOIN "Session" AS session
         ON session."userId" = target_user."id" AND session."id" = $2::uuid
       WHERE target_user."id" = $1::uuid
         AND target_user."authorityGeneration" = $3::integer
         AND target_user."role" = 'ADMIN'
         AND target_user."accountStatus" = 'ACTIVE'
         AND session."token" = $4
         AND session."authorizationState" = 'ACTIVE'
         AND session."issuerProtocolVersion" = 'OWNED_V1'
         AND session."authorityGeneration" = $3::integer
         AND session."expiresAt" > clock_timestamp()
         AND session."createdAt" + INTERVAL '30 days' > clock_timestamp()`,
      input.userId,
      input.sessionId,
      input.authorityGeneration,
      input.token
    )
  ).length === 1

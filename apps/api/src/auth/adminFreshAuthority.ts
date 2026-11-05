import { createHash, randomUUID } from 'node:crypto'
import type { Prisma, PrismaClient } from '../generated/prisma/client.js'
import { adminAuditContentDigest } from '../admin/adminRepositoryCommon.js'

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

export type AdminFreshClient = Pick<
  PrismaClient,
  '$queryRawUnsafe' | '$executeRawUnsafe' | '$transaction'
>
type Transaction = Prisma.TransactionClient

export interface AdminFreshContextValue {
  readonly intentId: string
  readonly userId: string
  readonly sessionId: string
  readonly authorityGeneration: number
  readonly provider: string
  readonly accountId: string
}

const raise = async (
  transaction: Transaction,
  sqlState: '22023' | '40001' | '42501',
  message: string
): Promise<never> => {
  await transaction.$executeRawUnsafe(
    `DO $raise$ BEGIN RAISE EXCEPTION USING ERRCODE = '${sqlState}', MESSAGE = '${message}'; END $raise$`
  )
  throw new Error('PostgreSQL did not raise the ADMIN_FRESH failure.')
}

const requireRuntimeReady = async (
  client: Pick<PrismaClient, '$queryRawUnsafe'>
): Promise<void> => {
  await client.$queryRawUnsafe(`SELECT "require_runtime_ready"() AS ready`)
}

/** The intent token digest, as reauthentication_token_digest computed it. */
export const reauthenticationTokenDigest = (rawToken: string): string =>
  createHash('sha256')
    .update(
      Buffer.concat([
        Buffer.from('nihongo-reauthentication-intent-v1', 'utf8'),
        Buffer.from([0]),
        Buffer.from(rawToken, 'utf8')
      ])
    )
    .digest('hex')

const isLocalCallback = (callbackURL: string): boolean =>
  callbackURL.startsWith('/') && !callbackURL.startsWith('//')

/**
 * A boolean SQL expression: the raw Session token belongs to a Session
 * created by a completed SSO ADMIN_FRESH proof less than 5 minutes ago.
 * `tokenParameter` is a bind placeholder.
 */
export const adminSessionFreshSql = (tokenParameter: string): string => `
  EXISTS (
    SELECT 1 FROM "SsoAdminFreshProof" AS proof
    JOIN "Session" AS session ON session."id" = proof."completedSessionId"
    JOIN "User" AS actor
      ON actor."id" = session."userId"
     AND actor."id" = (proof."context"->>'userId')::UUID
    JOIN "Account" AS account
      ON account."userId" = actor."id"
     AND account."providerId" = proof."context"->>'provider'
     AND account."accountId" = proof."context"->>'accountId'
    WHERE session."token" = ${tokenParameter}
      AND session."authorizationState" = 'ACTIVE'
      AND session."issuerProtocolVersion" = 'PHASE7_V1'
      AND actor."role" = 'ADMIN' AND actor."accountStatus" = 'ACTIVE'
      AND actor."authorityGeneration" =
        (proof."context"->>'authorityGeneration')::INTEGER
      AND session."authorityGeneration" = actor."authorityGeneration"
      AND proof."expiresAt" > clock_timestamp()
      AND proof."completedAt" + INTERVAL '5 minutes' > clock_timestamp()
      AND session."createdAt" + INTERVAL '5 minutes' > clock_timestamp()
      AND session."expiresAt" > clock_timestamp()
  )`

// sso_fresh_context_valid: the PREPARED intent still owns the exact
// active old Session and linked provider account named by the context.
const contextIsValid = async (
  transaction: Transaction,
  context: AdminFreshContextValue
): Promise<boolean> => {
  const rows = await transaction.$queryRawUnsafe<
    Array<{ oldTokenDigest: string; token: string }>
  >(
    `SELECT intent."oldTokenDigest", session."token"
     FROM "ReauthenticationIntent" AS intent
     JOIN "User" AS actor ON actor."id" = intent."userId"
     JOIN "Session" AS session
       ON session."id" = intent."oldSessionId"
      AND session."userId" = actor."id"
     JOIN "Account" AS account
       ON account."userId" = actor."id"
      AND account."providerId" = $5 AND account."accountId" = $6
     WHERE intent."id" = $1::uuid
       AND intent."state" = 'PREPARED' AND intent."expiresAt" > clock_timestamp()
       AND intent."userId" = $2::uuid
       AND intent."oldSessionId" = $3::uuid
       AND intent."capturedAuthorityGeneration" = $4::integer
       AND actor."authorityGeneration" = intent."capturedAuthorityGeneration"
       AND actor."role" = 'ADMIN' AND actor."accountStatus" = 'ACTIVE'
       AND session."authorizationState" = 'ACTIVE'
       AND session."issuerProtocolVersion" = 'PHASE7_V1'
       AND session."authorityGeneration" = intent."capturedAuthorityGeneration"
       AND session."expiresAt" > clock_timestamp()
       AND session."createdAt" + INTERVAL '30 days' > clock_timestamp()`,
    context.intentId,
    context.userId,
    context.sessionId,
    context.authorityGeneration,
    context.provider,
    context.accountId
  )
  return rows.some(
    (row) => reauthenticationTokenDigest(row.token) === row.oldTokenDigest
  )
}

const intentExpiry = async (
  transaction: Transaction,
  intentId: string
): Promise<Date | null> => {
  const rows = await transaction.$queryRawUnsafe<Array<{ expiresAt: Date }>>(
    `SELECT "expiresAt" FROM "ReauthenticationIntent" WHERE "id" = $1::uuid`,
    intentId
  )
  return rows[0]?.expiresAt ?? null
}

export interface PreparedReauthentication {
  intentId: string
  operationId: string
  requestId: string
  email: string
  expiresAt: Date
  sessionId: string
  generation: number
}

/**
 * prepare_reauthentication inside the caller's transaction: a PREPARED
 * intent for the exact active ADMIN Session of the raw token, after removing
 * one expired unfinished intent of that Session. Returns null when the Session
 * does not qualify; raises 40001 when a live intent already owns it.
 */
export const prepareReauthentication = async (
  transaction: Transaction,
  input: {
    readonly rawOldToken: string
    readonly expectedActorId: string
    readonly requestId: string
    readonly environment: string
    readonly intentId: string
  }
): Promise<PreparedReauthentication | null> => {
  await transaction.$executeRawUnsafe(
    `SELECT "require_database_capability"($1::"AdminAuditEnvironment")`,
    input.environment
  )
  await requireRuntimeReady(transaction)
  if (input.rawOldToken === '') return null
  const targets = await transaction.$queryRawUnsafe<
    Array<{
      email: string
      generation: number
      sessionId: string
      userId: string
    }>
  >(
    `SELECT session."userId",
       session."id" AS "sessionId", target_user."authorityGeneration" AS generation,
       target_user."email"
     FROM "Session" AS session
     JOIN "User" AS target_user ON target_user."id" = session."userId"
     WHERE session."token" = $1 AND session."userId" = $2::uuid
       AND session."issuerProtocolVersion" = 'PHASE7_V1'
       AND session."authorizationState" = 'ACTIVE'
       AND session."authorityGeneration" = target_user."authorityGeneration"
       AND target_user."role" = 'ADMIN'
       AND target_user."accountStatus" = 'ACTIVE'
       AND target_user."emailVerified"
       AND session."expiresAt" > clock_timestamp()
       AND session."createdAt" + INTERVAL '30 days' > clock_timestamp()`,
    input.rawOldToken,
    input.expectedActorId
  )
  const target = targets[0]
  if (!target) return null
  await transaction.$queryRawUnsafe(
    `SELECT 1 FROM "User" WHERE "id" = $1::uuid FOR UPDATE`,
    target.userId
  )
  const staleIntents = await transaction.$queryRawUnsafe<
    Array<{ id: string; stagedSessionId: string | null }>
  >(
    `SELECT "id", "stagedSessionId" FROM "ReauthenticationIntent"
     WHERE "oldSessionId" = $1::uuid AND "state" IN ('PREPARED', 'STAGED')
       AND "expiresAt" <= clock_timestamp()
     ORDER BY "id" LIMIT 1`,
    target.sessionId
  )
  const stale = staleIntents[0]
  await transaction.$queryRawUnsafe(
    `SELECT 1 FROM "Session"
     WHERE "userId" = $1::uuid AND "id" = ANY($2::uuid[])
     ORDER BY "id" FOR UPDATE`,
    target.userId,
    [
      target.sessionId,
      ...(stale?.stagedSessionId ? [stale.stagedSessionId] : [])
    ]
  )
  if (stale) {
    const locked = await transaction.$queryRawUnsafe<
      Array<{ id: string; stagedSessionId: string | null }>
    >(
      `SELECT "id", "stagedSessionId" FROM "ReauthenticationIntent"
       WHERE "id" = $1::uuid AND "oldSessionId" = $2::uuid
         AND "state" IN ('PREPARED', 'STAGED')
         AND "expiresAt" <= clock_timestamp()
       FOR UPDATE`,
      stale.id,
      target.sessionId
    )
    const expired = locked[0]
    if (expired) {
      await transaction.$executeRawUnsafe(
        `DELETE FROM "Session"
         WHERE "id" = $1::uuid AND "userId" = $2::uuid
           AND "authorizationState" = 'PENDING_REAUTH'`,
        expired.stagedSessionId,
        target.userId
      )
      const removed = await transaction.$executeRawUnsafe(
        `DELETE FROM "ReauthenticationIntent"
         WHERE "id" = $1::uuid AND "oldSessionId" = $2::uuid
           AND "state" IN ('PREPARED', 'STAGED')
           AND "expiresAt" <= clock_timestamp()`,
        expired.id,
        target.sessionId
      )
      if (removed !== 1)
        await raise(
          transaction,
          '40001',
          'Expired reauthentication intent cleanup lost its CAS.'
        )
    }
  }
  const live = await transaction.$queryRawUnsafe<unknown[]>(
    `SELECT 1 FROM "ReauthenticationIntent"
     WHERE "oldSessionId" = $1::uuid AND "state" IN ('PREPARED', 'STAGED')`,
    target.sessionId
  )
  if (live.length > 0)
    await raise(
      transaction,
      '40001',
      'A live reauthentication intent already owns this Session.'
    )
  const stillActive = await transaction.$queryRawUnsafe<unknown[]>(
    `SELECT 1
     FROM "Session" AS session
     JOIN "User" AS target_user ON target_user."id" = session."userId"
     WHERE session."id" = $1::uuid AND session."token" = $2
       AND session."authorizationState" = 'ACTIVE'
       AND session."authorityGeneration" = $3::integer
       AND target_user."authorityGeneration" = $3::integer
       AND target_user."role" = 'ADMIN'
       AND target_user."accountStatus" = 'ACTIVE'
       AND session."expiresAt" > clock_timestamp()
       AND session."createdAt" + INTERVAL '30 days' > clock_timestamp()`,
    target.sessionId,
    input.rawOldToken,
    target.generation
  )
  if (stillActive.length !== 1) return null
  const operationId = randomUUID()
  const inserted = await transaction.$queryRawUnsafe<
    Array<{ expiresAt: Date }>
  >(
    `INSERT INTO "ReauthenticationIntent" (
       "id", "operationId", "requestId", "userId", "oldSessionId",
       "oldTokenDigest", "capturedAuthorityGeneration", "capturedRole",
       "capturedAccountStatus", "state", "environment", "createdAt",
       "expiresAt"
     ) VALUES (
       $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6,
       $7::integer, 'ADMIN', 'ACTIVE', 'PREPARED',
       $8::"AdminAuditEnvironment", clock_timestamp(),
       clock_timestamp() + INTERVAL '2 minutes'
     )
     RETURNING "expiresAt"`,
    input.intentId,
    operationId,
    input.requestId,
    target.userId,
    target.sessionId,
    reauthenticationTokenDigest(input.rawOldToken),
    target.generation,
    input.environment
  )
  return {
    intentId: input.intentId,
    operationId,
    requestId: input.requestId,
    email: target.email,
    expiresAt: inserted[0]!.expiresAt,
    sessionId: target.sessionId,
    generation: target.generation
  }
}

/** prepare_sso_admin_fresh. */
export const prepareAdminFresh = async (
  client: AdminFreshClient,
  rawToken: string,
  provider: string
): Promise<AdminFreshContextValue | null> => {
  if (provider !== 'apple' && provider !== 'google') return null
  if (rawToken === '') return null
  return client.$transaction(async (transaction) => {
    await requireRuntimeReady(transaction)
    const actors = await transaction.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT actor."id" FROM "Session" AS session
       JOIN "User" AS actor ON actor."id" = session."userId"
       WHERE session."token" = $1`,
      rawToken
    )
    const actorId = actors[0]?.id
    if (!actorId) return null
    await transaction.$queryRawUnsafe(
      `SELECT 1 FROM "User" WHERE "id" = $1::uuid FOR UPDATE`,
      actorId
    )
    const targets = await transaction.$queryRawUnsafe<
      Array<{ accountId: string; generation: number; sessionId: string }>
    >(
      `SELECT session."id" AS "sessionId",
         actor."authorityGeneration" AS generation, account."accountId"
       FROM "Session" AS session
       JOIN "User" AS actor ON actor."id" = session."userId"
       JOIN "Account" AS account
         ON account."userId" = actor."id" AND account."providerId" = $3
       WHERE session."token" = $1 AND actor."id" = $2::uuid
         AND actor."role" = 'ADMIN' AND actor."accountStatus" = 'ACTIVE'
         AND session."authorizationState" = 'ACTIVE'
         AND session."issuerProtocolVersion" = 'PHASE7_V1'
         AND session."authorityGeneration" = actor."authorityGeneration"
         AND session."expiresAt" > clock_timestamp()
         AND session."createdAt" + INTERVAL '30 days' > clock_timestamp()
         AND (SELECT count(*) FROM "Account"
              WHERE "userId" = $2::uuid AND "providerId" = $3) = 1`,
      rawToken,
      actorId,
      provider
    )
    const target = targets[0]
    if (!target) return null
    const environments = await transaction.$queryRawUnsafe<
      Array<{ environment: string }>
    >(
      `SELECT "environment"::TEXT AS environment
       FROM "DatabaseCapability" WHERE "id" = 1`
    )
    const environment = environments[0]?.environment
    if (!environment) return null
    const prepared = await prepareReauthentication(transaction, {
      rawOldToken: rawToken,
      expectedActorId: actorId,
      requestId: randomUUID(),
      environment,
      intentId: randomUUID()
    })
    if (!prepared) return null
    return {
      intentId: prepared.intentId,
      userId: actorId,
      sessionId: target.sessionId,
      authorityGeneration: target.generation,
      provider,
      accountId: target.accountId
    }
  })
}

/** create_sso_admin_fresh_transaction. */
export const createAdminFreshTransaction = async (
  client: AdminFreshClient,
  input: {
    readonly provider: string
    readonly stateDigest: string
    readonly bindingDigest: string
    readonly nonce: string
    readonly codeVerifier: string
    readonly callbackURL: string
    readonly context: AdminFreshContextValue
  }
): Promise<boolean> =>
  client.$transaction(async (transaction) => {
    await requireRuntimeReady(transaction)
    if (
      input.provider !== input.context.provider ||
      !(await contextIsValid(transaction, input.context)) ||
      !isLocalCallback(input.callbackURL)
    )
      return false
    const expiry = await intentExpiry(transaction, input.context.intentId)
    await transaction.$executeRawUnsafe(
      `DELETE FROM "SsoAdminFreshTransaction" WHERE "expiresAt" <= clock_timestamp()`
    )
    await transaction.$executeRawUnsafe(
      `DELETE FROM "SsoAdminFreshProof" WHERE "expiresAt" <= clock_timestamp()`
    )
    await transaction.$executeRawUnsafe(
      `INSERT INTO "SsoAdminFreshTransaction" (
         "userId", "provider", "stateDigest", "bindingDigest", "nonce",
         "codeVerifier", "callbackURL", "context", "createdAt", "expiresAt"
       ) VALUES (
         $1::uuid, $2, $3, $4, $5, $6, $7, $8::jsonb, clock_timestamp(),
         least($9::timestamptz, clock_timestamp() + INTERVAL '2 minutes')
       )`,
      input.context.userId,
      input.provider,
      input.stateDigest,
      input.bindingDigest,
      input.nonce,
      input.codeVerifier,
      input.callbackURL,
      JSON.stringify(input.context),
      expiry
    )
    return true
  })

/** consume_sso_admin_fresh_transaction: the one-time state row. */
export const consumeAdminFreshTransaction = async (
  client: AdminFreshClient,
  provider: string,
  stateDigest: string,
  bindingDigest: string
): Promise<unknown[]> => {
  await requireRuntimeReady(client)
  return client.$queryRawUnsafe<unknown[]>(
    `DELETE FROM "SsoAdminFreshTransaction" AS tx
     WHERE tx."provider" = $1 AND tx."stateDigest" = $2
       AND tx."bindingDigest" = $3 AND tx."expiresAt" > clock_timestamp()
     RETURNING tx."provider"::TEXT AS provider, tx."nonce"::TEXT AS nonce,
       tx."codeVerifier"::TEXT AS "codeVerifier",
       tx."callbackURL"::TEXT AS "callbackURL", tx."context"`,
    provider,
    stateDigest,
    bindingDigest
  )
}

/** stage_sso_admin_fresh_proof. */
export const stageAdminFreshProof = async (
  client: AdminFreshClient,
  input: {
    readonly context: AdminFreshContextValue
    readonly provider: string
    readonly accountId: string
    readonly proofDigest: string
    readonly callbackURL: string
  }
): Promise<boolean> =>
  client.$transaction(async (transaction) => {
    await requireRuntimeReady(transaction)
    await transaction.$queryRawUnsafe(
      `SELECT 1 FROM "User" WHERE "id" = $1::uuid FOR UPDATE`,
      input.context.userId
    )
    if (
      input.provider !== input.context.provider ||
      input.accountId !== input.context.accountId ||
      !(await contextIsValid(transaction, input.context)) ||
      !isLocalCallback(input.callbackURL)
    )
      return false
    const expiry = await intentExpiry(transaction, input.context.intentId)
    await transaction.$executeRawUnsafe(
      `INSERT INTO "SsoAdminFreshProof" (
         "userId", "proofDigest", "context", "callbackURL", "createdAt",
         "expiresAt"
       ) VALUES (
         $1::uuid, $2, $3::jsonb, $4, clock_timestamp(),
         least($5::timestamptz, clock_timestamp() + INTERVAL '2 minutes')
       )`,
      input.context.userId,
      input.proofDigest,
      JSON.stringify(input.context),
      input.callbackURL,
      expiry
    )
    return true
  })

interface IntentRow {
  readonly id: string
  readonly operationId: string
  readonly requestId: string
  readonly userId: string
  readonly oldSessionId: string
  readonly oldTokenDigest: string
  readonly capturedAuthorityGeneration: number
  readonly capturedRole: string
  readonly capturedAccountStatus: string
  readonly state: string
  readonly stagedSessionId: string | null
  readonly stagedTokenDigest: string | null
  readonly environment: string
  readonly expiresAt: Date
}

const INTENT_COLUMNS = `"id", "operationId", "requestId", "userId",
  "oldSessionId", "oldTokenDigest", "capturedAuthorityGeneration", "capturedRole"::TEXT AS "capturedRole",
  "capturedAccountStatus"::TEXT AS "capturedAccountStatus",
  "state"::TEXT AS "state", "stagedSessionId", "stagedTokenDigest",
  "environment"::TEXT AS "environment", "expiresAt"`

const readIntent = async (
  transaction: Transaction,
  intentId: string,
  lock: boolean
): Promise<IntentRow | undefined> =>
  (
    await transaction.$queryRawUnsafe<IntentRow[]>(
      `SELECT ${INTENT_COLUMNS} FROM "ReauthenticationIntent"
       WHERE "id" = $1::uuid${lock ? ' FOR UPDATE' : ''}`,
      intentId
    )
  )[0]

const REAUTHENTICATION_METADATA = {
  kind: 'REAUTHENTICATION_V1',
  rotation: 'OLD_REVOKED_NEW_ISSUED'
} as const

// The rotated Session still holds ADMIN authority.
const replacementHoldsAuthority = async (
  transaction: Transaction,
  intent: IntentRow,
  sessionId: string,
  rawNewToken: string
): Promise<boolean> =>
  (
    await transaction.$queryRawUnsafe<unknown[]>(
      `SELECT 1
       FROM "User" AS target_user
       JOIN "Session" AS session
         ON session."id" = $2::uuid AND session."userId" = target_user."id"
       WHERE target_user."id" = $1::uuid
         AND target_user."authorityGeneration" = $3::integer
         AND target_user."role" = 'ADMIN'
         AND target_user."accountStatus" = 'ACTIVE'
         AND session."token" = $4
         AND session."issuerProtocolVersion" = 'PHASE7_V1'
         AND session."authorizationState" = 'ACTIVE'
         AND session."authorityGeneration" = $3::integer
         AND session."expiresAt" > clock_timestamp()
         AND session."createdAt" + INTERVAL '30 days' > clock_timestamp()`,
      intent.userId,
      sessionId,
      intent.capturedAuthorityGeneration,
      rawNewToken
    )
  ).length === 1

export interface AdminFreshRotation {
  id: string
  createdAt: Date
  expiresAt: Date
  authorityGeneration: number
  userId: string
  callbackURL: string
}

export interface StagedReauthenticationSession {
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
       AND old_session."issuerProtocolVersion" = 'PHASE7_V1'
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
       $7::integer, 'PHASE7_V1', 'PENDING_REAUTH'
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

export interface FinalizedReauthentication {
  id: string
  createdAt: Date
  expiresAt: Date
  authorityGeneration: number
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
      AND pending."issuerProtocolVersion" = 'PHASE7_V1'
     WHERE old_session."id" = $2::uuid AND old_session."userId" = $1::uuid
       AND old_session."issuerProtocolVersion" = 'PHASE7_V1'
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
       AND "issuerProtocolVersion" = 'PHASE7_V1'
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
         AND session."issuerProtocolVersion" = 'PHASE7_V1'
         AND session."authorityGeneration" = $3::integer
         AND session."expiresAt" > clock_timestamp()
         AND session."createdAt" + INTERVAL '30 days' > clock_timestamp()`,
      input.userId,
      input.sessionId,
      input.authorityGeneration,
      input.token
    )
  ).length === 1

const reauthenticationAuditDigest = (
  operationId: string,
  beforeState: string
): string =>
  adminAuditContentDigest({
    operationId,
    command: 'REAUTHENTICATION',
    targetType: 'ADMIN_SESSION',
    targetId: operationId,
    beforeState,
    afterState: 'SESSION_FRESH',
    beforeRowVersion: null,
    afterRowVersion: null,
    changedFields: ['SESSION_ROTATION'],
    metadata: REAUTHENTICATION_METADATA
  } as unknown as Parameters<typeof adminAuditContentDigest>[0])

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
       AND session."issuerProtocolVersion" = 'PHASE7_V1'
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

const CLEANUP_CANDIDATE = `(
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

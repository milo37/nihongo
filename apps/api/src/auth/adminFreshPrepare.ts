import { randomUUID } from 'node:crypto'
import {
  type AdminFreshClient,
  type Transaction,
  type AdminFreshContextValue,
  raise,
  requireRuntimeReady,
  reauthenticationTokenDigest
} from './adminFreshShared.js'

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
       AND session."issuerProtocolVersion" = 'OWNED_V1'
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
         AND session."issuerProtocolVersion" = 'OWNED_V1'
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

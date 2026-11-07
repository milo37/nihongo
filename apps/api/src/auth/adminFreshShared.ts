import { createHash } from 'node:crypto'
import type { Prisma, PrismaClient } from '../generated/prisma/client.js'
import { adminAuditContentDigest } from '../admin/adminRepositoryCommon.js'

export { adminSessionFreshSql } from './adminFreshSql.js'

export type AdminFreshClient = Pick<
  PrismaClient,
  '$queryRawUnsafe' | '$executeRawUnsafe' | '$transaction'
>
export type Transaction = Prisma.TransactionClient

export interface AdminFreshContextValue {
  readonly intentId: string
  readonly userId: string
  readonly sessionId: string
  readonly authorityGeneration: number
  readonly provider: string
  readonly accountId: string
}

export const raise = async (
  transaction: Transaction,
  sqlState: '22023' | '40001' | '42501',
  message: string
): Promise<never> => {
  await transaction.$executeRawUnsafe(
    `DO $raise$ BEGIN RAISE EXCEPTION USING ERRCODE = '${sqlState}', MESSAGE = '${message}'; END $raise$`
  )
  throw new Error('PostgreSQL did not raise the ADMIN_FRESH failure.')
}

export const requireRuntimeReady = async (
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

export const isLocalCallback = (callbackURL: string): boolean =>
  callbackURL.startsWith('/') && !callbackURL.startsWith('//')

// sso_fresh_context_valid: the PREPARED intent still owns the exact
// active old Session and linked provider account named by the context.
export const contextIsValid = async (
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
       AND session."issuerProtocolVersion" = 'OWNED_V1'
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

export const intentExpiry = async (
  transaction: Transaction,
  intentId: string
): Promise<Date | null> => {
  const rows = await transaction.$queryRawUnsafe<Array<{ expiresAt: Date }>>(
    `SELECT "expiresAt" FROM "ReauthenticationIntent" WHERE "id" = $1::uuid`,
    intentId
  )
  return rows[0]?.expiresAt ?? null
}

export interface IntentRow {
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

export const INTENT_COLUMNS = `"id", "operationId", "requestId", "userId",
  "oldSessionId", "oldTokenDigest", "capturedAuthorityGeneration", "capturedRole"::TEXT AS "capturedRole",
  "capturedAccountStatus"::TEXT AS "capturedAccountStatus",
  "state"::TEXT AS "state", "stagedSessionId", "stagedTokenDigest",
  "environment"::TEXT AS "environment", "expiresAt"`

export const readIntent = async (
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

export const REAUTHENTICATION_METADATA = {
  kind: 'REAUTHENTICATION_V1',
  rotation: 'OLD_REVOKED_NEW_ISSUED'
} as const

// The rotated Session still holds ADMIN authority.
export const replacementHoldsAuthority = async (
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
         AND session."issuerProtocolVersion" = 'OWNED_V1'
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

export const reauthenticationAuditDigest = (
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

export interface FinalizedReauthentication {
  id: string
  createdAt: Date
  expiresAt: Date
  authorityGeneration: number
}

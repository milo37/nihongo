import { Prisma, type PrismaClient } from '../generated/prisma/client.js'

/**
 * Owned V1 Session issuance, refresh, sign-out and principal resolution in the
 * API (#504 P7 PR3a).
 *
 * These replace issue_v1_session, refresh_current_remembered_session
 * (with refresh_remembered_session), owned_sign_out and
 * resolve_v1_principal step for step: the same lock order (User, then
 * the Session, FOR UPDATE), the same authority conditions and a re-check
 * before commit. #504 P7 PR4b-1: a Session has no family or rotation fence; a
 * sign-out ends the Session of its token. Session_validate_authority_write
 * still validates every row the API writes.
 */

export type OwnedSessionClient = Pick<
  PrismaClient,
  '$queryRawUnsafe' | '$executeRawUnsafe' | '$transaction'
>
type Transaction = Prisma.TransactionClient

const raise = async (
  transaction: Transaction,
  sqlState: '23514' | '42501',
  message: string
): Promise<never> => {
  await transaction.$executeRawUnsafe(
    `DO $raise$ BEGIN RAISE EXCEPTION USING ERRCODE = '${sqlState}', MESSAGE = '${message}'; END $raise$`
  )
  throw new Error('PostgreSQL did not raise the Session authority failure.')
}

const requireRuntimeReady = async (
  client: Pick<PrismaClient, '$queryRawUnsafe'>
): Promise<void> => {
  await client.$queryRawUnsafe(`SELECT "require_runtime_ready"() AS ready`)
}

/**
 * The V1 principal of a raw Session token as one SQL subquery, so callers keep
 * joining it in the same statement. `tokenParameter` is a bind placeholder.
 */
export const v1PrincipalQuery = (tokenParameter: string): string => `
  SELECT target_user."id" AS "userId", target_user."name"::TEXT AS "name",
    target_user."role", target_user."targetLevel", session."id" AS "sessionId",
    session."createdAt", session."expiresAt"
  FROM (SELECT "require_runtime_ready"() AS ready) AS runtime
  JOIN "Session" AS session
    ON runtime.ready AND session."token" = ${tokenParameter}
  JOIN "User" AS target_user ON target_user."id" = session."userId"
  WHERE ${tokenParameter} <> ''
    AND session."issuerProtocolVersion" = 'PHASE7_V1'
    AND session."authorizationState" = 'ACTIVE'
    AND session."authorityGeneration" = target_user."authorityGeneration"
    AND target_user."accountStatus" = 'ACTIVE'
    AND session."expiresAt" > clock_timestamp()
    AND session."createdAt" + INTERVAL '30 days' > clock_timestamp()
  LIMIT 1`

/** The same subquery for Prisma.sql templates. */
export const v1PrincipalSql = (rawToken: string): Prisma.Sql => {
  const [before, between, after] = v1PrincipalQuery('\u0000').split('\u0000')
  return Prisma.sql(
    [before ?? '', between ?? '', after ?? ''],
    rawToken,
    rawToken
  )
}

export const issueOwnedSession = async (
  client: OwnedSessionClient,
  input: {
    readonly userId: string
    readonly authorityGeneration: number
    readonly role: 'USER' | 'ADMIN'
    readonly accountStatus: 'ACTIVE'
    readonly sessionId: string
    readonly token: string
    readonly ipAddress: string
    readonly userAgent: string
    readonly remember: boolean
  }
): Promise<{
  id: string
  createdAt: Date
  expiresAt: Date
  authorityGeneration: number
}> =>
  client.$transaction(async (transaction) => {
    await requireRuntimeReady(transaction)
    if (
      input.authorityGeneration <= 0 ||
      input.accountStatus !== 'ACTIVE' ||
      input.token === ''
    )
      await raise(
        transaction,
        '42501',
        'V1 Session issuance proof is malformed.'
      )
    const users = await transaction.$queryRawUnsafe<
      Array<{
        authorityGeneration: number
        role: string
        accountStatus: string
      }>
    >(
      `SELECT "authorityGeneration", "role"::TEXT AS "role",
         "accountStatus"::TEXT AS "accountStatus"
       FROM "User" WHERE "id" = $1::uuid FOR UPDATE`,
      input.userId
    )
    const user = users[0]
    if (
      !user ||
      user.authorityGeneration !== input.authorityGeneration ||
      user.role !== input.role ||
      user.accountStatus !== input.accountStatus
    )
      await raise(transaction, '42501', 'V1 Session issuance proof is stale.')

    // The Session trigger sets createdAt, updatedAt and expiresAt (7 days when
    // remembered, otherwise 1 day) and checks the generation.
    const issued = await transaction.$queryRawUnsafe<
      Array<{
        id: string
        createdAt: Date
        expiresAt: Date
        authorityGeneration: number
      }>
    >(
      `INSERT INTO "Session" (
         "id", "expiresAt", "token", "createdAt", "updatedAt", "ipAddress",
         "userAgent", "userId", "authorityGeneration", "issuerProtocolVersion"
       ) VALUES (
         $1::uuid, clock_timestamp() + CASE WHEN $2::boolean
           THEN INTERVAL '7 days' ELSE INTERVAL '1 day' END, $3,
         clock_timestamp(), clock_timestamp(), $4, $5, $6::uuid,
         $7::integer, 'PHASE7_V1'
       )
       RETURNING "id", "createdAt", "expiresAt", "authorityGeneration"`,
      input.sessionId,
      input.remember,
      input.token,
      input.ipAddress,
      input.userAgent,
      input.userId,
      input.authorityGeneration
    )
    const session = issued[0]
    if (!session)
      return raise(transaction, '42501', 'V1 Session issuance is unavailable.')

    const confirmed = await transaction.$queryRawUnsafe<unknown[]>(
      `SELECT 1
       FROM "User" AS locked_user
       JOIN "Session" AS session
         ON session."userId" = locked_user."id" AND session."id" = $2::uuid
       WHERE locked_user."id" = $1::uuid
         AND locked_user."authorityGeneration" = $3::integer
         AND locked_user."role" = $4::"UserRole"
         AND locked_user."accountStatus" = 'ACTIVE'
         AND session."token" = $5
         AND session."issuerProtocolVersion" = 'PHASE7_V1'
         AND session."authorityGeneration" = $3::integer
         AND session."expiresAt" > clock_timestamp()
         AND session."createdAt" + INTERVAL '30 days' > clock_timestamp()
       FOR UPDATE OF session`,
      input.userId,
      session.id,
      input.authorityGeneration,
      input.role,
      input.token
    )
    if (confirmed.length !== 1)
      await raise(
        transaction,
        '42501',
        'V1 Session lost authority before issuance completed.'
      )
    return session
  })

/**
 * Ends the ACTIVE Session of a raw token. Unknown tokens sign out with nothing
 * to end. #504 P7 PR4b-1: an old token that a re-authentication replaced no
 * longer finds a Session, so it cannot end the replacement.
 */
export const signOutOwnedSession = async (
  client: OwnedSessionClient,
  rawToken: string
): Promise<true> =>
  client.$transaction(async (transaction) => {
    await requireRuntimeReady(transaction)
    const targets = await transaction.$queryRawUnsafe<
      Array<{ sessionId: string; userId: string }>
    >(
      `SELECT session."userId", session."id" AS "sessionId"
       FROM "Session" AS session
       WHERE session."token" = $1 AND session."authorizationState" = 'ACTIVE'
       LIMIT 1`,
      rawToken
    )
    const target = targets[0]
    if (!target) return true

    await transaction.$queryRawUnsafe(
      `SELECT 1 FROM "User" WHERE "id" = $1::uuid FOR UPDATE`,
      target.userId
    )
    await transaction.$queryRawUnsafe(
      `SELECT 1 FROM "Session" WHERE "id" = $1::uuid FOR UPDATE`,
      target.sessionId
    )
    await transaction.$executeRawUnsafe(
      `DELETE FROM "Session" WHERE "id" = $1::uuid AND "token" = $2`,
      target.sessionId,
      rawToken
    )
    const cleared = await transaction.$queryRawUnsafe<
      Array<{ cleared: boolean }>
    >(
      `SELECT NOT EXISTS (
         SELECT 1 FROM "Session" WHERE "id" = $1::uuid
       ) AS cleared`,
      target.sessionId
    )
    if (cleared[0]?.cleared !== true)
      await raise(
        transaction,
        '23514',
        'Owned sign-out could not clear the Session.'
      )
    return true as const
  })

export interface RememberedSessionRefresh {
  id: string
  updatedAt: Date
  expiresAt: Date
  refreshed: boolean
}

const ACTIVE_SESSION_CONDITIONS = `
      session."issuerProtocolVersion" = 'PHASE7_V1'
  AND session."authorizationState" = 'ACTIVE'
  AND session."authorityGeneration" = target_user."authorityGeneration"
  AND target_user."accountStatus" = 'ACTIVE'
  AND session."expiresAt" > clock_timestamp()
  AND session."createdAt" + INTERVAL '30 days' > clock_timestamp()`
// A remembered Session was issued for 7 days; a 1 day Session never refreshes.
const REMEMBERED_SESSION_CONDITIONS = `${ACTIVE_SESSION_CONDITIONS}
  AND session."expiresAt" > session."createdAt" + INTERVAL '1 day'`

/**
 * Extends a remembered Session at most once a day. Returns no row when the
 * token has no remembered V1 Session.
 */
export const refreshRememberedSession = async (
  client: OwnedSessionClient,
  rawToken: string
): Promise<RememberedSessionRefresh[]> => {
  if (rawToken === '') return []
  await requireRuntimeReady(client)
  const current = await client.$queryRawUnsafe<
    Array<{
      id: string
      updatedAt: Date
      expiresAt: Date
      due: boolean
    }>
  >(
    `SELECT session."id", session."updatedAt", session."expiresAt",
       session."updatedAt" + INTERVAL '24 hours' <= clock_timestamp() AS due
     FROM "Session" AS session
     JOIN "User" AS target_user ON target_user."id" = session."userId"
     WHERE session."token" = $1 AND ${REMEMBERED_SESSION_CONDITIONS}`,
    rawToken
  )
  const session = current[0]
  if (!session) return []
  if (!session.due)
    return [
      {
        id: session.id,
        updatedAt: session.updatedAt,
        expiresAt: session.expiresAt,
        refreshed: false
      }
    ]

  return client.$transaction(async (transaction) => {
    const targets = await transaction.$queryRawUnsafe<
      Array<{
        userId: string
        authorityGeneration: number
        role: string
      }>
    >(
      `SELECT session."userId",
         target_user."authorityGeneration", target_user."role"::TEXT AS "role"
       FROM "Session" AS session
       JOIN "User" AS target_user ON target_user."id" = session."userId"
       WHERE session."id" = $1::uuid AND session."token" = $2
         AND session."authorizationState" = 'ACTIVE'`,
      session.id,
      rawToken
    )
    const target = targets[0]
    if (!target) return []
    await transaction.$queryRawUnsafe(
      `SELECT 1 FROM "User" WHERE "id" = $1::uuid FOR UPDATE`,
      target.userId
    )
    await transaction.$queryRawUnsafe(
      `SELECT 1 FROM "Session" WHERE "id" = $1::uuid FOR UPDATE`,
      session.id
    )
    const lockedCheck = (conditions: string): string => `
      SELECT 1
      FROM "User" AS target_user
      JOIN "Session" AS session
        ON session."userId" = target_user."id" AND session."id" = $2::uuid
      WHERE target_user."id" = $1::uuid
        AND target_user."authorityGeneration" = $3::integer
        AND target_user."role" = $4::"UserRole"
        AND session."token" = $5
        AND ${conditions}`
    const lockedValues = [
      target.userId,
      session.id,
      target.authorityGeneration,
      target.role,
      rawToken
    ]
    const before = await transaction.$queryRawUnsafe<unknown[]>(
      lockedCheck(REMEMBERED_SESSION_CONDITIONS),
      ...lockedValues
    )
    if (before.length !== 1) return []
    // The Session trigger sets updatedAt to now and expiresAt to
    // least(now + 7 days, createdAt + 30 days).
    const refreshed = await transaction.$queryRawUnsafe<
      Array<{ id: string; updatedAt: Date; expiresAt: Date }>
    >(
      `UPDATE "Session" AS target_session
       SET "expiresAt" = target_session."expiresAt",
           "updatedAt" = target_session."updatedAt"
       WHERE target_session."id" = $1::uuid
         AND target_session."authorizationState" = 'ACTIVE'
       RETURNING target_session."id", target_session."updatedAt",
         target_session."expiresAt"`,
      session.id
    )
    const row = refreshed[0]
    const after = row
      ? await transaction.$queryRawUnsafe<unknown[]>(
          lockedCheck(ACTIVE_SESSION_CONDITIONS),
          ...lockedValues
        )
      : []
    if (!row || after.length !== 1)
      await raise(
        transaction,
        '42501',
        'Remembered Session lost authority before refresh commit.'
      )
    return [{ ...row!, refreshed: true }]
  })
}

/**
 * confirm_v1_session_issuance: after the issuance committed, the new
 * Session still holds the captured authority under User and Session locks. Returns false instead of raising, as the SQL function did.
 */
export const confirmOwnedSession = async (
  client: OwnedSessionClient,
  input: {
    readonly token: string
    readonly sessionId: string
    readonly userId: string
    readonly authorityGeneration: number
    readonly role: 'USER' | 'ADMIN'
    readonly accountStatus: 'ACTIVE'
  }
): Promise<boolean> => {
  if (
    input.token === '' ||
    input.authorityGeneration <= 0 ||
    input.accountStatus !== 'ACTIVE'
  )
    return false
  return client.$transaction(async (transaction) => {
    await requireRuntimeReady(transaction)
    const locks = [
      [`SELECT 1 FROM "User" WHERE "id" = $1::uuid FOR UPDATE`, input.userId],
      [
        `SELECT 1 FROM "Session"
         WHERE "id" = $1::uuid AND "userId" = $2::uuid AND "token" = $3
         FOR UPDATE`,
        input.sessionId,
        input.userId,
        input.token
      ]
    ] as const
    for (const [sql, ...values] of locks)
      if (
        (await transaction.$queryRawUnsafe<unknown[]>(sql, ...values))
          .length !== 1
      )
        return false
    const confirmed = await transaction.$queryRawUnsafe<unknown[]>(
      `SELECT 1
       FROM "User" AS target_user
       JOIN "Session" AS session
         ON session."userId" = target_user."id" AND session."id" = $2::uuid
       WHERE target_user."id" = $1::uuid
         AND target_user."authorityGeneration" = $3::integer
         AND target_user."role" = $4::"UserRole"
         AND target_user."accountStatus" = 'ACTIVE'
         AND session."token" = $5
         AND session."authorizationState" = 'ACTIVE'
         AND session."issuerProtocolVersion" = 'PHASE7_V1'
         AND session."authorityGeneration" = $3::integer
         AND session."expiresAt" > clock_timestamp()
         AND session."createdAt" + INTERVAL '30 days' > clock_timestamp()`,
      input.userId,
      input.sessionId,
      input.authorityGeneration,
      input.role,
      input.token
    )
    return confirmed.length === 1
  })
}

import type { Prisma, PrismaClient } from '../../generated/prisma/client.js'

/**
 * TEST-only User authority change (#504 P7 PR5a).
 *
 * phase7_change_user_authority (with its _pre_reauthentication body) had no
 * product caller; database tests use it to take authority away mid-flow. This
 * keeps it step for step: the same actor checks, the same lock order (both
 * Users, then the target's Verification and Account rows, then both Users'
 * Sessions), the same compare-and-swap and the same SQLSTATE and message on
 * failure. nihongo_app has no User role privilege: the marker set here names
 * the User and the new role and status, and the User trigger applies them only
 * in a TEST database with a TEST capability, then records the revocation,
 * steps the generation and deletes the Sessions as before.
 */

type Transaction = Prisma.TransactionClient

const TEST_AUTHORITY_SETTING = 'nihongo.phase7_test_authority_change'

const raise = async (
  transaction: Transaction,
  sqlState: '23514' | '40001' | '42501',
  message: string
): Promise<never> => {
  await transaction.$executeRawUnsafe(
    `DO $raise$ BEGIN RAISE EXCEPTION USING ERRCODE = '${sqlState}', MESSAGE = '${message}'; END $raise$`
  )
  throw new Error('PostgreSQL did not raise the authority change failure.')
}

const actorHoldsFreshAdmin = async (
  transaction: Transaction,
  actorUserId: string,
  actorSessionId: string,
  rawActorToken: string,
  lock: boolean
): Promise<boolean> =>
  (
    await transaction.$queryRawUnsafe<unknown[]>(
      `WITH checked AS (SELECT clock_timestamp() AS at)
       SELECT 1
       FROM checked, "User" AS actor
       JOIN "Session" AS session
         ON session."userId" = actor."id" AND session."id" = $2::uuid
       WHERE actor."id" = $1::uuid
         AND actor."role" = 'ADMIN' AND actor."accountStatus" = 'ACTIVE'
         AND session."token" = $3
         AND session."issuerProtocolVersion" = 'PHASE7_V1'
         AND session."authorityGeneration" = actor."authorityGeneration"
         AND session."expiresAt" > checked.at
         AND session."createdAt" + INTERVAL '30 days' > checked.at
         AND session."createdAt" + INTERVAL '5 minutes' > checked.at
       ${lock ? 'FOR UPDATE OF session' : ''}`,
      actorUserId,
      actorSessionId,
      rawActorToken
    )
  ).length > 0

export const changeUserAuthorityForTest = async (
  client: Pick<PrismaClient, '$transaction'>,
  input: {
    readonly rawActorToken: string
    readonly targetUserId: string
    readonly expectedTargetGeneration: number
    readonly newRole: string
    readonly newStatus: string
    readonly environment: string
  }
): Promise<number> =>
  client.$transaction(async (transaction) => {
    // phase7_change_user_authority
    const active = await transaction.$queryRawUnsafe<unknown[]>(
      `SELECT 1 FROM "Session"
       WHERE "token" = $1 AND "authorizationState" = 'ACTIVE'`,
      input.rawActorToken
    )
    if (active.length === 0)
      await raise(
        transaction,
        '42501',
        'Authority-change actor is stale or not fresh.'
      )
    // phase7_change_user_authority_pre_reauthentication
    await transaction.$executeRawUnsafe(
      `SELECT "phase7_require_database_capability"($1::"AdminAuditEnvironment")`,
      input.environment
    )
    await transaction.$queryRawUnsafe(
      `SELECT "phase7_require_runtime_ready"() AS ready`
    )
    const actor = (
      await transaction.$queryRawUnsafe<
        Array<{ sessionId: string; userId: string }>
      >(
        `SELECT "userId", "id" AS "sessionId" FROM "Session" WHERE "token" = $1`,
        input.rawActorToken
      )
    )[0]
    if (!actor || actor.userId === input.targetUserId)
      return raise(
        transaction,
        '42501',
        'Authority change requires a distinct ADMIN actor.'
      )
    await transaction.$queryRawUnsafe(
      `SELECT 1 FROM "User" WHERE "id" IN ($1::uuid, $2::uuid)
       ORDER BY "id" FOR UPDATE`,
      actor.userId,
      input.targetUserId
    )
    const target = (
      await transaction.$queryRawUnsafe<
        Array<{ accountStatus: string; generation: number; role: string }>
      >(
        `SELECT "role"::text AS role, "accountStatus"::text AS "accountStatus",
           "authorityGeneration" AS generation
         FROM "User" WHERE "id" = $1::uuid`,
        input.targetUserId
      )
    )[0]
    const roleChanged = target?.role !== input.newRole
    const statusChanged = target?.accountStatus !== input.newStatus
    if (
      !target ||
      target.generation !== input.expectedTargetGeneration ||
      target.accountStatus === 'DELETED' ||
      Number(roleChanged) + Number(statusChanged) !== 1 ||
      (statusChanged &&
        !(
          (target.accountStatus === 'ACTIVE' &&
            input.newStatus === 'DELETION_PENDING') ||
          (target.accountStatus === 'DELETION_PENDING' &&
            input.newStatus === 'ACTIVE')
        ))
    )
      await raise(
        transaction,
        '23514',
        'Target authority transition is stale or invalid.'
      )
    await transaction.$queryRawUnsafe(
      `SELECT 1 FROM "Verification" WHERE "resetUserId" = $1::uuid
       ORDER BY "id" FOR UPDATE`,
      input.targetUserId
    )
    await transaction.$queryRawUnsafe(
      `SELECT 1 FROM "Account" WHERE "userId" = $1::uuid ORDER BY "id" FOR UPDATE`,
      input.targetUserId
    )
    await transaction.$queryRawUnsafe(
      `SELECT 1 FROM "Session" WHERE "userId" IN ($1::uuid, $2::uuid)
       ORDER BY "userId", "id" FOR UPDATE`,
      actor.userId,
      input.targetUserId
    )
    if (
      !(await actorHoldsFreshAdmin(
        transaction,
        actor.userId,
        actor.sessionId,
        input.rawActorToken,
        true
      ))
    )
      await raise(
        transaction,
        '42501',
        'Authority-change actor is stale or not fresh.'
      )
    await transaction.$queryRawUnsafe(
      `SELECT set_config('${TEST_AUTHORITY_SETTING}',
         $1::uuid::text || ':' || $2::"UserRole"::text || ':'
           || $3::"UserAccountStatus"::text, true)`,
      input.targetUserId,
      input.newRole,
      input.newStatus
    )
    const changed = await transaction.$queryRawUnsafe<
      Array<{ generation: number }>
    >(
      `UPDATE "User" SET "accountStatus" = "accountStatus"
       WHERE "id" = $1::uuid AND "authorityGeneration" = $2::integer
       RETURNING "authorityGeneration" AS generation`,
      input.targetUserId,
      input.expectedTargetGeneration
    )
    await transaction.$queryRawUnsafe(
      `SELECT set_config('${TEST_AUTHORITY_SETTING}', '', true)`
    )
    const generation = changed[0]?.generation
    if (generation === undefined)
      return raise(
        transaction,
        '40001',
        'Target authority compare-and-swap failed.'
      )
    if (
      !(await actorHoldsFreshAdmin(
        transaction,
        actor.userId,
        actor.sessionId,
        input.rawActorToken,
        false
      ))
    )
      await raise(
        transaction,
        '42501',
        'Authority-change actor expired before commit.'
      )
    return generation
  })

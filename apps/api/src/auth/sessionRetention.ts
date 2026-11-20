import type { PrismaClient } from '../generated/prisma/client.js'
import { ABSOLUTE_SESSION_TTL_MS } from './principalService.js'

export const DEFAULT_EXPIRED_SESSION_BATCH_SIZE = 500
export const MAX_EXPIRED_SESSION_BATCH_SIZE = 5_000

interface ExpiredSessionCleanupResult {
  eligibleCount: number
  deletedCount: number
  hasMore: boolean
}

// nihongo_app may delete only OWNED_V1 Sessions (validate_session_write).
// A Session also ends 30 days after sign-in (principalService); the
// Session_absolute_lifetime_check keeps expiresAt inside that, and this
// condition states it here too. `ttl` is the bind placeholder of the limit.
const expired = (ttl: string): string => `("expiresAt" <= clock_timestamp()
    OR "createdAt" + ${ttl}::bigint * INTERVAL '1 millisecond'
      <= clock_timestamp())
  AND "issuerProtocolVersion" = 'OWNED_V1'`

const countExpired = async (
  client: Pick<PrismaClient, '$queryRawUnsafe'>
): Promise<number> => {
  const [row] = await client.$queryRawUnsafe<{ count: number }[]>(
    `SELECT count(*)::int AS "count" FROM "Session" WHERE ${expired('$1')}`,
    ABSOLUTE_SESSION_TTL_MS
  )
  return row?.count ?? 0
}

/**
 * #695: deletes expired sign-in Sessions (with their IP address and browser)
 * in batches, including those past the 30-day absolute limit (#1043). An expired Session no longer signs anyone in; re-running
 * changes nothing already deleted.
 */
export const deleteExpiredSessions = async (
  client: Pick<PrismaClient, '$queryRawUnsafe'>,
  { batchSize, dryRun }: { batchSize: number; dryRun: boolean }
): Promise<ExpiredSessionCleanupResult> => {
  if (dryRun) {
    const eligibleCount = await countExpired(client)
    return { eligibleCount, deletedCount: 0, hasMore: eligibleCount > 0 }
  }
  const deleted = await client.$queryRawUnsafe<{ id: string }[]>(
    `WITH candidates AS MATERIALIZED (
       SELECT "id" FROM "Session"
       WHERE ${expired('$2')}
       ORDER BY "expiresAt", "id"
       FOR UPDATE SKIP LOCKED
       LIMIT $1::integer
     )
     DELETE FROM "Session" AS session
     USING candidates
     WHERE session."id" = candidates."id"
     RETURNING session."id"`,
    batchSize,
    ABSOLUTE_SESSION_TTL_MS
  )
  const remaining = await countExpired(client)
  return {
    eligibleCount: deleted.length + remaining,
    deletedCount: deleted.length,
    hasMore: remaining > 0
  }
}

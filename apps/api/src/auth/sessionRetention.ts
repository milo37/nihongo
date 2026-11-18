import type { PrismaClient } from '../generated/prisma/client.js'

export const DEFAULT_EXPIRED_SESSION_BATCH_SIZE = 500
export const MAX_EXPIRED_SESSION_BATCH_SIZE = 5_000

interface ExpiredSessionCleanupResult {
  eligibleCount: number
  deletedCount: number
  hasMore: boolean
}

// nihongo_app may delete only OWNED_V1 Sessions (validate_session_write).
const EXPIRED = `"expiresAt" <= clock_timestamp()
  AND "issuerProtocolVersion" = 'OWNED_V1'`

const countExpired = async (
  client: Pick<PrismaClient, '$queryRawUnsafe'>
): Promise<number> => {
  const [row] = await client.$queryRawUnsafe<{ count: number }[]>(
    `SELECT count(*)::int AS "count" FROM "Session" WHERE ${EXPIRED}`
  )
  return row?.count ?? 0
}

/**
 * #695: deletes expired sign-in Sessions (with their IP address and browser)
 * in batches. An expired Session no longer signs anyone in; re-running
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
       WHERE ${EXPIRED}
       ORDER BY "expiresAt", "id"
       FOR UPDATE SKIP LOCKED
       LIMIT $1::integer
     )
     DELETE FROM "Session" AS session
     USING candidates
     WHERE session."id" = candidates."id"
     RETURNING session."id"`,
    batchSize
  )
  const remaining = await countExpired(client)
  return {
    eligibleCount: deleted.length + remaining,
    deletedCount: deleted.length,
    hasMore: remaining > 0
  }
}

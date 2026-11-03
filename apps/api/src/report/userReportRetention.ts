import { Prisma, type PrismaClient } from '../generated/prisma/client.js'

/** Closed learner reports keep their free-text description for 180 days. */
export const USER_REPORT_RETENTION_DAYS = 180
export const DEFAULT_USER_REPORT_RETENTION_BATCH_SIZE = 500
export const MAX_USER_REPORT_RETENTION_BATCH_SIZE = 5_000

/** Approved replacement text (JLP-702); the erasure text stays as is. */
export const USER_REPORT_RETENTION_REDACTED_DESCRIPTION =
  '보관 기간이 지나 제보 내용이 삭제되었습니다.'
const USER_REPORT_ERASURE_REDACTED_DESCRIPTION =
  '탈퇴한 회원의 제보 내용은 삭제되었습니다.'

export interface UserReportRetentionResult {
  eligibleCount: number
  redactedCount: number
  hasMore: boolean
}

const eligible = (asOf: Date | null) => Prisma.sql`
  "status" IN ('ANSWERED', 'CLOSED')
  AND "closedAt" IS NOT NULL
  AND "closedAt" <= COALESCE(${asOf}::timestamptz, clock_timestamp())
    - make_interval(days => ${USER_REPORT_RETENTION_DAYS})
  AND "description" NOT IN (
    ${USER_REPORT_RETENTION_REDACTED_DESCRIPTION},
    ${USER_REPORT_ERASURE_REDACTED_DESCRIPTION}
  )`

const countEligible = async (
  client: PrismaClient,
  asOf: Date | null
): Promise<number> => {
  const [row] = await client.$queryRaw<{ count: number }[]>`
    SELECT COUNT(*)::int AS "count" FROM "UserReport" WHERE ${eligible(asOf)}`
  return row?.count ?? 0
}

/**
 * Replaces the description of reports closed at least 180 days before `asOf`
 * (database clock when omitted). Re-running changes nothing already redacted.
 */
export const redactExpiredUserReportDescriptions = async (
  client: PrismaClient,
  {
    asOf = null,
    batchSize,
    dryRun
  }: { asOf?: Date | null; batchSize: number; dryRun: boolean }
): Promise<UserReportRetentionResult> => {
  if (dryRun) {
    const eligibleCount = await countEligible(client, asOf)
    return { eligibleCount, redactedCount: 0, hasMore: eligibleCount > 0 }
  }
  const redacted = await client.$queryRaw<{ id: string }[]>`
    WITH candidates AS MATERIALIZED (
      SELECT "id" FROM "UserReport"
      WHERE ${eligible(asOf)}
      ORDER BY "closedAt", "id"
      FOR UPDATE SKIP LOCKED
      LIMIT ${batchSize}
    )
    UPDATE "UserReport" AS report
    SET "description" = ${USER_REPORT_RETENTION_REDACTED_DESCRIPTION},
        "rowVersion" = report."rowVersion" + 1,
        "updatedAt" = clock_timestamp()
    FROM candidates
    WHERE report."id" = candidates."id"
    RETURNING report."id"`
  const remaining = await countEligible(client, asOf)
  return {
    eligibleCount: redacted.length + remaining,
    redactedCount: redacted.length,
    hasMore: remaining > 0
  }
}

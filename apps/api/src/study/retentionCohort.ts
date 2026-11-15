import { Prisma } from '../generated/prisma/client.js'
import type { DatabaseRuntime } from '../db/database.js'

/**
 * Korea days before today that the daily count looks at. A cohort is written
 * on the first run after its day 7 has passed (today - 8); the older days fill
 * a missed run while the guest sets still exist (they go 7 days after they
 * expire).
 */
export const RETENTION_LOOKBACK_DAYS = 14
const RETENTION_SETTLED_DAYS = 8

/** A cohort is the people whose first set started on the same Korea day. */
const KOREA_DAY = (column: Prisma.Sql) =>
  Prisma.sql`(${column} AT TIME ZONE 'Asia/Seoul')::date`

/**
 * #1042: writes, for each settled Korea day of the lookback, the number of
 * members and of guests whose first set started that day, and how many of
 * them started a set again on the next day, on day 7 and on any day 1 to 7.
 * Each row is written once from one reading of the sets, so its counts share
 * one cohort even when a guest result moves to a member later, and a second
 * run leaves every row as it was. Only numbers are stored. A guest is
 * counted by its guest record, which lasts 7 days from its creation, so a
 * guest coming back later starts a new cohort.
 */
export const countRetentionCohorts = async (
  client: DatabaseRuntime['client'],
  now: Date
): Promise<{ written: number }> => {
  const today = KOREA_DAY(Prisma.sql`${now}::timestamptz`)
  const written = await client.$executeRaw`
    WITH visits AS (
      SELECT DISTINCT
        CASE WHEN "userId" IS NULL THEN 'GUEST' ELSE 'MEMBER' END AS audience,
        COALESCE("userId", "guestPrincipalId") AS who,
        ${KOREA_DAY(Prisma.sql`"startedAt"`)} AS day
      FROM "StudySession"
      WHERE ("userId" IS NOT NULL OR "guestPrincipalId" IS NOT NULL)
        AND ${KOREA_DAY(Prisma.sql`"startedAt"`)} < ${today}
    ),
    firsts AS (
      SELECT audience, who, min(day) AS first_day FROM visits GROUP BY audience, who
    )
    INSERT INTO "RetentionCohort" ("cohortDate", audience, "cohortSize",
      "day1Returned", "day7Returned", "week1Returned")
    SELECT d.day::date, a.audience,
      count(f.who)::int,
      count(f.who) FILTER (WHERE EXISTS (SELECT 1 FROM visits v
        WHERE v.audience = f.audience AND v.who = f.who
          AND v.day = f.first_day + 1))::int,
      count(f.who) FILTER (WHERE EXISTS (SELECT 1 FROM visits v
        WHERE v.audience = f.audience AND v.who = f.who
          AND v.day = f.first_day + 7))::int,
      count(f.who) FILTER (WHERE EXISTS (SELECT 1 FROM visits v
        WHERE v.audience = f.audience AND v.who = f.who
          AND v.day BETWEEN f.first_day + 1 AND f.first_day + 7))::int
    FROM generate_series(${today} - ${RETENTION_LOOKBACK_DAYS}::int,
        ${today} - ${RETENTION_SETTLED_DAYS}::int, INTERVAL '1 day') AS d(day)
      CROSS JOIN (VALUES ('MEMBER'), ('GUEST')) AS a(audience)
      LEFT JOIN firsts f ON f.audience = a.audience AND f.first_day = d.day::date
    GROUP BY a.audience, d.day
    ON CONFLICT ("cohortDate", audience) DO NOTHING`
  return { written }
}

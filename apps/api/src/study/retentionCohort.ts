import { Prisma } from '../generated/prisma/client.js'
import type { DatabaseRuntime } from '../db/database.js'

/**
 * Days the daily count looks back. A missed run is filled on the next one
 * while the guest sets still exist (they go 7 days after they expire).
 */
export const RETENTION_LOOKBACK_DAYS = 14

/** A cohort is the people whose first set started on the same Korea day. */
const KOREA_DAY = (column: Prisma.Sql) =>
  Prisma.sql`(${column} AT TIME ZONE 'Asia/Seoul')::date`

/**
 * #1042: writes, for each Korea day of the lookback before today, the number
 * of members and of guests whose first set started that day, and how many of
 * them started a set again on the next day, on day 7 and on any day 1 to 7.
 * A count is written once, after its last day has passed, and never changed,
 * so a second run on the same day leaves every number as it was. Only
 * numbers are stored. A guest is counted by its guest record, which lasts
 * 7 days from its first set, so a guest coming back later starts a new
 * cohort.
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
    ),
    cohorts AS (
      SELECT a.audience, d.day::date AS cohort_date,
        count(f.who)::int AS cohort_size,
        count(f.who) FILTER (WHERE EXISTS (SELECT 1 FROM visits v
          WHERE v.audience = f.audience AND v.who = f.who
            AND v.day = f.first_day + 1))::int AS day1,
        count(f.who) FILTER (WHERE EXISTS (SELECT 1 FROM visits v
          WHERE v.audience = f.audience AND v.who = f.who
            AND v.day = f.first_day + 7))::int AS day7,
        count(f.who) FILTER (WHERE EXISTS (SELECT 1 FROM visits v
          WHERE v.audience = f.audience AND v.who = f.who
            AND v.day BETWEEN f.first_day + 1 AND f.first_day + 7))::int AS week1
      FROM generate_series(${today} - ${RETENTION_LOOKBACK_DAYS}::int,
          ${today} - 1, INTERVAL '1 day') AS d(day)
        CROSS JOIN (VALUES ('MEMBER'), ('GUEST')) AS a(audience)
        LEFT JOIN firsts f
          ON f.audience = a.audience AND f.first_day = d.day::date
      GROUP BY a.audience, d.day
    )
    INSERT INTO "RetentionCohort" AS r ("cohortDate", audience, "cohortSize",
      "day1Returned", "day7Returned", "week1Returned")
    SELECT cohort_date, audience, cohort_size,
      CASE WHEN cohort_date + 1 < ${today} THEN day1 END,
      CASE WHEN cohort_date + 7 < ${today} THEN day7 END,
      CASE WHEN cohort_date + 7 < ${today} THEN week1 END
    FROM cohorts
    ON CONFLICT ("cohortDate", audience) DO UPDATE SET
      "day1Returned" = COALESCE(r."day1Returned", EXCLUDED."day1Returned"),
      "day7Returned" = COALESCE(r."day7Returned", EXCLUDED."day7Returned"),
      "week1Returned" = COALESCE(r."week1Returned", EXCLUDED."week1Returned"),
      "updatedAt" = clock_timestamp()
    WHERE (r."day1Returned" IS NULL AND EXCLUDED."day1Returned" IS NOT NULL)
      OR (r."day7Returned" IS NULL AND EXCLUDED."day7Returned" IS NOT NULL)`
  return { written }
}

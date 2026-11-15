import { Prisma } from '../generated/prisma/client.js'
import type { DatabaseRuntime } from '../db/database.js'

/**
 * Korea days before today that the daily count looks at. Days past the first
 * chance fill a missed run while the guest sets still exist (they go 7 days
 * after they expire).
 */
export const RETENTION_LOOKBACK_DAYS = 14
/** The next-day count is final once the day after the cohort has passed. */
const NEXT_DAY_SETTLED = 2
/** The day-7 counts are final once day 7 of the cohort has passed. */
const WEEK_SETTLED = 8
const DAY_MS = 86_400_000
const KOREA_OFFSET_MS = 9 * 60 * 60 * 1_000

const KOREA_DAY = Prisma.sql`("startedAt" AT TIME ZONE 'Asia/Seoul')::date`

/** The Korea calendar day of an instant, as YYYY-MM-DD. */
const koreaDay = (at: Date, daysBefore = 0): string =>
  new Date(at.getTime() + KOREA_OFFSET_MS - daysBefore * DAY_MS)
    .toISOString()
    .slice(0, 10)

/**
 * One reading of the sets for one cohort day: per audience, the people whose
 * first set started that day and how many started a set again on the next
 * day, on day 7 and on any day 1 to 7. Sets of `before` and later are left
 * out. A guest result brought in at sign-in counts for the member.
 */
const cohortReading = (cohortDate: string, before: string) => Prisma.sql`
  WITH visits AS (
    SELECT DISTINCT
      CASE WHEN "userId" IS NULL THEN 'GUEST' ELSE 'MEMBER' END AS audience,
      COALESCE("userId", "guestPrincipalId") AS who,
      ${KOREA_DAY} AS day
    FROM "StudySession"
    WHERE ("userId" IS NOT NULL OR "guestPrincipalId" IS NOT NULL)
      AND ${KOREA_DAY} < ${before}::date
  ),
  cohort AS (
    SELECT audience, who FROM visits GROUP BY audience, who
    HAVING min(day) = ${cohortDate}::date
  )
  SELECT a.audience,
    count(c.who)::int AS size,
    count(c.who) FILTER (WHERE EXISTS (SELECT 1 FROM visits v
      WHERE v.audience = c.audience AND v.who = c.who
        AND v.day = ${cohortDate}::date + 1))::int AS day1,
    count(c.who) FILTER (WHERE EXISTS (SELECT 1 FROM visits v
      WHERE v.audience = c.audience AND v.who = c.who
        AND v.day = ${cohortDate}::date + 7))::int AS day7,
    count(c.who) FILTER (WHERE EXISTS (SELECT 1 FROM visits v
      WHERE v.audience = c.audience AND v.who = c.who
        AND v.day BETWEEN ${cohortDate}::date + 1
          AND ${cohortDate}::date + 7))::int AS week1
  FROM (VALUES ('MEMBER'), ('GUEST')) AS a(audience)
    LEFT JOIN cohort c ON c.audience = a.audience
  GROUP BY a.audience`

export interface RetentionCountResult {
  /** Cohort rows added with their size and next-day count. */
  nextDayWritten: number
  /** Cohort rows given their day-7 counts. */
  weekWritten: number
  /** Cohort days whose writing failed; the other days are still written. */
  failedDays: string[]
}

/**
 * #1042: for each Korea day of the lookback, writes per audience (member,
 * guest) only numbers, in two steps, each from one reading of the sets so a
 * count never comes from another cohort than its base:
 *   - from 2 days on: the cohort size and how many came back the next day,
 *     read while the guest sets of the cohort surely still exist;
 *   - from 8 days on: the cohort size at that reading and how many came
 *     back on day 7 and on any day 1 to 7.
 * A written count never changes, so a second run leaves every number as it
 * was. A guest is counted by its guest record, which lasts 7 days from its
 * creation, so a guest coming back later starts a new cohort.
 */
export const countRetentionCohorts = async (
  client: DatabaseRuntime['client'],
  now: Date
): Promise<RetentionCountResult> => {
  const result: RetentionCountResult = {
    nextDayWritten: 0,
    weekWritten: 0,
    failedDays: []
  }
  for (
    let daysBefore = RETENTION_LOOKBACK_DAYS;
    daysBefore >= NEXT_DAY_SETTLED;
    daysBefore -= 1
  ) {
    const cohortDate = koreaDay(now, daysBefore)
    try {
      result.nextDayWritten += await client.$executeRaw`
        WITH reading AS (${cohortReading(
          cohortDate,
          koreaDay(now, daysBefore - NEXT_DAY_SETTLED)
        )})
        INSERT INTO "RetentionCohort" ("cohortDate", audience, "cohortSize",
          "day1Returned")
        SELECT ${cohortDate}::date, audience, size, day1 FROM reading
        ON CONFLICT ("cohortDate", audience) DO NOTHING`
      if (daysBefore >= WEEK_SETTLED) {
        result.weekWritten += await client.$executeRaw`
          WITH reading AS (${cohortReading(
            cohortDate,
            koreaDay(now, daysBefore - WEEK_SETTLED)
          )})
          UPDATE "RetentionCohort" r SET "weekCohortSize" = reading.size,
            "day7Returned" = reading.day7, "week1Returned" = reading.week1
          FROM reading
          WHERE r."cohortDate" = ${cohortDate}::date
            AND r.audience = reading.audience AND r."weekCohortSize" IS NULL`
      }
    } catch {
      result.failedDays.push(cohortDate)
    }
  }
  return result
}

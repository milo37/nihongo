import type {
  AdminRetentionAudience,
  AdminRetentionRow
} from '@nihongo/contracts/admin/retention'

export const RETENTION_AUDIENCES: readonly AdminRetentionAudience[] = [
  'MEMBER',
  'GUEST'
]

/** How many counted cohort days the headline numbers add up (#1271). */
export const HEADLINE_DAYS = 7

export type RetentionMeasure = 'day1' | 'week1'

/** One audience's returned count and the people it is counted against. */
export interface RetentionCount {
  readonly returned: number
  readonly base: number
}

export type RetentionPoint = RetentionCount & { readonly date: string }

const DAY_MS = 86_400_000

/** Korea calendar day of `now` moved by `days`, as YYYY-MM-DD. */
export const koreaDay = (now: Date, days = 0): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(
    new Date(now.getTime() + days * DAY_MS)
  )

/** All cohort days in the response, oldest first. */
export const cohortDays = (rows: readonly AdminRetentionRow[]): string[] =>
  [...new Set(rows.map((row) => row.cohortDate))].sort()

/**
 * The counted value of one row, or null while it is not counted yet. The next
 * day is counted once the day after the cohort has ended, so yesterday's cohort
 * is left out; the first week waits for its day-7 size.
 */
const countOf = (
  row: AdminRetentionRow,
  measure: RetentionMeasure,
  lastDay1Cohort: string
): RetentionCount | null => {
  if (measure === 'day1')
    return row.cohortDate <= lastDay1Cohort
      ? { returned: row.day1Returned, base: row.cohortSize }
      : null
  return row.week1Returned === null || row.weekCohortSize === null
    ? null
    : { returned: row.week1Returned, base: row.weekCohortSize }
}

/** One audience's counted points of one measure, oldest first. */
export const retentionPoints = (
  rows: readonly AdminRetentionRow[],
  audience: AdminRetentionAudience,
  measure: RetentionMeasure,
  now: Date
): RetentionPoint[] => {
  const lastDay1Cohort = koreaDay(now, -2)
  return rows
    .filter((row) => row.audience === audience)
    .sort((a, b) => a.cohortDate.localeCompare(b.cohortDate))
    .flatMap((row) => {
      const count = countOf(row, measure, lastDay1Cohort)
      return count ? [{ date: row.cohortDate, ...count }] : []
    })
}

/**
 * Headline: returned ÷ people over the latest counted days (weighted, so a
 * small day does not swing it). Fewer counted days just add up fewer.
 */
export const headlineCount = (
  points: readonly RetentionPoint[]
): RetentionCount =>
  points.slice(-HEADLINE_DAYS).reduce(
    (sum, point) => ({
      returned: sum.returned + point.returned,
      base: sum.base + point.base
    }),
    { returned: 0, base: 0 }
  )

export const rateOf = ({ returned, base }: RetentionCount): number | null =>
  base === 0 ? null : returned / base

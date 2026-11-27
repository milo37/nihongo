import type { AdminRetentionRow } from '@nihongo/contracts/admin/retention'
import {
  cohortDays,
  headlineCount,
  koreaDay,
  rateOf,
  retentionPoints
} from '@app/admin-retention/libs/retentionSeries'

const row = (
  cohortDate: string,
  cohortSize: number,
  day1Returned: number,
  week?: [number, number]
): AdminRetentionRow => ({
  cohortDate,
  audience: 'MEMBER',
  cohortSize,
  day1Returned,
  weekCohortSize: week ? week[0] : null,
  day7Returned: week ? 0 : null,
  week1Returned: week ? week[1] : null
})

// 2026-11-26 00:30 in Korea is still 11-25 in UTC.
const now = new Date('2026-11-25T15:30:00Z')

it('reads the Korea calendar day', () => {
  expect(koreaDay(now)).toBe('2026-11-26')
  expect(koreaDay(now, -2)).toBe('2026-11-24')
})

it('leaves out next days not over yet and first weeks not counted yet', () => {
  const rows = [
    row('2026-11-25', 9, 1),
    row('2026-11-24', 10, 4),
    row('2026-11-18', 20, 5, [21, 7])
  ]
  expect(cohortDays(rows)).toEqual(['2026-11-18', '2026-11-24', '2026-11-25'])
  expect(
    retentionPoints(rows, 'MEMBER', 'day1', now).map((p) => p.date)
  ).toEqual(['2026-11-18', '2026-11-24'])
  expect(retentionPoints(rows, 'MEMBER', 'week1', now)).toEqual([
    { date: '2026-11-18', returned: 7, base: 21 }
  ])
  expect(retentionPoints(rows, 'GUEST', 'day1', now)).toEqual([])
})

it('weights the headline by people over the latest seven counted days', () => {
  const points = Array.from({ length: 9 }, (_, index) => ({
    date: `2026-11-0${index + 1}`,
    returned: index === 8 ? 9 : 1,
    base: index === 8 ? 10 : 2
  }))
  // Days 3..9: six days of 1/2 and one of 9/10 → 15 of 22, not the mean.
  expect(headlineCount(points)).toEqual({ returned: 15, base: 22 })
  expect(rateOf({ returned: 0, base: 0 })).toBeNull()
})

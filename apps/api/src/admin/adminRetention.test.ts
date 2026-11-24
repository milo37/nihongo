import { describe, expect, it, vi } from 'vitest'
import { createAdminRetentionReader } from './adminRetention.js'

const row = (cohortDate: string, audience: string) => ({
  cohortDate: new Date(`${cohortDate}T00:00:00.000Z`),
  audience,
  cohortSize: 10,
  day1Returned: 4,
  weekCohortSize: null,
  day7Returned: null,
  week1Returned: null,
  createdAt: new Date('2026-11-24T00:00:00.000Z')
})

describe('admin retention reader', () => {
  it('reads from the first Korea day of the last 8 weeks, newest day first', async () => {
    const findMany = vi.fn(async () => [
      row('2026-11-23', 'MEMBER'),
      row('2026-11-23', 'GUEST')
    ])
    // 2026-11-24 00:30 in Seoul is still 2026-11-23 15:30Z.
    const reader = createAdminRetentionReader({
      retentionCohort: { findMany }
    } as never)
    const result = await reader.read(new Date('2026-11-23T15:30:00.000Z'))
    expect(findMany).toHaveBeenCalledWith({
      where: { cohortDate: { gte: new Date('2026-09-30T00:00:00.000Z') } },
      orderBy: [{ cohortDate: 'desc' }, { audience: 'asc' }]
    })
    expect(result.rows).toEqual([
      {
        cohortDate: '2026-11-23',
        audience: 'MEMBER',
        cohortSize: 10,
        day1Returned: 4,
        weekCohortSize: null,
        day7Returned: null,
        week1Returned: null
      },
      expect.objectContaining({ cohortDate: '2026-11-23', audience: 'GUEST' })
    ])
    expect(Object.keys(result.rows[0] ?? {})).not.toContain('createdAt')
  })
})

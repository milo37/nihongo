import { describe, expect, it, vi } from 'vitest'
import type { DatabaseRuntime } from '../db/database.js'
import { countRetentionCohorts } from './retentionCohort.js'

describe('#1042 retention count failures', () => {
  it('keeps writing the other days when one day fails', async () => {
    let call = 0
    const executeRaw = vi.fn(async () => {
      call += 1
      // The second statement is the day-7 step of the oldest day.
      if (call === 2) throw new Error('check violation')
      return 2
    })
    const client = {
      $executeRaw: executeRaw
    } as unknown as DatabaseRuntime['client']
    // 2001-03-20 09:00 in Korea.
    const result = await countRetentionCohorts(
      client,
      new Date('2001-03-20T00:00:00.000Z')
    )
    expect(result.failedDays).toEqual(['2001-03-06'])
    // 13 next-day steps and 7 day-7 steps; the failed one adds nothing.
    expect(executeRaw).toHaveBeenCalledTimes(20)
    expect(result).toMatchObject({ nextDayWritten: 26, weekWritten: 12 })
  })
})

import { afterEach, describe, expect, it } from 'vitest'
import { GUEST_DAILY_SESSION_LIMIT } from '@nihongo/contracts/study/guest-limits'
import { mockGuestAllowance } from '@mocks/handlers/guestAllowanceHandlers'

describe('mockGuestAllowance', () => {
  afterEach(() => mockGuestAllowance.reset({ enforce: false }))

  it('keeps the day count in sessionStorage so a reload does not refill it', () => {
    const now = new Date('2026-11-09T03:00:00.000Z')
    mockGuestAllowance.record(now)
    expect(mockGuestAllowance.remaining(now)).toBe(
      GUEST_DAILY_SESSION_LIMIT - 1
    )
    const stored = sessionStorage.getItem('harumaru:mock-guest-allowance:v1')
    expect(JSON.parse(stored ?? 'null')).toMatchObject({ count: 1 })

    mockGuestAllowance.record(now)
    expect(mockGuestAllowance.remaining(now)).toBe(
      Math.max(0, GUEST_DAILY_SESSION_LIMIT - 2)
    )
    // The next Korea day starts over.
    expect(
      mockGuestAllowance.remaining(new Date('2026-11-09T15:00:00.000Z'))
    ).toBe(GUEST_DAILY_SESSION_LIMIT)
  })

  it('reset clears the stored count', () => {
    mockGuestAllowance.setRemaining(0)
    mockGuestAllowance.reset()
    expect(
      sessionStorage.getItem('harumaru:mock-guest-allowance:v1')
    ).toBeNull()
    expect(mockGuestAllowance.remaining()).toBe(GUEST_DAILY_SESSION_LIMIT)
  })
})

import { http, HttpResponse } from 'msw'
import { getGuestAllowanceResponseSchema } from '@nihongo/contracts/study/get-guest-allowance'
import {
  GUEST_DAILY_SESSION_LIMIT,
  GUEST_DAY_UTC_OFFSET_MINUTES,
  GUEST_SESSION_QUESTION_LIMIT
} from '@nihongo/contracts/study/guest-limits'
import { mockDatabase } from '@mocks/repository/mockDatabase'

const DAY_MS = 24 * 60 * 60 * 1000
const OFFSET_MS = GUEST_DAY_UTC_OFFSET_MINUTES * 60 * 1000

// One guest per mock browser: the count of sessions started per Korea day.
let used = { day: -1, count: 0 }
// Unit tests build guest fixtures of any size and number; they turn the
// guest limits on only where they test them. The dev mock always enforces.
let enforced = true

const guestDay = (now: Date): number =>
  Math.floor((now.getTime() + OFFSET_MS) / DAY_MS)

const usedToday = (now: Date): number =>
  used.day === guestDay(now) ? used.count : 0

export const mockGuestAllowance = {
  remaining: (now = new Date()): number =>
    Math.max(0, GUEST_DAILY_SESSION_LIMIT - usedToday(now)),
  record: (now = new Date()): void => {
    used = { day: guestDay(now), count: usedToday(now) + 1 }
  },
  /** Tests: set how many tries are left today. */
  setRemaining: (remaining: number, now = new Date()): void => {
    used = {
      day: guestDay(now),
      count: Math.max(0, GUEST_DAILY_SESSION_LIMIT - remaining)
    }
  },
  /** Whether session creation applies the guest count and daily limits. */
  isEnforced: (): boolean => enforced,
  enforce: (on = true): void => {
    enforced = on
  },
  reset: ({ enforce = true }: { enforce?: boolean } = {}): void => {
    used = { day: -1, count: 0 }
    enforced = enforce
  }
}

export const guestAllowanceHandlers = [
  http.get('*/api/v1/guest-allowance', () => {
    const now = new Date()
    const body = mockDatabase.getCurrentUser()
      ? { kind: 'USER' as const }
      : {
          kind: 'GUEST' as const,
          sessionQuestionCount: GUEST_SESSION_QUESTION_LIMIT,
          dailyLimit: GUEST_DAILY_SESSION_LIMIT,
          remaining: mockGuestAllowance.remaining(now),
          resetsAt: new Date(
            (guestDay(now) + 1) * DAY_MS - OFFSET_MS
          ).toISOString()
        }
    return HttpResponse.json(getGuestAllowanceResponseSchema.parse(body), {
      headers: { 'Cache-Control': 'private, no-store' }
    })
  })
]

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

// One guest per mock tab: the count of sessions started per Korea day. Kept
// in sessionStorage so a reload or a typed URL does not hand out fresh tries;
// the real server counts by the guest cookie.
const USED_STORAGE_KEY = 'harumaru:mock-guest-allowance:v1'
type Used = { day: number; count: number }

const readUsed = (): Used => {
  try {
    const parsed: unknown = JSON.parse(
      globalThis.sessionStorage?.getItem(USED_STORAGE_KEY) ?? 'null'
    )
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'day' in parsed &&
      'count' in parsed &&
      typeof parsed.day === 'number' &&
      typeof parsed.count === 'number'
    ) {
      return { day: parsed.day, count: parsed.count }
    }
  } catch {
    // Unreadable storage counts as a fresh day.
  }
  return { day: -1, count: 0 }
}

const writeUsed = (used: Used | null): void => {
  try {
    if (used) {
      globalThis.sessionStorage?.setItem(USED_STORAGE_KEY, JSON.stringify(used))
    } else {
      globalThis.sessionStorage?.removeItem(USED_STORAGE_KEY)
    }
  } catch {
    // Storage off: the count lasts until the page reloads.
  }
}
// Unit tests build guest fixtures of any size and number; they turn the
// guest limits on only where they test them. The dev mock always enforces.
let enforced = true

const guestDay = (now: Date): number =>
  Math.floor((now.getTime() + OFFSET_MS) / DAY_MS)

const usedToday = (now: Date): number => {
  const used = readUsed()
  return used.day === guestDay(now) ? used.count : 0
}

export const mockGuestAllowance = {
  /** The next midnight Korea time, as the server sends it. */
  resetsAt: (now = new Date()): string =>
    new Date((guestDay(now) + 1) * DAY_MS - OFFSET_MS).toISOString(),
  remaining: (now = new Date()): number =>
    Math.max(0, GUEST_DAILY_SESSION_LIMIT - usedToday(now)),
  record: (now = new Date()): void => {
    writeUsed({ day: guestDay(now), count: usedToday(now) + 1 })
  },
  /** Tests: set how many tries are left today. */
  setRemaining: (remaining: number, now = new Date()): void => {
    writeUsed({
      day: guestDay(now),
      count: Math.max(0, GUEST_DAILY_SESSION_LIMIT - remaining)
    })
  },
  /** Whether session creation applies the guest count and daily limits. */
  isEnforced: (): boolean => enforced,
  enforce: (on = true): void => {
    enforced = on
  },
  reset: ({ enforce = true }: { enforce?: boolean } = {}): void => {
    writeUsed(null)
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
          resetsAt: mockGuestAllowance.resetsAt(now)
        }
    return HttpResponse.json(getGuestAllowanceResponseSchema.parse(body), {
      headers: { 'Cache-Control': 'private, no-store' }
    })
  })
]

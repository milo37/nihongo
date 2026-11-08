import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { adminFreshRemainingMs } from '@nihongo/browser/app/reauth/adminFreshTime'
import { authQueries } from '@nihongo/browser/app/login/queries/authQueries'

/** From here on the chip warns and offers to extend. */
export const REAUTH_SOON_MS = 5 * 60_000

export type ReauthClock =
  | { readonly state: 'need' }
  | { readonly state: 'active' | 'soon'; readonly minutes: number }

/** Minutes are rounded up (4m10s reads 5); nothing left means check again. */
export const reauthClockFor = (remainingMs: number): ReauthClock =>
  remainingMs <= 0
    ? { state: 'need' }
    : {
        state: remainingMs <= REAUTH_SOON_MS ? 'soon' : 'active',
        minutes: Math.ceil(remainingMs / 60_000)
      }

/**
 * Reads the cached current user without fetching again, counts on the server
 * clock, and redraws only when the rounded minute changes: no per-second
 * countdown.
 */
export const useReauthClock = (): ReauthClock => {
  const { data } = useQuery({
    ...authQueries.currentUser(),
    enabled: false
  })
  const [now, setNow] = useState(() => Date.now())
  const remaining = adminFreshRemainingMs(data ?? null, now)

  useEffect(() => {
    if (remaining <= 0) return
    // Wake just after the next whole minute of remaining time ends.
    const timer = window.setTimeout(
      () => setNow(Date.now()),
      (remaining % 60_000 || 60_000) + 50
    )
    return () => window.clearTimeout(timer)
  }, [remaining])

  return reauthClockFor(remaining)
}

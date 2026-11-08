import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { authQueries } from '@nihongo/browser/app/login/queries/authQueries'

/** From here on the chip warns and offers to extend. */
export const REAUTH_SOON_MS = 5 * 60_000

export type ReauthClock =
  | { readonly state: 'need' }
  | { readonly state: 'active' | 'soon'; readonly minutes: number }

/**
 * End of the fresh window on the browser clock. The server sends its own time
 * with the answer, so `adminFreshUntil - adminServerTime` is the time that was
 * left when the answer arrived (`receivedAt`), whatever the browser clock says.
 */
export const reauthEndsAt = (
  freshUntil: string | null | undefined,
  serverTime: string | undefined,
  receivedAt: number
): number | null => {
  if (typeof freshUntil !== 'string') return null
  const until = Date.parse(freshUntil)
  if (Number.isNaN(until)) return null
  const server = serverTime === undefined ? Number.NaN : Date.parse(serverTime)
  return Number.isNaN(server) ? until : receivedAt + (until - server)
}

/** Minutes are rounded up (4m10s reads 5); zero or less means sign in again. */
export const reauthClockAt = (
  endsAt: number | null,
  now: number
): ReauthClock => {
  const left = endsAt === null ? 0 : endsAt - now
  if (left <= 0) return { state: 'need' }
  return {
    state: left <= REAUTH_SOON_MS ? 'soon' : 'active',
    minutes: Math.ceil(left / 60_000)
  }
}

/**
 * Reads the cached current user without fetching again and redraws only when
 * the rounded minute changes, so there is no per-second countdown.
 */
export const useReauthClock = (): ReauthClock => {
  const { data, dataUpdatedAt } = useQuery({
    ...authQueries.currentUser(),
    enabled: false
  })
  const endsAt = reauthEndsAt(
    data?.adminFreshUntil,
    data?.adminServerTime,
    dataUpdatedAt
  )
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (endsAt === null) return
    const left = endsAt - Date.now()
    if (left <= 0) return
    // Wake just after the next whole minute of remaining time ends.
    const timer = window.setTimeout(
      () => setNow(Date.now()),
      (left % 60_000 || 60_000) + 50
    )
    return () => window.clearTimeout(timer)
  }, [endsAt, now])

  return reauthClockAt(endsAt, Math.max(now, dataUpdatedAt))
}

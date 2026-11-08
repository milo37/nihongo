import type { AuthenticatedUser } from '@nihongo/contracts/auth/get-current-principal'

/**
 * Milliseconds of admin re-verification left at `now`, counted on the
 * server clock: `adminFreshUntil - adminServerTime` when the answer arrived
 * (`receivedAt`), minus the time since. 0 when there is none.
 */
export const adminFreshRemainingMs = (
  user: Pick<AuthenticatedUser, 'adminFreshUntil' | 'adminServerTime'> | null,
  receivedAt: number,
  now: number = Date.now()
): number => {
  if (!user?.adminFreshUntil) return 0
  const until = Date.parse(user.adminFreshUntil)
  const serverNow = user.adminServerTime
    ? Date.parse(user.adminServerTime)
    : receivedAt
  return Math.max(0, until - serverNow - (now - receivedAt))
}

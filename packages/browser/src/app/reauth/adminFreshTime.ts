import type { AuthenticatedUser } from '@nihongo/contracts/auth/get-current-principal'
import { serverNow } from '../../libs/serverClock'

/**
 * Milliseconds of admin re-verification left at `now`, counted on the
 * server clock from the last /me Date header, so a wrong browser clock does
 * not matter. 0 when there is none.
 */
export const adminFreshRemainingMs = (
  user: Pick<AuthenticatedUser, 'adminFreshUntil'> | null,
  now: number = Date.now()
): number => {
  if (!user?.adminFreshUntil) return 0
  return Math.max(0, Date.parse(user.adminFreshUntil) - serverNow(now))
}

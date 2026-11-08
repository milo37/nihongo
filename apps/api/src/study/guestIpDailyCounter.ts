import { GUEST_DAILY_SESSION_LIMIT_PER_IP } from '@nihongo/contracts/study/guest-limits'
import type { PrismaClient } from '../generated/prisma/client.js'
import {
  applicationRateLimitKey,
  type ApplicationRateLimiter
} from '../middleware/applicationRateLimiter.js'
import {
  GUEST_DAILY_IP_OPERATION,
  GUEST_DAILY_IP_WINDOW_MS,
  guestDailyIpClient
} from './guestDay.js'

/**
 * Guest sessions created from one client IP on one Korea-time day (#737).
 * Only created sessions count, so one person retrying on a shared school or
 * office IP does not use up everyone's share; the per-minute creation limit
 * handles rapid retries. The day is part of the key, so the count starts
 * again at midnight Korea time.
 */
export interface GuestIpDailyCounter {
  /** Guest sessions this IP has created today. */
  used: (clientIp: string, at: Date) => Promise<number>
  /** Counts one created guest session. */
  record: (clientIp: string, at: Date) => Promise<void>
}

export const createGuestIpDailyCounter = ({
  client,
  keySecret,
  rateLimiter
}: {
  client: PrismaClient
  keySecret: string
  rateLimiter: ApplicationRateLimiter
}): GuestIpDailyCounter => ({
  used: async (clientIp, at) => {
    const row = await client.rateLimit.findUnique({
      where: {
        key: applicationRateLimitKey(
          keySecret,
          GUEST_DAILY_IP_OPERATION,
          guestDailyIpClient(clientIp, at)
        )
      },
      select: { count: true }
    })
    return row?.count ?? 0
  },
  record: async (clientIp, at) => {
    // The session already exists. Concurrent starts may pass `used` together,
    // so the count stops at the limit and the next start is refused.
    await rateLimiter
      .consume({
        clientIp: guestDailyIpClient(clientIp, at),
        operation: GUEST_DAILY_IP_OPERATION,
        windowMs: GUEST_DAILY_IP_WINDOW_MS,
        max: GUEST_DAILY_SESSION_LIMIT_PER_IP
      })
      .catch(() => undefined)
  }
})

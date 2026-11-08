import {
  GUEST_DAILY_SESSION_LIMIT,
  GUEST_DAILY_SESSION_LIMIT_PER_IP,
  GUEST_SESSION_QUESTION_LIMIT
} from '@nihongo/contracts/study/guest-limits'
import type { GetGuestAllowanceResponse } from '@nihongo/contracts/study/get-guest-allowance'
import type { PrismaClient } from '../generated/prisma/client.js'
import { applicationRateLimitKey } from '../middleware/applicationRateLimiter.js'
import {
  GUEST_DAILY_IP_OPERATION,
  guestDailyIpClient,
  nextGuestDayStart,
  startOfGuestDay
} from './guestDay.js'

export interface GuestAllowanceInput {
  at: Date
  clientIp: string
  /** The verified guest cookie, or null when there is none yet. */
  guest: { guestPrincipalId: string; tokenDigest: string } | null
}

export interface GuestAllowanceReader {
  read: (
    input: GuestAllowanceInput
  ) => Promise<Extract<GetGuestAllowanceResponse, { kind: 'GUEST' }>>
}

/**
 * Reads what a guest may still start today without writing anything. The
 * guest count matches the per-guest check in session creation, and the IP
 * count reads the same row as `GuestIpDailyCounter` (created sessions only).
 */
export const createPrismaGuestAllowanceReader = ({
  client,
  keySecret
}: {
  client: PrismaClient
  keySecret: string
}): GuestAllowanceReader => ({
  read: async ({ at, clientIp, guest }) => {
    const resetsAt = nextGuestDayStart(at)
    const [guestStarted, ipRow] = await Promise.all([
      guest
        ? client.studySession.count({
            where: {
              guestPrincipalId: guest.guestPrincipalId,
              guestPrincipal: { tokenDigest: guest.tokenDigest },
              startedAt: { gte: startOfGuestDay(at), lt: resetsAt }
            }
          })
        : Promise.resolve(0),
      client.rateLimit.findUnique({
        where: {
          key: applicationRateLimitKey(
            keySecret,
            GUEST_DAILY_IP_OPERATION,
            guestDailyIpClient(clientIp, at)
          )
        },
        select: { count: true }
      })
    ])
    // The key holds the Korea-time date, so the row only ever counts today.
    const ipStarted = ipRow?.count ?? 0
    return {
      kind: 'GUEST',
      sessionQuestionCount: GUEST_SESSION_QUESTION_LIMIT,
      dailyLimit: GUEST_DAILY_SESSION_LIMIT,
      remaining: Math.max(
        0,
        Math.min(
          GUEST_DAILY_SESSION_LIMIT - guestStarted,
          GUEST_DAILY_SESSION_LIMIT_PER_IP - ipStarted
        )
      ),
      resetsAt: resetsAt.toISOString()
    }
  }
})

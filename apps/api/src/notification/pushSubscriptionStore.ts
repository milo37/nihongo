import type { PushLocale } from '@nihongo/contracts/notification/web-push'
import type { PrismaClient } from '../generated/prisma/client.js'

export interface PushSubscriptionInput {
  /** The signed-in member who turned it on. */
  readonly userId: string
  readonly endpoint: string
  readonly p256dh: string
  readonly auth: string
  readonly locale: PushLocale
}

/** #1046: members' browser subscriptions, with no session or IP. */
export interface PushSubscriptionStore {
  /**
   * Same endpoint: new keys, language and member (another member turned it
   * on in the same browser); the day of the last send stays.
   */
  save(input: PushSubscriptionInput): Promise<void>
  /** Turning off; nothing to delete is fine. */
  remove(endpoint: string): Promise<void>
}

/** Browsers may pad base64url; the table keeps it unpadded. */
const unpadded = (value: string): string => value.replace(/=+$/u, '')

export const createPrismaPushSubscriptionStore = (
  client: Pick<PrismaClient, '$executeRaw'>
): PushSubscriptionStore => ({
  save: async ({ userId, endpoint, p256dh, auth, locale }) => {
    await client.$executeRaw`
      INSERT INTO "PushSubscription"
        ("userId", "endpoint", "p256dh", "auth", "locale")
      VALUES (${userId}::uuid, ${endpoint}, ${unpadded(p256dh)},
        ${unpadded(auth)}, ${locale})
      ON CONFLICT ("endpoint") DO UPDATE SET
        "userId" = EXCLUDED."userId",
        "p256dh" = EXCLUDED."p256dh",
        "auth" = EXCLUDED."auth",
        "locale" = EXCLUDED."locale",
        "updatedAt" = clock_timestamp()`
  },
  remove: async (endpoint) => {
    await client.$executeRaw`
      DELETE FROM "PushSubscription" WHERE "endpoint" = ${endpoint}`
  }
})

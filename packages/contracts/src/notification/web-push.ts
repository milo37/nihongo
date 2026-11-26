import { z } from 'zod'

/**
 * #1046: one web push a day at 08:00 Korea/Japan time that says the member's
 * daily goal. A subscription is the address and keys a browser gives; it
 * belongs to the member who turned it on (no session or IP) and is deleted
 * when it is turned off, the member is deleted or the push service says it is
 * gone. Members only; a member with no daily goal gets no push.
 *
 * GET    /api/v1/push/config        → 200 PushConfigResponse
 * PUT    /api/v1/push/subscription  → 204, member only (same endpoint: keys,
 *                                      locale and member replaced)
 * DELETE /api/v1/push/subscription  → 204 (also when there was none; no
 *                                      sign-in needed, so logout can call it)
 */
export const pushConfigResponseSchema = z
  .object({
    /** VAPID public key (base64url); null while push is off: hide the button. */
    publicKey: z
      .string()
      .regex(/^[A-Za-z0-9_-]{87}$/u)
      .nullable()
  })
  .strict()

export type PushConfigResponse = z.output<typeof pushConfigResponseSchema>

/**
 * The push services browsers use. The server only ever sends to these, so a
 * subscription cannot make it call any other address.
 */
const PUSH_SERVICE_HOSTS = [
  /^fcm\.googleapis\.com$/u,
  /^(?:[a-z0-9-]+\.)*push\.apple\.com$/u,
  /^updates\.push\.services\.mozilla\.com$/u,
  /^(?:[a-z0-9-]+\.)*notify\.windows\.com$/u
] as const

// https, a lower-case host with no user, password or port, then a path. The
// contracts build has no URL global, so the address is read by pattern.
const ENDPOINT_PATTERN = /^https:\/\/([a-z0-9.-]+)(?:[/?][\x21-\x7e]*)?$/u

export const isPushServiceEndpoint = (value: string): boolean => {
  const host = ENDPOINT_PATTERN.exec(value)?.[1]
  return (
    host !== undefined &&
    PUSH_SERVICE_HOSTS.some((pattern) => pattern.test(host))
  )
}

export const pushEndpointSchema = z
  .string()
  .max(1024)
  .refine(isPushServiceEndpoint, {
    message: '지원하지 않는 알림 주소입니다.'
  })

export const pushLocaleSchema = z.enum(['ko', 'ja'])

export type PushLocale = z.output<typeof pushLocaleSchema>

/** PushSubscription.toJSON() of the browser, plus the screen language. */
export const putPushSubscriptionRequestSchema = z
  .object({
    endpoint: pushEndpointSchema,
    keys: z
      .object({
        /** P-256 public key, 65 bytes in base64url. */
        p256dh: z.string().regex(/^[A-Za-z0-9_-]{87}=?$/u),
        /** Auth secret, 16 bytes in base64url. */
        auth: z.string().regex(/^[A-Za-z0-9_-]{22}(?:==)?$/u)
      })
      .strict(),
    locale: pushLocaleSchema
  })
  .strict()

export type PutPushSubscriptionRequest = z.output<
  typeof putPushSubscriptionRequestSchema
>

export const deletePushSubscriptionRequestSchema = z
  .object({ endpoint: pushEndpointSchema })
  .strict()

export type DeletePushSubscriptionRequest = z.output<
  typeof deletePushSubscriptionRequestSchema
>

/**
 * The words of the daily goal push, per screen language. It goes out at 08:00
 * Seoul time, so the title greets the morning. `{count}` becomes the member's
 * daily goal. The words live only here.
 */
export const DAILY_PUSH_TITLE: Readonly<Record<PushLocale, string>> = {
  ko: '좋은 아침이에요',
  ja: 'おはよう'
}

export const DAILY_PUSH_BODY_TEMPLATE: Readonly<Record<PushLocale, string>> = {
  ko: '오늘도 {count}문제, 가볍게 풀고 가요',
  ja: '今日も{count}問、気軽に解いていこう'
}

export const dailyPushBody = (locale: PushLocale, dailyGoal: number): string =>
  DAILY_PUSH_BODY_TEMPLATE[locale].replace('{count}', String(dailyGoal))

/** Tapping the push opens practice. */
export const DAILY_PUSH_URL = '/practice'

/**
 * The encrypted message the service worker receives. It shows `title` and
 * `body` and opens `url` when tapped.
 */
export const dailyPushPayloadSchema = z
  .object({
    kind: z.literal('DAILY_GOAL'),
    title: z.string().min(1).max(50),
    body: z.string().min(1).max(100),
    url: z.literal(DAILY_PUSH_URL)
  })
  .strict()

export type DailyPushPayload = z.output<typeof dailyPushPayloadSchema>

import { z } from 'zod'

/**
 * #1046: one web push a day ("오늘의 한 문제가 왔어요") at 08:00 Korea/Japan
 * time. A subscription is the address and keys a browser gives; it is kept
 * without a user, session or IP, until it is turned off or the push service
 * says it is gone. No sign-in: members and guests are the same.
 *
 * GET    /api/v1/push/config        → 200 PushConfigResponse
 * PUT    /api/v1/push/subscription  → 204 (same endpoint: keys and locale replaced)
 * DELETE /api/v1/push/subscription  → 204 (also when there was none)
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

/** The words of the daily push, per screen language. Nothing personal. */
export const DAILY_PUSH_BODY: Readonly<Record<PushLocale, string>> = {
  ko: '오늘의 한 문제가 왔어요',
  ja: '今日の1問が届きました'
}

/**
 * The encrypted message the service worker receives. It shows `body` under
 * the app name and opens `url` when tapped.
 */
export const dailyPushPayloadSchema = z
  .object({
    kind: z.literal('DAILY_QUESTION'),
    body: z.string().min(1).max(100),
    url: z.literal('/')
  })
  .strict()

export type DailyPushPayload = z.output<typeof dailyPushPayloadSchema>

import { describe, expect, it } from 'vitest'
import {
  DAILY_PUSH_BODY_TEMPLATE,
  DAILY_PUSH_TITLE,
  dailyPushBody,
  dailyPushPayloadSchema,
  deletePushSubscriptionRequestSchema,
  isPushServiceEndpoint,
  pushConfigResponseSchema,
  putPushSubscriptionRequestSchema
} from '../src/notification/web-push.js'

const subscription = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc:DEF_123',
  keys: { p256dh: `B${'a'.repeat(86)}`, auth: 'b'.repeat(22) },
  locale: 'ko'
}

describe('web push contract (#1046)', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/x',
    'https://web.push.apple.com/QGx',
    'https://updates.push.services.mozilla.com/wpush/v2/x',
    'https://wns2-par02p.notify.windows.com/w/?token=x'
  ])('accepts the push service %s', (endpoint) => {
    expect(isPushServiceEndpoint(endpoint)).toBe(true)
  })

  it.each([
    'http://fcm.googleapis.com/fcm/send/x',
    'https://fcm.googleapis.com:8443/fcm/send/x',
    'https://user@fcm.googleapis.com/fcm/send/x',
    'https://fcm.googleapis.com.evil.example/x',
    'https://evilpush.apple.com/x',
    'https://169.254.169.254/latest',
    'https://localhost/x',
    'not a url'
  ])('refuses any other address %s', (endpoint) => {
    expect(isPushServiceEndpoint(endpoint)).toBe(false)
  })

  it('takes the browser subscription with the screen language', () => {
    expect(putPushSubscriptionRequestSchema.parse(subscription)).toEqual(
      subscription
    )
    expect(
      putPushSubscriptionRequestSchema.parse({
        ...subscription,
        keys: {
          p256dh: `${subscription.keys.p256dh}=`,
          auth: 'b'.repeat(22) + '=='
        },
        locale: 'ja'
      }).locale
    ).toBe('ja')
  })

  it.each([
    ['another language', { ...subscription, locale: 'en' }],
    [
      'a short key',
      { ...subscription, keys: { ...subscription.keys, p256dh: 'abc' } }
    ],
    [
      'a long auth',
      { ...subscription, keys: { ...subscription.keys, auth: 'b'.repeat(40) } }
    ],
    ['an extra field', { ...subscription, expirationTime: null }],
    ['a user', { ...subscription, userId: 'u1' }],
    [
      'a long endpoint',
      {
        ...subscription,
        endpoint: `https://fcm.googleapis.com/${'x'.repeat(1024)}`
      }
    ]
  ])('refuses %s', (_label, body) => {
    expect(putPushSubscriptionRequestSchema.safeParse(body).success).toBe(false)
  })

  it('turns off by endpoint only', () => {
    expect(
      deletePushSubscriptionRequestSchema.parse({
        endpoint: subscription.endpoint
      })
    ).toEqual({ endpoint: subscription.endpoint })
    expect(
      deletePushSubscriptionRequestSchema.safeParse({ ...subscription }).success
    ).toBe(false)
  })

  it('gives a public key or null', () => {
    expect(pushConfigResponseSchema.parse({ publicKey: null })).toEqual({
      publicKey: null
    })
    expect(
      pushConfigResponseSchema.safeParse({ publicKey: 'short' }).success
    ).toBe(false)
  })
})

describe('daily push payload (#1046)', () => {
  it('says the daily goal and opens practice', () => {
    expect(dailyPushBody('ko', 30)).toBe('오늘도 30문제, 가볍게 풀고 가요')
    expect(dailyPushBody('ja', 150)).toBe(
      '今日も150問、気軽に解いていきましょう'
    )
    expect(DAILY_PUSH_TITLE).toEqual({
      ko: '좋은 아침이에요',
      ja: 'おはようございます'
    })
    for (const template of Object.values(DAILY_PUSH_BODY_TEMPLATE)) {
      expect(template).toContain('{count}')
    }
    const payload = {
      kind: 'DAILY_GOAL',
      title: DAILY_PUSH_TITLE.ko,
      body: dailyPushBody('ko', 10),
      url: '/practice'
    }
    expect(dailyPushPayloadSchema.parse(payload)).toEqual(payload)
    expect(
      dailyPushPayloadSchema.safeParse({ ...payload, url: '/' }).success
    ).toBe(false)
    expect(
      dailyPushPayloadSchema.safeParse({ ...payload, nickname: 'a' }).success
    ).toBe(false)
    const { title: _title, ...untitled } = payload
    expect(dailyPushPayloadSchema.safeParse(untitled).success).toBe(false)
  })
})

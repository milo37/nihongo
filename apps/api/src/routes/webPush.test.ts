import { createECDH } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { AuthGateway } from '../auth/authGateway.js'
import type { GuestPrincipalService } from '../auth/guestPrincipalService.js'
import type { PrincipalService } from '../auth/principalService.js'
import { parseApiEnvironment, type ApiEnvironment } from '../config/env.js'
import { ApplicationError } from '../errors/applicationError.js'
import type { ApplicationRateLimiter } from '../middleware/applicationRateLimiter.js'
import type { PushSubscriptionStore } from '../notification/pushSubscriptionStore.js'
import { createJsonLogger } from '../observability/logger.js'
import { createApiApp } from '../app/createApp.js'

const origin = 'https://app.example.test'
const environment = parseApiEnvironment({
  NODE_ENV: 'production',
  DEPLOYMENT_ENVIRONMENT: 'TEST',
  RELEASE_ID: 'a'.repeat(40),
  HOST: '127.0.0.1',
  PORT: '3001',
  LOG_LEVEL: 'info',
  DATABASE_URL:
    'postgresql://nihongo_test_app_login:placeholder@localhost/nihongo_test?schema=public&sslmode=require',
  TRUSTED_ORIGINS: origin,
  BETTER_AUTH_URL: origin,
  BETTER_AUTH_SECRET: 'test-auth-placeholder-only-1234567890',
  GUEST_COOKIE_SECRET: 'test-guest-placeholder-only-1234567890',
  AUTH_TRUSTED_PROXY_CIDRS: '127.0.0.1/32',
  WEB_PUSH_PUBLIC_KEY: `B${'k'.repeat(86)}`
})

const browserKey = createECDH('prime256v1')
browserKey.generateKeys()

const subscription = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
  keys: {
    p256dh: browserKey.getPublicKey().toString('base64url'),
    auth: 'b'.repeat(22)
  },
  locale: 'ja'
}

const fixture = (options: { limited?: boolean; env?: ApiEnvironment } = {}) => {
  const env = options.env ?? environment
  const rateLimiter = {
    consume: vi.fn<ApplicationRateLimiter['consume']>(async () => {
      if (options.limited)
        throw new ApplicationError({
          code: 'RATE_LIMITED',
          message: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
          retryable: true,
          retryAfterSeconds: 60
        })
    })
  }
  const store = {
    save: vi.fn<PushSubscriptionStore['save']>(async () => undefined),
    remove: vi.fn<PushSubscriptionStore['remove']>(async () => undefined)
  }
  const app = createApiApp({
    auth: {
      environment: env,
      gateway: { handle: vi.fn() } as unknown as AuthGateway,
      guestPrincipalService: {} as GuestPrincipalService,
      principalService: {} as PrincipalService
    },
    checkReadiness: async () => undefined,
    logger: createJsonLogger('silent', () => undefined, {
      deploymentEnvironment: 'TEST',
      releaseId: 'a'.repeat(40)
    }),
    questionReadSecurity: { environment: env, rateLimiter },
    webPushStore: store
  })
  return { app, rateLimiter, store }
}

const send = (
  app: ReturnType<typeof createApiApp>,
  method: 'PUT' | 'DELETE',
  body: unknown,
  headers: Record<string, string> = { Origin: origin }
) =>
  app.request('/api/v1/push/subscription', {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body)
  })

describe('web push routes (#1046)', () => {
  it('gives the public key without sign-in, or null while push is off', async () => {
    const on = await fixture().app.request('/api/v1/push/config')
    expect(on.status).toBe(200)
    expect(await on.json()).toEqual({ publicKey: `B${'k'.repeat(86)}` })

    const off = fixture({
      env: { ...environment, WEB_PUSH_PUBLIC_KEY: undefined }
    })
    const response = await off.app.request('/api/v1/push/config')
    expect(await response.json()).toEqual({ publicKey: null })
    const refused = await send(off.app, 'PUT', subscription)
    expect(refused.status).toBe(503)
    expect(off.store.save).not.toHaveBeenCalled()
  })

  it('saves a subscription with no person attached', async () => {
    const { app, rateLimiter, store } = fixture()
    const response = await send(app, 'PUT', subscription)
    expect(response.status).toBe(204)
    expect(store.save).toHaveBeenCalledWith({
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      locale: 'ja'
    })
    expect(rateLimiter.consume).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'push-subscription', max: 10 })
    )
  })

  it('turns off by endpoint', async () => {
    const { app, store } = fixture()
    const response = await send(app, 'DELETE', {
      endpoint: subscription.endpoint
    })
    expect(response.status).toBe(204)
    expect(store.remove).toHaveBeenCalledWith(subscription.endpoint)
  })

  it.each([
    ['another address', { ...subscription, endpoint: 'https://example.com/x' }],
    ['a person', { ...subscription, userId: 'u1' }],
    [
      'a key that is not a P-256 point',
      {
        ...subscription,
        keys: { ...subscription.keys, p256dh: `B${'a'.repeat(86)}=` }
      }
    ]
  ])('refuses %s', async (_label, body) => {
    const { app, store } = fixture()
    const response = await send(app, 'PUT', body)
    expect(response.status).toBe(422)
    expect(store.save).not.toHaveBeenCalled()
  })

  it('refuses a write from another site and over the limit', async () => {
    const other = fixture()
    const foreign = await send(other.app, 'PUT', subscription, {
      Origin: 'https://evil.example.test'
    })
    expect(foreign.status).toBe(403)
    expect(other.store.save).not.toHaveBeenCalled()

    const limited = fixture({ limited: true })
    const response = await send(limited.app, 'DELETE', {
      endpoint: subscription.endpoint
    })
    expect(response.status).toBe(429)
    expect(limited.store.remove).not.toHaveBeenCalled()
  })
})

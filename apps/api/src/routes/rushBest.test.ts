import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import {
  rushBestResponseSchema,
  submitRushScoreResponseSchema
} from '@nihongo/contracts/study/rush-best'
import { createApiErrorHandler } from '../app/createApp.js'
import type { PrincipalService } from '../auth/principalService.js'
import { parseApiEnvironment } from '../config/env.js'
import {
  createRushBestService,
  RushBestRepositoryUnavailableError,
  type RushBestRepository
} from '../member/rushBest.js'
import { requestContext } from '../middleware/requestContext.js'
import type { ApiVariables } from '../middleware/requestContext.js'
import { createJsonLogger } from '../observability/logger.js'
import { createRushBestRoutes } from './rushBest.js'

const environment = parseApiEnvironment({
  NODE_ENV: 'test',
  DEPLOYMENT_ENVIRONMENT: 'TEST',
  DATABASE_URL:
    'postgresql://nihongo_test_app_login:unit-only@127.0.0.1:5432/nihongo_test?schema=nihongo_' +
    'a'.repeat(32) +
    '_test&sslmode=verify-full',
  AUTH_TRUSTED_PROXY_CIDRS: '127.0.0.1/32,::1/128',
  BETTER_AUTH_SECRET: 'a'.repeat(48),
  GUEST_COOKIE_SECRET: 'b'.repeat(48),
  BETTER_AUTH_URL: 'http://127.0.0.1:4200',
  TRUSTED_ORIGINS: 'http://127.0.0.1:4200',
  HOST: '127.0.0.1',
  PORT: '4201',
  RELEASE_ID: '1'.repeat(40),
  LOG_LEVEL: 'silent'
})

const userId = '018f6b7a-1f4b-7d5e-8a91-4c27df9c10a1'

const entry = {
  mode: 'KANJI_RUSH_30S' as const,
  level: 'N3' as const,
  best: 24,
  achievedAt: '2026-11-20T01:00:00.000Z'
}

const createHarness = (
  repository: Partial<RushBestRepository> = {},
  session: 'member' | 'none' | 'expired' = 'member'
) => {
  const rateLimiter = { consume: vi.fn(async () => undefined) }
  const store = {
    read: vi.fn(async () => [entry]),
    submit: vi.fn(async () => ({ best: entry, isNewBest: true })),
    ...repository
  }
  const principalService = {
    resolveAuthenticatedUser: async () => ({
      clearSessionCookie: session === 'expired',
      headers: new Headers(),
      user:
        session === 'member'
          ? { id: userId, name: 'member', role: 'USER', targetLevel: null }
          : null
    })
  } as unknown as PrincipalService
  const app = new Hono<{ Variables: ApiVariables }>()
  app.use('*', requestContext)
  app.use('*', async (context, next) => {
    const url = new URL(context.req.url)
    context.set('rawRequestTarget', url.pathname + url.search)
    context.set('requestStartedAt', Date.now())
    await next()
  })
  app.route(
    '/api/v1/me/rush-best',
    createRushBestRoutes({
      environment,
      principalService,
      rateLimiter,
      rushBestService: createRushBestService(store)
    })
  )
  app.onError(createApiErrorHandler({ logger: createJsonLogger('silent') }))
  return { app, rateLimiter, store }
}

const send = (
  app: Hono<{ Variables: ApiVariables }>,
  method: 'GET' | 'PUT',
  body?: unknown
) =>
  app.request('/api/v1/me/rush-best', {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  })

describe('/api/v1/me/rush-best (#1043)', () => {
  it('reads every best of the member', async () => {
    const harness = createHarness()
    const response = await send(harness.app, 'GET')
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(rushBestResponseSchema.parse(await response.json())).toEqual({
      bests: [entry]
    })
    expect(harness.store.read).toHaveBeenCalledWith(userId)
    expect(harness.rateLimiter.consume).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'rush-best-read', max: 60 })
    )
  })

  it('submits a whole score from 0 to 60 for a mode and a level', async () => {
    const harness = createHarness()
    const body = { mode: 'KANJI_RUSH_30S', level: 'N3', score: 24 }
    const response = await send(harness.app, 'PUT', body)
    expect(response.status).toBe(200)
    expect(submitRushScoreResponseSchema.parse(await response.json())).toEqual({
      best: entry,
      isNewBest: true
    })
    expect(harness.store.submit).toHaveBeenCalledWith(userId, body)
    expect(harness.rateLimiter.consume).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'rush-best-write', max: 30 })
    )
    for (const bad of [
      {},
      { mode: 'KANJI_RUSH_30S', level: 'N3' },
      { ...body, score: -1 },
      { ...body, score: 61 },
      { ...body, score: 2.5 },
      { ...body, mode: 'PAIR_MATCH' },
      { ...body, level: 'N6' },
      { ...body, userId }
    ]) {
      const invalid = await send(harness.app, 'PUT', bad)
      expect(invalid.status).toBe(400)
      expect(await invalid.json()).toMatchObject({ code: 'INVALID_REQUEST' })
    }
    expect(harness.store.submit).toHaveBeenCalledTimes(1)
  })

  it('asks a guest or an expired session to sign in', async () => {
    const guest = createHarness({}, 'none')
    const guestResponse = await send(guest.app, 'GET')
    expect(guestResponse.status).toBe(401)
    expect(await guestResponse.json()).toMatchObject({
      code: 'AUTHENTICATION_REQUIRED'
    })
    const expired = createHarness({}, 'expired')
    const expiredResponse = await send(expired.app, 'PUT', {
      mode: 'KANJI_RUSH_30S',
      level: 'N5',
      score: 3
    })
    expect(expiredResponse.status).toBe(401)
    expect(await expiredResponse.json()).toMatchObject({
      code: 'AUTH_SESSION_EXPIRED'
    })
    expect(guest.store.read).not.toHaveBeenCalled()
    expect(expired.store.submit).not.toHaveBeenCalled()
  })

  it('treats a member who is no longer ACTIVE as signed out', async () => {
    const harness = createHarness({
      read: async () => null,
      submit: async () => null
    })
    expect((await send(harness.app, 'GET')).status).toBe(401)
    expect(
      (
        await send(harness.app, 'PUT', {
          mode: 'KANJI_RUSH_30S',
          level: 'N5',
          score: 3
        })
      ).status
    ).toBe(401)
  })

  it('answers SERVICE_UNAVAILABLE when the database is down', async () => {
    const harness = createHarness({
      submit: async () => {
        throw new RushBestRepositoryUnavailableError({
          cause: new Error('down')
        })
      }
    })
    const response = await send(harness.app, 'PUT', {
      mode: 'KANJI_RUSH_30S',
      level: 'N3',
      score: 10
    })
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      retryable: true
    })
  })
})

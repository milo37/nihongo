import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import { studyGoalResponseSchema } from '@nihongo/contracts/auth/study-goal'
import { createApiErrorHandler } from '../app/createApp.js'
import type { PrincipalService } from '../auth/principalService.js'
import { parseApiEnvironment } from '../config/env.js'
import {
  createStudyGoalService,
  StudyGoalRepositoryUnavailableError,
  type StudyGoalRepository
} from '../member/studyGoal.js'
import { requestContext } from '../middleware/requestContext.js'
import type { ApiVariables } from '../middleware/requestContext.js'
import { createJsonLogger } from '../observability/logger.js'
import { createStudyGoalRoutes } from './studyGoal.js'

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

const goal = (overrides: Record<string, unknown> = {}) => ({
  targetLevel: 'N3' as const,
  dailyGoal: 30,
  goalSetAt: '2026-11-18T01:00:00.000Z',
  skippedAt: null,
  onboardingRequired: false,
  todayAnsweredCount: 20,
  ...overrides
})

const createHarness = (
  repository: Partial<StudyGoalRepository> = {},
  session: 'member' | 'none' | 'expired' = 'member'
) => {
  const rateLimiter = { consume: vi.fn(async () => undefined) }
  const store = {
    read: vi.fn(async () => goal()),
    update: vi.fn(async () => goal()),
    skipOnboarding: vi.fn(async () =>
      goal({
        targetLevel: null,
        dailyGoal: null,
        goalSetAt: null,
        skippedAt: '2026-11-18T01:00:00.000Z'
      })
    ),
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
    '/api/v1/me/study-goal',
    createStudyGoalRoutes({
      environment,
      principalService,
      rateLimiter,
      studyGoalService: createStudyGoalService(store)
    })
  )
  app.onError(createApiErrorHandler({ logger: createJsonLogger('silent') }))
  return { app, rateLimiter, store }
}

const send = (
  app: Hono<{ Variables: ApiVariables }>,
  method: 'GET' | 'PUT' | 'POST',
  path = '',
  body?: unknown
) =>
  app.request(`/api/v1/me/study-goal${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  })

describe('/api/v1/me/study-goal (#1090)', () => {
  it('reads the member goal', async () => {
    const harness = createHarness()
    const response = await send(harness.app, 'GET')
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(studyGoalResponseSchema.parse(await response.json())).toEqual(goal())
    expect(harness.store.read).toHaveBeenCalledWith(userId)
    expect(harness.rateLimiter.consume).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'study-goal-read', max: 60 })
    )
  })

  it('saves a level and a daily goal in tens from 10 to 150', async () => {
    const harness = createHarness()
    const response = await send(harness.app, 'PUT', '', {
      targetLevel: 'N3',
      dailyGoal: 30
    })
    expect(response.status).toBe(200)
    expect(harness.store.update).toHaveBeenCalledWith(userId, 'N3', 30)
    expect(harness.rateLimiter.consume).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'study-goal-write', max: 30 })
    )
    for (const body of [
      {},
      { targetLevel: 'N3' },
      { targetLevel: 'N3', dailyGoal: 5 },
      { targetLevel: 'N3', dailyGoal: 15 },
      { targetLevel: 'N3', dailyGoal: 160 },
      { targetLevel: 'N6', dailyGoal: 30 },
      { targetLevel: 'N3', dailyGoal: 30, userId }
    ]) {
      const invalid = await send(harness.app, 'PUT', '', body)
      expect(invalid.status).toBe(400)
      expect(await invalid.json()).toMatchObject({ code: 'INVALID_REQUEST' })
    }
    expect(harness.store.update).toHaveBeenCalledTimes(1)
  })

  it('skips with an empty body only', async () => {
    const harness = createHarness()
    const response = await send(harness.app, 'POST', '/skip', {})
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      dailyGoal: null,
      skippedAt: '2026-11-18T01:00:00.000Z'
    })
    const invalid = await send(harness.app, 'POST', '/skip', { dailyGoal: 10 })
    expect(invalid.status).toBe(400)
    expect(harness.store.skipOnboarding).toHaveBeenCalledTimes(1)
  })

  it('asks a guest or an expired session to sign in', async () => {
    const guest = createHarness({}, 'none')
    const guestResponse = await send(guest.app, 'GET')
    expect(guestResponse.status).toBe(401)
    expect(await guestResponse.json()).toMatchObject({
      code: 'AUTHENTICATION_REQUIRED'
    })
    const expired = createHarness({}, 'expired')
    const expiredResponse = await send(expired.app, 'POST', '/skip', {})
    expect(expiredResponse.status).toBe(401)
    expect(await expiredResponse.json()).toMatchObject({
      code: 'AUTH_SESSION_EXPIRED'
    })
    expect(guest.store.read).not.toHaveBeenCalled()
    expect(expired.store.skipOnboarding).not.toHaveBeenCalled()
  })

  it('treats a member who is no longer ACTIVE as signed out', async () => {
    const harness = createHarness({ read: async () => null })
    const response = await send(harness.app, 'GET')
    expect(response.status).toBe(401)
  })

  it('answers SERVICE_UNAVAILABLE when the database is down', async () => {
    const harness = createHarness({
      update: async () => {
        throw new StudyGoalRepositoryUnavailableError({
          cause: new Error('down')
        })
      }
    })
    const response = await send(harness.app, 'PUT', '', {
      targetLevel: 'N3',
      dailyGoal: 30
    })
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      retryable: true
    })
  })
})

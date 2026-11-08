import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import {
  getMyTodayResponseSchema,
  type GetMyTodayResponse
} from '@nihongo/contracts/dashboard/get-my-today'
import { createApiErrorHandler } from '../app/createApp.js'
import type { PrincipalService } from '../auth/principalService.js'
import { parseApiEnvironment } from '../config/env.js'
import {
  MyTodayRepositoryUnavailableError,
  type MyTodayRepository
} from '../dashboard/myTodayRepository.js'
import {
  createMyTodayService,
  toStreakDays
} from '../dashboard/myTodayService.js'
import { requestContext } from '../middleware/requestContext.js'
import type { ApiVariables } from '../middleware/requestContext.js'
import { createJsonLogger } from '../observability/logger.js'
import { createMyTodayRoutes } from './myToday.js'

const userId = '11111111-1111-4111-8111-111111111111'
const observedAt = new Date('2026-08-16T05:00:00.000Z')

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

const createHarness = ({
  authenticated = true,
  repository = {
    readOwnedSnapshot: vi.fn(async () => ({
      latestStreak: { lastDay: '2026-08-15', length: 4 },
      observedAt,
      reviewDueCount: 3,
      today: '2026-08-16',
      todayAnsweredCount: 0
    }))
  }
}: {
  authenticated?: boolean
  repository?: MyTodayRepository
} = {}) => {
  const listOwnedResumable = vi.fn(async () => ({
    items: [],
    page: 1,
    pageSize: 1,
    total: 0
  }))
  const principalService = {
    getAuthenticatedUser: async () => null,
    resolveAuthenticatedUser: vi.fn(async () => ({
      clearSessionCookie: false,
      headers: new Headers(),
      user: authenticated
        ? {
            id: userId,
            name: 'My today',
            role: 'USER' as const,
            targetLevel: null
          }
        : null
    }))
  } satisfies PrincipalService
  const rateLimiter = { consume: vi.fn(async () => undefined) }
  const app = new Hono<{ Variables: ApiVariables }>()
  app.use('*', requestContext)
  app.use('*', async (context, next) => {
    const url = new URL(context.req.url)
    context.set('rawRequestTarget', url.pathname + url.search)
    context.set('requestStartedAt', Date.now())
    await next()
  })
  app.route(
    '/api/v1/me',
    createMyTodayRoutes({
      environment,
      myTodayService: createMyTodayService(repository, { listOwnedResumable }),
      principalService,
      rateLimiter
    })
  )
  app.onError(createApiErrorHandler({ logger: createJsonLogger('silent') }))
  return { app, listOwnedResumable, rateLimiter, repository }
}

describe('GET /api/v1/me/today', () => {
  it('returns the member card with the streak carried from yesterday', async () => {
    const harness = createHarness()
    const response = await harness.app.request('/api/v1/me/today')
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    const body: GetMyTodayResponse = getMyTodayResponseSchema.parse(
      await response.json()
    )
    expect(body).toEqual({
      observedAt: observedAt.toISOString(),
      timeZone: 'Asia/Seoul',
      today: '2026-08-16',
      streakDays: 4,
      studiedToday: false,
      todayAnsweredCount: 0,
      dailyGoal: 10,
      reviewDueCount: 3,
      latestResumableSession: null
    })
    expect(harness.rateLimiter.consume).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'me-today-read' })
    )
    expect(harness.listOwnedResumable).toHaveBeenCalledWith(
      { kind: 'USER', userId },
      { status: 'IN_PROGRESS', page: 1, pageSize: 1 },
      observedAt
    )
  })

  it('rejects query parameters', async () => {
    const harness = createHarness()
    const response = await harness.app.request('/api/v1/me/today?day=1')
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ code: 'VALIDATION_ERROR' })
    expect(harness.repository.readOwnedSnapshot).not.toHaveBeenCalled()
  })

  it('denies a guest before reading the repository', async () => {
    const harness = createHarness({ authenticated: false })
    const response = await harness.app.request('/api/v1/me/today')
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({
      code: 'AUTHENTICATION_REQUIRED'
    })
    expect(harness.repository.readOwnedSnapshot).not.toHaveBeenCalled()
  })

  it('maps an unavailable database to 503', async () => {
    const harness = createHarness({
      repository: {
        readOwnedSnapshot: vi.fn(async () => {
          throw new MyTodayRepositoryUnavailableError()
        })
      }
    })
    const response = await harness.app.request('/api/v1/me/today')
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({
      code: 'SERVICE_UNAVAILABLE'
    })
  })
})

describe('toStreakDays', () => {
  const run = (lastDay: string, length: number) => ({ lastDay, length })

  it.each([
    ['no submit yet', null, 0],
    ['run ends today', run('2026-03-01', 5), 5],
    ['run ends yesterday', run('2026-02-28', 5), 5],
    ['run ended two days ago', run('2026-02-27', 5), 0]
  ] as const)('%s', (_label, latestStreak, expected) => {
    expect(toStreakDays({ latestStreak, today: '2026-03-01' })).toBe(expected)
  })
})

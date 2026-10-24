import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import { getDashboardInsightsResponseSchema } from '@nihongo/contracts/dashboard/get-dashboard-insights'
import { createApiErrorHandler } from '../app/createApp.js'
import type { PrincipalService } from '../auth/principalService.js'
import { parseApiEnvironment } from '../config/env.js'
import type { ApiEnvironment } from '../config/env.js'
import {
  createPrismaDashboardInsightsRepository,
  type DashboardInsightsSnapshotRecord
} from '../dashboard/dashboardInsightsRepository.js'
import { createDashboardInsightsService } from '../dashboard/dashboardInsightsService.js'
import type { Prisma, PrismaClient } from '../generated/prisma/client.js'
import { requestContext } from '../middleware/requestContext.js'
import type { ApiVariables } from '../middleware/requestContext.js'
import { createJsonLogger } from '../observability/logger.js'
import { createDashboardInsightsRoutes } from './dashboardInsights.js'

const userId = '11111111-1111-4111-8111-111111111111'
const observedAt = new Date('2026-01-01T00:00:00.000Z')
const sessionProof = {
  id: '22222222-2222-4222-8222-222222222222',
  token: 'owned-session-proof'.repeat(3),
  createdAt: new Date(observedAt.getTime() - 60_000),
  expiresAt: new Date(observedAt.getTime() + 86_400_000),
  isFresh: true
}
const user = {
  id: userId,
  name: 'Insights regression',
  role: 'USER' as const,
  targetLevel: 'N5' as const
}

const snapshot: DashboardInsightsSnapshotRecord = {
  clock: { futureAnswerCount: 0n, observedAt, targetLevel: 'N5' },
  nonTagRows: [
    {
      attemptedCount: 0n,
      correctCount: 0n,
      elapsedTotal: 0n,
      incorrectCount: 0n,
      kind: 'OVERALL',
      lastAnsweredAt: null,
      level: null,
      questionType: null,
      repeatExtra: 0n,
      subject: null
    }
  ],
  reviewRows: [
    {
      earliestDueAt: null,
      isDue: null,
      kind: 'COUNTS',
      lastWrongAt: null,
      level: null,
      questionId: null,
      questionText: null,
      repeatedCount: 0n,
      status: null,
      subject: null,
      totalCount: 0n,
      wrongCount: null
    }
  ],
  tagRows: [],
  targetRows: [
    {
      catalogCount: 5n,
      lastStudiedAt: null,
      level: 'N5',
      nonRecentCount: 5n,
      subject: 'VOCABULARY'
    }
  ]
}

const createEnvironment = (
  cms: 'disabled' | 'technical',
  ownedAuth: boolean,
  nodeEnvironment: 'test' | 'production' = 'test'
): ApiEnvironment => {
  const origin =
    nodeEnvironment === 'production'
      ? 'https://insights.test.invalid'
      : 'http://127.0.0.1:4200'
  const databaseUrl = (login: string): string =>
    'postgresql://' +
    login +
    ':unit-only@127.0.0.1:5432/nihongo_test?schema=phase7_' +
    'a'.repeat(32) +
    '_test&sslmode=verify-full'
  return parseApiEnvironment({
    NODE_ENV: nodeEnvironment,
    DEPLOYMENT_ENVIRONMENT: 'TEST',
    ADMIN_CMS_MODE: cms,
    DATABASE_URL: databaseUrl(
      ownedAuth ? 'nihongo_test_app_login' : 'nihongo_test_legacy_app_login'
    ),
    ...(ownedAuth
      ? {
          AUTH_GATEWAY_DATABASE_URL: databaseUrl(
            'nihongo_test_auth_gateway_login'
          )
        }
      : {}),
    AUTH_TRUSTED_PROXY_CIDRS: '127.0.0.1/32,::1/128',
    BETTER_AUTH_SECRET: 'a'.repeat(48),
    GUEST_COOKIE_SECRET: 'b'.repeat(48),
    BETTER_AUTH_URL: origin,
    TRUSTED_ORIGINS: origin,
    HOST: '127.0.0.1',
    PORT: '4201',
    RELEASE_ID: '1'.repeat(40),
    PRACTICE_CONTRACT_RUNTIME: 'v1-v2',
    LOG_LEVEL: 'silent'
  })
}

const createHarness = ({
  cms = 'disabled',
  ownedAuth = true,
  nodeEnvironment = 'test',
  authenticated = true,
  hasSessionProof = true,
  databasePrincipalPresent = true
}: {
  cms?: 'disabled' | 'technical'
  ownedAuth?: boolean
  nodeEnvironment?: 'test' | 'production'
  authenticated?: boolean
  hasSessionProof?: boolean
  databasePrincipalPresent?: boolean
} = {}) => {
  const environment = createEnvironment(cms, ownedAuth, nodeEnvironment)
  const query = vi
    .fn<(...args: unknown[]) => Promise<unknown[]>>()
    .mockResolvedValueOnce(databasePrincipalPresent ? [snapshot.clock] : [])
    .mockResolvedValueOnce([...snapshot.nonTagRows])
    .mockResolvedValueOnce([...snapshot.tagRows])
    .mockResolvedValueOnce([...snapshot.reviewRows])
    .mockResolvedValueOnce([...snapshot.targetRows])
  const readOnly = vi.fn(async () => 0)
  const transaction = { $queryRaw: query, $executeRaw: readOnly }
  const transact = vi.fn(
    async (operation: (client: typeof transaction) => Promise<unknown>) =>
      operation(transaction)
  )
  const client = { $transaction: transact } as unknown as PrismaClient
  const repository = createPrismaDashboardInsightsRepository(
    client,
    ownedAuth ? 'PHASE7' : 'LEGACY'
  )
  const principalService = {
    getAuthenticatedUser: async () => (authenticated ? user : null),
    resolveAuthenticatedUser: vi.fn(async () => ({
      clearSessionCookie: false,
      headers: new Headers(),
      ...(authenticated && hasSessionProof
        ? { phase7Session: sessionProof }
        : {}),
      user: authenticated ? user : null
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
    '/api/v1/dashboard',
    createDashboardInsightsRoutes({
      dashboardInsightsService: createDashboardInsightsService(repository),
      environment,
      principalService,
      rateLimiter
    })
  )
  app.onError(createApiErrorHandler({ logger: createJsonLogger('silent') }))
  return { app, query, readOnly, transact, principalService }
}

describe('dashboard insights authentication authority', () => {
  it.each([
    ['test', 'disabled'],
    ['production', 'disabled'],
    ['test', 'technical']
  ] as const)(
    'uses owned session authority for %s with CMS %s',
    async (nodeEnvironment, cms) => {
      const harness = createHarness({ nodeEnvironment, cms })
      const response = await harness.app.request('/api/v1/dashboard/insights')
      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('private, no-store')
      expect(response.headers.getSetCookie()).toEqual([])
      const body = getDashboardInsightsResponseSchema.parse(
        await response.json()
      )
      expect(body.stats.overall.attemptedCount).toBe(0)
      expect(body.observedAt).toBe(observedAt.toISOString())
      expect(harness.transact).toHaveBeenCalledOnce()
      expect(harness.readOnly).toHaveBeenCalledOnce()
      const statement = harness.query.mock.calls[0]?.[0] as Prisma.Sql
      expect(statement.text).toContain('phase7_resolve_v1_principal')
      expect(statement.values.includes(sessionProof.token)).toBe(true)
      expect(statement.values.includes(userId)).toBe(true)
    }
  )

  it.each(['disabled', 'technical'] as const)(
    'rejects an owned USER without session proof when CMS is %s',
    async (cms) => {
      const harness = createHarness({ cms, hasSessionProof: false })
      const response = await harness.app.request('/api/v1/dashboard/insights')
      expect(response.status).toBe(401)
      expect(await response.json()).toMatchObject({
        code: 'AUTH_SESSION_EXPIRED'
      })
      expect(response.headers.getSetCookie().length).toBe(2)
      expect(harness.transact).not.toHaveBeenCalled()
    }
  )

  it('keeps the database principal revalidation fail closed', async () => {
    const harness = createHarness({ databasePrincipalPresent: false })
    const response = await harness.app.request('/api/v1/dashboard/insights')
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({
      code: 'AUTH_SESSION_EXPIRED'
    })
    expect(
      response.headers
        .getSetCookie()
        .every((cookie) => cookie.includes('Max-Age=0'))
    ).toBe(true)
    expect(harness.query).toHaveBeenCalledOnce()
    const statement = harness.query.mock.calls[0]?.[0] as Prisma.Sql
    expect(statement.text).toContain('phase7_resolve_v1_principal')
  })

  it('denies a guest before entering the repository', async () => {
    const harness = createHarness({ authenticated: false })
    const response = await harness.app.request('/api/v1/dashboard/insights')
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({
      code: 'AUTHENTICATION_REQUIRED'
    })
    expect(harness.transact).not.toHaveBeenCalled()
  })

  it('retains the legacy-only authority branch', async () => {
    const harness = createHarness({ ownedAuth: false, hasSessionProof: false })
    const response = await harness.app.request('/api/v1/dashboard/insights')
    expect(response.status).toBe(200)
    getDashboardInsightsResponseSchema.parse(await response.json())
    const statement = harness.query.mock.calls[0]?.[0] as Prisma.Sql
    expect(statement.text).not.toContain('phase7_resolve_v1_principal')
    expect(statement.text).toContain('"User"')
  })
})

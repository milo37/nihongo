import { apiFailureSchema } from '@nihongo/contracts/common/error'
import { dashboardInsightsConformanceFixture } from '@nihongo/contracts/testing/dashboard-insights-conformance'
import { describe, expect, it, vi } from 'vitest'
import { createApiApp } from '../app/createApp.js'
import type { AuthGateway } from '../auth/authGateway.js'
import type { GuestPrincipalService } from '../auth/guestPrincipalService.js'
import type { PrincipalService } from '../auth/principalService.js'
import type { ApiEnvironment } from '../config/env.js'
import type { DashboardInsightsService } from '../dashboard/dashboardInsightsService.js'
import type { DashboardService } from '../dashboard/dashboardService.js'
import { ApplicationError } from '../errors/applicationError.js'
import type { ApplicationRateLimiter } from '../middleware/applicationRateLimiter.js'
import { createJsonLogger } from '../observability/logger.js'
import type { QuestionReader } from '../question/questionService.js'
import type { WrongNoteReviewCenterService } from '../wrong-note/wrongNoteReviewCenterService.js'
import type { WrongNoteService } from '../wrong-note/wrongNoteService.js'

const ORIGIN = 'http://localhost:5173'
const USER_ID = '018f6b7a-1f4b-7d5e-8a91-4c27df9c10d2'

const environment = {
  NODE_ENV: 'test',
  HOST: '127.0.0.1',
  PORT: 3001,
  DATABASE_URL: 'postgresql://localhost/nihongo_test',
  TRUSTED_ORIGINS: [ORIGIN],
  LOG_LEVEL: 'silent',
  BETTER_AUTH_SECRET: 'auth-secret-that-is-at-least-32-characters',
  BETTER_AUTH_URL: 'http://localhost:3001',
  GUEST_COOKIE_SECRET: 'guest-secret-that-is-at-least-32-characters',
  AUTH_EMAIL_FROM: 'auth@example.test',
  AUTH_EMAIL_DELIVERY_MODE: 'test-sink',
  AUTH_TRUSTED_PROXY_CIDRS: ['127.0.0.1/32']
} satisfies ApiEnvironment

const authGateway: AuthGateway = {
  handle: async () => new Response(null, { status: 404 })
}

const questionReader: QuestionReader = {
  getQuestion: async () => Promise.reject(new Error('Not used.')),
  listQuestions: async () => ({ items: [], page: 1, pageSize: 20, total: 0 })
}

const createDependencies = () => {
  const principalService = {
    getAuthenticatedUser: vi.fn(),
    resolveAuthenticatedUser: vi.fn().mockResolvedValue({
      clearSessionCookie: false,
      headers: new Headers(),
      user: {
        id: USER_ID,
        name: 'Admin User',
        role: 'ADMIN',
        targetLevel: null
      }
    })
  } satisfies PrincipalService
  const guestPrincipalService = {
    clear: vi.fn(),
    create: vi.fn(),
    deleteExpired: vi.fn(),
    inspectCookie: vi.fn(
      (): ReturnType<GuestPrincipalService['inspectCookie']> => ({
        kind: 'ABSENT'
      })
    ),
    prepareCredential: vi.fn(),
    resolveExisting: vi.fn()
  } satisfies GuestPrincipalService
  const rateLimiter = {
    consume: vi.fn().mockResolvedValue(undefined)
  } satisfies ApplicationRateLimiter
  const dashboardInsightsService = {
    getDashboardInsights: vi
      .fn()
      .mockResolvedValue(dashboardInsightsConformanceFixture)
  } satisfies DashboardInsightsService
  const dashboardService = {
    getDashboardStats: vi.fn()
  } satisfies DashboardService
  const wrongNoteService = {
    getWrongNote: vi.fn<WrongNoteService['getWrongNote']>(),
    listWrongNotes: vi.fn<WrongNoteService['listWrongNotes']>()
  } satisfies WrongNoteService
  const reviewCenterService = {
    getMemo: vi.fn<WrongNoteReviewCenterService['getMemo']>(),
    listReviewEvents: vi.fn<WrongNoteReviewCenterService['listReviewEvents']>(),
    updateMemo: vi.fn<WrongNoteReviewCenterService['updateMemo']>()
  } satisfies WrongNoteReviewCenterService

  return {
    dashboardInsightsService,
    dashboardService,
    guestPrincipalService,
    principalService,
    rateLimiter,
    reviewCenterService,
    wrongNoteService
  }
}

const createTestApp = (
  dependencies: ReturnType<typeof createDependencies>,
  routeEnvironment: ApiEnvironment = environment
) =>
  createApiApp({
    auth: {
      environment: routeEnvironment,
      gateway: authGateway,
      guestPrincipalService: dependencies.guestPrincipalService,
      principalService: dependencies.principalService
    },
    checkReadiness: vi.fn().mockResolvedValue(undefined),
    learning: {
      dashboardInsightsService: dependencies.dashboardInsightsService,
      dashboardService: dependencies.dashboardService,
      rateLimiter: dependencies.rateLimiter,
      reviewCenterEnabled: false,
      reviewCenterService: dependencies.reviewCenterService,
      wrongNoteService: dependencies.wrongNoteService
    },
    logger: createJsonLogger('silent'),
    questionReader
  })

describe('Dashboard insights route', () => {
  it('USER/ADMIN 공통 self-only 응답과 rolling cookie·no-store를 보존한다', async () => {
    const dependencies = createDependencies()
    dependencies.principalService.resolveAuthenticatedUser.mockResolvedValue({
      clearSessionCookie: false,
      headers: new Headers({
        'Set-Cookie': 'nihongo.session_token=rolling; Path=/; HttpOnly'
      }),
      user: {
        id: USER_ID,
        name: 'Admin User',
        role: 'ADMIN',
        targetLevel: 'N1'
      }
    })

    const response = await createTestApp(dependencies).request(
      '/api/v1/dashboard/insights',
      { headers: { Origin: ORIGIN } }
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(dashboardInsightsConformanceFixture)
    expect(
      dependencies.dashboardInsightsService.getDashboardInsights
    ).toHaveBeenCalledWith({ kind: 'LEGACY', userId: USER_ID })
    expect(
      dependencies.dashboardService.getDashboardStats
    ).not.toHaveBeenCalled()
    expect(dependencies.rateLimiter.consume).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'dashboard-insights-read',
        windowMs: 60_000,
        max: 120
      })
    )
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(response.headers.get('Set-Cookie')).toContain(
      'nihongo.session_token=rolling'
    )
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN)
  })

  it('technical mode는 검증된 Phase 7 proof만 전달하고 proof loss를 닫는다', async () => {
    const technicalEnvironment = {
      ...environment,
      ADMIN_CMS_MODE: 'technical' as const,
      AUTH_GATEWAY_DATABASE_URL: environment.DATABASE_URL
    }
    const authorized = createDependencies()
    authorized.principalService.resolveAuthenticatedUser.mockResolvedValue({
      clearSessionCookie: false,
      headers: new Headers(),
      phase7Session: {
        id: '018f6b7a-1f4b-7d5e-8a91-4c27df9c10d3',
        token: 'phase7-authoritative-token',
        createdAt: new Date('2026-09-28T11:55:00.000Z'),
        expiresAt: new Date('2026-09-28T13:00:00.000Z'),
        isFresh: true
      },
      user: {
        id: USER_ID,
        name: 'Admin User',
        role: 'ADMIN',
        targetLevel: 'N1'
      }
    })
    const missingProof = createDependencies()

    const [authorizedResponse, missingProofResponse] = await Promise.all([
      createTestApp(authorized, technicalEnvironment).request(
        '/api/v1/dashboard/insights'
      ),
      createTestApp(missingProof, technicalEnvironment).request(
        '/api/v1/dashboard/insights'
      )
    ])

    expect(authorizedResponse.status).toBe(200)
    expect(
      authorized.dashboardInsightsService.getDashboardInsights
    ).toHaveBeenCalledWith({
      kind: 'PHASE7',
      sessionToken: 'phase7-authoritative-token',
      userId: USER_ID
    })
    expect(missingProofResponse.status).toBe(401)
    expect(await missingProofResponse.json()).toMatchObject({
      code: 'AUTH_SESSION_EXPIRED',
      retryable: false
    })
    expect(missingProofResponse.headers.get('Set-Cookie')).toContain(
      'Max-Age=0'
    )
    expect(
      missingProof.dashboardInsightsService.getDashboardInsights
    ).not.toHaveBeenCalled()
  })

  it('unknown·duplicate·malformed query를 rate 이후 auth 이전 422로 닫는다', async () => {
    const dependencies = createDependencies()
    const app = createTestApp(dependencies)
    const responses = await Promise.all([
      app.request(`/api/v1/dashboard/insights?userId=${USER_ID}`),
      app.request('/api/v1/dashboard/insights?role=USER&role=ADMIN'),
      app.request('/api/v1/dashboard/insights?algorithm=%ZZ'),
      app.request('/api/v1/dashboard/insights?isCorrect=true')
    ])

    expect(responses.map(({ status }) => status)).toEqual([422, 422, 422, 422])
    expect(
      await Promise.all(
        responses.map(async (response) =>
          apiFailureSchema.parse(await response.json())
        )
      )
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'VALIDATION_ERROR', retryable: false })
      ])
    )
    expect(dependencies.rateLimiter.consume).toHaveBeenCalledTimes(4)
    expect(
      dependencies.principalService.resolveAuthenticatedUser
    ).not.toHaveBeenCalled()
    expect(
      dependencies.dashboardInsightsService.getDashboardInsights
    ).not.toHaveBeenCalled()
  })

  it('rate limit를 query·auth·service보다 먼저 적용한다', async () => {
    const dependencies = createDependencies()
    dependencies.rateLimiter.consume.mockRejectedValue(
      new ApplicationError({
        code: 'RATE_LIMITED',
        message: '요청이 너무 많습니다.',
        retryable: true,
        retryAfterSeconds: 41
      })
    )

    const response = await createTestApp(dependencies).request(
      '/api/v1/dashboard/insights?userId=invalid'
    )
    const failure = apiFailureSchema.parse(await response.json())

    expect(response.status).toBe(429)
    expect(failure.code).toBe('RATE_LIMITED')
    expect(response.headers.get('Retry-After')).toBe('41')
    expect(
      dependencies.principalService.resolveAuthenticatedUser
    ).not.toHaveBeenCalled()
    expect(
      dependencies.dashboardInsightsService.getDashboardInsights
    ).not.toHaveBeenCalled()
  })

  it('guest/expired auth를 분리하고 learning·guest 저장소를 호출하지 않는다', async () => {
    const absent = createDependencies()
    absent.principalService.resolveAuthenticatedUser.mockResolvedValue({
      clearSessionCookie: false,
      headers: new Headers(),
      user: null
    })
    const expired = createDependencies()
    expired.principalService.resolveAuthenticatedUser.mockResolvedValue({
      clearSessionCookie: true,
      headers: new Headers(),
      user: null
    })

    const [absentResponse, expiredResponse] = await Promise.all([
      createTestApp(absent).request('/api/v1/dashboard/insights', {
        headers: { Cookie: 'nihongo.guest_principal=signed-guest' }
      }),
      createTestApp(expired).request('/api/v1/dashboard/insights')
    ])
    const absentFailure = apiFailureSchema.parse(await absentResponse.json())
    const expiredFailure = apiFailureSchema.parse(await expiredResponse.json())

    expect(absentResponse.status).toBe(401)
    expect(absentFailure.code).toBe('AUTHENTICATION_REQUIRED')
    expect(expiredResponse.status).toBe(401)
    expect(expiredFailure.code).toBe('AUTH_SESSION_EXPIRED')
    expect(expiredResponse.headers.get('Set-Cookie')).toContain('Max-Age=0')
    expect(absent.guestPrincipalService.inspectCookie).not.toHaveBeenCalled()
    expect(
      absent.dashboardInsightsService.getDashboardInsights
    ).not.toHaveBeenCalled()
    expect(
      expired.dashboardInsightsService.getDashboardInsights
    ).not.toHaveBeenCalled()
  })

  it('503는 retry-after로, malformed service output은 누출 없는 500으로 닫는다', async () => {
    const unavailable = createDependencies()
    unavailable.dashboardInsightsService.getDashboardInsights.mockRejectedValue(
      new ApplicationError({
        code: 'SERVICE_UNAVAILABLE',
        message: '대시보드 인사이트 저장소에 연결할 수 없습니다.',
        retryable: true
      })
    )
    const malformed = createDependencies()
    malformed.dashboardInsightsService.getDashboardInsights.mockImplementation(
      async () => ({ userId: USER_ID, secret: 'do-not-leak' }) as never
    )

    const [unavailableResponse, malformedResponse] = await Promise.all([
      createTestApp(unavailable).request('/api/v1/dashboard/insights'),
      createTestApp(malformed).request('/api/v1/dashboard/insights')
    ])
    const unavailableFailure = apiFailureSchema.parse(
      await unavailableResponse.json()
    )
    const malformedBody = await malformedResponse.text()
    const malformedFailure = apiFailureSchema.parse(JSON.parse(malformedBody))

    expect(unavailableResponse.status).toBe(503)
    expect(unavailableFailure.code).toBe('SERVICE_UNAVAILABLE')
    expect(unavailableResponse.headers.get('Retry-After')).toBe('5')
    expect(malformedResponse.status).toBe(500)
    expect(malformedFailure.code).toBe('INTERNAL_SERVER_ERROR')
    expect(malformedBody).not.toContain(USER_ID)
    expect(malformedBody).not.toContain('do-not-leak')
  })
})

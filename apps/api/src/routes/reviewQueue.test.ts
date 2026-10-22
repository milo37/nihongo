import {
  listReviewQueueErrorSchema,
  listReviewQueueResponseSchema
} from '@nihongo/contracts/wrong-note/list-review-queue'
import {
  assertNoReviewCenterForbiddenKeys,
  reviewCenterConformanceFixture
} from '@nihongo/contracts/testing/review-center-conformance'
import { describe, expect, it, vi } from 'vitest'
import { createApiApp } from '../app/createApp.js'
import type { AuthGateway } from '../auth/authGateway.js'
import type { GuestPrincipalService } from '../auth/guestPrincipalService.js'
import type { PrincipalService } from '../auth/principalService.js'
import type { ApiEnvironment } from '../config/env.js'
import type { DashboardService } from '../dashboard/dashboardService.js'
import { ApplicationError } from '../errors/applicationError.js'
import type { ApplicationRateLimiter } from '../middleware/applicationRateLimiter.js'
import type { StructuredLogger } from '../observability/logger.js'
import type { QuestionReader } from '../question/questionService.js'
import type { StudySessionService } from '../study/studySessionService.js'
import type { WrongNoteReviewCenterService } from '../wrong-note/wrongNoteReviewCenterService.js'
import type { WrongNoteReviewQueueService } from '../wrong-note/wrongNoteReviewQueueService.js'
import type { WrongNoteService } from '../wrong-note/wrongNoteService.js'

const ORIGIN = 'http://localhost:5173'
const USER_ID = '018f6b7a-1f4b-7d5e-8a91-4c27df9c1001'

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

const questionReader: QuestionReader = {
  getQuestion: async () => Promise.reject(new Error('Not used.')),
  listQuestions: async () => ({ items: [], page: 1, pageSize: 20, total: 0 })
}

const authGateway: AuthGateway = {
  handle: async () => new Response(null, { status: 404 })
}

const createDependencies = () => {
  const principalService = {
    getAuthenticatedUser: vi.fn(),
    resolveAuthenticatedUser: vi.fn().mockResolvedValue({
      clearSessionCookie: false,
      headers: new Headers(),
      user: {
        id: USER_ID,
        name: 'Queue User',
        role: 'USER',
        targetLevel: 'N5'
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
  const reviewQueueService = {
    listReviewQueue: vi
      .fn<WrongNoteReviewQueueService['listReviewQueue']>()
      .mockResolvedValue(reviewCenterConformanceFixture.queue)
  } satisfies WrongNoteReviewQueueService
  const reviewCenterService = {
    getMemo: vi.fn<WrongNoteReviewCenterService['getMemo']>(),
    listReviewEvents: vi.fn<WrongNoteReviewCenterService['listReviewEvents']>(),
    updateMemo: vi.fn<WrongNoteReviewCenterService['updateMemo']>()
  } satisfies WrongNoteReviewCenterService
  const studyService = {
    create: vi.fn<StudySessionService['create']>(),
    get: vi.fn<StudySessionService['get']>()
  } satisfies StudySessionService
  const wrongNoteService = {
    getWrongNote: vi.fn<WrongNoteService['getWrongNote']>(),
    listWrongNotes: vi.fn<WrongNoteService['listWrongNotes']>()
  } satisfies WrongNoteService
  const dashboardService = {
    getDashboardStats: vi.fn<DashboardService['getDashboardStats']>()
  } satisfies DashboardService
  const logger = {
    debug: vi.fn<StructuredLogger['debug']>(),
    info: vi.fn<StructuredLogger['info']>(),
    warn: vi.fn<StructuredLogger['warn']>(),
    error: vi.fn<StructuredLogger['error']>()
  } satisfies StructuredLogger
  return {
    dashboardService,
    guestPrincipalService,
    logger,
    principalService,
    rateLimiter,
    reviewCenterService,
    reviewQueueService,
    studyService,
    wrongNoteService
  }
}

const createTestApp = (
  dependencies: ReturnType<typeof createDependencies>,
  options: {
    practiceContractV2Enabled?: boolean
    reviewCenterEnabled?: boolean
    includeQueueService?: boolean
  } = {}
) =>
  createApiApp({
    auth: {
      environment,
      gateway: authGateway,
      guestPrincipalService: dependencies.guestPrincipalService,
      principalService: dependencies.principalService
    },
    checkReadiness: vi.fn().mockResolvedValue(undefined),
    learning: {
      dashboardService: dependencies.dashboardService,
      rateLimiter: dependencies.rateLimiter,
      reviewCenterEnabled: options.reviewCenterEnabled ?? true,
      reviewCenterService: dependencies.reviewCenterService,
      ...(options.includeQueueService === false
        ? {}
        : { reviewQueueService: dependencies.reviewQueueService }),
      wrongNoteService: dependencies.wrongNoteService
    },
    logger: dependencies.logger,
    questionReader,
    study: {
      practiceContractV2Enabled: options.practiceContractV2Enabled ?? true,
      rateLimiter: dependencies.rateLimiter,
      service: dependencies.studyService
    }
  })

describe('Phase 5 review queue route', () => {
  it.each([
    { reviewCenterEnabled: false },
    { practiceContractV2Enabled: false },
    { includeQueueService: false }
  ])(
    'double fail-closed gate가 route를 mount하지 않는다: %o',
    async (options) => {
      const dependencies = createDependencies()
      const response = await createTestApp(dependencies, options).request(
        '/api/v1/review-queue'
      )

      expect(response.status).toBe(404)
      expect(
        dependencies.reviewQueueService.listReviewQueue
      ).not.toHaveBeenCalled()
    }
  )

  it('canonical query·owner·response headers와 private projection을 보존한다', async () => {
    const dependencies = createDependencies()
    const response = await createTestApp(dependencies).request(
      '/api/v1/review-queue?view=DUE&level=N5&subject=VOCABULARY&questionType=KANJI_READING&tag=%ED%95%9C%EC%9E%90+%EC%9D%BD%EA%B8%B0&sort=NEXT_REVIEW&page=1&pageSize=20'
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(response.headers.get('X-Request-Id')).toMatch(/^[0-9a-f-]{36}$/u)
    const body = listReviewQueueResponseSchema.parse(await response.json())
    expect(body).toEqual(reviewCenterConformanceFixture.queue)
    assertNoReviewCenterForbiddenKeys('QUEUE', body)
    expect(
      dependencies.reviewQueueService.listReviewQueue
    ).toHaveBeenCalledWith(USER_ID, {
      view: 'DUE',
      level: 'N5',
      subject: 'VOCABULARY',
      questionType: 'KANJI_READING',
      tag: '한자 읽기',
      sort: 'NEXT_REVIEW',
      page: 1,
      pageSize: 20
    })
  })

  it('anonymous와 expired session을 service 호출 전 closed 401로 분리한다', async () => {
    const dependencies = createDependencies()
    dependencies.principalService.resolveAuthenticatedUser
      .mockResolvedValueOnce({
        clearSessionCookie: false,
        headers: new Headers(),
        user: null
      })
      .mockResolvedValueOnce({
        clearSessionCookie: true,
        headers: new Headers(),
        user: null
      })
    const app = createTestApp(dependencies)

    const anonymous = await app.request('/api/v1/review-queue')
    const expired = await app.request('/api/v1/review-queue')
    expect(anonymous.status).toBe(401)
    expect(expired.status).toBe(401)
    expect(listReviewQueueErrorSchema.parse(await anonymous.json()).code).toBe(
      'AUTHENTICATION_REQUIRED'
    )
    expect(listReviewQueueErrorSchema.parse(await expired.json()).code).toBe(
      'AUTH_SESSION_EXPIRED'
    )
    expect(expired.headers.get('Set-Cookie')).toContain('Max-Age=0')
    expect(
      dependencies.reviewQueueService.listReviewQueue
    ).not.toHaveBeenCalled()
  })

  it.each([
    '?unknown=x',
    '?page=1&page=2',
    '?__proto__=x',
    '?page=0',
    '?pageSize=101'
  ])('strict query %s를 auth/service 전 422로 닫는다', async (suffix) => {
    const dependencies = createDependencies()
    const response = await createTestApp(dependencies).request(
      `/api/v1/review-queue${suffix}`
    )

    expect(response.status).toBe(422)
    expect(listReviewQueueErrorSchema.parse(await response.json()).code).toBe(
      'VALIDATION_ERROR'
    )
    expect(
      dependencies.principalService.resolveAuthenticatedUser
    ).not.toHaveBeenCalled()
    expect(
      dependencies.reviewQueueService.listReviewQueue
    ).not.toHaveBeenCalled()
  })

  it('rate limit과 response integrity failure를 closed union으로 반환한다', async () => {
    const rateLimited = createDependencies()
    rateLimited.rateLimiter.consume.mockRejectedValue(
      new ApplicationError({
        code: 'RATE_LIMITED',
        message: '요청이 너무 많습니다.',
        retryable: true,
        retryAfterSeconds: 31
      })
    )
    const rateResponse = await createTestApp(rateLimited).request(
      '/api/v1/review-queue'
    )
    expect(rateResponse.status).toBe(429)
    expect(rateResponse.headers.get('Retry-After')).toBe('31')
    expect(
      listReviewQueueErrorSchema.parse(await rateResponse.json()).code
    ).toBe('RATE_LIMITED')
    expect(
      rateLimited.principalService.resolveAuthenticatedUser
    ).not.toHaveBeenCalled()

    const invalid = createDependencies()
    invalid.reviewQueueService.listReviewQueue.mockResolvedValue({
      ...reviewCenterConformanceFixture.queue,
      items: reviewCenterConformanceFixture.queue.items.map((item) => ({
        ...item,
        tags: ['대기열 facet에 없는 태그']
      }))
    })
    const integrityResponse = await createTestApp(invalid).request(
      '/api/v1/review-queue'
    )
    expect(integrityResponse.status).toBe(500)
    expect(
      listReviewQueueErrorSchema.parse(await integrityResponse.json()).code
    ).toBe('INTERNAL_SERVER_ERROR')
  })
})

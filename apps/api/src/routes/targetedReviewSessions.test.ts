import { randomUUID } from 'node:crypto'
import {
  createTargetedReviewSessionErrorSchema,
  createTargetedReviewSessionResponseSchema
} from '@nihongo/contracts/wrong-note/create-targeted-review-session'
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
import type { WrongNoteTargetedReviewService } from '../wrong-note/wrongNoteTargetedReviewService.js'
import type { WrongNoteService } from '../wrong-note/wrongNoteService.js'

const ORIGIN = 'http://localhost:5173'
const USER_ID = '018f6b7a-1f4b-7d5e-8a91-4c27df9c1001'
const QUESTION_ID = reviewCenterConformanceFixture.targetedQuestionId

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
        name: 'Targeted User',
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
  const targetedReviewService = {
    createTargetedReviewSession: vi
      .fn<WrongNoteTargetedReviewService['createTargetedReviewSession']>()
      .mockResolvedValue({
        replayed: false,
        response: reviewCenterConformanceFixture.targetedSession
      })
  } satisfies WrongNoteTargetedReviewService
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
    studyService,
    targetedReviewService,
    wrongNoteService
  }
}

const createTestApp = (
  dependencies: ReturnType<typeof createDependencies>,
  options: {
    readonly includeTargetedService?: boolean
    readonly practiceContractV2Enabled?: boolean
    readonly reviewCenterEnabled?: boolean
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
      ...(options.includeTargetedService === false
        ? {}
        : { targetedReviewService: dependencies.targetedReviewService }),
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

const request = (
  app: ReturnType<typeof createTestApp>,
  path = `/api/v1/wrong-notes/${QUESTION_ID}/review-session`,
  init: RequestInit = {}
) => {
  const { body = '{}', headers, ...rest } = init
  return app.request(path, {
    ...rest,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: ORIGIN,
      'X-Nihongo-Practice-Contract': '2',
      'Idempotency-Key': randomUUID(),
      ...headers
    },
    body
  })
}

describe('Phase 5 targeted review session route', () => {
  it.each([
    { reviewCenterEnabled: false },
    { practiceContractV2Enabled: false },
    { includeTargetedService: false }
  ])(
    'triple fail-closed gate가 route를 mount하지 않는다: %o',
    async (options) => {
      const dependencies = createDependencies()
      const response = await request(createTestApp(dependencies, options))

      expect(response.status).toBe(404)
      expect(
        dependencies.targetedReviewService.createTargetedReviewSession
      ).not.toHaveBeenCalled()
    }
  )

  it('USER/ADMIN self actor와 exact 201 transport를 보존한다', async () => {
    const dependencies = createDependencies()
    dependencies.principalService.resolveAuthenticatedUser
      .mockResolvedValueOnce({
        clearSessionCookie: false,
        headers: new Headers(),
        user: { id: USER_ID, name: 'User', role: 'USER', targetLevel: 'N5' }
      })
      .mockResolvedValueOnce({
        clearSessionCookie: false,
        headers: new Headers(),
        user: { id: USER_ID, name: 'Admin', role: 'ADMIN', targetLevel: 'N5' }
      })
    const app = createTestApp(dependencies)
    const key = randomUUID()
    const first = await request(app, undefined, {
      headers: { 'Idempotency-Key': key }
    })
    dependencies.targetedReviewService.createTargetedReviewSession.mockResolvedValueOnce(
      {
        replayed: true,
        response: reviewCenterConformanceFixture.targetedSession
      }
    )
    const replay = await request(app, undefined, {
      headers: { 'Idempotency-Key': key }
    })

    for (const response of [first, replay]) {
      expect(response.status).toBe(201)
      expect(response.headers.get('Cache-Control')).toBe('private, no-store')
      expect(response.headers.get('X-Request-Id')).toMatch(/^[0-9a-f-]{36}$/u)
      expect(response.headers.get('X-Nihongo-Practice-Contract')).toBe('2')
      expect(response.headers.get('Location')).toBe(
        reviewCenterConformanceFixture.targetedLocation
      )
      const body = createTargetedReviewSessionResponseSchema.parse(
        await response.json()
      )
      assertNoReviewCenterForbiddenKeys('TARGETED_SESSION', body)
    }
    expect(first.headers.get('Idempotency-Replayed')).toBeNull()
    expect(replay.headers.get('Idempotency-Replayed')).toBe('true')
    expect(
      dependencies.targetedReviewService.createTargetedReviewSession
    ).toHaveBeenNthCalledWith(1, USER_ID, QUESTION_ID, key)
    expect(
      dependencies.targetedReviewService.createTargetedReviewSession
    ).toHaveBeenNthCalledWith(2, USER_ID, QUESTION_ID, key)
  })

  it('anonymous와 expired session을 service 전 closed 401로 구분한다', async () => {
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

    const anonymous = await request(app)
    const expired = await request(app)
    expect(anonymous.status).toBe(401)
    expect(expired.status).toBe(401)
    expect(
      createTargetedReviewSessionErrorSchema.parse(await anonymous.json()).code
    ).toBe('AUTHENTICATION_REQUIRED')
    expect(
      createTargetedReviewSessionErrorSchema.parse(await expired.json()).code
    ).toBe('AUTH_SESSION_EXPIRED')
    expect(expired.headers.get('Set-Cookie')).toContain('Max-Age=0')
    expect(
      dependencies.targetedReviewService.createTargetedReviewSession
    ).not.toHaveBeenCalled()
  })

  it.each([
    [`/api/v1/wrong-notes/not-a-uuid/review-session`, {}, 'INVALID_ID'],
    [undefined, { pathSuffix: '?userId=x' }, 'INVALID_REQUEST'],
    [undefined, { pathSuffix: '?__proto__=x' }, 'INVALID_REQUEST'],
    [undefined, { contract: '1' }, 'INVALID_REQUEST'],
    [undefined, { key: 'bad-key' }, 'IDEMPOTENCY_KEY_REQUIRED'],
    [undefined, { body: '{"questionId":"x"}' }, 'INVALID_REQUEST']
  ] as const)(
    'strict input를 auth/service 전 closed union으로 닫는다',
    async (basePath, mutation, expectedCode) => {
      const dependencies = createDependencies()
      const path = `${basePath ?? `/api/v1/wrong-notes/${QUESTION_ID}/review-session`}${'pathSuffix' in mutation ? mutation.pathSuffix : ''}`
      const response = await request(createTestApp(dependencies), path, {
        body: 'body' in mutation ? mutation.body : '{}',
        headers: {
          'X-Nihongo-Practice-Contract':
            'contract' in mutation ? mutation.contract : '2',
          'Idempotency-Key': 'key' in mutation ? mutation.key : randomUUID()
        }
      })

      expect(response.status).toBe(expectedCode === 'INVALID_ID' ? 422 : 400)
      expect(
        createTargetedReviewSessionErrorSchema.parse(await response.json()).code
      ).toBe(expectedCode)
      expect(
        dependencies.principalService.resolveAuthenticatedUser
      ).not.toHaveBeenCalled()
      expect(
        dependencies.targetedReviewService.createTargetedReviewSession
      ).not.toHaveBeenCalled()
    }
  )

  it('write security와 rate limit가 parse/auth/service보다 먼저 실행된다', async () => {
    const badMedia = createDependencies()
    const badMediaResponse = await request(createTestApp(badMedia), undefined, {
      headers: { 'Content-Type': 'text/plain' }
    })
    expect(badMediaResponse.status).toBe(400)
    expect(
      createTargetedReviewSessionErrorSchema.parse(
        await badMediaResponse.json()
      ).code
    ).toBe('INVALID_REQUEST')

    const badOrigin = createDependencies()
    const badOriginResponse = await request(
      createTestApp(badOrigin),
      undefined,
      { headers: { Origin: 'https://attacker.example' } }
    )
    expect(badOriginResponse.status).toBe(403)
    expect(
      createTargetedReviewSessionErrorSchema.parse(
        await badOriginResponse.json()
      ).code
    ).toBe('UNTRUSTED_ORIGIN')

    const limited = createDependencies()
    limited.rateLimiter.consume.mockRejectedValue(
      new ApplicationError({
        code: 'RATE_LIMITED',
        message: '요청이 너무 많습니다.',
        retryable: true,
        retryAfterSeconds: 17
      })
    )
    const limitedResponse = await request(createTestApp(limited))
    expect(limitedResponse.status).toBe(429)
    expect(limitedResponse.headers.get('Retry-After')).toBe('17')
    expect(
      createTargetedReviewSessionErrorSchema.parse(await limitedResponse.json())
        .code
    ).toBe('RATE_LIMITED')
    expect(
      limited.principalService.resolveAuthenticatedUser
    ).not.toHaveBeenCalled()
  })

  it('path와 다른 valid target response를 safe 500으로 닫는다', async () => {
    const dependencies = createDependencies()
    const targetedQuestion =
      reviewCenterConformanceFixture.targetedSession.questions[0]
    if (!targetedQuestion) {
      throw new Error('targeted conformance question이 필요합니다.')
    }
    dependencies.targetedReviewService.createTargetedReviewSession.mockResolvedValue(
      {
        replayed: false,
        response: {
          ...reviewCenterConformanceFixture.targetedSession,
          questions: [
            {
              ...targetedQuestion,
              question: {
                ...targetedQuestion.question,
                id: randomUUID()
              }
            }
          ]
        }
      }
    )

    const response = await request(createTestApp(dependencies))
    expect(response.status).toBe(500)
    expect(
      createTargetedReviewSessionErrorSchema.parse(await response.json()).code
    ).toBe('INTERNAL_SERVER_ERROR')
  })
})

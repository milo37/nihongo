import { apiFailureSchema } from '@nihongo/contracts/common/error'
import {
  getWrongNoteMemoErrorSchema,
  type GetWrongNoteMemoResponse
} from '@nihongo/contracts/wrong-note/get-wrong-note-memo'
import {
  listReviewEventsErrorSchema,
  type ListReviewEventsResponse
} from '@nihongo/contracts/wrong-note/list-review-events'
import {
  updateWrongNoteMemoErrorSchema,
  type UpdateWrongNoteMemoResponse
} from '@nihongo/contracts/wrong-note/update-wrong-note-memo'
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
import type { WrongNoteService } from '../wrong-note/wrongNoteService.js'

const ORIGIN = 'http://localhost:5173'
const USER_ID = '018f6b7a-1f4b-7d5e-8a91-4c27df9c1001'
const ADMIN_ID = '018f6b7a-1f4b-7d5e-8a91-4c27df9c1002'
const QUESTION_ID = reviewCenterConformanceFixture.memo.questionId
const MISSING_ID = '018f6b7a-1f4b-7d5e-8a91-4c27df9c1099'

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
        name: 'Review User',
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
  const reviewCenterService = {
    getMemo: vi
      .fn<WrongNoteReviewCenterService['getMemo']>()
      .mockResolvedValue(reviewCenterConformanceFixture.memo),
    listReviewEvents: vi
      .fn<WrongNoteReviewCenterService['listReviewEvents']>()
      .mockResolvedValue(reviewCenterConformanceFixture.history),
    updateMemo: vi
      .fn<WrongNoteReviewCenterService['updateMemo']>()
      .mockResolvedValue(reviewCenterConformanceFixture.memo)
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
    wrongNoteService
  }
}

const createTestApp = (
  dependencies: ReturnType<typeof createDependencies>,
  reviewCenterEnabled = true,
  practiceContractV2Enabled = true
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
      reviewCenterEnabled,
      reviewCenterService: dependencies.reviewCenterService,
      wrongNoteService: dependencies.wrongNoteService
    },
    logger: dependencies.logger,
    questionReader,
    study: {
      practiceContractV2Enabled,
      rateLimiter: dependencies.rateLimiter,
      service: dependencies.studyService
    }
  })

const getMemo = (
  app: ReturnType<typeof createTestApp>,
  questionId = QUESTION_ID,
  suffix = ''
) => app.request(`/api/v1/wrong-notes/${questionId}/memo${suffix}`)

const putMemo = (
  app: ReturnType<typeof createTestApp>,
  body: string,
  headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Origin: ORIGIN
  }
) =>
  app.request(`/api/v1/wrong-notes/${QUESTION_ID}/memo`, {
    method: 'PUT',
    headers,
    body
  })

describe('Phase 5 review-center memo/history routes', () => {
  it('v1-compatible runtime에는 새 route를 mount하지 않는다', async () => {
    const dependencies = createDependencies()
    const app = createTestApp(dependencies, true, false)

    const [memo, update, history] = await Promise.all([
      getMemo(app),
      putMemo(app, JSON.stringify({ memo: '숨겨진 메모' })),
      app.request(`/api/v1/wrong-notes/${QUESTION_ID}/review-events`)
    ])

    expect([memo.status, update.status, history.status]).toEqual([
      404, 404, 404
    ])
    expect(dependencies.reviewCenterService.getMemo).not.toHaveBeenCalled()
    expect(dependencies.reviewCenterService.updateMemo).not.toHaveBeenCalled()
    expect(
      dependencies.reviewCenterService.listReviewEvents
    ).not.toHaveBeenCalled()
  })

  it('memo GET/PUT과 history가 canonical body·header·owner를 보존한다', async () => {
    const dependencies = createDependencies()
    const app = createTestApp(dependencies)

    const memo = await getMemo(app, QUESTION_ID.toUpperCase())
    const update = await putMemo(app, JSON.stringify({ memo: '  새 메모  ' }))
    const history = await app.request(
      `/api/v1/wrong-notes/${QUESTION_ID}/review-events?pageSize=2`
    )

    expect(memo.status).toBe(200)
    expect(update.status).toBe(200)
    expect(history.status).toBe(200)
    const memoBody = (await memo.json()) as GetWrongNoteMemoResponse
    const updateBody = (await update.json()) as UpdateWrongNoteMemoResponse
    const historyBody = (await history.json()) as ListReviewEventsResponse
    expect(memoBody).toEqual(reviewCenterConformanceFixture.memo)
    expect(updateBody).toEqual(reviewCenterConformanceFixture.memo)
    expect(historyBody).toEqual(reviewCenterConformanceFixture.history)
    assertNoReviewCenterForbiddenKeys('MEMO', memoBody)
    assertNoReviewCenterForbiddenKeys('MEMO', updateBody)
    assertNoReviewCenterForbiddenKeys('HISTORY', historyBody)
    expect(dependencies.reviewCenterService.getMemo).toHaveBeenCalledWith(
      USER_ID,
      QUESTION_ID
    )
    expect(dependencies.reviewCenterService.updateMemo).toHaveBeenCalledWith(
      USER_ID,
      QUESTION_ID,
      { memo: '새 메모' }
    )
    expect(
      dependencies.reviewCenterService.listReviewEvents
    ).toHaveBeenCalledWith(USER_ID, QUESTION_ID, { pageSize: 2 })
    for (const response of [memo, update, history]) {
      expect(response.headers.get('Cache-Control')).toBe('private, no-store')
      expect(response.headers.get('X-Request-Id')).toMatch(/^[0-9a-f-]{36}$/u)
    }
  })

  it('ADMIN도 자기 actor ID로만 조회한다', async () => {
    const dependencies = createDependencies()
    dependencies.principalService.resolveAuthenticatedUser.mockResolvedValue({
      clearSessionCookie: false,
      headers: new Headers(),
      user: {
        id: ADMIN_ID,
        name: 'Review Admin',
        role: 'ADMIN',
        targetLevel: 'N1'
      }
    })

    const response = await getMemo(createTestApp(dependencies))

    expect(response.status).toBe(200)
    expect(dependencies.reviewCenterService.getMemo).toHaveBeenCalledWith(
      ADMIN_ID,
      QUESTION_ID
    )
  })

  it('ADMIN memo write/history도 자기 actor ID만 전달한다', async () => {
    const dependencies = createDependencies()
    dependencies.principalService.resolveAuthenticatedUser.mockResolvedValue({
      clearSessionCookie: false,
      headers: new Headers(),
      user: {
        id: ADMIN_ID,
        name: 'Review Admin',
        role: 'ADMIN',
        targetLevel: 'N1'
      }
    })
    const app = createTestApp(dependencies)

    const [update, history] = await Promise.all([
      putMemo(app, JSON.stringify({ memo: '관리자 자신의 메모' })),
      app.request(`/api/v1/wrong-notes/${QUESTION_ID}/review-events`)
    ])

    expect(update.status).toBe(200)
    expect(history.status).toBe(200)
    expect(dependencies.reviewCenterService.updateMemo).toHaveBeenCalledWith(
      ADMIN_ID,
      QUESTION_ID,
      { memo: '관리자 자신의 메모' }
    )
    expect(
      dependencies.reviewCenterService.listReviewEvents
    ).toHaveBeenCalledWith(ADMIN_ID, QUESTION_ID, { pageSize: 20 })
  })

  it('guest와 만료 session은 service 전에 closed 401로 닫는다', async () => {
    for (const expired of [false, true]) {
      const dependencies = createDependencies()
      dependencies.principalService.resolveAuthenticatedUser.mockResolvedValue({
        clearSessionCookie: expired,
        headers: new Headers(),
        user: null
      })

      const response = await getMemo(createTestApp(dependencies))
      const failure = getWrongNoteMemoErrorSchema.parse(await response.json())

      expect(response.status).toBe(401)
      expect(failure.code).toBe(
        expired ? 'AUTH_SESSION_EXPIRED' : 'AUTHENTICATION_REQUIRED'
      )
      expect(dependencies.reviewCenterService.getMemo).not.toHaveBeenCalled()
      expect(
        dependencies.guestPrincipalService.inspectCookie
      ).not.toHaveBeenCalled()
      if (expired) {
        expect(response.headers.get('Set-Cookie')).toContain('Max-Age=0')
      }
    }
  })

  it('guest memo write/history도 service 전에 각 operation closed 401로 닫는다', async () => {
    const dependencies = createDependencies()
    dependencies.principalService.resolveAuthenticatedUser.mockResolvedValue({
      clearSessionCookie: false,
      headers: new Headers(),
      user: null
    })
    const app = createTestApp(dependencies)

    const update = await putMemo(app, JSON.stringify({ memo: 'guest memo' }))
    const history = await app.request(
      `/api/v1/wrong-notes/${QUESTION_ID}/review-events`
    )

    expect(update.status).toBe(401)
    expect(history.status).toBe(401)
    expect(updateWrongNoteMemoErrorSchema.parse(await update.json()).code).toBe(
      'AUTHENTICATION_REQUIRED'
    )
    expect(listReviewEventsErrorSchema.parse(await history.json()).code).toBe(
      'AUTHENTICATION_REQUIRED'
    )
    expect(dependencies.reviewCenterService.updateMemo).not.toHaveBeenCalled()
    expect(
      dependencies.reviewCenterService.listReviewEvents
    ).not.toHaveBeenCalled()
  })

  it('invalid params/query/cursor는 auth 전에 operation closed error로 거부한다', async () => {
    const cases = [
      {
        path: '/api/v1/wrong-notes/not-uuid/memo',
        schema: getWrongNoteMemoErrorSchema,
        status: 422,
        code: 'INVALID_ID'
      },
      {
        path: `/api/v1/wrong-notes/${QUESTION_ID}/memo?owner=true`,
        schema: getWrongNoteMemoErrorSchema,
        status: 422,
        code: 'VALIDATION_ERROR'
      },
      {
        path: `/api/v1/wrong-notes/${QUESTION_ID}/memo?include=x&include=y`,
        schema: getWrongNoteMemoErrorSchema,
        status: 422,
        code: 'VALIDATION_ERROR'
      },
      {
        path: `/api/v1/wrong-notes/${QUESTION_ID}/memo?__proto__=x`,
        schema: getWrongNoteMemoErrorSchema,
        status: 422,
        code: 'VALIDATION_ERROR'
      },
      {
        path: `/api/v1/wrong-notes/${QUESTION_ID}/review-events?pageSize=101`,
        schema: listReviewEventsErrorSchema,
        status: 422,
        code: 'VALIDATION_ERROR'
      },
      {
        path: `/api/v1/wrong-notes/${QUESTION_ID}/review-events?cursor=not_canonical`,
        schema: listReviewEventsErrorSchema,
        status: 422,
        code: 'VALIDATION_ERROR'
      },
      {
        path: `/api/v1/wrong-notes/${QUESTION_ID}/review-events?pageSize=20&pageSize=21`,
        schema: listReviewEventsErrorSchema,
        status: 422,
        code: 'VALIDATION_ERROR'
      },
      {
        path: `/api/v1/wrong-notes/${QUESTION_ID}/review-events?unknown=true`,
        schema: listReviewEventsErrorSchema,
        status: 422,
        code: 'VALIDATION_ERROR'
      },
      {
        path: `/api/v1/wrong-notes/${QUESTION_ID}/review-events?__proto__=x`,
        schema: listReviewEventsErrorSchema,
        status: 422,
        code: 'VALIDATION_ERROR'
      }
    ] as const

    for (const testCase of cases) {
      const dependencies = createDependencies()
      const response = await createTestApp(dependencies).request(testCase.path)
      expect(response.status).toBe(testCase.status)
      expect(testCase.schema.parse(await response.json()).code).toBe(
        testCase.code
      )
      expect(
        dependencies.principalService.resolveAuthenticatedUser
      ).not.toHaveBeenCalled()
      expect(dependencies.reviewCenterService.getMemo).not.toHaveBeenCalled()
      expect(
        dependencies.reviewCenterService.listReviewEvents
      ).not.toHaveBeenCalled()
    }
  })

  it('history canonical cursor와 pageSize 100을 service에 exact 전달한다', async () => {
    const dependencies = createDependencies()
    const cursor = reviewCenterConformanceFixture.nextHistoryCursor
    const response = await createTestApp(dependencies).request(
      `/api/v1/wrong-notes/${QUESTION_ID}/review-events` +
        `?cursor=${cursor}&pageSize=100`
    )

    expect(response.status).toBe(200)
    expect(
      dependencies.reviewCenterService.listReviewEvents
    ).toHaveBeenCalledWith(USER_ID, QUESTION_ID, { cursor, pageSize: 100 })
  })

  it('memo body를 bounded strict JSON과 Unicode 규칙으로 검증한다', async () => {
    const cases = [
      { body: '{', status: 400, code: 'INVALID_JSON' },
      { body: '[]', status: 400, code: 'INVALID_JSON' },
      {
        body: JSON.stringify({ memo: 'ok', userId: USER_ID }),
        status: 400,
        code: 'INVALID_REQUEST'
      },
      {
        body: JSON.stringify({ memo: 'bad\u0000memo' }),
        status: 422,
        code: 'VALIDATION_ERROR'
      },
      {
        body: JSON.stringify({ memo: '\ud800' }),
        status: 422,
        code: 'VALIDATION_ERROR'
      },
      {
        body: JSON.stringify({ memo: '𠮷'.repeat(2_001) }),
        status: 422,
        code: 'VALIDATION_ERROR'
      }
    ] as const

    for (const testCase of cases) {
      const dependencies = createDependencies()
      const response = await putMemo(createTestApp(dependencies), testCase.body)
      const failure = updateWrongNoteMemoErrorSchema.parse(
        await response.json()
      )
      expect(response.status).toBe(testCase.status)
      expect(failure.code).toBe(testCase.code)
      expect(dependencies.reviewCenterService.updateMemo).not.toHaveBeenCalled()
    }
  })

  it('memo PUT의 unexpected/duplicate query를 auth와 body 전에 거부한다', async () => {
    for (const suffix of ['?owner=true', '?owner=x&owner=y', '?__proto__=x']) {
      const dependencies = createDependencies()
      const response = await createTestApp(dependencies).request(
        `/api/v1/wrong-notes/${QUESTION_ID}/memo${suffix}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Origin: ORIGIN
          },
          body: '{'
        }
      )
      const failure = updateWrongNoteMemoErrorSchema.parse(
        await response.json()
      )

      expect(response.status).toBe(422)
      expect(failure.code).toBe('VALIDATION_ERROR')
      expect(
        dependencies.principalService.resolveAuthenticatedUser
      ).not.toHaveBeenCalled()
      expect(dependencies.reviewCenterService.updateMemo).not.toHaveBeenCalled()
    }
  })

  it('memo 1/2000 code point와 whitespace/null delete를 canonical body로 전달한다', async () => {
    const inputs = [
      { raw: ' 𠮷 ', parsed: '𠮷' },
      { raw: '𠮷'.repeat(2_000), parsed: '𠮷'.repeat(2_000) },
      { raw: ' \n\t ', parsed: null },
      { raw: null, parsed: null }
    ] as const

    for (const input of inputs) {
      const dependencies = createDependencies()
      const response = await putMemo(
        createTestApp(dependencies),
        JSON.stringify({ memo: input.raw })
      )
      expect(response.status).toBe(200)
      expect(dependencies.reviewCenterService.updateMemo).toHaveBeenCalledWith(
        USER_ID,
        QUESTION_ID,
        { memo: input.parsed }
      )
    }
  })

  it('escaped astral memo의 2000/2001 code-point transport 경계를 보존한다', async () => {
    const escapedScalar = '\\ud83d\\ude42'
    const validDependencies = createDependencies()
    const validResponse = await putMemo(
      createTestApp(validDependencies),
      `{"memo":"${escapedScalar.repeat(2_000)}"}`
    )

    expect(validResponse.status).toBe(200)
    expect(
      validDependencies.reviewCenterService.updateMemo
    ).toHaveBeenCalledWith(USER_ID, QUESTION_ID, { memo: '🙂'.repeat(2_000) })

    const invalidDependencies = createDependencies()
    const invalidResponse = await putMemo(
      createTestApp(invalidDependencies),
      `{"memo":"${escapedScalar.repeat(2_001)}"}`
    )
    const failure = updateWrongNoteMemoErrorSchema.parse(
      await invalidResponse.json()
    )

    expect(invalidResponse.status).toBe(422)
    expect(failure.code).toBe('VALIDATION_ERROR')
    expect(
      invalidDependencies.reviewCenterService.updateMemo
    ).not.toHaveBeenCalled()
  })

  it('write security와 rate limit이 body/auth/service보다 먼저 실행된다', async () => {
    const missingContentType = createDependencies()
    const untrusted = createDependencies()
    const limited = createDependencies()
    limited.rateLimiter.consume.mockRejectedValueOnce(
      new ApplicationError({
        code: 'RATE_LIMITED',
        message: '요청이 너무 많습니다.',
        retryable: true
      })
    )

    const responses = await Promise.all([
      putMemo(createTestApp(missingContentType), '{}', { Origin: ORIGIN }),
      putMemo(createTestApp(untrusted), '{}', {
        'Content-Type': 'application/json',
        Origin: 'https://evil.example'
      }),
      putMemo(createTestApp(limited), '{')
    ])
    const failures = await Promise.all(
      responses.map(async (response) =>
        apiFailureSchema.parse(await response.json())
      )
    )

    expect(failures.map((failure) => failure.code)).toEqual([
      'INVALID_REQUEST',
      'UNTRUSTED_ORIGIN',
      'RATE_LIMITED'
    ])
    expect(missingContentType.rateLimiter.consume).not.toHaveBeenCalled()
    expect(untrusted.rateLimiter.consume).not.toHaveBeenCalled()
    expect(
      limited.principalService.resolveAuthenticatedUser
    ).not.toHaveBeenCalled()
    expect(limited.reviewCenterService.updateMemo).not.toHaveBeenCalled()
  })

  it('memo/history read rate limit도 auth/service보다 먼저 닫는다', async () => {
    for (const [path, parseFailure] of [
      [
        `/api/v1/wrong-notes/${QUESTION_ID}/memo`,
        getWrongNoteMemoErrorSchema.parse
      ],
      [
        `/api/v1/wrong-notes/${QUESTION_ID}/review-events`,
        listReviewEventsErrorSchema.parse
      ]
    ] as const) {
      const dependencies = createDependencies()
      dependencies.rateLimiter.consume.mockRejectedValueOnce(
        new ApplicationError({
          code: 'RATE_LIMITED',
          message: '요청이 너무 많습니다.',
          retryable: true
        })
      )

      const response = await createTestApp(dependencies).request(path)
      const failure = parseFailure(await response.json())

      expect(response.status).toBe(429)
      expect(failure.code).toBe('RATE_LIMITED')
      expect(
        dependencies.principalService.resolveAuthenticatedUser
      ).not.toHaveBeenCalled()
      expect(dependencies.reviewCenterService.getMemo).not.toHaveBeenCalled()
      expect(
        dependencies.reviewCenterService.listReviewEvents
      ).not.toHaveBeenCalled()
    }
  })

  it('same-origin Fetch Metadata와 trusted CORS preflight를 허용한다', async () => {
    const dependencies = createDependencies()
    const app = createTestApp(dependencies)
    const sameOrigin = await putMemo(
      app,
      JSON.stringify({ memo: 'same origin' }),
      {
        'Content-Type': 'application/json',
        'Sec-Fetch-Site': 'same-origin'
      }
    )
    const preflight = await app.request(
      `/api/v1/wrong-notes/${QUESTION_ID}/memo`,
      {
        method: 'OPTIONS',
        headers: {
          Origin: ORIGIN,
          'Access-Control-Request-Method': 'PUT',
          'Access-Control-Request-Headers': 'Content-Type'
        }
      }
    )

    expect(sameOrigin.status).toBe(200)
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN)
    expect(preflight.headers.get('Access-Control-Allow-Methods')).toContain(
      'PUT'
    )
    expect(preflight.headers.get('Access-Control-Allow-Headers')).toContain(
      'Content-Type'
    )
  })

  it('foreign과 missing은 bit-identical owner-safe 404로 닫는다', async () => {
    const failures: unknown[] = []
    for (const _questionId of [QUESTION_ID, MISSING_ID]) {
      const dependencies = createDependencies()
      dependencies.reviewCenterService.getMemo.mockRejectedValueOnce(
        new ApplicationError({
          code: 'RESOURCE_NOT_FOUND',
          message: '오답 노트를 찾을 수 없습니다.',
          retryable: false
        })
      )
      const response = await getMemo(createTestApp(dependencies), _questionId)
      expect(response.status).toBe(404)
      const failure = getWrongNoteMemoErrorSchema.parse(await response.json())
      failures.push({
        code: failure.code,
        message: failure.message,
        retryable: failure.retryable
      })
    }

    expect(failures[0]).toEqual(failures[1])
  })

  it('memo write/history의 owner-safe 404는 header와 body request ID가 같다', async () => {
    const updateDependencies = createDependencies()
    const historyDependencies = createDependencies()
    for (const serviceOperation of [
      updateDependencies.reviewCenterService.updateMemo,
      historyDependencies.reviewCenterService.listReviewEvents
    ]) {
      serviceOperation.mockRejectedValueOnce(
        new ApplicationError({
          code: 'RESOURCE_NOT_FOUND',
          message: '오답 노트를 찾을 수 없습니다.',
          retryable: false
        })
      )
    }

    const update = await putMemo(
      createTestApp(updateDependencies),
      JSON.stringify({ memo: 'missing' })
    )
    const history = await createTestApp(historyDependencies).request(
      `/api/v1/wrong-notes/${MISSING_ID}/review-events`
    )
    const updateFailure = updateWrongNoteMemoErrorSchema.parse(
      await update.json()
    )
    const historyFailure = listReviewEventsErrorSchema.parse(
      await history.json()
    )

    expect(update.status).toBe(404)
    expect(history.status).toBe(404)
    expect(updateFailure).toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
      message: '오답 노트를 찾을 수 없습니다.',
      retryable: false
    })
    expect(historyFailure).toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
      message: '오답 노트를 찾을 수 없습니다.',
      retryable: false
    })
    expect(updateFailure.requestId).toBe(update.headers.get('X-Request-Id'))
    expect(historyFailure.requestId).toBe(history.headers.get('X-Request-Id'))
  })

  it('request-aware output과 strict history shape가 mismatch를 500으로 닫는다', async () => {
    const mismatchedMemo = createDependencies()
    mismatchedMemo.reviewCenterService.getMemo.mockResolvedValueOnce({
      ...reviewCenterConformanceFixture.memo,
      questionId: MISSING_ID
    } as never)
    const leakedHistory = createDependencies()
    leakedHistory.reviewCenterService.listReviewEvents.mockResolvedValueOnce({
      ...reviewCenterConformanceFixture.history,
      ownerId: USER_ID
    } as never)

    const [memoResponse, historyResponse] = await Promise.all([
      getMemo(createTestApp(mismatchedMemo)),
      createTestApp(leakedHistory).request(
        `/api/v1/wrong-notes/${QUESTION_ID}/review-events`
      )
    ])

    for (const response of [memoResponse, historyResponse]) {
      expect(response.status).toBe(500)
      const failure = apiFailureSchema.parse(await response.json())
      expect(failure.code).toBe('INTERNAL_SERVER_ERROR')
      expect(failure.message).not.toContain(USER_ID)
      expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    }
  })

  it('request/error log는 route template만 기록하고 UUID·memo를 남기지 않는다', async () => {
    const dependencies = createDependencies()
    const app = createTestApp(dependencies)

    await getMemo(app)
    dependencies.reviewCenterService.updateMemo.mockRejectedValueOnce(
      new Error('private memo sentinel')
    )
    await putMemo(app, JSON.stringify({ memo: 'private memo sentinel' }))
    dependencies.reviewCenterService.listReviewEvents.mockRejectedValueOnce(
      new Error('private evidence sentinel')
    )
    await app.request(
      `/api/v1/wrong-notes/${QUESTION_ID}/review-events?pageSize=1`
    )

    expect(dependencies.logger.info).toHaveBeenCalledWith(
      'http.request.completed',
      expect.objectContaining({
        path: '/api/v1/wrong-notes/:questionId/memo',
        status: 200
      })
    )
    expect(dependencies.logger.error).toHaveBeenCalledWith(
      'http.request.failed',
      expect.objectContaining({
        path: '/api/v1/wrong-notes/:questionId/memo',
        status: 500
      })
    )
    const logs = JSON.stringify({
      info: dependencies.logger.info.mock.calls,
      error: dependencies.logger.error.mock.calls
    })
    expect(logs).not.toContain(QUESTION_ID)
    expect(logs).not.toContain(USER_ID)
    expect(logs).not.toContain('private memo sentinel')
    expect(logs).not.toContain('private evidence sentinel')
  })
})

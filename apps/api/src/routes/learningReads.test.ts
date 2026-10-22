import { apiFailureSchema } from '@nihongo/contracts/common/error'
import type { GetDashboardStatsResponse } from '@nihongo/contracts/dashboard/get-dashboard-stats'
import type { GetWrongNoteResponse } from '@nihongo/contracts/wrong-note/get-wrong-note'
import type {
  ListWrongNotesResponse,
  WrongNoteSummary
} from '@nihongo/contracts/wrong-note/list-wrong-notes'
import { describe, expect, it, vi } from 'vitest'
import { createApiApp } from '../app/createApp.js'
import type { AuthGateway } from '../auth/authGateway.js'
import type { GuestPrincipalService } from '../auth/guestPrincipalService.js'
import type { PrincipalService } from '../auth/principalService.js'
import type { ApiEnvironment } from '../config/env.js'
import type { DashboardService } from '../dashboard/dashboardService.js'
import { ApplicationError } from '../errors/applicationError.js'
import type { ApplicationRateLimiter } from '../middleware/applicationRateLimiter.js'
import { createJsonLogger } from '../observability/logger.js'
import type { QuestionReader } from '../question/questionService.js'
import type { WrongNoteReviewCenterService } from '../wrong-note/wrongNoteReviewCenterService.js'
import type { WrongNoteService } from '../wrong-note/wrongNoteService.js'

const ORIGIN = 'http://localhost:5173'
const USER_ID = '018f6b7a-1f4b-7d5e-8a91-4c27df9c10d2'
const QUESTION_ID = '018f6b7a-1f4b-7d5e-8a91-4c27df9c10a1'
const VERSION_ID = '018f6b7a-1f4b-7d5e-8a91-4c27df9c10a2'
const OPTION_IDS = [
  '018f6b7a-1f4b-7d5e-8a91-4c27df9c10b1',
  '018f6b7a-1f4b-7d5e-8a91-4c27df9c10b2',
  '018f6b7a-1f4b-7d5e-8a91-4c27df9c10b3',
  '018f6b7a-1f4b-7d5e-8a91-4c27df9c10b4'
] as const

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

const wrongNoteSummary = {
  questionId: QUESTION_ID,
  level: 'N5',
  subject: 'VOCABULARY',
  questionType: 'KANJI_READING',
  questionPreview: '川の読み方',
  wrongCount: 1,
  correctStreak: 0,
  status: 'NEW',
  lastWrongAt: '2026-08-15T00:00:00.000Z',
  lastReviewedAt: null,
  nextReviewAt: '2026-08-16T00:00:00.000Z',
  tags: ['한자 읽기'],
  hasMemo: false,
  reviewAvailability: 'AVAILABLE'
} satisfies WrongNoteSummary

const listResponse = {
  items: [wrongNoteSummary],
  page: 1,
  pageSize: 20,
  total: 1,
  availableTags: ['한자 읽기']
} satisfies ListWrongNotesResponse

const detailResponse = {
  wrongNote: wrongNoteSummary,
  question: {
    id: QUESTION_ID,
    questionVersionId: VERSION_ID,
    level: 'N5',
    subject: 'VOCABULARY',
    questionType: 'KANJI_READING',
    passage: null,
    questionText: '川の読み方',
    options: OPTION_IDS.map((id, index) => ({
      id,
      label: String(index + 1) as '1' | '2' | '3' | '4',
      text: `보기 ${index + 1}`
    })),
    difficulty: 'EASY',
    tags: [
      {
        id: '018f6b7a-1f4b-7d5e-8a91-4c27df9c10c1',
        label: '한자 읽기'
      }
    ],
    correctOptionId: OPTION_IDS[0],
    explanationKo: '해설',
    explanationJa: null
  },
  memo: null,
  lastWrongQuestionVersionId: VERSION_ID,
  currentReviewQuestionVersionId: null
} satisfies GetWrongNoteResponse

const dashboardResponse = {
  totalAnsweredCount: 0,
  correctCount: 0,
  correctRate: 0,
  wrongNoteCount: 0,
  solvedWrongNoteCount: 0,
  weakestSubject: null,
  subjectStats: [
    {
      subject: 'VOCABULARY',
      answeredCount: 0,
      correctCount: 0,
      correctRate: 0
    },
    {
      subject: 'GRAMMAR',
      answeredCount: 0,
      correctCount: 0,
      correctRate: 0
    },
    {
      subject: 'READING',
      answeredCount: 0,
      correctCount: 0,
      correctRate: 0
    }
  ],
  recentStudySessions: [],
  dailyStudyCountLast7Days: [
    '2026-08-10',
    '2026-08-11',
    '2026-08-12',
    '2026-08-13',
    '2026-08-14',
    '2026-08-15',
    '2026-08-16'
  ].map((date) => ({ date, count: 0 })),
  repeatedWrongQuestions: []
} satisfies GetDashboardStatsResponse

const questionReader: QuestionReader = {
  getQuestion: async () => Promise.reject(new Error('Not used in this test.')),
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
        name: 'Learning User',
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
  const wrongNoteService = {
    getWrongNote: vi.fn().mockResolvedValue(detailResponse),
    listWrongNotes: vi.fn().mockResolvedValue(listResponse)
  } satisfies WrongNoteService
  const reviewCenterService = {
    getMemo: vi.fn<WrongNoteReviewCenterService['getMemo']>(),
    listReviewEvents: vi.fn<WrongNoteReviewCenterService['listReviewEvents']>(),
    updateMemo: vi.fn<WrongNoteReviewCenterService['updateMemo']>()
  } satisfies WrongNoteReviewCenterService
  const dashboardService = {
    getDashboardStats: vi.fn().mockResolvedValue(dashboardResponse)
  } satisfies DashboardService

  return {
    dashboardService,
    guestPrincipalService,
    principalService,
    rateLimiter,
    reviewCenterService,
    wrongNoteService
  }
}

const createTestApp = (dependencies: ReturnType<typeof createDependencies>) =>
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
      reviewCenterEnabled: false,
      reviewCenterService: dependencies.reviewCenterService,
      wrongNoteService: dependencies.wrongNoteService
    },
    logger: createJsonLogger('silent'),
    questionReader
  })

describe('Slice 5 authenticated read routes', () => {
  it('owner USER로 list/detail을 조회하고 rolling cookie와 private no-store를 보존한다', async () => {
    const dependencies = createDependencies()
    dependencies.principalService.resolveAuthenticatedUser.mockResolvedValue({
      clearSessionCookie: false,
      headers: new Headers({
        'Set-Cookie': 'nihongo.session_token=rolling; Path=/; HttpOnly'
      }),
      user: {
        id: USER_ID,
        name: 'Learning User',
        role: 'USER',
        targetLevel: 'N5'
      }
    })
    const app = createTestApp(dependencies)

    const [list, detail] = await Promise.all([
      app.request('/api/v1/wrong-notes?sort=MOST_WRONG', {
        headers: { Origin: ORIGIN }
      }),
      app.request(`/api/v1/wrong-notes/${QUESTION_ID}`)
    ])

    expect(list.status).toBe(200)
    expect(detail.status).toBe(200)
    expect(await list.json()).toEqual(listResponse)
    expect(await detail.json()).toEqual(detailResponse)
    expect(dependencies.wrongNoteService.listWrongNotes).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ sort: 'MOST_WRONG' })
    )
    expect(dependencies.wrongNoteService.getWrongNote).toHaveBeenCalledWith(
      USER_ID,
      QUESTION_ID
    )
    expect(list.headers.get('Cache-Control')).toBe('private, no-store')
    expect(detail.headers.get('Cache-Control')).toBe('private, no-store')
    expect(list.headers.get('X-Request-Id')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
    )
    expect(detail.headers.get('X-Request-Id')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
    )
    expect(list.headers.get('Set-Cookie')).toContain(
      'nihongo.session_token=rolling'
    )
    expect(list.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN)
    expect(
      dependencies.guestPrincipalService.inspectCookie
    ).not.toHaveBeenCalled()
  })

  it('ADMIN도 자기 actor ID로만 dashboard service를 호출한다', async () => {
    const dependencies = createDependencies()
    dependencies.principalService.resolveAuthenticatedUser.mockResolvedValue({
      clearSessionCookie: false,
      headers: new Headers(),
      user: {
        id: USER_ID,
        name: 'Admin User',
        role: 'ADMIN',
        targetLevel: null
      }
    })

    const response = await createTestApp(dependencies).request(
      '/api/v1/dashboard?from=2026-08-10&to=2026-08-16'
    )

    expect(response.status).toBe(200)
    expect(
      dependencies.dashboardService.getDashboardStats
    ).toHaveBeenCalledWith(USER_ID, { from: '2026-08-10', to: '2026-08-16' })
  })

  it('inclusive 366일은 허용하고 367일은 auth 이전 거부한다', async () => {
    const dependencies = createDependencies()
    const app = createTestApp(dependencies)

    const allowed = await app.request(
      '/api/v1/dashboard?from=2025-01-01&to=2026-01-01'
    )
    const rejected = await app.request(
      '/api/v1/dashboard?from=2024-01-01&to=2025-01-01'
    )
    const failure = apiFailureSchema.parse(await rejected.json())

    expect(allowed.status).toBe(200)
    expect(rejected.status).toBe(422)
    expect(failure.code).toBe('VALIDATION_ERROR')
    expect(
      dependencies.principalService.resolveAuthenticatedUser
    ).toHaveBeenCalledTimes(1)
  })

  it('MAX_SAFE page도 유효한 1-based query로 service에 전달한다', async () => {
    const dependencies = createDependencies()
    const app = createTestApp(dependencies)

    const response = await app.request(
      `/api/v1/wrong-notes?page=${Number.MAX_SAFE_INTEGER}`
    )

    expect(response.status).toBe(200)
    expect(dependencies.wrongNoteService.listWrongNotes).toHaveBeenCalledTimes(
      1
    )
    expect(dependencies.wrongNoteService.listWrongNotes).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ page: Number.MAX_SAFE_INTEGER })
    )
    expect(
      dependencies.principalService.resolveAuthenticatedUser
    ).toHaveBeenCalledTimes(1)
  })

  it('unknown userId/versionId/role/isCorrect query와 invalid ID를 auth 이전 422로 닫는다', async () => {
    const dependencies = createDependencies()
    const app = createTestApp(dependencies)
    const responses = await Promise.all([
      app.request(`/api/v1/wrong-notes?userId=${USER_ID}`),
      app.request(`/api/v1/wrong-notes/${QUESTION_ID}?versionId=${VERSION_ID}`),
      app.request('/api/v1/wrong-notes/not-a-uuid'),
      app.request(`/api/v1/dashboard?userId=${USER_ID}`),
      app.request('/api/v1/dashboard?from=2026-08-10'),
      app.request('/api/v1/wrong-notes?role=ADMIN'),
      app.request('/api/v1/dashboard?isCorrect=true')
    ])
    const failures = await Promise.all(
      responses.map(async (response) =>
        apiFailureSchema.parse(await response.json())
      )
    )

    expect(responses.map(({ status }) => status)).toEqual([
      422, 422, 422, 422, 422, 422, 422
    ])
    expect(failures.map(({ code }) => code)).toEqual([
      'VALIDATION_ERROR',
      'VALIDATION_ERROR',
      'INVALID_ID',
      'VALIDATION_ERROR',
      'VALIDATION_ERROR',
      'VALIDATION_ERROR',
      'VALIDATION_ERROR'
    ])
    expect(
      dependencies.principalService.resolveAuthenticatedUser
    ).not.toHaveBeenCalled()
    expect(dependencies.wrongNoteService.listWrongNotes).not.toHaveBeenCalled()
    expect(
      dependencies.dashboardService.getDashboardStats
    ).not.toHaveBeenCalled()
    expect(responses[0]?.headers.get('Cache-Control')).toBe('private, no-store')
    expect(responses[0]?.headers.get('X-Request-Id')).toBe(
      failures[0]?.requestId
    )
  })

  it('rate limit를 parse·principal·service보다 먼저 적용하고 Retry-After를 반환한다', async () => {
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
      '/api/v1/dashboard?userId=invalid'
    )
    const failure = apiFailureSchema.parse(await response.json())

    expect(response.status).toBe(429)
    expect(failure.code).toBe('RATE_LIMITED')
    expect(response.headers.get('Retry-After')).toBe('41')
    expect(response.headers.get('X-Request-Id')).toBe(failure.requestId)
    expect(
      dependencies.principalService.resolveAuthenticatedUser
    ).not.toHaveBeenCalled()
    expect(
      dependencies.dashboardService.getDashboardStats
    ).not.toHaveBeenCalled()
  })

  it('guest/absent 인증은 어떤 guest 저장소나 learning service도 건드리지 않는다', async () => {
    const dependencies = createDependencies()
    dependencies.principalService.resolveAuthenticatedUser.mockResolvedValue({
      clearSessionCookie: false,
      headers: new Headers(),
      user: null
    })
    const response = await createTestApp(dependencies).request(
      '/api/v1/wrong-notes',
      { headers: { Cookie: 'nihongo.guest_principal=signed-guest' } }
    )
    const responseBody: unknown = await response.json()
    const failure = apiFailureSchema.parse(responseBody)

    expect(response.status).toBe(401)
    expect(failure.code).toBe('AUTHENTICATION_REQUIRED')
    expect(responseBody).toEqual({
      code: 'AUTHENTICATION_REQUIRED',
      message: '오답 노트를 조회하려면 로그인이 필요합니다.',
      requestId: expect.any(String),
      retryable: false
    })
    expect(
      dependencies.guestPrincipalService.inspectCookie
    ).not.toHaveBeenCalled()
    expect(
      dependencies.guestPrincipalService.resolveExisting
    ).not.toHaveBeenCalled()
    expect(dependencies.wrongNoteService.listWrongNotes).not.toHaveBeenCalled()
  })

  it('expired auth를 closed code로 반환하고 세션 cookie를 제거한다', async () => {
    const dependencies = createDependencies()
    dependencies.principalService.resolveAuthenticatedUser.mockResolvedValue({
      clearSessionCookie: true,
      headers: new Headers(),
      user: null
    })

    const response =
      await createTestApp(dependencies).request('/api/v1/dashboard')
    const failure = apiFailureSchema.parse(await response.json())

    expect(response.status).toBe(401)
    expect(failure.code).toBe('AUTH_SESSION_EXPIRED')
    expect(response.headers.get('Set-Cookie')).toContain('Max-Age=0')
    expect(
      dependencies.dashboardService.getDashboardStats
    ).not.toHaveBeenCalled()
  })

  it('repository unavailable을 safe 503과 Retry-After로 반환한다', async () => {
    const dependencies = createDependencies()
    dependencies.dashboardService.getDashboardStats.mockRejectedValue(
      new ApplicationError({
        code: 'SERVICE_UNAVAILABLE',
        message: '대시보드 저장소에 연결할 수 없습니다.',
        retryable: true
      })
    )

    const response =
      await createTestApp(dependencies).request('/api/v1/dashboard')
    const failure = apiFailureSchema.parse(await response.json())

    expect(response.status).toBe(503)
    expect(failure).toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      retryable: true
    })
    expect(response.headers.get('Retry-After')).toBe('5')
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(response.headers.get('X-Request-Id')).toBe(failure.requestId)
  })

  it('foreign과 missing question 모두 동일한 owner-scoped 404로 반환한다', async () => {
    const dependencies = createDependencies()
    dependencies.wrongNoteService.getWrongNote.mockRejectedValue(
      new ApplicationError({
        code: 'RESOURCE_NOT_FOUND',
        message: '오답 노트를 찾을 수 없습니다.',
        retryable: false
      })
    )
    const app = createTestApp(dependencies)
    const otherQuestionId = '018f6b7a-1f4b-7d5e-8a91-4c27df9c10ee'

    const [missing, foreign] = await Promise.all([
      app.request(`/api/v1/wrong-notes/${QUESTION_ID}`),
      app.request(`/api/v1/wrong-notes/${otherQuestionId}`)
    ])
    const missingFailure = apiFailureSchema.parse(await missing.json())
    const foreignFailure = apiFailureSchema.parse(await foreign.json())

    expect(missing.status).toBe(404)
    expect(foreign.status).toBe(404)
    expect(missingFailure).toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
      message: '오답 노트를 찾을 수 없습니다.',
      retryable: false
    })
    expect(foreignFailure).toMatchObject({
      code: missingFailure.code,
      message: missingFailure.message,
      retryable: missingFailure.retryable
    })
  })

  it('service output leakage를 response schema에서 500으로 fail closed한다', async () => {
    const dependencies = createDependencies()
    dependencies.dashboardService.getDashboardStats.mockImplementation(
      async () => ({ userId: USER_ID, secret: 'do-not-leak' }) as never
    )

    const response =
      await createTestApp(dependencies).request('/api/v1/dashboard')
    const body = await response.text()
    const failure = apiFailureSchema.parse(JSON.parse(body))

    expect(response.status).toBe(500)
    expect(failure.code).toBe('INTERNAL_SERVER_ERROR')
    expect(body).not.toContain(USER_ID)
    expect(body).not.toContain('do-not-leak')
  })

  it('v1-compatible runtime에는 review-center/Bookmark 경로를 등록하지 않는다', async () => {
    const dependencies = createDependencies()
    const app = createTestApp(dependencies)
    const responses = await Promise.all([
      app.request(`/api/v1/wrong-notes/${QUESTION_ID}/memo`),
      app.request(`/api/v1/wrong-notes/${QUESTION_ID}/review-events`),
      app.request(`/api/v1/wrong-notes/${QUESTION_ID}/review`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: ORIGIN
        },
        body: '{}'
      }),
      app.request('/api/v1/bookmarks'),
      app.request('/api/v1/dashboard/wrong-note')
    ])
    const failures = await Promise.all(
      responses.map(async (response) =>
        apiFailureSchema.parse(await response.json())
      )
    )

    expect(responses.map(({ status }) => status)).toEqual([
      404, 404, 404, 404, 404
    ])
    expect(failures.every(({ code }) => code === 'RESOURCE_NOT_FOUND')).toBe(
      true
    )
    expect(dependencies.wrongNoteService.getWrongNote).not.toHaveBeenCalled()
    expect(dependencies.reviewCenterService.getMemo).not.toHaveBeenCalled()
    expect(
      dependencies.reviewCenterService.listReviewEvents
    ).not.toHaveBeenCalled()
    expect(
      dependencies.dashboardService.getDashboardStats
    ).not.toHaveBeenCalled()
  })
})

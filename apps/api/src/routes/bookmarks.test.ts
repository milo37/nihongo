import type { BookmarkSummary } from '@nihongo/contracts/bookmark/bookmark'
import { apiFailureSchema } from '@nihongo/contracts/common/error'
import { describe, expect, it, vi } from 'vitest'
import { createApiApp } from '../app/createApp.js'
import type { AuthGateway } from '../auth/authGateway.js'
import type { GuestPrincipalService } from '../auth/guestPrincipalService.js'
import type { PrincipalService } from '../auth/principalService.js'
import type { BookmarkService } from '../bookmark/bookmarkService.js'
import type { ApiEnvironment } from '../config/env.js'
import type { DashboardService } from '../dashboard/dashboardService.js'
import type { ApplicationRateLimiter } from '../middleware/applicationRateLimiter.js'
import { createJsonLogger } from '../observability/logger.js'
import type { QuestionReader } from '../question/questionService.js'
import type { StudySessionService } from '../study/studySessionService.js'
import type { WrongNoteReviewCenterService } from '../wrong-note/wrongNoteReviewCenterService.js'
import type { WrongNoteService } from '../wrong-note/wrongNoteService.js'

const ORIGIN = 'http://localhost:5173'
const USER_ID = '018f6b7a-1f4b-7d5e-8a91-4c27df9c1001'
const QUESTION_ID = '018f6b7a-1f4b-7d5e-8a91-4c27df9c1002'

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

const bookmark: BookmarkSummary = {
  questionId: QUESTION_ID,
  availability: 'AVAILABLE',
  createdAt: '2026-08-21T00:00:00.000Z',
  question: {
    id: QUESTION_ID,
    questionVersionId: '018f6b7a-1f4b-7d5e-8a91-4c27df9c1003',
    level: 'N5',
    subject: 'VOCABULARY',
    questionType: 'KANJI_READING',
    difficulty: 'EASY',
    questionTextPreview: '「川」の読み方はどれですか。',
    tags: [
      {
        id: '018f6b7a-1f4b-7d5e-8a91-4c27df9c1004',
        label: '한자 읽기'
      }
    ]
  }
}

const questionReader: QuestionReader = {
  getQuestion: async () => Promise.reject(new Error('Not used.')),
  listQuestions: async () => ({ items: [], page: 1, pageSize: 20, total: 0 })
}

const authGateway: AuthGateway = {
  handle: async () => new Response(null, { status: 404 })
}

const createDependencies = () => {
  const bookmarkService = {
    create: vi.fn<BookmarkService['create']>(async () => ({
      bookmark,
      created: true
    })),
    delete: vi.fn<BookmarkService['delete']>(async () => undefined),
    list: vi.fn<BookmarkService['list']>(async (_userId, query) => ({
      items: [bookmark],
      page: query.page,
      pageSize: query.pageSize,
      total: 1
    }))
  } satisfies BookmarkService
  const principalService = {
    getAuthenticatedUser: vi.fn(),
    resolveAuthenticatedUser: vi.fn().mockResolvedValue({
      clearSessionCookie: false,
      headers: new Headers(),
      user: {
        id: USER_ID,
        name: 'Bookmark User',
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
  const studyService = {
    create: vi.fn<StudySessionService['create']>(),
    get: vi.fn<StudySessionService['get']>()
  } satisfies StudySessionService
  const wrongNoteService = {
    getWrongNote: vi.fn<WrongNoteService['getWrongNote']>(),
    listWrongNotes: vi.fn<WrongNoteService['listWrongNotes']>()
  } satisfies WrongNoteService
  const reviewCenterService = {
    getMemo: vi.fn<WrongNoteReviewCenterService['getMemo']>(),
    listReviewEvents: vi.fn<WrongNoteReviewCenterService['listReviewEvents']>(),
    updateMemo: vi.fn<WrongNoteReviewCenterService['updateMemo']>()
  } satisfies WrongNoteReviewCenterService
  const dashboardService = {
    getDashboardStats: vi.fn<DashboardService['getDashboardStats']>()
  } satisfies DashboardService
  return {
    bookmarkService,
    dashboardService,
    guestPrincipalService,
    principalService,
    rateLimiter,
    reviewCenterService,
    studyService,
    wrongNoteService
  }
}

const createTestApp = (
  dependencies: ReturnType<typeof createDependencies>,
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
      bookmarkService: dependencies.bookmarkService,
      dashboardService: dependencies.dashboardService,
      rateLimiter: dependencies.rateLimiter,
      reviewCenterEnabled: practiceContractV2Enabled,
      reviewCenterService: dependencies.reviewCenterService,
      wrongNoteService: dependencies.wrongNoteService
    },
    logger: createJsonLogger('silent'),
    questionReader,
    study: {
      practiceContractV2Enabled,
      rateLimiter: dependencies.rateLimiter,
      service: dependencies.studyService
    }
  })

describe('bookmark routes', () => {
  it('v1-compatible runtime에는 Bookmark route를 mount하지 않는다', async () => {
    const dependencies = createDependencies()
    const response = await createTestApp(dependencies, false).request(
      '/api/v1/bookmarks?page=1&pageSize=20'
    )

    expect(response.status).toBe(404)
    expect(dependencies.bookmarkService.list).not.toHaveBeenCalled()
  })

  it('반복 questionIds와 owner를 보존해 list하고 private response를 반환한다', async () => {
    const dependencies = createDependencies()
    const response = await createTestApp(dependencies).request(
      `/api/v1/bookmarks?page=1&pageSize=20&questionIds=${QUESTION_ID}`
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ items: [bookmark], total: 1 })
    expect(dependencies.bookmarkService.list).toHaveBeenCalledWith(USER_ID, {
      page: 1,
      pageSize: 20,
      questionIds: [QUESTION_ID]
    })
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(response.headers.get('X-Request-Id')).toMatch(/^[0-9a-f-]{36}$/u)
  })

  it('PUT 신규 201과 기존 200을 Location과 함께 구분한다', async () => {
    const dependencies = createDependencies()
    const app = createTestApp(dependencies)
    const request = () =>
      app.request(`/api/v1/bookmarks/${QUESTION_ID}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
        body: '{}'
      })

    const created = await request()
    dependencies.bookmarkService.create.mockResolvedValueOnce({
      bookmark,
      created: false
    })
    const existing = await request()

    expect(created.status).toBe(201)
    expect(existing.status).toBe(200)
    expect(created.headers.get('Location')).toBe(
      `/api/v1/bookmarks/${QUESTION_ID}`
    )
    expect(await created.json()).toEqual(bookmark)
  })

  it('DELETE는 존재 여부와 무관하게 body/Content-Type 없는 204를 반환한다', async () => {
    const dependencies = createDependencies()
    const response = await createTestApp(dependencies).request(
      `/api/v1/bookmarks/${QUESTION_ID}`,
      { method: 'DELETE', headers: { Origin: ORIGIN } }
    )

    expect(response.status).toBe(204)
    expect(await response.text()).toBe('')
    expect(response.headers.get('Content-Type')).toBeNull()
    expect(dependencies.bookmarkService.delete).toHaveBeenCalledWith(
      USER_ID,
      QUESTION_ID
    )
  })

  it('trusted origin preflight가 Bookmark PUT과 DELETE를 허용한다', async () => {
    const app = createTestApp(createDependencies())

    for (const method of ['PUT', 'DELETE']) {
      const response = await app.request(`/api/v1/bookmarks/${QUESTION_ID}`, {
        method: 'OPTIONS',
        headers: {
          'Access-Control-Request-Method': method,
          Origin: ORIGIN
        }
      })

      expect(response.status).toBe(204)
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN)
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain(
        method
      )
    }
  })

  it('guest는 list/create/delete 모두 401이고 service와 guest cookie를 만들지 않는다', async () => {
    const dependencies = createDependencies()
    dependencies.principalService.resolveAuthenticatedUser.mockResolvedValue({
      clearSessionCookie: false,
      headers: new Headers(),
      user: null
    })
    const app = createTestApp(dependencies)
    const responses = await Promise.all([
      app.request('/api/v1/bookmarks?page=1&pageSize=20'),
      app.request(`/api/v1/bookmarks/${QUESTION_ID}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
        body: '{}'
      }),
      app.request(`/api/v1/bookmarks/${QUESTION_ID}`, {
        method: 'DELETE',
        headers: { Origin: ORIGIN }
      })
    ])

    for (const response of responses) {
      expect(response.status).toBe(401)
      expect(apiFailureSchema.parse(await response.json()).code).toBe(
        'AUTHENTICATION_REQUIRED'
      )
      expect(response.headers.get('Set-Cookie')).toBeNull()
    }
    expect(dependencies.bookmarkService.list).not.toHaveBeenCalled()
    expect(dependencies.bookmarkService.create).not.toHaveBeenCalled()
    expect(dependencies.bookmarkService.delete).not.toHaveBeenCalled()
  })

  it('strict body/ID/query와 trusted origin을 stable 오류로 닫는다', async () => {
    const app = createTestApp(createDependencies())
    const [strictBody, invalidId, invalidQuery, untrusted] = await Promise.all([
      app.request(`/api/v1/bookmarks/${QUESTION_ID}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
        body: JSON.stringify({ extra: true })
      }),
      app.request('/api/v1/bookmarks/not-an-id', {
        method: 'DELETE',
        headers: { Origin: ORIGIN }
      }),
      app.request('/api/v1/bookmarks?page=0&pageSize=20'),
      app.request(`/api/v1/bookmarks/${QUESTION_ID}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://evil.example'
        },
        body: '{}'
      })
    ])

    await expect(strictBody.json()).resolves.toMatchObject({
      code: 'INVALID_REQUEST'
    })
    await expect(invalidId.json()).resolves.toMatchObject({
      code: 'INVALID_ID'
    })
    await expect(invalidQuery.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR'
    })
    await expect(untrusted.json()).resolves.toMatchObject({
      code: 'UNTRUSTED_ORIGIN'
    })
  })
})

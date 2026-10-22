import { apiFailureSchema } from '@nihongo/contracts/common/error'
import type { StudyDraftSnapshot } from '@nihongo/contracts/study/study-draft'
import { describe, expect, it, vi } from 'vitest'
import { createApiApp } from '../app/createApp.js'
import type { AuthGateway } from '../auth/authGateway.js'
import type { GuestPrincipalService } from '../auth/guestPrincipalService.js'
import type { PrincipalService } from '../auth/principalService.js'
import type { ApiEnvironment } from '../config/env.js'
import type { ApplicationRateLimiter } from '../middleware/applicationRateLimiter.js'
import { createJsonLogger } from '../observability/logger.js'
import type { QuestionReader } from '../question/questionService.js'
import type { StudyDraftService } from '../study/studyDraftService.js'
import type { StudySessionService } from '../study/studySessionService.js'

const ORIGIN = 'http://localhost:5173'
const SESSION_ID = '018f6b7a-1f4b-7d5e-8a91-4c27df9c10d1'
const QUESTION_ID = '018f6b7a-1f4b-7d5e-8a91-4c27df9c10d2'
const OPTION_ID = '018f6b7a-1f4b-7d5e-8a91-4c27df9c10d3'
const IDEMPOTENCY_KEY = '018f6b7a-1f4b-7d5e-8a91-4c27df9c10d4'
const USER_ID = '018f6b7a-1f4b-7d5e-8a91-4c27df9c10d5'

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

const initialDraft = {
  studySessionId: SESSION_ID,
  revision: 0,
  currentOrdinal: 1,
  savedAt: null,
  answers: [
    {
      studySessionQuestionId: QUESTION_ID,
      selectedOptionId: null,
      elapsedSec: 0
    }
  ]
} satisfies StudyDraftSnapshot

const savedDraft = {
  ...initialDraft,
  revision: 1,
  savedAt: '2026-08-18T00:00:00.000Z',
  answers: [
    {
      studySessionQuestionId: QUESTION_ID,
      selectedOptionId: OPTION_ID,
      elapsedSec: 8
    }
  ]
} satisfies StudyDraftSnapshot

const questionReader: QuestionReader = {
  getQuestion: async () => Promise.reject(new Error('Not used.')),
  listQuestions: async () => ({ items: [], page: 1, pageSize: 20, total: 0 })
}

const authGateway: AuthGateway = {
  handle: async () => new Response(null, { status: 404 })
}

const sessionService: StudySessionService = {
  create: async () => Promise.reject(new Error('Not used.')),
  get: async () => Promise.reject(new Error('Not used.'))
}

const createDependencies = () => {
  const rateLimiter = {
    consume: vi.fn().mockResolvedValue(undefined)
  } satisfies ApplicationRateLimiter
  const principalService = {
    getAuthenticatedUser: vi.fn(),
    resolveAuthenticatedUser: vi.fn().mockResolvedValue({
      clearSessionCookie: false,
      headers: new Headers(),
      user: {
        id: USER_ID,
        name: 'Study User',
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
  const studyDraftService = {
    cancel: vi.fn<StudyDraftService['cancel']>(async () => undefined),
    get: vi.fn<StudyDraftService['get']>(async () => initialDraft),
    listResumable: vi.fn<StudyDraftService['listResumable']>(
      async (_owner, query) => ({
        items: [],
        page: query.page,
        pageSize: query.pageSize,
        total: 0
      })
    ),
    save: vi.fn<StudyDraftService['save']>(async () => ({
      replayed: true,
      response: savedDraft
    }))
  } satisfies StudyDraftService
  return {
    guestPrincipalService,
    principalService,
    rateLimiter,
    studyDraftService
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
    logger: createJsonLogger('silent'),
    questionReader,
    study: {
      draftService: dependencies.studyDraftService,
      practiceContractV2Enabled,
      rateLimiter: dependencies.rateLimiter,
      service: sessionService
    }
  })

const request = (
  app: ReturnType<typeof createTestApp>,
  path: string,
  method: 'GET' | 'PUT' | 'POST',
  body?: unknown,
  headers: Record<string, string> = {}
) =>
  app.request(path, {
    method,
    headers: {
      'X-Nihongo-Practice-Contract': '2',
      ...(method === 'GET'
        ? {}
        : { 'Content-Type': 'application/json', Origin: ORIGIN }),
      ...headers
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  })

describe('study draft routes', () => {
  it('v1-compatible runtime은 v2-only draft routes를 mount하지 않는다', async () => {
    const dependencies = createDependencies()
    const response = await request(
      createTestApp(dependencies, false),
      `/api/v1/study-sessions/${SESSION_ID}/draft-answers`,
      'GET'
    )

    expect(response.status).toBe(404)
    expect(apiFailureSchema.parse(await response.json()).code).toBe(
      'RESOURCE_NOT_FOUND'
    )
    expect(dependencies.studyDraftService.get).not.toHaveBeenCalled()
  })

  it('trusted-origin preflight가 PUT과 practice/idempotency headers를 허용한다', async () => {
    const response = await createTestApp(createDependencies()).request(
      `/api/v1/study-sessions/${SESSION_ID}/draft-answers`,
      {
        method: 'OPTIONS',
        headers: {
          Origin: ORIGIN,
          'Access-Control-Request-Method': 'PUT',
          'Access-Control-Request-Headers':
            'content-type,idempotency-key,x-nihongo-practice-contract'
        }
      }
    )

    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN)
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain(
      'PUT'
    )
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain(
      'X-Nihongo-Practice-Contract'
    )
  })

  it('필수 practice header와 list query를 principal 조회 전에 닫는다', async () => {
    const dependencies = createDependencies()
    const app = createTestApp(dependencies)
    const [missingHeader, invalidQuery] = await Promise.all([
      app.request(
        '/api/v1/study-sessions?status=IN_PROGRESS&page=1&pageSize=20'
      ),
      request(
        app,
        '/api/v1/study-sessions?status=IN_PROGRESS&page=0&pageSize=20',
        'GET'
      )
    ])

    expect(apiFailureSchema.parse(await missingHeader.json()).code).toBe(
      'INVALID_REQUEST'
    )
    expect(apiFailureSchema.parse(await invalidQuery.json()).code).toBe(
      'VALIDATION_ERROR'
    )
    expect(
      dependencies.principalService.resolveAuthenticatedUser
    ).not.toHaveBeenCalled()
  })

  it('GET/PUT의 UUID, idempotency, elapsed 오류를 closed code로 구분한다', async () => {
    const dependencies = createDependencies()
    const app = createTestApp(dependencies)
    const invalidId = await request(
      app,
      '/api/v1/study-sessions/not-a-uuid/draft-answers',
      'GET'
    )
    const missingKey = await request(
      app,
      `/api/v1/study-sessions/${SESSION_ID}/draft-answers`,
      'PUT',
      {
        expectedRevision: 0,
        currentOrdinal: 1,
        answers: initialDraft.answers
      }
    )
    const invalidDuration = await request(
      app,
      `/api/v1/study-sessions/${SESSION_ID}/draft-answers`,
      'PUT',
      {
        expectedRevision: 0,
        currentOrdinal: 1,
        answers: [{ ...initialDraft.answers[0], elapsedSec: 86_401 }]
      },
      { 'Idempotency-Key': IDEMPOTENCY_KEY }
    )

    expect(apiFailureSchema.parse(await invalidId.json()).code).toBe(
      'INVALID_ID'
    )
    expect(apiFailureSchema.parse(await missingKey.json()).code).toBe(
      'IDEMPOTENCY_KEY_REQUIRED'
    )
    expect(apiFailureSchema.parse(await invalidDuration.json()).code).toBe(
      'INVALID_DURATION'
    )
  })

  it('저장 성공은 exact v2/no-store/replay metadata를 반환한다', async () => {
    const dependencies = createDependencies()
    const response = await request(
      createTestApp(dependencies),
      `/api/v1/study-sessions/${SESSION_ID}/draft-answers`,
      'PUT',
      {
        expectedRevision: 0,
        currentOrdinal: 1,
        answers: savedDraft.answers
      },
      { 'Idempotency-Key': IDEMPOTENCY_KEY }
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(savedDraft)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(response.headers.get('X-Nihongo-Practice-Contract')).toBe('2')
    expect(response.headers.get('Idempotency-Replayed')).toBe('true')
    expect(dependencies.studyDraftService.save).toHaveBeenCalledWith(
      SESSION_ID,
      IDEMPOTENCY_KEY,
      expect.objectContaining({ expectedRevision: 0 }),
      { kind: 'USER', userId: USER_ID }
    )
  })

  it('cancellation은 strict empty body와 body 없는 204를 보장한다', async () => {
    const dependencies = createDependencies()
    const app = createTestApp(dependencies)
    const invalid = await request(
      app,
      `/api/v1/study-sessions/${SESSION_ID}/cancellation`,
      'POST',
      { unexpected: true }
    )
    expect(apiFailureSchema.parse(await invalid.json()).code).toBe(
      'INVALID_REQUEST'
    )

    const response = await request(
      app,
      `/api/v1/study-sessions/${SESSION_ID}/cancellation`,
      'POST',
      {}
    )
    expect(response.status).toBe(204)
    expect(await response.text()).toBe('')
    expect(response.headers.has('Content-Type')).toBe(false)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(response.headers.get('X-Nihongo-Practice-Contract')).toBe('2')
  })
})

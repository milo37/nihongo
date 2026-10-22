import { randomUUID } from 'node:crypto'
import { apiFailureSchema } from '@nihongo/contracts/common/error'
import type { VersionedStudySessionPayload } from '@nihongo/contracts/study/study-session'
import { describe, expect, it, vi } from 'vitest'
import { createApiApp } from '../app/createApp.js'
import type { AuthGateway } from '../auth/authGateway.js'
import type { GuestPrincipalService } from '../auth/guestPrincipalService.js'
import type { PrincipalService } from '../auth/principalService.js'
import type { ApiEnvironment } from '../config/env.js'
import type { ApplicationRateLimiter } from '../middleware/applicationRateLimiter.js'
import { createJsonLogger } from '../observability/logger.js'
import type { QuestionReader } from '../question/questionService.js'
import type { StudyResultRetryService } from '../study/studyResultRetryService.js'
import type { StudySessionService } from '../study/studySessionService.js'

const ORIGIN = 'http://localhost:5173'
const SOURCE_SESSION_ID = randomUUID()
const TARGET_SESSION_ID = randomUUID()
const IDEMPOTENCY_KEY = randomUUID()
const USER_ID = randomUUID()
const SESSION_QUESTION_ID = randomUUID()
const QUESTION_ID = randomUUID()
const VERSION_ID = randomUUID()
const TAG_ID = randomUUID()

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

const response: VersionedStudySessionPayload = {
  session: {
    id: TARGET_SESSION_ID,
    level: 'N5',
    subject: 'VOCABULARY',
    mode: 'WRONG_NOTE',
    status: 'IN_PROGRESS',
    requestedCount: 1,
    actualCount: 1,
    usedFallback: false,
    fallbackReason: null,
    startedAt: '2026-08-21T15:00:00.000Z',
    expiresAt: '2026-08-22T15:00:00.000Z',
    submittedAt: null,
    durationSec: null,
    practiceContractVersion: 2
  },
  questions: [
    {
      sessionQuestionId: SESSION_QUESTION_ID,
      ordinal: 1,
      question: {
        id: QUESTION_ID,
        questionVersionId: VERSION_ID,
        level: 'N5',
        subject: 'VOCABULARY',
        questionType: 'KANJI_READING',
        passage: null,
        questionText: '再挑戦する問題です。',
        options: Array.from({ length: 4 }, (_, index) => ({
          id: randomUUID(),
          label: String(index + 1) as '1' | '2' | '3' | '4',
          text: `보기 ${index + 1}`
        })),
        difficulty: 'EASY',
        tags: [{ id: TAG_ID, label: '재도전' }]
      }
    }
  ]
}

const authGateway: AuthGateway = {
  handle: async () => new Response(null, { status: 404 })
}
const questionReader: QuestionReader = {
  getQuestion: async () => Promise.reject(new Error('Not used.')),
  listQuestions: async () => ({ items: [], page: 1, pageSize: 20, total: 0 })
}
const sessionService: StudySessionService = {
  create: async () => Promise.reject(new Error('Not used.')),
  get: async () => Promise.reject(new Error('Not used.'))
}

const createDependencies = () => {
  const principalService = {
    getAuthenticatedUser: vi.fn(),
    resolveAuthenticatedUser: vi.fn().mockResolvedValue({
      clearSessionCookie: false,
      headers: new Headers(),
      user: {
        id: USER_ID,
        name: 'Retry User',
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
  const retryService = {
    create: vi.fn<StudyResultRetryService['create']>(async () => ({
      replayed: false,
      response
    }))
  } satisfies StudyResultRetryService
  return {
    guestPrincipalService,
    principalService,
    rateLimiter,
    retryService
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
      practiceContractV2Enabled,
      rateLimiter: dependencies.rateLimiter,
      retryService: dependencies.retryService,
      service: sessionService
    }
  })

const retryRequest = (
  app: ReturnType<typeof createTestApp>,
  overrides: {
    body?: unknown
    headers?: Record<string, string>
    sessionId?: string
  } = {}
) =>
  app.request(
    `/api/v1/study-sessions/${overrides.sessionId ?? SOURCE_SESSION_ID}/retry`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': IDEMPOTENCY_KEY,
        Origin: ORIGIN,
        'X-Nihongo-Practice-Contract': '2',
        ...overrides.headers
      },
      body: JSON.stringify(overrides.body ?? {})
    }
  )

describe('study result retry routes', () => {
  it('v1-compatible runtime에는 retry route를 mount하지 않는다', async () => {
    const dependencies = createDependencies()
    const result = await retryRequest(createTestApp(dependencies, false))

    expect(result.status).toBe(404)
    expect(apiFailureSchema.parse(await result.json()).code).toBe(
      'RESOURCE_NOT_FOUND'
    )
    expect(dependencies.retryService.create).not.toHaveBeenCalled()
  })

  it('UUID, contract header, idempotency key와 strict body를 auth 전에 검증한다', async () => {
    const dependencies = createDependencies()
    const app = createTestApp(dependencies)
    const results = await Promise.all([
      retryRequest(app, { sessionId: 'invalid-id' }),
      retryRequest(app, {
        headers: { 'X-Nihongo-Practice-Contract': '1' }
      }),
      retryRequest(app, { headers: { 'Idempotency-Key': '' } }),
      retryRequest(app, { body: { questionIds: [QUESTION_ID] } })
    ])

    expect(
      await Promise.all(
        results.map(
          async (result) => apiFailureSchema.parse(await result.json()).code
        )
      )
    ).toEqual([
      'INVALID_ID',
      'INVALID_REQUEST',
      'IDEMPOTENCY_KEY_REQUIRED',
      'INVALID_REQUEST'
    ])
    expect(
      dependencies.principalService.resolveAuthenticatedUser
    ).not.toHaveBeenCalled()
  })

  it('first 201에 canonical headers를 쓰고 owner/source/key만 service에 전달한다', async () => {
    const dependencies = createDependencies()
    const result = await retryRequest(createTestApp(dependencies))

    expect(result.status).toBe(201)
    expect(result.headers.get('Cache-Control')).toBe('private, no-store')
    expect(result.headers.get('X-Nihongo-Practice-Contract')).toBe('2')
    expect(result.headers.get('Location')).toBe(
      `/api/v1/study-sessions/${TARGET_SESSION_ID}`
    )
    expect(result.headers.get('Idempotency-Replayed')).toBeNull()
    expect(await result.json()).toEqual(response)
    expect(dependencies.retryService.create).toHaveBeenCalledWith(
      SOURCE_SESSION_ID,
      IDEMPOTENCY_KEY,
      { kind: 'USER', userId: USER_ID }
    )
  })

  it('replay 201에 replay header를 노출한다', async () => {
    const dependencies = createDependencies()
    dependencies.retryService.create.mockResolvedValueOnce({
      replayed: true,
      response
    })

    const result = await retryRequest(createTestApp(dependencies))

    expect(result.status).toBe(201)
    expect(result.headers.get('Idempotency-Replayed')).toBe('true')
  })

  it('인증 사용자와 guest proof가 모두 없으면 401로 닫는다', async () => {
    const dependencies = createDependencies()
    dependencies.principalService.resolveAuthenticatedUser.mockResolvedValueOnce(
      { clearSessionCookie: false, headers: new Headers(), user: null }
    )

    const result = await retryRequest(createTestApp(dependencies))

    expect(result.status).toBe(401)
    expect(apiFailureSchema.parse(await result.json()).code).toBe(
      'AUTHENTICATION_REQUIRED'
    )
    expect(dependencies.retryService.create).not.toHaveBeenCalled()
  })
})

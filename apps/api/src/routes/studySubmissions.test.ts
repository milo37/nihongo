import { apiFailureSchema } from '@nihongo/contracts/common/error'
import { studyResultSchema } from '@nihongo/contracts/study/study-result'
import { describe, expect, it, vi } from 'vitest'
import { createApiApp } from '../app/createApp.js'
import type { AuthGateway } from '../auth/authGateway.js'
import type { GuestPrincipalService } from '../auth/guestPrincipalService.js'
import type { PrincipalService } from '../auth/principalService.js'
import type { ApiEnvironment } from '../config/env.js'
import { ApplicationError } from '../errors/applicationError.js'
import type { ApplicationRateLimiter } from '../middleware/applicationRateLimiter.js'
import { createJsonLogger } from '../observability/logger.js'
import type { QuestionReader } from '../question/questionService.js'
import type { StudySessionService } from '../study/studySessionService.js'
import type { StudySubmissionService } from '../study/studySubmissionService.js'
import { GUEST_COOKIE_NAME } from './principal.js'

const ORIGIN = 'http://localhost:5173'
const id = (suffix: number): string =>
  `018f6b7a-1f4b-7d5e-8a91-${suffix.toString().padStart(12, '0')}`
const SESSION_ID = id(1)
const IDEMPOTENCY_KEY = id(2)
const USER_ID = id(3)

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

const result = studyResultSchema.parse({
  sessionId: SESSION_ID,
  level: 'N5',
  subject: 'VOCABULARY',
  mode: 'RANDOM',
  totalCount: 1,
  correctCount: 1,
  incorrectCount: 0,
  correctRate: 100,
  durationSec: 8,
  submittedAt: '2026-08-15T01:00:00.000Z',
  items: [
    {
      sessionQuestionId: id(4),
      question: {
        id: id(5),
        questionVersionId: id(6),
        level: 'N5',
        subject: 'VOCABULARY',
        questionType: 'KANJI_READING',
        passage: null,
        questionText: '「川」의 읽는 방법은 무엇입니까?',
        options: ['かわ', 'やま', 'うみ', 'そら'].map((text, index) => ({
          id: id(10 + index),
          label: String(index + 1),
          text
        })),
        difficulty: 'EASY',
        tags: [{ id: id(20), label: '한자 읽기' }],
        correctOptionId: id(10),
        explanationKo: '川은 かわ라고 읽습니다.',
        explanationJa: null
      },
      selectedOptionId: id(10),
      isCorrect: true,
      wrongNoteStatus: null
    }
  ]
})

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
  const rateLimiter = {
    consume: vi.fn().mockResolvedValue(undefined)
  } satisfies ApplicationRateLimiter
  const studySubmissionService = {
    submit: vi.fn<StudySubmissionService['submit']>(async () => ({
      response: result,
      replayed: false,
      guestProofExpiresAt: null
    })),
    getResult: vi.fn<StudySubmissionService['getResult']>(async () => result)
  } satisfies StudySubmissionService

  return {
    guestPrincipalService,
    principalService,
    rateLimiter,
    studySubmissionService
  }
}

const createTestApp = (
  dependencies: ReturnType<typeof createDependencies>,
  appEnvironment: ApiEnvironment = environment,
  practiceContractV2Enabled = true
) =>
  createApiApp({
    auth: {
      environment: appEnvironment,
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
      service: sessionService,
      submissionService: dependencies.studySubmissionService
    }
  })

const getSetCookies = (response: Response): string[] => {
  const values = response.headers.getSetCookie?.()
  if (values && values.length > 0) {
    return values
  }
  const combined = response.headers.get('Set-Cookie')
  return combined ? [combined] : []
}

const postSubmission = (
  app: ReturnType<typeof createTestApp>,
  init: { body?: unknown; headers?: Record<string, string> } = {}
) =>
  app.request(`/api/v1/study-sessions/${SESSION_ID}/submission`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: ORIGIN,
      'Idempotency-Key': IDEMPOTENCY_KEY,
      ...init.headers
    },
    body: JSON.stringify(
      init.body ?? {
        answers: [
          {
            studySessionQuestionId: id(4),
            selectedOptionId: id(10),
            elapsedSec: 8
          }
        ],
        durationSec: 8
      }
    )
  })

describe('study submission routes', () => {
  it('v1-compatible runtime은 v2 submit을 service 호출 전에 닫는다', async () => {
    const dependencies = createDependencies()
    const response = await postSubmission(
      createTestApp(dependencies, environment, false),
      {
        headers: { 'X-Nihongo-Practice-Contract': '2' },
        body: {
          answers: [
            {
              studySessionQuestionId: id(4),
              selectedOptionId: id(10),
              elapsedSec: 8
            }
          ],
          durationSec: 8,
          expectedDraftRevision: 0
        }
      }
    )

    expect(response.status).toBe(400)
    expect(apiFailureSchema.parse(await response.json()).code).toBe(
      'INVALID_REQUEST'
    )
    expect(dependencies.studySubmissionService.submit).not.toHaveBeenCalled()
  })

  it('429를 params/header/body/principal/service보다 먼저 반환한다', async () => {
    const dependencies = createDependencies()
    dependencies.rateLimiter.consume.mockRejectedValue(
      new ApplicationError({
        code: 'RATE_LIMITED',
        message: '요청이 너무 많습니다.',
        retryable: true,
        retryAfterSeconds: 17
      })
    )
    const response = await createTestApp(dependencies).request(
      '/api/v1/study-sessions/not-a-uuid/submission',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: ORIGIN,
          'Idempotency-Key': 'malformed'
        },
        body: '{'
      }
    )
    const failure = apiFailureSchema.parse(await response.json())

    expect(response.status).toBe(429)
    expect(failure).toMatchObject({ code: 'RATE_LIMITED', retryable: true })
    expect(response.headers.get('Retry-After')).toBe('17')
    expect(response.headers.get('X-Request-Id')).toBe(failure.requestId)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(
      response.headers
        .get('Access-Control-Expose-Headers')
        ?.split(',')
        .map((header) => header.trim())
    ).toEqual([
      'Idempotency-Replayed',
      'Location',
      'Retry-After',
      'X-Request-Id',
      'X-Nihongo-Practice-Contract'
    ])
    expect(
      dependencies.principalService.resolveAuthenticatedUser
    ).not.toHaveBeenCalled()
    expect(dependencies.studySubmissionService.submit).not.toHaveBeenCalled()
  })

  it('missing Idempotency-Key도 principal lookup 전에 400/fieldErrors omit으로 닫는다', async () => {
    const dependencies = createDependencies()
    const response = await createTestApp(dependencies).request(
      `/api/v1/study-sessions/${SESSION_ID}/submission`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
        body: JSON.stringify({
          answers: [
            {
              studySessionQuestionId: id(4),
              selectedOptionId: id(10),
              elapsedSec: 8
            }
          ],
          durationSec: 8
        })
      }
    )
    const failure = apiFailureSchema.parse(await response.json())

    expect(response.status).toBe(400)
    expect(failure.code).toBe('IDEMPOTENCY_KEY_REQUIRED')
    expect(failure.fieldErrors).toBeUndefined()
    expect(
      dependencies.principalService.resolveAuthenticatedUser
    ).not.toHaveBeenCalled()
  })

  it('invalid duration을 principal lookup 전에 422 INVALID_DURATION으로 닫는다', async () => {
    const dependencies = createDependencies()
    const response = await postSubmission(createTestApp(dependencies), {
      body: {
        answers: [
          {
            studySessionQuestionId: id(4),
            selectedOptionId: id(10),
            elapsedSec: 86_401
          }
        ],
        durationSec: 8
      }
    })
    const failure = apiFailureSchema.parse(await response.json())

    expect(response.status).toBe(422)
    expect(failure.code).toBe('INVALID_DURATION')
    expect(
      dependencies.principalService.resolveAuthenticatedUser
    ).not.toHaveBeenCalled()
  })

  it('malformed와 oversized JSON을 bounded reader에서 안전하게 거부한다', async () => {
    const dependencies = createDependencies()
    const app = createTestApp(dependencies)
    const headers = {
      'Content-Type': 'application/json',
      Origin: ORIGIN,
      'Idempotency-Key': IDEMPOTENCY_KEY
    }
    const [malformed, oversized] = await Promise.all([
      app.request(`/api/v1/study-sessions/${SESSION_ID}/submission`, {
        method: 'POST',
        headers,
        body: '{'
      }),
      app.request(`/api/v1/study-sessions/${SESSION_ID}/submission`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ padding: 'x'.repeat(17 * 1_024) })
      })
    ])

    for (const [response, code] of [
      [malformed, 'INVALID_JSON'],
      [oversized, 'INVALID_REQUEST']
    ] as const) {
      const failure = apiFailureSchema.parse(await response.json())
      expect(response.status).toBe(400)
      expect(failure.code).toBe(code)
      expect(response.headers.get('Cache-Control')).toBe('private, no-store')
      expect(response.headers.get('X-Request-Id')).toBe(failure.requestId)
    }
    expect(
      dependencies.principalService.resolveAuthenticatedUser
    ).not.toHaveBeenCalled()
    expect(dependencies.studySubmissionService.submit).not.toHaveBeenCalled()
  })

  it('Idempotency-Key 형식을 principal lookup 전에 400으로 거부하고 fieldErrors를 생략한다', async () => {
    const dependencies = createDependencies()
    const response = await postSubmission(createTestApp(dependencies), {
      headers: { 'Idempotency-Key': 'invalid' }
    })
    const failure = apiFailureSchema.parse(await response.json())

    expect(response.status).toBe(400)
    expect(failure.code).toBe('IDEMPOTENCY_KEY_REQUIRED')
    expect(failure.fieldErrors).toBeUndefined()
    expect(
      dependencies.principalService.resolveAuthenticatedUser
    ).not.toHaveBeenCalled()
    expect(dependencies.studySubmissionService.submit).not.toHaveBeenCalled()
  })

  it('duplicate answer를 principal lookup 전에 422 stable code로 거부한다', async () => {
    const dependencies = createDependencies()
    const answer = {
      studySessionQuestionId: id(4),
      selectedOptionId: id(10),
      elapsedSec: 8
    }
    const response = await postSubmission(createTestApp(dependencies), {
      body: { answers: [answer, answer], durationSec: 16 }
    })
    const failure = apiFailureSchema.parse(await response.json())

    expect(response.status).toBe(422)
    expect(failure.code).toBe('DUPLICATE_ANSWER')
    expect(
      dependencies.principalService.resolveAuthenticatedUser
    ).not.toHaveBeenCalled()
  })

  it('USER를 guest cookie보다 우선하고 canonical 201/no-store/CORS를 반환한다', async () => {
    const dependencies = createDependencies()
    const response = await postSubmission(createTestApp(dependencies), {
      headers: { Cookie: `${GUEST_COOKIE_NAME}=raw.signed.cookie` }
    })

    expect(response.status).toBe(201)
    expect(await response.json()).toEqual(result)
    expect(dependencies.studySubmissionService.submit).toHaveBeenCalledWith(
      SESSION_ID,
      IDEMPOTENCY_KEY,
      expect.objectContaining({ durationSec: 8 }),
      { kind: 'USER', userId: USER_ID }
    )
    expect(
      dependencies.guestPrincipalService.inspectCookie
    ).not.toHaveBeenCalled()
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(response.headers.get('Idempotency-Replayed')).toBeNull()
    expect(
      response.headers
        .get('Access-Control-Expose-Headers')
        ?.split(',')
        .map((header) => header.trim())
    ).toEqual([
      'Idempotency-Replayed',
      'Location',
      'Retry-After',
      'X-Request-Id',
      'X-Nihongo-Practice-Contract'
    ])
  })

  it('ADMIN도 guest cookie보다 우선하되 repository owner는 USER principal로 전달한다', async () => {
    const dependencies = createDependencies()
    dependencies.principalService.resolveAuthenticatedUser.mockResolvedValue({
      clearSessionCookie: false,
      headers: new Headers(),
      user: {
        id: USER_ID,
        name: 'Study Admin',
        role: 'ADMIN',
        targetLevel: 'N5'
      }
    })
    const response = await postSubmission(createTestApp(dependencies), {
      headers: { Cookie: `${GUEST_COOKIE_NAME}=raw.signed.cookie` }
    })

    expect(response.status).toBe(201)
    expect(dependencies.studySubmissionService.submit).toHaveBeenCalledWith(
      SESSION_ID,
      IDEMPOTENCY_KEY,
      expect.any(Object),
      { kind: 'USER', userId: USER_ID }
    )
    expect(
      dependencies.guestPrincipalService.inspectCookie
    ).not.toHaveBeenCalled()
  })

  it.each([
    {
      name: 'missing',
      inspected: { kind: 'ABSENT' } as const,
      code: 'AUTHENTICATION_REQUIRED'
    },
    {
      name: 'invalid',
      inspected: { kind: 'INVALID' } as const,
      code: 'GUEST_SESSION_EXPIRED'
    }
  ])(
    '$name guest proof를 401로 닫고 cookie를 발급하지 않는다',
    async ({ inspected, code }) => {
      const dependencies = createDependencies()
      dependencies.principalService.resolveAuthenticatedUser.mockResolvedValue({
        clearSessionCookie: false,
        headers: new Headers(),
        user: null
      })
      dependencies.guestPrincipalService.inspectCookie.mockReturnValue(
        inspected
      )
      const response = await postSubmission(createTestApp(dependencies), {
        ...(inspected.kind === 'INVALID'
          ? { headers: { Cookie: `${GUEST_COOKIE_NAME}=malformed` } }
          : {})
      })
      const failure = apiFailureSchema.parse(await response.json())

      expect(response.status).toBe(401)
      expect(failure.code).toBe(code)
      expect(response.headers.get('Set-Cookie')).toBeNull()
      expect(dependencies.studySubmissionService.submit).not.toHaveBeenCalled()
    }
  )

  it('production guest first success는 same raw HttpOnly/Secure cookie expiry만 refresh한다', async () => {
    const dependencies = createDependencies()
    dependencies.principalService.resolveAuthenticatedUser.mockResolvedValue({
      clearSessionCookie: false,
      headers: new Headers(),
      user: null
    })
    dependencies.guestPrincipalService.inspectCookie.mockReturnValue({
      kind: 'VERIFIED',
      id: id(30),
      tokenDigest: 'a'.repeat(64)
    })
    dependencies.studySubmissionService.submit.mockResolvedValue({
      response: result,
      replayed: false,
      guestProofExpiresAt: new Date(Date.now() + 60_000)
    })

    const response = await postSubmission(
      createTestApp(dependencies, {
        ...environment,
        NODE_ENV: 'production'
      }),
      {
        headers: { Cookie: `${GUEST_COOKIE_NAME}=raw.signed.cookie` }
      }
    )

    expect(response.status).toBe(201)
    expect(response.headers.get('Idempotency-Replayed')).toBeNull()
    expect(response.headers.get('Set-Cookie')).toContain(
      `${GUEST_COOKIE_NAME}=raw.signed.cookie`
    )
    expect(response.headers.get('Set-Cookie')).toContain('HttpOnly')
    expect(response.headers.get('Set-Cookie')).toContain('Secure')
  })

  it('503에서도 auth rolling/clear cookies와 Retry-After를 보존한다', async () => {
    const dependencies = createDependencies()
    const authHeaders = new Headers()
    authHeaders.append(
      'Set-Cookie',
      'nihongo.session_token=rolling-token; Path=/; HttpOnly; SameSite=Lax'
    )
    dependencies.principalService.resolveAuthenticatedUser.mockResolvedValue({
      clearSessionCookie: true,
      headers: authHeaders,
      user: null
    })
    dependencies.guestPrincipalService.inspectCookie.mockReturnValue({
      kind: 'VERIFIED',
      id: id(30),
      tokenDigest: 'a'.repeat(64)
    })
    dependencies.studySubmissionService.submit.mockRejectedValue(
      new ApplicationError({
        code: 'SERVICE_UNAVAILABLE',
        message: '저장소를 사용할 수 없습니다.',
        retryable: true
      })
    )

    const response = await postSubmission(createTestApp(dependencies), {
      headers: { Cookie: `${GUEST_COOKIE_NAME}=raw.signed.cookie` }
    })
    const failure = apiFailureSchema.parse(await response.json())
    const setCookies = getSetCookies(response).join('\n')

    expect(response.status).toBe(503)
    expect(failure).toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      retryable: true
    })
    expect(response.headers.get('Retry-After')).toBe('5')
    expect(response.headers.get('X-Request-Id')).toBe(failure.requestId)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(setCookies).toContain('nihongo.session_token=rolling-token')
    expect(setCookies).toContain('nihongo.session_token=;')
    expect(setCookies).toContain('__Secure-nihongo.session_token=;')
    expect(setCookies).not.toContain(`${GUEST_COOKIE_NAME}=raw.signed.cookie`)
  })

  it('guest service error에는 proof cookie를 재발급하지 않는다', async () => {
    const dependencies = createDependencies()
    dependencies.principalService.resolveAuthenticatedUser.mockResolvedValue({
      clearSessionCookie: false,
      headers: new Headers(),
      user: null
    })
    dependencies.guestPrincipalService.inspectCookie.mockReturnValue({
      kind: 'VERIFIED',
      id: id(30),
      tokenDigest: 'a'.repeat(64)
    })
    dependencies.studySubmissionService.submit.mockRejectedValue(
      new ApplicationError({
        code: 'SERVICE_UNAVAILABLE',
        message: '저장소를 사용할 수 없습니다.',
        retryable: true
      })
    )

    const response = await postSubmission(createTestApp(dependencies), {
      headers: { Cookie: `${GUEST_COOKIE_NAME}=raw.signed.cookie` }
    })

    expect(response.status).toBe(503)
    expect(response.headers.get('Set-Cookie')).toBeNull()
  })

  it('guest replay는 same raw cookie expiry를 refresh하고 replay header를 노출한다', async () => {
    const dependencies = createDependencies()
    dependencies.principalService.resolveAuthenticatedUser.mockResolvedValue({
      clearSessionCookie: false,
      headers: new Headers(),
      user: null
    })
    dependencies.guestPrincipalService.inspectCookie.mockReturnValue({
      kind: 'VERIFIED',
      id: id(30),
      tokenDigest: 'a'.repeat(64)
    })
    dependencies.studySubmissionService.submit.mockResolvedValue({
      response: result,
      replayed: true,
      guestProofExpiresAt: new Date(Date.now() + 60_000)
    })

    const response = await postSubmission(createTestApp(dependencies), {
      headers: { Cookie: `${GUEST_COOKIE_NAME}=raw.signed.cookie` }
    })

    expect(response.status).toBe(201)
    expect(response.headers.get('Idempotency-Replayed')).toBe('true')
    expect(response.headers.get('Set-Cookie')).toContain(
      `${GUEST_COOKIE_NAME}=raw.signed.cookie`
    )
    expect(response.headers.get('Set-Cookie')).toContain('HttpOnly')
    expect(dependencies.studySubmissionService.submit).toHaveBeenCalledWith(
      SESSION_ID,
      IDEMPOTENCY_KEY,
      expect.any(Object),
      {
        kind: 'GUEST',
        guestPrincipalId: id(30),
        tokenDigest: 'a'.repeat(64)
      }
    )
  })

  it('different key submitted conflict에 strict failure와 result Location을 붙인다', async () => {
    const dependencies = createDependencies()
    dependencies.studySubmissionService.submit.mockRejectedValue(
      new ApplicationError({
        code: 'SESSION_ALREADY_SUBMITTED',
        message: '이미 제출된 학습 세션입니다.',
        retryable: false,
        location: `/api/v1/study-sessions/${SESSION_ID}/result`
      })
    )

    const response = await postSubmission(createTestApp(dependencies))
    const failure = apiFailureSchema.parse(await response.json())

    expect(response.status).toBe(409)
    expect(failure.code).toBe('SESSION_ALREADY_SUBMITTED')
    expect(response.headers.get('Location')).toBe(
      `/api/v1/study-sessions/${SESSION_ID}/result`
    )
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  })

  it('unsafe SESSION_ALREADY_SUBMITTED Location은 응답에 노출하지 않는다', async () => {
    const dependencies = createDependencies()
    dependencies.studySubmissionService.submit.mockRejectedValue(
      new ApplicationError({
        code: 'SESSION_ALREADY_SUBMITTED',
        message: '이미 제출된 학습 세션입니다.',
        retryable: false,
        location:
          'https://evil.example/result' as `/api/v1/study-sessions/${string}/result`
      })
    )

    const response = await postSubmission(createTestApp(dependencies))

    expect(response.status).toBe(409)
    expect(response.headers.get('Location')).toBeNull()
  })

  it('foreign option service error를 422 OPTION_NOT_IN_VERSION으로 매핑한다', async () => {
    const dependencies = createDependencies()
    dependencies.studySubmissionService.submit.mockRejectedValue(
      new ApplicationError({
        code: 'OPTION_NOT_IN_VERSION',
        message: '보기가 pinned version에 속하지 않습니다.',
        retryable: false
      })
    )

    const response = await postSubmission(createTestApp(dependencies))
    const failure = apiFailureSchema.parse(await response.json())

    expect(response.status).toBe(422)
    expect(failure.code).toBe('OPTION_NOT_IN_VERSION')
  })

  it.each([
    {
      code: 'STUDY_RESULT_NOT_READY' as const,
      expectedStatus: 409,
      message: '결과가 아직 준비되지 않았습니다.'
    },
    {
      code: 'RESOURCE_NOT_FOUND' as const,
      expectedStatus: 404,
      message: '학습 세션을 찾을 수 없습니다.'
    }
  ])(
    'GET $code를 canonical $expectedStatus로 반환한다',
    async ({ code, expectedStatus, message }) => {
      const dependencies = createDependencies()
      dependencies.studySubmissionService.getResult.mockRejectedValue(
        new ApplicationError({ code, message, retryable: false })
      )
      const response = await createTestApp(dependencies).request(
        `/api/v1/study-sessions/${SESSION_ID}/result`,
        { headers: { Origin: ORIGIN } }
      )
      const failure = apiFailureSchema.parse(await response.json())

      expect(response.status).toBe(expectedStatus)
      expect(failure.code).toBe(code)
      expect(response.headers.get('Cache-Control')).toBe('private, no-store')
      expect(response.headers.get('X-Request-Id')).toBe(failure.requestId)
    }
  )

  it('GET invalid UUID를 principal lookup 전에 422 INVALID_ID로 닫는다', async () => {
    const dependencies = createDependencies()
    const response = await createTestApp(dependencies).request(
      '/api/v1/study-sessions/not-a-uuid/result',
      { headers: { Origin: ORIGIN } }
    )
    const failure = apiFailureSchema.parse(await response.json())

    expect(response.status).toBe(422)
    expect(failure.code).toBe('INVALID_ID')
    expect(
      dependencies.principalService.resolveAuthenticatedUser
    ).not.toHaveBeenCalled()
  })

  it('GET invalid guest proof를 401로 닫고 result service를 호출하지 않는다', async () => {
    const dependencies = createDependencies()
    dependencies.principalService.resolveAuthenticatedUser.mockResolvedValue({
      clearSessionCookie: false,
      headers: new Headers(),
      user: null
    })
    dependencies.guestPrincipalService.inspectCookie.mockReturnValue({
      kind: 'INVALID'
    })
    const response = await createTestApp(dependencies).request(
      `/api/v1/study-sessions/${SESSION_ID}/result`,
      {
        headers: {
          Origin: ORIGIN,
          Cookie: `${GUEST_COOKIE_NAME}=malformed`
        }
      }
    )
    const failure = apiFailureSchema.parse(await response.json())

    expect(response.status).toBe(401)
    expect(failure.code).toBe('GUEST_SESSION_EXPIRED')
    expect(dependencies.studySubmissionService.getResult).not.toHaveBeenCalled()
  })

  it('service DTO의 top-level·nested extra field를 strict parse로 500 처리하고 누출하지 않는다', async () => {
    const dependencies = createDependencies()
    const leakingResult = {
      ...result,
      internalSecret: 'top-level-secret',
      items: result.items.map((item) => ({
        ...item,
        question: {
          ...item.question,
          answerKeySecret: 'nested-secret'
        }
      }))
    } as typeof result
    dependencies.studySubmissionService.submit.mockResolvedValue({
      response: leakingResult,
      replayed: false,
      guestProofExpiresAt: null
    })

    const response = await postSubmission(createTestApp(dependencies))
    const body = await response.text()
    const failure = apiFailureSchema.parse(JSON.parse(body))

    expect(response.status).toBe(500)
    expect(failure).toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      retryable: true
    })
    expect(body).not.toContain('top-level-secret')
    expect(body).not.toContain('nested-secret')
    expect(body).not.toContain('internalSecret')
    expect(body).not.toContain('answerKeySecret')
  })

  it('production legacy study/demo auth 경로는 모두 404로 닫는다', async () => {
    const dependencies = createDependencies()
    const productionEnvironment = {
      ...environment,
      NODE_ENV: 'production' as const
    }
    const app = createTestApp(dependencies, productionEnvironment)
    const responses = await Promise.all([
      app.request(`/api/study/session/${SESSION_ID}/submit`, {
        method: 'POST'
      }),
      app.request(`/api/study/session/${SESSION_ID}/result`),
      app.request('/api/auth/login/user', { method: 'POST' }),
      app.request('/api/auth/login/admin', { method: 'POST' })
    ])

    for (const response of responses) {
      expect(response.status).toBe(404)
    }
    expect(dependencies.studySubmissionService.submit).not.toHaveBeenCalled()
    expect(dependencies.studySubmissionService.getResult).not.toHaveBeenCalled()
  })

  it('owner-scoped stored result를 strict contract로 읽고 guest cookie를 갱신하지 않는다', async () => {
    const dependencies = createDependencies()
    const response = await createTestApp(dependencies).request(
      `/api/v1/study-sessions/${SESSION_ID}/result`,
      { headers: { Origin: ORIGIN } }
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(result)
    expect(dependencies.studySubmissionService.getResult).toHaveBeenCalledWith(
      SESSION_ID,
      { kind: 'USER', userId: USER_ID }
    )
    expect(response.headers.get('Set-Cookie')).toBeNull()
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  })
})

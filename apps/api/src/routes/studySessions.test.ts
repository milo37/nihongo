import { apiFailureSchema } from '@nihongo/contracts/common/error'
import type { StudySessionPayload } from '@nihongo/contracts/study/study-session'
import { describe, expect, it, vi } from 'vitest'
import { createApiApp } from '../app/createApp.js'
import type { AuthGateway } from '../auth/authGateway.js'
import type {
  GuestPrincipalService,
  PreparedGuestCredential
} from '../auth/guestPrincipalService.js'
import type { PrincipalService } from '../auth/principalService.js'
import type { ApiEnvironment } from '../config/env.js'
import { ApplicationError } from '../errors/applicationError.js'
import type { ApplicationRateLimiter } from '../middleware/applicationRateLimiter.js'
import { createJsonLogger } from '../observability/logger.js'
import type { QuestionReader } from '../question/questionService.js'
import type { StudySessionService } from '../study/studySessionService.js'
import { GUEST_COOKIE_NAME } from './principal.js'

const ORIGIN = 'http://localhost:5173'
const SESSION_ID = '018f6b7a-1f4b-7d5e-8a91-4c27df9c10d1'
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

const payload = {
  session: {
    id: SESSION_ID,
    level: 'N5',
    subject: 'VOCABULARY',
    mode: 'RANDOM',
    status: 'IN_PROGRESS',
    requestedCount: 1,
    actualCount: 1,
    usedFallback: false,
    fallbackReason: null,
    startedAt: '2026-08-14T00:00:00.000Z',
    expiresAt: '2026-08-15T00:00:00.000Z',
    submittedAt: null,
    durationSec: null
  },
  questions: [
    {
      sessionQuestionId: '018f6b7a-1f4b-7d5e-8a91-4c27df9c10d3',
      ordinal: 1,
      question: {
        id: '018f6b7a-1f4b-7d5e-8a91-4c27df9c10a1',
        questionVersionId: '018f6b7a-1f4b-7d5e-8a91-4c27df9c10a2',
        level: 'N5',
        subject: 'VOCABULARY',
        questionType: 'KANJI_READING',
        passage: null,
        questionText: '「川」의 읽는 방법은 무엇입니까?',
        options: ['かわ', 'やま', 'うみ', 'そら'].map((text, index) => ({
          id: `018f6b7a-1f4b-7d5e-8a91-4c27df9c10b${index}`,
          label: String(index + 1) as '1' | '2' | '3' | '4',
          text
        })),
        difficulty: 'EASY',
        tags: [
          {
            id: '018f6b7a-1f4b-7d5e-8a91-4c27df9c10c1',
            label: '한자 읽기'
          }
        ]
      }
    }
  ]
} satisfies StudySessionPayload

const credentialCreatedAt = new Date()
const credential = {
  id: '018f6b7a-1f4b-7d5e-8a91-4c27df9c10e1',
  tokenDigest: 'a'.repeat(64),
  createdAt: credentialCreatedAt,
  expiresAt: new Date(credentialCreatedAt.getTime() + 7 * 24 * 60 * 60 * 1_000),
  cookieValue: 'guest-id.raw-token.signature'
} satisfies PreparedGuestCredential

const questionReader: QuestionReader = {
  getQuestion: async () => Promise.reject(new Error('Not used in this test.')),
  listQuestions: async () => ({ items: [], page: 1, pageSize: 20, total: 0 })
}

const authGateway: AuthGateway = {
  handle: async () => new Response(null, { status: 404 })
}

const getSetCookies = (response: Response): string[] => {
  const values = response.headers.getSetCookie?.()
  return values && values.length > 0
    ? values
    : [response.headers.get('Set-Cookie') ?? '']
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
      user: null
    })
  } satisfies PrincipalService
  const guestPrincipalService = {
    clear: vi.fn().mockResolvedValue(undefined),
    create: vi.fn(),
    deleteExpired: vi.fn(),
    inspectCookie: vi.fn(
      (): ReturnType<GuestPrincipalService['inspectCookie']> => ({
        kind: 'ABSENT'
      })
    ),
    prepareCredential: vi.fn(() => credential),
    resolveExisting: vi.fn()
  } satisfies GuestPrincipalService
  const studySessionService = {
    create: vi.fn<StudySessionService['create']>(async () => ({
      payload,
      issuedGuestCredential: credential
    })),
    get: vi.fn<StudySessionService['get']>(async () => payload)
  } satisfies StudySessionService

  return {
    guestPrincipalService,
    principalService,
    rateLimiter,
    studySessionService
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
      service: dependencies.studySessionService
    }
  })

const postSession = (
  app: ReturnType<typeof createTestApp>,
  init: RequestInit = {}
) =>
  app.request('/api/v1/study-sessions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: ORIGIN,
      ...init.headers
    },
    body:
      init.body ??
      JSON.stringify({
        level: 'N5',
        subject: 'VOCABULARY',
        mode: 'RANDOM',
        count: 1
      })
  })

describe('study session route composition', () => {
  it('v1-compatible runtime은 header 2를 service 호출 전에 닫는다', async () => {
    const dependencies = createDependencies()
    const response = await postSession(createTestApp(dependencies, false), {
      headers: { 'X-Nihongo-Practice-Contract': '2' }
    })

    expect(response.status).toBe(400)
    expect(apiFailureSchema.parse(await response.json()).code).toBe(
      'INVALID_REQUEST'
    )
    expect(dependencies.studySessionService.create).not.toHaveBeenCalled()
  })

  it('v2 non-RANDOM 요청을 contract 2로 전달하고 응답 version을 고정한다', async () => {
    const dependencies = createDependencies()
    const v2Payload = {
      ...payload,
      session: {
        ...payload.session,
        mode: 'WRONG_NOTE' as const,
        practiceContractVersion: 2 as const
      }
    }
    dependencies.principalService.resolveAuthenticatedUser.mockResolvedValue({
      clearSessionCookie: false,
      headers: new Headers(),
      user: {
        id: USER_ID,
        name: 'Study User',
        role: 'USER',
        targetLevel: 'N5'
      }
    })
    dependencies.studySessionService.create.mockResolvedValue({
      payload: v2Payload,
      practiceContractVersion: 2,
      issuedGuestCredential: null
    })

    const response = await postSession(createTestApp(dependencies), {
      headers: { 'X-Nihongo-Practice-Contract': '2' },
      body: JSON.stringify({
        level: 'N5',
        subject: 'VOCABULARY',
        mode: 'WRONG_NOTE',
        count: 1
      })
    })

    expect(response.status).toBe(201)
    expect(response.headers.get('X-Nihongo-Practice-Contract')).toBe('2')
    expect(await response.json()).toEqual(v2Payload)
    expect(dependencies.studySessionService.create).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'WRONG_NOTE' }),
      { kind: 'USER', userId: USER_ID },
      2
    )
  })

  it('reviewFilter는 v2 review mode만 accept하고 v1은 unknown key로 닫는다', async () => {
    const dependencies = createDependencies()
    const v2Payload = {
      ...payload,
      session: {
        ...payload.session,
        mode: 'DAILY_REVIEW' as const,
        practiceContractVersion: 2 as const
      }
    }
    dependencies.principalService.resolveAuthenticatedUser.mockResolvedValue({
      clearSessionCookie: false,
      headers: new Headers(),
      user: {
        id: USER_ID,
        name: 'Study User',
        role: 'USER',
        targetLevel: 'N5'
      }
    })
    dependencies.studySessionService.create.mockResolvedValue({
      payload: v2Payload,
      practiceContractVersion: 2,
      issuedGuestCredential: null
    })
    const body = JSON.stringify({
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'DAILY_REVIEW',
      count: 1,
      reviewFilter: { questionType: 'KANJI_READING', tag: '한자 읽기' }
    })

    const v1 = await postSession(createTestApp(dependencies), { body })
    expect(v1.status).toBe(422)
    expect(apiFailureSchema.parse(await v1.json()).code).toBe(
      'VALIDATION_ERROR'
    )
    expect(dependencies.studySessionService.create).not.toHaveBeenCalled()

    const v2 = await postSession(createTestApp(dependencies), {
      headers: { 'X-Nihongo-Practice-Contract': '2' },
      body
    })
    expect(v2.status).toBe(201)
    expect(dependencies.studySessionService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'DAILY_REVIEW',
        reviewFilter: {
          questionType: 'KANJI_READING',
          tag: '한자 읽기'
        }
      }),
      { kind: 'USER', userId: USER_ID },
      2
    )
  })

  it('429를 principal·guest·service 작업보다 먼저 fail closed한다', async () => {
    const dependencies = createDependencies()
    dependencies.rateLimiter.consume.mockRejectedValue(
      new ApplicationError({
        code: 'RATE_LIMITED',
        message: '요청이 너무 많습니다.',
        retryable: true,
        retryAfterSeconds: 37
      })
    )

    const response = await postSession(createTestApp(dependencies))
    const failure = apiFailureSchema.parse(await response.json())

    expect(response.status).toBe(429)
    expect(failure.code).toBe('RATE_LIMITED')
    expect(response.headers.get('Retry-After')).toBe('37')
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(response.headers.get('X-Request-Id')).toBe(failure.requestId)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN)
    expect(response.headers.get('Access-Control-Allow-Credentials')).toBe(
      'true'
    )
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
    expect(
      dependencies.guestPrincipalService.inspectCookie
    ).not.toHaveBeenCalled()
    expect(
      dependencies.guestPrincipalService.prepareCredential
    ).not.toHaveBeenCalled()
    expect(dependencies.studySessionService.create).not.toHaveBeenCalled()
  })

  it('USER actor가 guest cookie보다 우선하고 rolling cookie를 성공 응답에 보존한다', async () => {
    const dependencies = createDependencies()
    dependencies.principalService.resolveAuthenticatedUser.mockResolvedValue({
      clearSessionCookie: false,
      headers: new Headers({
        'Set-Cookie': 'nihongo.session_token=rolling; Path=/; HttpOnly'
      }),
      user: {
        id: USER_ID,
        name: 'Study User',
        role: 'USER',
        targetLevel: 'N5'
      }
    })
    dependencies.studySessionService.create.mockResolvedValue({
      payload,
      issuedGuestCredential: null
    })

    const response = await postSession(createTestApp(dependencies), {
      headers: { Cookie: `${GUEST_COOKIE_NAME}=signed-guest` }
    })

    expect(response.status).toBe(201)
    expect(await response.json()).toEqual(payload)
    expect(dependencies.studySessionService.create).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'RANDOM' }),
      { kind: 'USER', userId: USER_ID }
    )
    expect(
      dependencies.guestPrincipalService.inspectCookie
    ).not.toHaveBeenCalled()
    expect(
      dependencies.guestPrincipalService.prepareCredential
    ).not.toHaveBeenCalled()
    expect(getSetCookies(response).join('\n')).toContain(
      'nihongo.session_token=rolling'
    )
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  })

  it('auth clear cookie를 service 오류에서도 보존하고 guest cookie는 commit 성공 전에 발급하지 않는다', async () => {
    const dependencies = createDependencies()
    dependencies.principalService.resolveAuthenticatedUser.mockResolvedValue({
      clearSessionCookie: true,
      headers: new Headers({
        'Set-Cookie': 'rolling=stale; Path=/; HttpOnly'
      }),
      user: null
    })
    dependencies.studySessionService.create.mockRejectedValue(
      new ApplicationError({
        code: 'SERVICE_UNAVAILABLE',
        message: '저장소에 연결할 수 없습니다.',
        retryable: true
      })
    )

    const response = await postSession(createTestApp(dependencies))
    const failure = apiFailureSchema.parse(await response.json())
    const setCookies = getSetCookies(response).join('\n')

    expect(response.status).toBe(503)
    expect(failure.code).toBe('SERVICE_UNAVAILABLE')
    expect(response.headers.get('Retry-After')).toBe('5')
    expect(setCookies).toContain('rolling=stale')
    expect(setCookies).toContain('nihongo.session_token=')
    expect(setCookies).toContain('__Secure-nihongo.session_token=')
    expect(setCookies).toContain('Max-Age=0')
    expect(setCookies).not.toContain(`${GUEST_COOKIE_NAME}=`)
  })

  it('폐기된 auth cookie와 commit된 신규 guest cookie를 성공 응답에 함께 보존한다', async () => {
    const dependencies = createDependencies()
    dependencies.principalService.resolveAuthenticatedUser.mockResolvedValue({
      clearSessionCookie: true,
      headers: new Headers({
        'Set-Cookie': 'rolling=stale; Path=/; HttpOnly'
      }),
      user: null
    })

    const response = await postSession(createTestApp(dependencies))
    const setCookies = getSetCookies(response).join('\n')

    expect(response.status).toBe(201)
    expect(setCookies).toContain('rolling=stale')
    expect(setCookies).toContain('nihongo.session_token=')
    expect(setCookies).toContain('__Secure-nihongo.session_token=')
    expect(setCookies).toContain('Max-Age=0')
    expect(setCookies).toContain(
      `${GUEST_COOKIE_NAME}=${credential.cookieValue}`
    )
  })

  it.each([
    {
      name: '신규 guest',
      inspected: { kind: 'ABSENT' as const },
      issuedGuestCredential: credential,
      expectedOwner: { kind: 'NEW_GUEST', credential }
    },
    {
      name: '유효한 기존 guest',
      inspected: {
        kind: 'VERIFIED' as const,
        id: credential.id,
        tokenDigest: credential.tokenDigest
      },
      issuedGuestCredential: null,
      expectedOwner: {
        kind: 'GUEST_OR_NEW',
        guestPrincipalId: credential.id,
        tokenDigest: credential.tokenDigest,
        replacement: credential
      }
    },
    {
      name: 'DB row가 사라진 stale guest',
      inspected: {
        kind: 'VERIFIED' as const,
        id: credential.id,
        tokenDigest: credential.tokenDigest
      },
      issuedGuestCredential: credential,
      expectedOwner: {
        kind: 'GUEST_OR_NEW',
        guestPrincipalId: credential.id,
        tokenDigest: credential.tokenDigest,
        replacement: credential
      }
    }
  ])(
    '$name credential을 repository commit 결과에 맞게 발급한다',
    async ({ expectedOwner, inspected, issuedGuestCredential }) => {
      const dependencies = createDependencies()
      dependencies.guestPrincipalService.inspectCookie.mockReturnValue(
        inspected
      )
      dependencies.studySessionService.create.mockResolvedValue({
        payload,
        issuedGuestCredential
      })

      const response = await postSession(createTestApp(dependencies), {
        headers: { Cookie: `${GUEST_COOKIE_NAME}=signed-guest` }
      })
      const setCookies = getSetCookies(response).join('\n')

      expect(response.status).toBe(201)
      expect(dependencies.studySessionService.create).toHaveBeenCalledWith(
        expect.objectContaining({ mode: 'RANDOM' }),
        expectedOwner
      )
      if (issuedGuestCredential) {
        expect(setCookies).toContain(
          `${GUEST_COOKIE_NAME}=${credential.cookieValue}`
        )
        expect(setCookies).toContain('HttpOnly')
        expect(setCookies).toContain('SameSite=Lax')
        expect(setCookies).toContain('Path=/')
      } else {
        expect(setCookies).not.toContain(`${GUEST_COOKIE_NAME}=`)
      }
    }
  )

  it('invalid body·origin·media type·UUID를 canonical error로 닫는다', async () => {
    const dependencies = createDependencies()
    const app = createTestApp(dependencies)
    const [malformed, invalidBody, untrustedOrigin, invalidMedia, invalidId] =
      await Promise.all([
        postSession(app, { body: '{' }),
        postSession(app, {
          body: JSON.stringify({
            level: 'N5',
            subject: 'VOCABULARY',
            mode: 'RANDOM',
            count: 0
          })
        }),
        postSession(app, { headers: { Origin: 'https://evil.example' } }),
        postSession(app, {
          headers: { 'Content-Type': 'text/plain', Origin: ORIGIN }
        }),
        app.request('/api/v1/study-sessions/not-a-uuid', {
          headers: { Origin: ORIGIN }
        })
      ])

    const expectations = [
      [malformed, 400, 'INVALID_JSON'],
      [invalidBody, 422, 'VALIDATION_ERROR'],
      [untrustedOrigin, 403, 'UNTRUSTED_ORIGIN'],
      [invalidMedia, 400, 'INVALID_REQUEST'],
      [invalidId, 422, 'INVALID_ID']
    ] as const

    for (const [response, status, code] of expectations) {
      const failure = apiFailureSchema.parse(await response.json())
      expect(response.status).toBe(status)
      expect(failure.code).toBe(code)
      expect(response.headers.get('Cache-Control')).toBe('private, no-store')
      expect(response.headers.get('X-Request-Id')).toBe(failure.requestId)
    }

    expect(malformed.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN)
    expect(invalidBody.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN)
    expect(invalidMedia.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN)
    expect(invalidId.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN)
    expect(
      untrustedOrigin.headers.get('Access-Control-Allow-Origin')
    ).toBeNull()
  })
})

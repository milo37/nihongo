import { randomUUID } from 'node:crypto'
import { apiFailureSchema } from '@nihongo/contracts/common/error'
import { describe, expect, it, vi } from 'vitest'
import type { AuthGateway } from '../auth/authGateway.js'
import type { GuestPrincipalService } from '../auth/guestPrincipalService.js'
import type { PrincipalService } from '../auth/principalService.js'
import { parseApiEnvironment } from '../config/env.js'
import { createJsonLogger } from '../observability/logger.js'
import type { QuestionReader } from '../question/questionService.js'
import { createApiApp } from './createApp.js'

const createTestLogger = () => {
  const lines: string[] = []

  return {
    lines,
    logger: createJsonLogger('debug', (line) => lines.push(line))
  }
}

const questionReader: QuestionReader = {
  getQuestion: async () => Promise.reject(new Error('Not used in this test.')),
  listQuestions: async () => ({ items: [], page: 1, pageSize: 20, total: 0 })
}

const authEnvironment = parseApiEnvironment({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://user:password@127.0.0.1:55432/nihongo_test',
  TRUSTED_ORIGINS: 'http://localhost:5173',
  BETTER_AUTH_SECRET: 'a'.repeat(32),
  GUEST_COOKIE_SECRET: 'b'.repeat(32),
  AUTH_EMAIL_FROM: 'auth@example.com'
})

const guestPrincipalService: GuestPrincipalService = {
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
}

const principalService: PrincipalService = {
  getAuthenticatedUser: vi.fn(),
  resolveAuthenticatedUser: vi.fn()
}

describe('Hono operational boundary', () => {
  it('live 응답과 유효한 request ID를 보존한다', async () => {
    const requestId = randomUUID()
    const { logger } = createTestLogger()
    const app = createApiApp({
      checkReadiness: vi.fn().mockResolvedValue(undefined),
      logger,
      questionReader
    })
    const response = await app.request('/health/live', {
      headers: { 'X-Request-Id': requestId }
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('X-Request-Id')).toBe(requestId)
    expect(await response.json()).toEqual({ status: 'ok' })
  })

  it('잘못된 request ID를 서버 UUID로 교체한다', async () => {
    const { logger } = createTestLogger()
    const app = createApiApp({
      checkReadiness: vi.fn().mockResolvedValue(undefined),
      logger,
      questionReader
    })
    const response = await app.request('/health/live', {
      headers: { 'X-Request-Id': 'not-a-uuid' }
    })

    expect(response.headers.get('X-Request-Id')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    )
  })

  it('readiness 실패를 안전한 503 계약으로 변환한다', async () => {
    const { logger } = createTestLogger()
    const app = createApiApp({
      checkReadiness: vi
        .fn()
        .mockRejectedValue(new Error('postgresql://secret@database')),
      logger,
      questionReader
    })
    const response = await app.request('/health/ready')
    const payload = apiFailureSchema.parse(await response.json())

    expect(response.status).toBe(503)
    expect(payload.code).toBe('SERVICE_UNAVAILABLE')
    expect(payload.message).not.toContain('secret')
    expect(response.headers.get('X-Request-Id')).toBe(payload.requestId)
    expect(response.headers.get('Retry-After')).toBe('5')
  })

  it('예상하지 못한 오류를 request ID가 포함된 500으로 정규화한다', async () => {
    const { logger, lines } = createTestLogger()
    const app = createApiApp({
      checkReadiness: vi.fn().mockResolvedValue(undefined),
      logger,
      questionReader,
      enableTestRoutes: true
    })
    const response = await app.request('/__test/error')
    const payload = apiFailureSchema.parse(await response.json())

    expect(response.status).toBe(500)
    expect(payload.code).toBe('INTERNAL_SERVER_ERROR')
    expect(payload.message).not.toContain('sensitive')
    expect(lines.some((line) => line.includes(payload.requestId))).toBe(true)
  })

  it('compatibility authority가 유효하지 않으면 API 요청을 503으로 닫는다', async () => {
    const { logger } = createTestLogger()
    const gatedQuestionReader: QuestionReader = {
      ...questionReader,
      listQuestions: vi.fn().mockResolvedValue({
        items: [],
        page: 1,
        pageSize: 20,
        total: 0
      })
    }
    const app = createApiApp({
      auth: {
        environment: authEnvironment,
        gateway: { handle: vi.fn() },
        guestPrincipalService,
        principalService
      },
      assertPracticeRuntimeAuthority: vi.fn(() => {
        throw new Error('revoked generation')
      }),
      checkReadiness: vi.fn().mockResolvedValue(undefined),
      logger,
      questionReader: gatedQuestionReader
    })
    const response = await app.request('/api/v1/questions')
    const failure = apiFailureSchema.parse(await response.json())

    expect(response.status).toBe(503)
    expect(failure.code).toBe('SERVICE_UNAVAILABLE')
    expect(failure.message).not.toContain('revoked')
    expect(gatedQuestionReader.listQuestions).not.toHaveBeenCalled()
  })

  it('인증 게이트웨이의 예상 밖 오류에도 trusted-origin CORS를 보존한다', async () => {
    const { logger } = createTestLogger()
    const gateway: AuthGateway = {
      handle: vi.fn().mockRejectedValue(new Error('database unavailable'))
    }
    const app = createApiApp({
      auth: {
        environment: authEnvironment,
        gateway,
        guestPrincipalService,
        principalService
      },
      checkReadiness: vi.fn().mockResolvedValue(undefined),
      logger,
      questionReader
    })
    const response = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:5173'
      },
      body: '{}'
    })
    const payload = apiFailureSchema.parse(await response.json())

    expect(response.status).toBe(500)
    expect(payload.code).toBe('INTERNAL_SERVER_ERROR')
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(
      'http://localhost:5173'
    )
    expect(response.headers.get('Access-Control-Allow-Credentials')).toBe(
      'true'
    )
    expect(response.headers.get('Access-Control-Expose-Headers')).toBe(
      'Retry-After, X-Request-Id'
    )
    expect(response.headers.get('X-Request-Id')).toBe(payload.requestId)
  })
})

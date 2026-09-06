import { apiFailureSchema } from '@nihongo/contracts/common/error'
import { describe, expect, it, vi } from 'vitest'
import type { AdminReadRateLimiter } from '../admin/adminReadRateLimiter.js'
import type { AdminQuestionReader } from '../admin/adminQuestionService.js'
import type { GuestPrincipalService } from '../auth/guestPrincipalService.js'
import type { PrincipalService } from '../auth/principalService.js'
import { parseApiEnvironment } from '../config/env.js'
import { ApplicationError } from '../errors/applicationError.js'
import { createJsonLogger } from '../observability/logger.js'
import type { QuestionReader } from '../question/questionService.js'
import { createApiApp } from './createApp.js'

const environment = parseApiEnvironment({
  NODE_ENV: 'test',
  ADMIN_CMS_MODE: 'technical',
  DATABASE_URL:
    'postgresql://nihongo_test_app_login:password@127.0.0.1:55432/nihongo_test?schema=public',
  AUTH_GATEWAY_DATABASE_URL:
    'postgresql://nihongo_test_auth_gateway_login:password@127.0.0.1:55432/nihongo_test?schema=public',
  TRUSTED_ORIGINS: 'http://localhost:5173',
  BETTER_AUTH_SECRET: 'a'.repeat(32),
  GUEST_COOKIE_SECRET: 'b'.repeat(32),
  AUTH_EMAIL_FROM: 'auth@example.com'
})

const questionReader: QuestionReader = {
  getQuestion: async () => Promise.reject(new Error('not used')),
  listQuestions: async () => ({ items: [], page: 1, pageSize: 20, total: 0 })
}

const guestPrincipalService: GuestPrincipalService = {
  clear: vi.fn(),
  create: vi.fn(),
  deleteExpired: vi.fn(),
  inspectCookie: vi.fn(() => ({ kind: 'ABSENT' }) as const),
  prepareCredential: vi.fn(),
  resolveExisting: vi.fn()
}

const createReader = (): AdminQuestionReader => ({
  listQuestions: vi.fn(async (query) => ({
    items: [],
    page: query.page,
    pageSize: query.pageSize,
    total: 0
  })),
  getQuestion: vi.fn(async () => Promise.reject(new Error('not used'))),
  listVersions: vi.fn(async () => Promise.reject(new Error('not used'))),
  previewVersion: vi.fn(async () => Promise.reject(new Error('not used'))),
  diffVersion: vi.fn(async () => Promise.reject(new Error('not used'))),
  listTags: vi.fn(async () => Promise.reject(new Error('not used'))),
  listReviews: vi.fn(async () => Promise.reject(new Error('not used'))),
  listAuditLog: vi.fn(async () => Promise.reject(new Error('not used')))
})

type ResolvedUser = Awaited<
  ReturnType<PrincipalService['resolveAuthenticatedUser']>
>['user']

const createFixture = ({
  clearSessionCookie = false,
  rateError,
  user
}: {
  clearSessionCookie?: boolean
  rateError?: ApplicationError
  user: ResolvedUser
}) => {
  const assertCapability = vi.fn().mockResolvedValue(undefined)
  const assertPracticeRuntimeAuthority = vi.fn().mockResolvedValue(undefined)
  const reader = createReader()
  const consume = vi.fn(async () => {
    if (rateError) throw rateError
  })
  const rateLimiter: AdminReadRateLimiter = { consume }
  const resolveAuthenticatedUser = vi.fn(async () => ({
    clearSessionCookie,
    headers: new Headers(),
    user
  }))
  const principalService: PrincipalService = {
    resolveAuthenticatedUser,
    getAuthenticatedUser: vi.fn(async () => user)
  }
  const app = createApiApp({
    admin: { assertCapability, rateLimiter, reader },
    assertPracticeRuntimeAuthority,
    auth: {
      environment,
      gateway: { handle: vi.fn() },
      guestPrincipalService,
      principalService
    },
    checkReadiness: vi.fn().mockResolvedValue(undefined),
    logger: createJsonLogger('silent'),
    questionReader
  })

  return {
    app,
    assertCapability,
    assertPracticeRuntimeAuthority,
    consume,
    reader,
    resolveAuthenticatedUser
  }
}

const adminUser = {
  id: '019d0000-0000-7000-8000-000000000001',
  name: '관리자',
  role: 'ADMIN',
  targetLevel: null
} as const

const regularUser = {
  ...adminUser,
  id: '019d0000-0000-7000-8000-000000000002',
  role: 'USER'
} as const

describe('Phase 7 Slice 2 ADMIN read routing', () => {
  it('orders session → ADMIN → capability → rate → strict query → reader', async () => {
    const fixture = createFixture({ user: adminUser })
    const response = await fixture.app.request(
      '/api/v1/admin/questions?page=1&pageSize=20'
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0
    })
    expect(fixture.resolveAuthenticatedUser).toHaveBeenCalledTimes(1)
    expect(fixture.assertCapability).toHaveBeenCalledTimes(1)
    expect(fixture.consume).toHaveBeenCalledWith({
      actorId: adminUser.id,
      clientIp: 'unresolved'
    })
    expect(fixture.reader.listQuestions).toHaveBeenCalledTimes(1)
    expect(fixture.assertPracticeRuntimeAuthority).not.toHaveBeenCalled()
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(response.headers.get('X-Request-Id')).toMatch(/^[0-9a-f-]{36}$/u)
  })

  it.each([
    {
      name: 'guest',
      user: null,
      clearSessionCookie: false,
      expectedCode: 'AUTHENTICATION_REQUIRED'
    },
    {
      name: 'expired',
      user: null,
      clearSessionCookie: true,
      expectedCode: 'AUTH_SESSION_EXPIRED'
    }
  ])(
    '$name 401은 capability/rate/reader 전에 종료한다',
    async ({ clearSessionCookie, expectedCode, user }) => {
      const fixture = createFixture({ clearSessionCookie, user })
      const response = await fixture.app.request('/api/v1/admin/questions')

      expect(response.status).toBe(401)
      expect(apiFailureSchema.parse(await response.json()).code).toBe(
        expectedCode
      )
      expect(fixture.assertCapability).not.toHaveBeenCalled()
      expect(fixture.consume).not.toHaveBeenCalled()
      expect(fixture.reader.listQuestions).not.toHaveBeenCalled()
    }
  )

  it('USER 403은 capability/rate/reader 전에 종료한다', async () => {
    const fixture = createFixture({ user: regularUser })
    const response = await fixture.app.request('/api/v1/admin/questions')

    expect(response.status).toBe(403)
    expect(apiFailureSchema.parse(await response.json()).code).toBe(
      'ADMIN_REQUIRED'
    )
    expect(fixture.assertCapability).not.toHaveBeenCalled()
    expect(fixture.consume).not.toHaveBeenCalled()
    expect(fixture.reader.listQuestions).not.toHaveBeenCalled()
  })

  it('strict query 422 is reached only after capability and shared rate', async () => {
    const fixture = createFixture({ user: adminUser })
    const response = await fixture.app.request(
      '/api/v1/admin/questions?unknown=1'
    )

    expect(response.status).toBe(422)
    expect(apiFailureSchema.parse(await response.json()).code).toBe(
      'VALIDATION_ERROR'
    )
    expect(fixture.assertCapability).toHaveBeenCalledTimes(1)
    expect(fixture.consume).toHaveBeenCalledTimes(1)
    expect(fixture.reader.listQuestions).not.toHaveBeenCalled()
  })

  it.each([
    ['baseVersionId=short', 'INVALID_ID'],
    ['unknown=1', 'VALIDATION_ERROR'],
    [
      'baseVersionId=019d0000-0000-7000-8000-000000000002&baseVersionId=019d0000-0000-7000-8000-000000000003',
      'VALIDATION_ERROR'
    ]
  ])(
    'diff query %s maps to %s after guard and before lookup',
    async (search, expectedCode) => {
      const fixture = createFixture({ user: adminUser })
      const response = await fixture.app.request(
        `/api/v1/admin/question-versions/019d0000-0000-7000-8000-000000000001/diff?${search}`
      )

      expect(response.status).toBe(422)
      expect(apiFailureSchema.parse(await response.json()).code).toBe(
        expectedCode
      )
      expect(fixture.assertCapability).toHaveBeenCalledTimes(1)
      expect(fixture.consume).toHaveBeenCalledTimes(1)
      expect(fixture.reader.diffVersion).not.toHaveBeenCalled()
    }
  )

  it('rate rejection keeps Retry-After and never calls the reader', async () => {
    const fixture = createFixture({
      user: adminUser,
      rateError: new ApplicationError({
        code: 'RATE_LIMITED',
        message: 'too many',
        retryable: false,
        retryAfterSeconds: 17
      })
    })
    const response = await fixture.app.request('/api/v1/admin/questions')

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('17')
    expect(apiFailureSchema.parse(await response.json()).retryable).toBe(true)
    expect(fixture.reader.listQuestions).not.toHaveBeenCalled()
  })

  it('derives GET 503 retryability and transport from the shared operation policy', async () => {
    const fixture = createFixture({ user: adminUser })
    vi.spyOn(fixture.reader, 'listQuestions').mockRejectedValueOnce(
      new ApplicationError({
        code: 'SERVICE_UNAVAILABLE',
        message: 'read unavailable',
        retryable: false,
        retryAfterSeconds: 11
      })
    )

    const response = await fixture.app.request('/api/v1/admin/questions')
    const body = apiFailureSchema.parse(await response.json())

    expect(response.status).toBe(503)
    expect(body).toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      retryable: true
    })
    expect(response.headers.get('Retry-After')).toBe('11')
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(response.headers.get('X-Request-Id')).toBe(body.requestId)
  })

  it.each([
    ['HEAD', '/api/v1/admin/questions'],
    ['GET', '/api/v1/admin/questions/short'],
    ['GET', '/api/v1/admin/questions/019D0000-0000-7000-8000-000000000001'],
    ['GET', '/api/v1/admin/questions/019d0000-0000-7000-8000-000000000001-'],
    ['GET', '/api/v1/admin/questions/00000000-0000-0000-8000-000000000000'],
    ['GET', '/api/v1/admin/questions/00000000-0000-f000-8000-000000000000'],
    ['GET', '/api/v1/admin/questions/'],
    ['GET', '/API/V1/ADMIN/questions']
  ])(
    '%s noncanonical %s is generic 404 before auth/capability/rate',
    async (method, pathname) => {
      const fixture = createFixture({ user: adminUser })
      const response = await fixture.app.request(pathname, { method })

      expect(response.status).toBe(404)
      expect(fixture.resolveAuthenticatedUser).not.toHaveBeenCalled()
      expect(fixture.assertCapability).not.toHaveBeenCalled()
      expect(fixture.consume).not.toHaveBeenCalled()
      expect(fixture.reader.listQuestions).not.toHaveBeenCalled()
    }
  )

  it.each([
    'ftp://localhost/api/v1/admin/questions',
    'custom://localhost/api/v1/admin/questions'
  ])(
    'absolute non-http request target %s is generic 404 before auth/capability/rate',
    async (requestTarget) => {
      const fixture = createFixture({ user: adminUser })
      const response = await fixture.app.fetch(new Request(requestTarget))

      expect(response.status).toBe(404)
      expect(fixture.resolveAuthenticatedUser).not.toHaveBeenCalled()
      expect(fixture.assertCapability).not.toHaveBeenCalled()
      expect(fixture.consume).not.toHaveBeenCalled()
      expect(fixture.reader.listQuestions).not.toHaveBeenCalled()
    }
  )

  it('canonical OPTIONS is answered by CORS without auth/capability/rate', async () => {
    const fixture = createFixture({ user: adminUser })
    const response = await fixture.app.request('/api/v1/admin/questions', {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:5173',
        'Access-Control-Request-Method': 'GET'
      }
    })

    expect(response.status).toBe(204)
    expect(fixture.resolveAuthenticatedUser).not.toHaveBeenCalled()
    expect(fixture.assertCapability).not.toHaveBeenCalled()
    expect(fixture.consume).not.toHaveBeenCalled()
  })
})

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { apiFailureSchema } from '@nihongo/contracts/common/error'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  AdminQuestionCommandService,
  AdminQuestionPublicationCommandService
} from '../admin/adminQuestionCommandService.js'
import type { AdminQuestionReader } from '../admin/adminQuestionService.js'
import { ApplicationError } from '../errors/applicationError.js'
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
  DATABASE_URL:
    'postgresql://nihongo_test_legacy_app_login:password@127.0.0.1:55432/nihongo_test',
  TRUSTED_ORIGINS: 'http://localhost:5173',
  BETTER_AUTH_SECRET: 'a'.repeat(32),
  GUEST_COOKIE_SECRET: 'b'.repeat(32),
  AUTH_EMAIL_FROM: 'auth@example.com'
})

const technicalAuthEnvironment = parseApiEnvironment({
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
  it('question read security dependency가 없으면 validation과 reader 전에 fail closed한다', async () => {
    const { logger } = createTestLogger()
    const gatedQuestionReader: QuestionReader = {
      getQuestion: vi.fn(),
      listQuestions: vi.fn()
    }
    const app = createApiApp({
      checkReadiness: vi.fn().mockResolvedValue(undefined),
      logger,
      questionReader: gatedQuestionReader
    })

    const [queryResponse, idResponse] = await Promise.all([
      app.request('/api/v1/questions?page=0'),
      app.request('/api/v1/questions/not-a-uuid')
    ])

    for (const response of [queryResponse, idResponse]) {
      const failure = apiFailureSchema.parse(await response.json())
      expect(response.status).toBe(503)
      expect(response.headers.get('Cache-Control')).toBe('private, no-store')
      expect(response.headers.get('Retry-After')).toBe('5')
      expect(response.headers.get('X-Request-Id')).toBe(failure.requestId)
      expect(failure).toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
        retryable: true
      })
    }
    expect(gatedQuestionReader.listQuestions).not.toHaveBeenCalled()
    expect(gatedQuestionReader.getQuestion).not.toHaveBeenCalled()
  })

  it.each([
    {
      pathname: '/api/v1/questions',
      expectedHeaders: ['Content-Type']
    },
    {
      pathname: '/api/v1/study-sessions',
      expectedHeaders: [
        'Content-Type',
        'Idempotency-Key',
        'X-Nihongo-Practice-Contract'
      ]
    },
    {
      pathname:
        '/api/v1/wrong-notes/019d0000-0000-7000-8000-000000000001/review-session',
      expectedHeaders: [
        'Content-Type',
        'Idempotency-Key',
        'X-Nihongo-Practice-Contract'
      ]
    }
  ])(
    'technical CORS $pathname의 method와 request header를 최소 권한으로 고정한다',
    async ({ expectedHeaders, pathname }) => {
      const { logger } = createTestLogger()
      const app = createApiApp({
        auth: {
          environment: technicalAuthEnvironment,
          gateway: { handle: vi.fn() },
          guestPrincipalService,
          principalService
        },
        checkReadiness: vi.fn().mockResolvedValue(undefined),
        logger,
        questionReader
      })

      const response = await app.request(pathname, {
        method: 'OPTIONS',
        headers: {
          'Access-Control-Request-Headers':
            'Content-Type, Idempotency-Key, X-Nihongo-Practice-Contract',
          'Access-Control-Request-Method': 'PATCH',
          Origin: 'http://localhost:5173'
        }
      })

      expect(response.status).toBe(204)
      expect(
        response.headers.get('Access-Control-Allow-Methods')?.split(',')
      ).toEqual(['DELETE', 'GET', 'OPTIONS', 'PATCH', 'POST', 'PUT'])
      expect(
        response.headers.get('Access-Control-Allow-Headers')?.split(',')
      ).toEqual(expectedHeaders)
      expect(
        response.headers.get('Access-Control-Expose-Headers')?.split(',')
      ).toEqual([
        'Content-Disposition',
        'Idempotency-Replayed',
        'Location',
        'Retry-After',
        'X-Request-Id',
        'X-Nihongo-Practice-Contract'
      ])
    }
  )

  it.each(['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'HEAD'])(
    'Phase 7 prefix를 %s에서도 CORS·practice authority 전에 generic 404로 닫는다',
    async (method) => {
      const { logger } = createTestLogger()
      const assertPracticeRuntimeAuthority = vi.fn()
      const gateway: AuthGateway = { handle: vi.fn() }
      const app = createApiApp({
        auth: {
          environment: authEnvironment,
          gateway,
          guestPrincipalService,
          principalService
        },
        assertPracticeRuntimeAuthority,
        checkReadiness: vi.fn().mockResolvedValue(undefined),
        logger,
        questionReader
      })
      const response = await app.request('/api/v1/admin/questions', {
        method,
        headers: { Origin: 'http://localhost:5173' }
      })

      expect(response.status).toBe(404)
      expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
      expect(response.headers.get('Cache-Control')).toBe('private, no-store')
      expect(assertPracticeRuntimeAuthority).not.toHaveBeenCalled()
      expect(gateway.handle).not.toHaveBeenCalled()

      if (method !== 'HEAD') {
        const failure = apiFailureSchema.parse(await response.json())
        expect(failure.code).toBe('RESOURCE_NOT_FOUND')
      }
    }
  )

  it('Phase 7 decoded prefix alias도 조기 차단한다', async () => {
    const { logger } = createTestLogger()
    const assertPracticeRuntimeAuthority = vi.fn()
    const app = createApiApp({
      auth: {
        environment: authEnvironment,
        gateway: { handle: vi.fn() },
        guestPrincipalService,
        principalService
      },
      assertPracticeRuntimeAuthority,
      checkReadiness: vi.fn().mockResolvedValue(undefined),
      logger,
      questionReader
    })
    const response = await app.request('/api/v1/%71uestion-reports', {
      headers: { Origin: 'http://localhost:5173' }
    })

    expect(response.status).toBe(404)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
    expect(assertPracticeRuntimeAuthority).not.toHaveBeenCalled()
  })

  it.each([
    {
      canonicalUrl: 'http://localhost:3001/api/v1/admin/questions',
      rawTarget: String.raw`http://localhost:3001\api\v1\admin\questions`
    },
    {
      canonicalUrl:
        'http://localhost:3001/api/v1/question-reports/019d0000-0000-7000-8000-000000000001',
      rawTarget: String.raw`http:\\localhost:3001\api\v1\question-reports\019d0000-0000-7000-8000-000000000001`
    },
    {
      canonicalUrl: 'http://localhost:3001/api/v1/admin/questions',
      rawTarget: String.raw`http:/\localhost:3001\api\v1\admin\questions`
    }
  ])(
    'absolute-form backslash Phase 7 alias $rawTarget를 조기 차단한다',
    async ({ canonicalUrl, rawTarget }) => {
      const { logger } = createTestLogger()
      const assertPracticeRuntimeAuthority = vi.fn()
      const checkReadiness = vi.fn().mockResolvedValue(undefined)
      const gateway: AuthGateway = { handle: vi.fn() }
      const listQuestions = vi.fn().mockResolvedValue({
        items: [],
        page: 1,
        pageSize: 20,
        total: 0
      })
      const app = createApiApp({
        auth: {
          environment: authEnvironment,
          gateway,
          guestPrincipalService,
          principalService
        },
        assertPracticeRuntimeAuthority,
        checkReadiness,
        logger,
        questionReader: { ...questionReader, listQuestions }
      })

      const response = await app.fetch(
        new Request(canonicalUrl, {
          headers: { Origin: 'http://localhost:5173' }
        }),
        { incoming: { url: rawTarget } } as never
      )

      expect(response.status).toBe(404)
      expect(response.headers.get('Cache-Control')).toBe('private, no-store')
      expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
      expect(apiFailureSchema.parse(await response.json()).code).toBe(
        'RESOURCE_NOT_FOUND'
      )
      expect(checkReadiness).not.toHaveBeenCalled()
      expect(assertPracticeRuntimeAuthority).not.toHaveBeenCalled()
      expect(gateway.handle).not.toHaveBeenCalled()
      expect(listQuestions).not.toHaveBeenCalled()
    }
  )

  it.each([
    '/api/v1/admin/../questions',
    '/api/v1/admin/%2e%2e/questions',
    '/api/v1/%252561dmin/questions',
    '/api/v1/%61dmin/%ZZ',
    '/api/v1/%71uestion-reports/%ZZ'
  ])(
    'adapter가 보존한 raw Phase 7 alias %s를 조기 차단한다',
    async (rawUrl) => {
      const { logger } = createTestLogger()
      const assertPracticeRuntimeAuthority = vi.fn()
      const listQuestions = vi.fn().mockResolvedValue({
        items: [],
        page: 1,
        pageSize: 20,
        total: 0
      })
      const app = createApiApp({
        auth: {
          environment: authEnvironment,
          gateway: { handle: vi.fn() },
          guestPrincipalService,
          principalService
        },
        assertPracticeRuntimeAuthority,
        checkReadiness: vi.fn().mockResolvedValue(undefined),
        logger,
        questionReader: { ...questionReader, listQuestions }
      })

      const response = await app.fetch(
        new Request('http://localhost:3001/api/v1/questions'),
        { incoming: { url: rawUrl } } as never
      )

      expect(response.status).toBe(404)
      expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
      expect(assertPracticeRuntimeAuthority).not.toHaveBeenCalled()
      expect(listQuestions).not.toHaveBeenCalled()
    }
  )

  it.each([
    {
      canonicalUrl: 'http://localhost:3001/health/live',
      rawTarget: '/api/v1/admin/../../../health/live'
    },
    {
      canonicalUrl: 'http://localhost:3001/health/ready',
      rawTarget:
        'http://localhost:3001/api/v1/question-reports/../../../health/ready'
    },
    {
      canonicalUrl: 'http://localhost:3001/health/ready',
      rawTarget: '/api/v1/%61dmin/%2e%2e/%2e%2e/%2e%2e/health/ready'
    },
    {
      canonicalUrl: 'http://localhost:3001/health/live',
      rawTarget: String.raw`http://localhost:3001\api\v1\admin\..\..\..\health\live`
    },
    {
      canonicalUrl: 'http://localhost:3001/health/ready',
      rawTarget: String.raw`http:\\localhost:3001\api\v1\question-reports\..\..\..\health\ready`
    },
    {
      canonicalUrl: 'http://localhost:3001/health/ready',
      rawTarget: String.raw`http:/\localhost:3001\api\v1\admin\..\..\..\health\ready`
    }
  ])(
    'health로 정규화된 raw Phase 7 alias $rawTarget도 health handler 전에 닫는다',
    async ({ canonicalUrl, rawTarget }) => {
      const { logger } = createTestLogger()
      const checkReadiness = vi.fn().mockResolvedValue(undefined)
      const gateway: AuthGateway = { handle: vi.fn() }
      const app = createApiApp({
        auth: {
          environment: authEnvironment,
          gateway,
          guestPrincipalService,
          principalService
        },
        checkReadiness,
        logger,
        questionReader
      })

      const response = await app.fetch(new Request(canonicalUrl), {
        incoming: { url: rawTarget }
      } as never)

      expect(response.status).toBe(404)
      expect(response.headers.get('Cache-Control')).toBe('private, no-store')
      expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
      expect(apiFailureSchema.parse(await response.json()).code).toBe(
        'RESOURCE_NOT_FOUND'
      )
      expect(checkReadiness).not.toHaveBeenCalled()
      expect(gateway.handle).not.toHaveBeenCalled()
    }
  )

  it('adapter raw auth target을 gateway까지 보존한다', async () => {
    const { logger } = createTestLogger()
    const handle = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }))
    const app = createApiApp({
      auth: {
        environment: authEnvironment,
        gateway: { handle },
        guestPrincipalService,
        principalService
      },
      checkReadiness: vi.fn().mockResolvedValue(undefined),
      logger,
      questionReader
    })
    const rawUrl = '/api/auth/foo/../reset-password'

    await app.fetch(
      new Request('http://localhost:3001/api/auth/reset-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost:5173'
        },
        body: '{}'
      }),
      { incoming: { url: rawUrl } } as never
    )

    expect(handle).toHaveBeenCalledOnce()
    expect(handle.mock.calls[0]?.[2]).toBe(rawUrl)
  })

  it('live 응답과 유효한 request ID를 보존한다', async () => {
    const requestId = randomUUID()
    const releaseId = '1234567890abcdef1234567890abcdef12345678'
    const { logger } = createTestLogger()
    const app = createApiApp({
      checkReadiness: vi.fn().mockResolvedValue(undefined),
      logger,
      questionReader,
      releaseId
    })
    const response = await app.request('/health/live', {
      headers: { 'X-Request-Id': requestId }
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('X-Request-Id')).toBe(requestId)
    expect(response.headers.get('X-Release-Id')).toBe(releaseId)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
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
    expect(response.headers.get('X-Release-Id')).toBe(
      '0000000000000000000000000000000000000000'
    )
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

describe('protected admin artifact and API composition', () => {
  const directories: string[] = []
  afterEach(() => {
    for (const root of directories)
      rmSync(root, { recursive: true, force: true })
    directories.length = 0
  })
  const fixture = ({
    role = 'ADMIN',
    fresh = true,
    cms = true,
    production = false
  }: {
    role?: 'ADMIN' | 'USER' | null
    fresh?: boolean
    cms?: boolean
    production?: boolean
  } = {}) => {
    const directory = mkdtempSync(join(tmpdir(), 'nihongo-admin-composition-'))
    directories.push(directory)
    const web = join(directory, 'web')
    const adminRoot = join(directory, 'admin')
    const releaseId = '2'.repeat(40)
    for (const root of [web, adminRoot])
      mkdirSync(join(root, 'assets'), { recursive: true })
    const html = (label: string) =>
      `<html><head><meta name="nihongo-release-id" content="${releaseId}"></head><body>${label}</body></html>`
    writeFileSync(join(web, 'index.html'), html('LEARNER_ONLY'))
    writeFileSync(join(adminRoot, 'index.html'), html('ADMIN_HTML_ONLY'))
    writeFileSync(join(adminRoot, 'assets/admin.js'), 'ADMIN_ASSET_ONLY')
    const user = role
      ? {
          id: '11111111-1111-4111-8111-111111111111',
          name: 'Fixture',
          role,
          targetLevel: null
        }
      : null
    const resolve = vi.fn<PrincipalService['resolveAuthenticatedUser']>(
      async () => ({
        clearSessionCookie: false,
        headers: new Headers(),
        user,
        ...(user
          ? {
              phase7Session: {
                id: '22222222-2222-4222-8222-222222222222',
                token: 'test-session-only',
                createdAt: new Date(0),
                expiresAt: new Date(60_000),
                isFresh: fresh
              }
            }
          : {})
      })
    )
    const capability = vi.fn(async () => undefined)
    const readLimit = vi.fn(async () => undefined)
    const commandLimit = vi.fn(async () => undefined)
    const approve = vi.fn()
    const listQuestions = vi.fn(async () => ({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0
    }))
    const app = createApiApp({
      webAssetsDirectory: web,
      adminAssetsDirectory: adminRoot,
      releaseId,
      checkReadiness: async () => undefined,
      logger: createJsonLogger('silent'),
      questionReader,
      auth: {
        environment: {
          ...(cms ? technicalAuthEnvironment : authEnvironment),
          ...(production ? { NODE_ENV: 'production' as const } : {})
        },
        gateway: { handle: vi.fn() },
        guestPrincipalService,
        principalService: {
          resolveAuthenticatedUser: resolve,
          getAuthenticatedUser: async () => user
        }
      },
      admin: {
        assertCapability: capability,
        rateLimiter: { consume: readLimit },
        reader: { listQuestions } as unknown as AdminQuestionReader,
        commands: {
          rateLimiter: { consume: commandLimit },
          service: {
            approveVersion: approve
          } as unknown as AdminQuestionCommandService &
            AdminQuestionPublicationCommandService
        }
      }
    })
    return {
      app,
      resolve,
      capability,
      readLimit,
      commandLimit,
      approve,
      listQuestions
    }
  }

  it.each([
    { role: null, status: 401, code: 'AUTHENTICATION_REQUIRED' },
    { role: 'USER' as const, status: 403, code: 'ADMIN_REQUIRED' }
  ])(
    'denies $role direct HTML, assets, fallback and API access without private bytes',
    async ({ role, status, code }) => {
      const f = fixture({ role })
      for (const path of [
        '/admin',
        '/admin/questions/123/edit',
        '/admin/assets/admin.js',
        '/api/v1/admin/questions'
      ]) {
        const response = await f.app.request(path)
        expect(response.status).toBe(status)
        expect(response.headers.get('Cache-Control')).toBe('private, no-store')
        const body = await response.text()
        expect(body).not.toContain('ADMIN_HTML_ONLY')
        expect(body).not.toContain('ADMIN_ASSET_ONLY')
        expect(JSON.parse(body).code).toBe(code)
      }
      expect(f.capability).not.toHaveBeenCalled()
      expect(f.readLimit).not.toHaveBeenCalled()
      expect(f.listQuestions).not.toHaveBeenCalled()
    }
  )

  it('allows current ADMIN static paths and the unchanged read API with existing read guards', async () => {
    const f = fixture()
    for (const path of [
      '/admin',
      '/admin/questions/123/edit',
      '/admin/assets/admin.js'
    ]) {
      const response = await f.app.request(path, {
        headers: { 'X-Forwarded-For': '192.0.2.99' }
      })
      expect(response.status).toBe(200)
      expect(await response.text()).toContain(
        path.endsWith('.js') ? 'ADMIN_ASSET_ONLY' : 'ADMIN_HTML_ONLY'
      )
      expect(response.headers.get('Cache-Control')).toBe('private, no-store')
      expect(response.headers.get('Vary')).toBe('Cookie, Authorization')
    }
    const read = await f.app.request('/api/v1/admin/questions')
    expect(read.status).toBe(200)
    expect(await read.json()).toEqual({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0
    })
    expect(f.capability).toHaveBeenCalledTimes(4)
    expect(f.readLimit).toHaveBeenCalledTimes(4)
    expect(f.readLimit).toHaveBeenCalledWith({
      actorId: '11111111-1111-4111-8111-111111111111',
      clientIp: 'unresolved'
    })
    expect(f.listQuestions).toHaveBeenCalledOnce()
  })

  it('keeps CMS disabled for static HTML/assets and direct API even for an authenticated ADMIN', async () => {
    const f = fixture({ cms: false })
    for (const path of [
      '/admin',
      '/admin/questions',
      '/admin/assets/admin.js',
      '/api/v1/admin/questions'
    ]) {
      const response = await f.app.request(path)
      expect(response.status).toBe(404)
      expect(response.headers.get('Cache-Control')).toBe('private, no-store')
      expect(await response.text()).not.toContain('ADMIN_')
    }
    expect(f.resolve).not.toHaveBeenCalled()
    expect(f.capability).not.toHaveBeenCalled()
    expect(f.readLimit).not.toHaveBeenCalled()
  })

  it.each([false, true])(
    'keeps production admin HTML/assets and API closed even with CMS=%s',
    async (cms) => {
      const f = fixture({ cms, production: true })
      for (const path of [
        '/admin',
        '/admin/questions/123/edit',
        '/admin/assets/admin.js',
        '/api/v1/admin/questions'
      ]) {
        const response = await f.app.request(path)
        expect(response.status).toBe(404)
        expect(response.headers.get('Cache-Control')).toBe('private, no-store')
        const body = await response.text()
        expect(body).not.toContain('ADMIN_')
        expect(body).not.toContain('LEARNER_ONLY')
      }
      expect(f.resolve).not.toHaveBeenCalled()
      expect(f.capability).not.toHaveBeenCalled()
      expect(f.readLimit).not.toHaveBeenCalled()
    }
  )

  it('rechecks a revoked session on a conditional asset request instead of using cached ADMIN bytes', async () => {
    const f = fixture()
    const allowed = await f.app.request('/admin/assets/admin.js')
    expect(allowed.status).toBe(200)
    await allowed.text()
    f.resolve.mockResolvedValueOnce({
      clearSessionCookie: true,
      headers: new Headers(),
      user: null
    })
    const denied = await f.app.request('/admin/assets/admin.js', {
      headers: {
        'If-None-Match': 'old-admin',
        'If-Modified-Since': new Date().toUTCString(),
        Range: 'bytes=0-4'
      }
    })
    expect(denied.status).toBe(401)
    expect(denied.headers.get('Cache-Control')).toBe('private, no-store')
    expect(denied.headers.get('Set-Cookie')).toContain('Max-Age=0')
    expect(await denied.text()).not.toContain('ADMIN_ASSET_ONLY')
    expect(f.readLimit).toHaveBeenCalledOnce()
  })

  it('keeps capability failures and read rate limits closed before reading admin files', async () => {
    const f = fixture()
    f.capability.mockRejectedValueOnce(new Error('unavailable fixture'))
    const unavailable = await f.app.request('/admin')
    expect(unavailable.status).toBe(503)
    expect(unavailable.headers.get('Retry-After')).toBe('5')
    expect(await unavailable.text()).not.toContain('ADMIN_HTML_ONLY')
    expect(f.readLimit).not.toHaveBeenCalled()
    f.readLimit.mockRejectedValueOnce(
      new ApplicationError({
        code: 'RATE_LIMITED',
        message: 'fixture limit',
        retryable: true,
        retryAfterSeconds: 7
      })
    )
    const limited = await f.app.request('/admin/assets/admin.js')
    expect(limited.status).toBe(429)
    expect(limited.headers.get('Retry-After')).toBe('7')
    expect(limited.headers.get('Cache-Control')).toBe('private, no-store')
    expect(await limited.text()).not.toContain('ADMIN_ASSET_ONLY')
  })

  const commandPath =
    '/api/v1/admin/question-versions/33333333-3333-4333-8333-333333333333/approval'
  it('does not let a successful admin HTML read replace fresh SSO for sensitive direct commands', async () => {
    const f = fixture({ fresh: false })
    const html = await f.app.request('/admin')
    expect(html.status).toBe(200)
    await html.text()
    const response = await f.app.request(commandPath, {
      method: 'POST',
      headers: {
        Origin: 'http://localhost:5173',
        'Content-Type': 'application/json'
      },
      body: '{}'
    })
    expect(response.status).toBe(401)
    expect(apiFailureSchema.parse(await response.json()).code).toBe(
      'FRESH_ASSURANCE_REQUIRED'
    )
    expect(f.commandLimit).not.toHaveBeenCalled()
    expect(f.approve).not.toHaveBeenCalled()
  })

  it.each([
    {
      headers: {
        Origin: 'http://localhost:5173',
        'Content-Type': 'text/plain'
      },
      code: 'INVALID_REQUEST'
    },
    {
      headers: {
        Origin: 'https://foreign.example.test',
        'Content-Type': 'application/json'
      },
      code: 'UNTRUSTED_ORIGIN'
    }
  ])(
    'preserves $code validation on fresh ADMIN direct commands',
    async ({ headers, code }) => {
      const f = fixture()
      const response = await f.app.request(commandPath, {
        method: 'POST',
        headers,
        body: '{}'
      })
      expect(apiFailureSchema.parse(await response.json()).code).toBe(code)
      expect(f.commandLimit).not.toHaveBeenCalled()
      expect(f.approve).not.toHaveBeenCalled()
    }
  )

  it('retains the command limiter before downstream payload validation with fresh trusted JSON', async () => {
    const f = fixture()
    const response = await f.app.request(commandPath, {
      method: 'POST',
      headers: {
        Origin: 'http://localhost:5173',
        'Content-Type': 'application/json'
      },
      body: '{}'
    })
    expect(apiFailureSchema.parse(await response.json()).code).toBe(
      'VALIDATION_ERROR'
    )
    expect(f.commandLimit).toHaveBeenCalledOnce()
    expect(f.approve).not.toHaveBeenCalled()
  })
})

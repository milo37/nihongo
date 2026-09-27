import type {
  AdminQuestionMutationResult,
  CreateAdminQuestionRequest,
  UpdateQuestionVersionRequest
} from '@nihongo/contracts/admin/phase7'
import { phase7DormantAfterSlice3AOperationManifest } from '@nihongo/contracts/admin/phase7'
import { apiFailureSchema } from '@nihongo/contracts/common/error'
import { describe, expect, it, vi } from 'vitest'
import type { AdminCommandRateLimiter } from '../admin/adminCommandRateLimiter.js'
import type { AdminQuestionCommandService } from '../admin/adminQuestionCommandService.js'
import type { AdminQuestionReader } from '../admin/adminQuestionService.js'
import type { AdminReadRateLimiter } from '../admin/adminReadRateLimiter.js'
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

const questionId = '019d0000-0000-7000-8000-000000000003'
const versionId = '019d0000-0000-7000-8000-000000000004'
const requestId = '019d0000-0000-7000-8000-000000000005'
const sessionId = '019d0000-0000-7000-8000-000000000006'
const reportId = '019d0000-0000-7000-8000-000000000007'
const optionIds = [
  '019d0000-0000-7000-8000-000000000011',
  '019d0000-0000-7000-8000-000000000012',
  '019d0000-0000-7000-8000-000000000013',
  '019d0000-0000-7000-8000-000000000014'
] as const
const content: CreateAdminQuestionRequest = {
  level: 'N5',
  subject: 'GRAMMAR',
  questionType: 'GRAMMAR_SELECT',
  difficulty: 'NORMAL',
  questionText: '빈칸에 알맞은 표현을 고르세요.',
  passage: null,
  explanationKo: '문법 설명입니다.',
  explanationJa: null,
  tagNames: ['문법'],
  options: [
    { clientOptionKey: 'a', text: 'です' },
    { clientOptionKey: 'b', text: 'ます' },
    { clientOptionKey: 'c', text: 'でした' },
    { clientOptionKey: 'd', text: 'ません' }
  ],
  correctOptionKey: 'a'
}
const update: UpdateQuestionVersionRequest = {
  level: content.level,
  subject: content.subject,
  questionType: content.questionType,
  difficulty: content.difficulty,
  questionText: content.questionText,
  passage: content.passage,
  explanationKo: content.explanationKo,
  explanationJa: content.explanationJa,
  tagNames: content.tagNames,
  options: content.options.map((option, index) => ({
    id: optionIds[index]!,
    ordinal: index + 1,
    text: option.text
  })),
  correctOptionId: optionIds[0],
  expectedRowVersion: 1
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
type ResolvedUser = Awaited<
  ReturnType<PrincipalService['resolveAuthenticatedUser']>
>['user']

const mutationResult = (
  status: AdminQuestionMutationResult['versionStatus'],
  rowVersion: number,
  overrides: Partial<AdminQuestionMutationResult> = {}
): AdminQuestionMutationResult => ({
  questionId,
  questionVersionId: versionId,
  lifecycleStatus: 'ACTIVE',
  versionStatus: status,
  questionRowVersion: 1,
  versionRowVersion: rowVersion,
  occurredAt: '2026-09-06T00:00:00.000Z',
  ...overrides
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
const reader: AdminQuestionReader = {
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
}

const createFixture = ({
  adminAuthorityFailure,
  capabilityError,
  clearSessionCookie = false,
  rateError,
  user = adminUser
}: {
  adminAuthorityFailure?: 'ADMIN_REQUIRED' | 'AUTH_SESSION_EXPIRED'
  capabilityError?: unknown
  clearSessionCookie?: boolean
  rateError?: unknown
  user?: ResolvedUser
} = {}) => {
  const commandService: AdminQuestionCommandService = {
    createQuestion: vi.fn(async () => mutationResult('DRAFT', 1)),
    createVersion: vi.fn(async (_authority, targetQuestionId) =>
      mutationResult('DRAFT', 1, {
        questionId: targetQuestionId,
        questionRowVersion: 2
      })
    ),
    updateVersion: vi.fn(async (_authority, targetVersionId, request) =>
      mutationResult('DRAFT', request.expectedRowVersion + 1, {
        questionVersionId: targetVersionId
      })
    ),
    requestReview: vi.fn(async (_authority, targetVersionId, request) =>
      mutationResult('IN_REVIEW', request.expectedRowVersion + 1, {
        questionVersionId: targetVersionId
      })
    ),
    requestChanges: vi.fn(async (_authority, targetVersionId, request) =>
      mutationResult('CHANGES_REQUESTED', request.expectedRowVersion + 1, {
        questionVersionId: targetVersionId
      })
    ),
    approveVersion: vi.fn(async (_authority, targetVersionId, request) =>
      mutationResult('APPROVED', request.expectedRowVersion + 1, {
        questionVersionId: targetVersionId
      })
    ),
    withdrawApproval: vi.fn(async (_authority, targetVersionId, request) =>
      mutationResult('CHANGES_REQUESTED', request.expectedRowVersion + 1, {
        questionVersionId: targetVersionId
      })
    )
  }
  const consume = vi.fn(async () => {
    if (rateError !== undefined) throw rateError
  })
  const assertCapability = vi.fn(async () => {
    if (capabilityError !== undefined) throw capabilityError
  })
  const resolutionHeaders = new Headers()
  const resolveAuthenticatedUser = vi.fn(async () => ({
    ...(adminAuthorityFailure === undefined ? {} : { adminAuthorityFailure }),
    clearSessionCookie,
    headers: resolutionHeaders,
    ...(user === null
      ? {}
      : {
          phase7Session: {
            id: sessionId,
            token: 'phase7-session-token',
            createdAt: new Date('2026-09-06T00:00:00.000Z'),
            expiresAt: new Date('2026-09-07T00:00:00.000Z'),
            isFresh: true
          }
        }),
    user
  }))
  const principalService: PrincipalService = {
    resolveAuthenticatedUser,
    getAuthenticatedUser: vi.fn(async () => user)
  }
  const readRateLimiter: AdminReadRateLimiter = { consume: vi.fn() }
  const commandRateLimiter: AdminCommandRateLimiter = { consume }
  const app = createApiApp({
    admin: {
      assertCapability,
      commands: {
        rateLimiter: commandRateLimiter,
        service: commandService
      },
      rateLimiter: readRateLimiter,
      reader
    },
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
    commandService,
    consume,
    resolveAuthenticatedUser
  }
}

const commandHeaders = (additional?: Record<string, string>): Headers => {
  const headers = new Headers(additional)
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  if (!headers.has('Origin')) {
    headers.set('Origin', environment.TRUSTED_ORIGINS[0]!)
  }
  headers.set('X-Request-Id', requestId)
  return headers
}

const materializeManifestPath = (path: string): string =>
  path
    .replace(':questionId', questionId)
    .replace(':versionId', versionId)
    .replace(':reportId', reportId)

describe('Phase 7 Slice 3 ADMIN command routing', () => {
  it.each([
    [
      'POST',
      '/api/v1/admin/questions',
      content,
      'createQuestion',
      201,
      'ADMIN_EDIT'
    ],
    [
      'POST',
      `/api/v1/admin/questions/${questionId}/versions`,
      { ...content, expectedQuestionRowVersion: 1 },
      'createVersion',
      201,
      'ADMIN_EDIT'
    ],
    [
      'PATCH',
      `/api/v1/admin/question-versions/${versionId}`,
      update,
      'updateVersion',
      200,
      'ADMIN_EDIT'
    ],
    [
      'POST',
      `/api/v1/admin/question-versions/${versionId}/review-request`,
      { expectedRowVersion: 1 },
      'requestReview',
      200,
      'ADMIN_EDIT'
    ],
    [
      'POST',
      `/api/v1/admin/question-versions/${versionId}/change-request`,
      { expectedRowVersion: 1, reason: '해설 보완' },
      'requestChanges',
      200,
      'ADMIN_EDIT'
    ]
  ] as const)(
    '%s %s dispatches %s with the canonical rate group',
    async (method, pathname, body, serviceMethod, status, group) => {
      const fixture = createFixture()
      const response = await fixture.app.request(pathname, {
        method,
        headers: commandHeaders(),
        body: JSON.stringify(body)
      })

      expect(response.status).toBe(status)
      expect(response.headers.get('Cache-Control')).toBe('private, no-store')
      expect(response.headers.get('X-Request-Id')).toBe(requestId)
      expect(fixture.consume).toHaveBeenCalledWith({
        actorId: adminUser.id,
        clientIp: 'unresolved',
        group
      })
      expect(fixture.resolveAuthenticatedUser).toHaveBeenCalledWith(
        expect.any(Headers),
        {
          classifyAdminAuthorityLoss: true,
          refreshRememberedSession: true
        }
      )
      expect(fixture.commandService[serviceMethod]).toHaveBeenCalledTimes(1)
      expect(
        vi.mocked(fixture.commandService[serviceMethod]).mock.calls[0]?.[0]
      ).toEqual({
        actorId: adminUser.id,
        rawSessionToken: 'phase7-session-token',
        requestId
      })
    }
  )

  it.each([
    ['/api/v1/admin/questions', 256 * 1024 + 1],
    [
      `/api/v1/admin/question-versions/${versionId}/review-request`,
      16 * 1024 + 1
    ]
  ] as const)(
    'declared oversize %s stops before session resolution',
    async (pathname, size) => {
      const fixture = createFixture({ user: null })
      const response = await fixture.app.request(pathname, {
        method: 'POST',
        headers: commandHeaders({ 'Content-Length': String(size) }),
        body: '{}'
      })

      expect(response.status).toBe(413)
      expect(apiFailureSchema.parse(await response.json()).code).toBe(
        'REQUEST_TOO_LARGE'
      )
      expect(fixture.resolveAuthenticatedUser).not.toHaveBeenCalled()
    }
  )

  it('role/account-loss evidence는 initial command guard에서 exact 403으로 닫는다', async () => {
    const fixture = createFixture({
      adminAuthorityFailure: 'ADMIN_REQUIRED',
      clearSessionCookie: true,
      user: null
    })

    const response = await fixture.app.request('/api/v1/admin/questions', {
      method: 'POST',
      headers: commandHeaders(),
      body: JSON.stringify(content)
    })

    expect(response.status).toBe(403)
    expect(apiFailureSchema.parse(await response.json()).code).toBe(
      'ADMIN_REQUIRED'
    )
    expect(fixture.assertCapability).not.toHaveBeenCalled()
    expect(fixture.consume).not.toHaveBeenCalled()
  })

  it.each([
    [null, false, 'AUTHENTICATION_REQUIRED', 401],
    [null, true, 'AUTH_SESSION_EXPIRED', 401],
    [regularUser, false, 'ADMIN_REQUIRED', 403]
  ] as const)(
    'session/role failure %s closes before capability and rate',
    async (user, clearSessionCookie, expectedCode, status) => {
      const fixture = createFixture({ clearSessionCookie, user })
      const response = await fixture.app.request('/api/v1/admin/questions', {
        method: 'POST',
        headers: commandHeaders(),
        body: JSON.stringify(content)
      })

      expect(response.status).toBe(status)
      expect(apiFailureSchema.parse(await response.json()).code).toBe(
        expectedCode
      )
      expect(fixture.assertCapability).not.toHaveBeenCalled()
      expect(fixture.consume).not.toHaveBeenCalled()
      expect(fixture.commandService.createQuestion).not.toHaveBeenCalled()
    }
  )

  it('rewraps an untagged capability ApplicationError as retryable NO_TX 503', async () => {
    const fixture = createFixture({
      capabilityError: new ApplicationError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'untyped capability failure',
        retryable: false
      })
    })
    const response = await fixture.app.request('/api/v1/admin/questions', {
      method: 'POST',
      headers: commandHeaders(),
      body: JSON.stringify(content)
    })
    const failure = apiFailureSchema.parse(await response.json())

    expect(response.status).toBe(503)
    expect(failure).toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      retryable: true
    })
    expect(response.headers.get('Retry-After')).toBe('5')
    expect(fixture.consume).not.toHaveBeenCalled()
    expect(fixture.commandService.createQuestion).not.toHaveBeenCalled()
  })

  it.each([
    [
      { 'Content-Type': 'text/plain', Origin: environment.TRUSTED_ORIGINS[0]! },
      'INVALID_REQUEST'
    ],
    [
      { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
      'UNTRUSTED_ORIGIN'
    ],
    [
      {
        'Content-Encoding': 'gzip',
        'Content-Type': 'application/json',
        Origin: environment.TRUSTED_ORIGINS[0]!
      },
      'INVALID_REQUEST'
    ]
  ] as const)(
    'transport/origin failure %s stops before rate',
    async (headers, expectedCode) => {
      const fixture = createFixture()
      const response = await fixture.app.request('/api/v1/admin/questions', {
        method: 'POST',
        headers,
        body: JSON.stringify(content)
      })

      expect(apiFailureSchema.parse(await response.json()).code).toBe(
        expectedCode
      )
      expect(fixture.consume).not.toHaveBeenCalled()
      expect(fixture.commandService.createQuestion).not.toHaveBeenCalled()
    }
  )

  it('rate rejection wins before duplicate-key JSON parsing', async () => {
    const fixture = createFixture({
      rateError: new ApplicationError({
        code: 'RATE_LIMITED',
        message: 'too many',
        retryable: true,
        retryAfterSeconds: 17,
        phase7Disposition: 'NO_TX'
      })
    })
    const response = await fixture.app.request('/api/v1/admin/questions', {
      method: 'POST',
      headers: commandHeaders(),
      body: '{"questionText":"first","questionText":"second"}'
    })

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('17')
    expect(apiFailureSchema.parse(await response.json()).code).toBe(
      'RATE_LIMITED'
    )
    expect(fixture.commandService.createQuestion).not.toHaveBeenCalled()
  })

  it('strict query and duplicate-key JSON fail only after the shared rate gate', async () => {
    const queryFixture = createFixture()
    const queryResponse = await queryFixture.app.request(
      '/api/v1/admin/questions?unknown=1',
      {
        method: 'POST',
        headers: commandHeaders(),
        body: JSON.stringify(content)
      }
    )
    expect(queryResponse.status).toBe(422)
    expect(queryFixture.consume).toHaveBeenCalledTimes(1)
    expect(queryFixture.commandService.createQuestion).not.toHaveBeenCalled()

    const jsonFixture = createFixture()
    const jsonResponse = await jsonFixture.app.request(
      '/api/v1/admin/questions',
      {
        method: 'POST',
        headers: commandHeaders(),
        body: '{"questionText":"first","questionText":"second"}'
      }
    )
    expect(jsonResponse.status).toBe(400)
    expect(apiFailureSchema.parse(await jsonResponse.json()).code).toBe(
      'INVALID_JSON'
    )
    expect(jsonFixture.consume).toHaveBeenCalledTimes(1)
    expect(jsonFixture.commandService.createQuestion).not.toHaveBeenCalled()
  })

  it.each([
    ['HEAD', '/api/v1/admin/questions'],
    ['POST', '/api/v1/admin/questions#alias'],
    ['POST', `/api/v1/%${'25'.repeat(32)}61dmin/questions`],
    ['POST', '/api/v1/admin/questions/short/versions'],
    ['POST', `/api/v1/admin/question-versions/${versionId}/approval`],
    [
      'POST',
      `/api/v1/admin/question-versions/${versionId}/approval-withdrawal`
    ],
    ['POST', '/api/v1/admin/reauthentication'],
    [
      'POST',
      '/api/v1/admin/question-versions/019D0000-0000-7000-8000-000000000004/approval'
    ],
    ['POST', `/api/v1/admin/question-versions/${versionId}/publication`],
    ['POST', '/api/v1/admin/question']
  ] as const)(
    '%s noncanonical or dormant %s is generic 404 before auth',
    async (method, pathname) => {
      const fixture = createFixture()
      const response = await fixture.app.request(pathname, { method })

      expect(response.status).toBe(404)
      expect(fixture.resolveAuthenticatedUser).not.toHaveBeenCalled()
      expect(fixture.assertCapability).not.toHaveBeenCalled()
      expect(fixture.consume).not.toHaveBeenCalled()
      expect(fixture.commandService.approveVersion).not.toHaveBeenCalled()
      expect(fixture.commandService.withdrawApproval).not.toHaveBeenCalled()
      expect(response.headers.get('Set-Cookie')).toBeNull()
    }
  )

  it('manifest의 dormant 15개 전부를 auth/service/DB/cookie 전에 generic 404로 닫는다', async () => {
    const fixture = createFixture()
    const readerCallsBefore = Object.values(reader).map(
      (read) => vi.mocked(read).mock.calls.length
    )

    expect(phase7DormantAfterSlice3AOperationManifest).toHaveLength(15)
    for (const entry of phase7DormantAfterSlice3AOperationManifest) {
      const response = await fixture.app.request(
        materializeManifestPath(entry.path),
        {
          method: entry.method,
          headers: commandHeaders(),
          ...(entry.method === 'GET' ? {} : { body: '{}' })
        }
      )

      expect(response.status, entry.operation).toBe(404)
      expect(apiFailureSchema.parse(await response.json())).toMatchObject({
        code: 'RESOURCE_NOT_FOUND',
        message: '요청한 경로를 찾을 수 없습니다.',
        retryable: false
      })
      expect(response.headers.get('Retry-After')).toBeNull()
      expect(response.headers.get('Set-Cookie')).toBeNull()
    }

    expect(fixture.resolveAuthenticatedUser).not.toHaveBeenCalled()
    expect(fixture.assertCapability).not.toHaveBeenCalled()
    expect(fixture.consume).not.toHaveBeenCalled()
    for (const service of Object.values(fixture.commandService)) {
      expect(service).not.toHaveBeenCalled()
    }
    expect(
      Object.values(reader).map((read) => vi.mocked(read).mock.calls.length)
    ).toEqual(readerCallsBefore)
  })

  it.each(
    [
      `/api/v1/admin/question-versions/${versionId}/publication`,
      `/api/v1/admin/question-versions/${versionId}/retirement`,
      `/api/v1/admin/questions/${questionId}/archive`
    ].flatMap((canonicalPath) => [
      ['POST', canonicalPath],
      ['GET', canonicalPath],
      ['POST', `${canonicalPath}/`],
      ['POST', canonicalPath.replace('019d', '019D')],
      ['POST', `${canonicalPath}#alias`]
    ]) as readonly (readonly [string, string])[]
  )(
    '%s Slice 4P dormant alias %s is exact generic 404 with every caller at zero',
    async (method, pathname) => {
      const fixture = createFixture()
      const readerCallsBefore = Object.values(reader).map(
        (read) => vi.mocked(read).mock.calls.length
      )
      const response = await fixture.app.request(pathname, {
        method,
        headers: commandHeaders(),
        ...(method === 'GET' ? {} : { body: '{}' })
      })

      expect(response.status).toBe(404)
      expect(apiFailureSchema.parse(await response.json())).toEqual({
        code: 'RESOURCE_NOT_FOUND',
        message: '요청한 경로를 찾을 수 없습니다.',
        requestId,
        retryable: false
      })
      expect(response.headers.get('Cache-Control')).toBe('private, no-store')
      expect(response.headers.get('X-Request-Id')).toBe(requestId)
      expect(response.headers.get('Retry-After')).toBeNull()
      expect(response.headers.get('Set-Cookie')).toBeNull()
      expect(fixture.resolveAuthenticatedUser).not.toHaveBeenCalled()
      expect(fixture.assertCapability).not.toHaveBeenCalled()
      expect(fixture.consume).not.toHaveBeenCalled()
      for (const service of Object.values(fixture.commandService)) {
        expect(service).not.toHaveBeenCalled()
      }
      expect(
        Object.values(reader).map((read) => vi.mocked(read).mock.calls.length)
      ).toEqual(readerCallsBefore)
    }
  )

  it('does not attach expired credentials when the request origin is untrusted', async () => {
    const fixture = createFixture({ clearSessionCookie: true, user: null })
    const response = await fixture.app.request('/api/v1/admin/questions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://evil.example'
      },
      body: JSON.stringify(content)
    })

    expect(response.status).toBe(401)
    expect(response.headers.get('Set-Cookie')).toBeNull()
  })
})

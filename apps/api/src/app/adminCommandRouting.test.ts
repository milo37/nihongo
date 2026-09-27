import type {
  AdminQuestionMutationResult,
  CreateAdminQuestionRequest,
  UpdateQuestionVersionRequest
} from '@nihongo/contracts/admin/phase7'
import {
  phase7DormantAfterSlice3RA2OperationManifest,
  reauthenticateAdminErrorSchema,
  reauthenticateAdminResponseSchema
} from '@nihongo/contracts/admin/phase7'
import { apiFailureSchema } from '@nihongo/contracts/common/error'
import { describe, expect, it, vi } from 'vitest'
import type { AdminCommandRateLimiter } from '../admin/adminCommandRateLimiter.js'
import type { AdminQuestionCommandService } from '../admin/adminQuestionCommandService.js'
import type { AdminReauthenticationService } from '../admin/adminReauthenticationService.js'
import type { AdminQuestionReader } from '../admin/adminQuestionService.js'
import type { AdminReadRateLimiter } from '../admin/adminReadRateLimiter.js'
import type { GuestPrincipalService } from '../auth/guestPrincipalService.js'
import type { PrincipalService } from '../auth/principalService.js'
import { parseApiEnvironment, type ApiEnvironment } from '../config/env.js'
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
  appEnvironment = environment,
  capabilityError,
  clearSessionCookie = false,
  includeReauthentication = true,
  includeCommands = true,
  isFresh = true,
  principalError,
  rateError,
  reauthenticationError,
  user = adminUser
}: {
  adminAuthorityFailure?: 'ADMIN_REQUIRED' | 'AUTH_SESSION_EXPIRED'
  appEnvironment?: ApiEnvironment
  capabilityError?: unknown
  clearSessionCookie?: boolean
  includeReauthentication?: boolean
  includeCommands?: boolean
  isFresh?: boolean
  principalError?: unknown
  rateError?: unknown
  reauthenticationError?: unknown
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
  const reauthenticate = vi.fn(async () => {
    if (reauthenticationError !== undefined) throw reauthenticationError
    return {
      response: {
        reauthenticatedAt: '2026-09-06T00:00:00.000Z',
        assuranceExpiresAt: '2026-09-06T00:05:00.000Z'
      },
      setCookies: [
        'nihongo.session_token=replacement; Path=/; HttpOnly; SameSite=Lax',
        'nihongo.dont_remember=1; Path=/; HttpOnly; SameSite=Lax'
      ]
    }
  })
  const reauthenticationService: AdminReauthenticationService = {
    reauthenticate
  }
  const resolutionHeaders = new Headers()
  const resolveAuthenticatedUser = vi.fn(async () => {
    if (principalError !== undefined) throw principalError
    return {
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
              isFresh
            }
          }),
      user
    }
  })
  const principalService: PrincipalService = {
    resolveAuthenticatedUser,
    getAuthenticatedUser: vi.fn(async () => user)
  }
  const readRateLimiter: AdminReadRateLimiter = { consume: vi.fn() }
  const commandRateLimiter: AdminCommandRateLimiter = { consume }
  const app = createApiApp({
    admin: {
      assertCapability,
      ...(includeCommands
        ? {
            commands: {
              rateLimiter: commandRateLimiter,
              service: commandService
            }
          }
        : {}),
      ...(includeReauthentication
        ? {
            reauthentication: {
              rateLimiter: commandRateLimiter,
              service: reauthenticationService
            }
          }
        : {}),
      rateLimiter: readRateLimiter,
      reader
    },
    auth: {
      environment: appEnvironment,
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
    reauthenticate,
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
    ],
    [
      'POST',
      `/api/v1/admin/question-versions/${versionId}/approval`,
      { expectedRowVersion: 1, comment: '승인합니다.' },
      'approveVersion',
      200,
      'ADMIN_SENSITIVE'
    ],
    [
      'POST',
      `/api/v1/admin/question-versions/${versionId}/approval-withdrawal`,
      { expectedRowVersion: 1, reason: '최종 재검수' },
      'withdrawApproval',
      200,
      'ADMIN_SENSITIVE'
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
    ],
    [`/api/v1/admin/question-versions/${versionId}/approval`, 16 * 1024 + 1],
    [
      `/api/v1/admin/question-versions/${versionId}/approval-withdrawal`,
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

  it.each([
    [
      `/api/v1/admin/question-versions/${versionId}/approval`,
      { expectedRowVersion: 1 },
      'approveVersion'
    ],
    [
      `/api/v1/admin/question-versions/${versionId}/approval-withdrawal`,
      { expectedRowVersion: 1, reason: '재검수' },
      'withdrawApproval'
    ]
  ] as const)(
    'stale A2 command %s fails fresh assurance before rate and service',
    async (pathname, body, serviceMethod) => {
      const fixture = createFixture({ isFresh: false })
      const response = await fixture.app.request(pathname, {
        method: 'POST',
        headers: commandHeaders(),
        body: JSON.stringify(body)
      })

      expect(response.status).toBe(401)
      expect(apiFailureSchema.parse(await response.json()).code).toBe(
        'FRESH_ASSURANCE_REQUIRED'
      )
      expect(fixture.consume).not.toHaveBeenCalled()
      expect(fixture.commandService[serviceMethod]).not.toHaveBeenCalled()
    }
  )

  it.each([
    `/api/v1/admin/question-versions/${versionId}/approval`,
    `/api/v1/admin/question-versions/${versionId}/approval-withdrawal`
  ])(
    'canonical A2 OPTIONS %s is answered by CORS before auth and command service',
    async (pathname) => {
      const fixture = createFixture()
      const response = await fixture.app.request(pathname, {
        method: 'OPTIONS',
        headers: {
          Origin: environment.TRUSTED_ORIGINS[0]!,
          'Access-Control-Request-Method': 'POST'
        }
      })

      expect(response.status).toBe(204)
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe(
        environment.TRUSTED_ORIGINS[0]
      )
      expect(fixture.resolveAuthenticatedUser).not.toHaveBeenCalled()
      expect(fixture.assertCapability).not.toHaveBeenCalled()
      expect(fixture.consume).not.toHaveBeenCalled()
      expect(fixture.commandService.approveVersion).not.toHaveBeenCalled()
      expect(fixture.commandService.withdrawApproval).not.toHaveBeenCalled()
    }
  )

  it('approval paths require the commands dependency before entering the guard', async () => {
    const fixture = createFixture({ includeCommands: false })
    for (const pathname of [
      `/api/v1/admin/question-versions/${versionId}/approval`,
      `/api/v1/admin/question-versions/${versionId}/approval-withdrawal`
    ]) {
      const response = await fixture.app.request(pathname, {
        method: 'POST',
        headers: commandHeaders(),
        body: JSON.stringify({ expectedRowVersion: 1, reason: '재검수' })
      })
      expect(response.status).toBe(404)
    }
    expect(fixture.resolveAuthenticatedUser).not.toHaveBeenCalled()
    expect(fixture.consume).not.toHaveBeenCalled()
    expect(fixture.commandService.approveVersion).not.toHaveBeenCalled()
    expect(fixture.commandService.withdrawApproval).not.toHaveBeenCalled()
  })

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
    [
      `/api/v1/admin/question-versions/${versionId}/approval`,
      { expectedRowVersion: 1 },
      'approveVersion'
    ],
    [
      `/api/v1/admin/question-versions/${versionId}/approval-withdrawal`,
      { expectedRowVersion: 1, reason: '재검수' },
      'withdrawApproval'
    ]
  ] as const)(
    'A2 role/account loss %s is exact 403 before capability/rate/service',
    async (pathname, body, serviceMethod) => {
      const fixture = createFixture({
        adminAuthorityFailure: 'ADMIN_REQUIRED',
        clearSessionCookie: true,
        user: null
      })
      const response = await fixture.app.request(pathname, {
        method: 'POST',
        headers: commandHeaders(),
        body: JSON.stringify(body)
      })

      expect(response.status).toBe(403)
      expect(apiFailureSchema.parse(await response.json()).code).toBe(
        'ADMIN_REQUIRED'
      )
      expect(fixture.assertCapability).not.toHaveBeenCalled()
      expect(fixture.consume).not.toHaveBeenCalled()
      expect(fixture.commandService[serviceMethod]).not.toHaveBeenCalled()
    }
  )

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

  it('A2 strict query/body validation runs after the shared sensitive rate gate', async () => {
    const queryFixture = createFixture()
    const queryResponse = await queryFixture.app.request(
      `/api/v1/admin/question-versions/${versionId}/approval?unknown=1`,
      {
        method: 'POST',
        headers: commandHeaders(),
        body: JSON.stringify({ expectedRowVersion: 1 })
      }
    )
    expect(queryResponse.status).toBe(422)
    expect(apiFailureSchema.parse(await queryResponse.json()).code).toBe(
      'VALIDATION_ERROR'
    )
    expect(queryFixture.consume).toHaveBeenCalledWith({
      actorId: adminUser.id,
      clientIp: 'unresolved',
      group: 'ADMIN_SENSITIVE'
    })
    expect(queryFixture.commandService.approveVersion).not.toHaveBeenCalled()

    const bodyFixture = createFixture()
    const bodyResponse = await bodyFixture.app.request(
      `/api/v1/admin/question-versions/${versionId}/approval-withdrawal`,
      {
        method: 'POST',
        headers: commandHeaders(),
        body: JSON.stringify({ expectedRowVersion: 1, unknown: true })
      }
    )
    expect(bodyResponse.status).toBe(422)
    expect(apiFailureSchema.parse(await bodyResponse.json()).code).toBe(
      'VALIDATION_ERROR'
    )
    expect(bodyFixture.consume).toHaveBeenCalledWith({
      actorId: adminUser.id,
      clientIp: 'unresolved',
      group: 'ADMIN_SENSITIVE'
    })
    expect(bodyFixture.commandService.withdrawApproval).not.toHaveBeenCalled()
  })

  it('default createApiApp composition rotates a stale ADMIN session and preserves ordered cookies', async () => {
    const fixture = createFixture({ isFresh: false })
    const response = await fixture.app.request(
      '/api/v1/admin/reauthentication',
      {
        method: 'POST',
        headers: commandHeaders(),
        body: JSON.stringify({ password: 'valid-password-value' })
      }
    )

    expect(response.status).toBe(200)
    expect(
      reauthenticateAdminResponseSchema.parse(await response.json())
    ).toEqual({
      reauthenticatedAt: '2026-09-06T00:00:00.000Z',
      assuranceExpiresAt: '2026-09-06T00:05:00.000Z'
    })
    expect(response.headers.getSetCookie()).toEqual([
      'nihongo.session_token=replacement; Path=/; HttpOnly; SameSite=Lax',
      'nihongo.dont_remember=1; Path=/; HttpOnly; SameSite=Lax'
    ])
    expect(fixture.resolveAuthenticatedUser).toHaveBeenCalledWith(
      expect.any(Headers),
      {
        classifyAdminAuthorityLoss: true,
        refreshRememberedSession: false
      }
    )
    expect(fixture.consume).toHaveBeenCalledWith({
      actorId: adminUser.id,
      clientIp: 'unresolved',
      group: 'REAUTHENTICATION'
    })
    expect(fixture.reauthenticate).toHaveBeenCalledWith({
      actorId: adminUser.id,
      headers: expect.any(Headers),
      password: 'valid-password-value',
      rawSessionToken: 'phase7-session-token',
      requestId
    })
  })

  it('reauthentication keeps 4KiB, origin, rate, query, and body checks in guard order', async () => {
    const oversized = createFixture({ user: null })
    const oversizedResponse = await oversized.app.request(
      '/api/v1/admin/reauthentication',
      {
        method: 'POST',
        headers: commandHeaders({ 'Content-Length': String(4 * 1024 + 1) }),
        body: '{}'
      }
    )
    expect(oversizedResponse.status).toBe(413)
    expect(oversized.resolveAuthenticatedUser).not.toHaveBeenCalled()

    const untrusted = createFixture()
    const untrustedResponse = await untrusted.app.request(
      '/api/v1/admin/reauthentication',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      }
    )
    expect(
      reauthenticateAdminErrorSchema.parse(await untrustedResponse.json()).code
    ).toBe('UNTRUSTED_ORIGIN')
    expect(untrusted.consume).not.toHaveBeenCalled()

    const limited = createFixture({
      rateError: new ApplicationError({
        code: 'RATE_LIMITED',
        message: 'too many',
        retryable: true,
        retryAfterSeconds: 29,
        phase7Disposition: 'NO_TX'
      })
    })
    const limitedResponse = await limited.app.request(
      '/api/v1/admin/reauthentication?unexpected=1',
      {
        method: 'POST',
        headers: commandHeaders(),
        body: '{"password":"first","password":"second"}'
      }
    )
    expect(limitedResponse.status).toBe(429)
    expect(limitedResponse.headers.get('Retry-After')).toBe('29')
    expect(limited.reauthenticate).not.toHaveBeenCalled()

    const query = createFixture()
    const queryResponse = await query.app.request(
      '/api/v1/admin/reauthentication?unexpected=1',
      {
        method: 'POST',
        headers: commandHeaders(),
        body: JSON.stringify({ password: 'valid-password-value' })
      }
    )
    expect(queryResponse.status).toBe(422)
    expect(query.consume).toHaveBeenCalledTimes(1)
    expect(query.reauthenticate).not.toHaveBeenCalled()

    const body = createFixture()
    const bodyResponse = await body.app.request(
      '/api/v1/admin/reauthentication',
      {
        method: 'POST',
        headers: commandHeaders(),
        body: '{"password":"first","password":"second"}'
      }
    )
    expect(bodyResponse.status).toBe(400)
    expect(body.consume).toHaveBeenCalledTimes(1)
    expect(body.reauthenticate).not.toHaveBeenCalled()
  })

  it('wrong password and authority failures emit no replacement cookie or service-side success', async () => {
    const wrongPassword = createFixture({
      reauthenticationError: new ApplicationError({
        code: 'REAUTHENTICATION_FAILED',
        message: '비밀번호를 확인할 수 없습니다.',
        retryable: false,
        phase7Disposition: 'NO_TX'
      })
    })
    const wrongPasswordResponse = await wrongPassword.app.request(
      '/api/v1/admin/reauthentication',
      {
        method: 'POST',
        headers: commandHeaders(),
        body: JSON.stringify({ password: 'wrong-password-value' })
      }
    )
    expect(wrongPasswordResponse.status).toBe(401)
    expect(
      reauthenticateAdminErrorSchema.parse(await wrongPasswordResponse.json())
        .code
    ).toBe('REAUTHENTICATION_FAILED')
    expect(wrongPasswordResponse.headers.getSetCookie()).toHaveLength(0)

    for (const input of [
      {
        fixture: createFixture({
          adminAuthorityFailure: 'AUTH_SESSION_EXPIRED',
          clearSessionCookie: true,
          user: null
        }),
        code: 'AUTH_SESSION_EXPIRED',
        status: 401
      },
      {
        fixture: createFixture({
          adminAuthorityFailure: 'ADMIN_REQUIRED',
          clearSessionCookie: true,
          user: null
        }),
        code: 'ADMIN_REQUIRED',
        status: 403
      }
    ] as const) {
      const response = await input.fixture.app.request(
        '/api/v1/admin/reauthentication',
        {
          method: 'POST',
          headers: commandHeaders(),
          body: JSON.stringify({ password: 'valid-password-value' })
        }
      )
      expect(response.status).toBe(input.status)
      expect(
        reauthenticateAdminErrorSchema.parse(await response.json()).code
      ).toBe(input.code)
      expect(input.fixture.reauthenticate).not.toHaveBeenCalled()
    }

    const classifier = createFixture({
      principalError: new Error('classifier unavailable')
    })
    const classifierResponse = await classifier.app.request(
      '/api/v1/admin/reauthentication',
      {
        method: 'POST',
        headers: commandHeaders(),
        body: JSON.stringify({ password: 'valid-password-value' })
      }
    )
    expect(classifierResponse.status).toBe(503)
    expect(classifierResponse.headers.get('Retry-After')).toBe('5')
    expect(
      reauthenticateAdminErrorSchema.parse(await classifierResponse.json())
    ).toMatchObject({ code: 'SERVICE_UNAVAILABLE', retryable: false })
    expect(classifier.reauthenticate).not.toHaveBeenCalled()
  })

  it.each([
    ['disabled', { ...environment, ADMIN_CMS_MODE: 'disabled' }],
    ['production', { ...environment, NODE_ENV: 'production' }]
  ] as const)(
    '%s mode keeps A1/A2 remediation generic 404 before guard and service',
    async (_label, appEnvironment) => {
      const fixture = createFixture({ appEnvironment })
      for (const [pathname, body] of [
        [
          '/api/v1/admin/reauthentication',
          { password: 'valid-password-value' }
        ],
        [
          `/api/v1/admin/question-versions/${versionId}/approval`,
          { expectedRowVersion: 1 }
        ],
        [
          `/api/v1/admin/question-versions/${versionId}/approval-withdrawal`,
          { expectedRowVersion: 1, reason: '재검수' }
        ]
      ] as const) {
        const response = await fixture.app.request(pathname, {
          method: 'POST',
          headers: commandHeaders(),
          body: JSON.stringify(body)
        })
        expect(response.status).toBe(404)
        expect(response.headers.getSetCookie()).toHaveLength(0)
      }
      expect(fixture.resolveAuthenticatedUser).not.toHaveBeenCalled()
      expect(fixture.consume).not.toHaveBeenCalled()
      expect(fixture.reauthenticate).not.toHaveBeenCalled()
      expect(fixture.commandService.approveVersion).not.toHaveBeenCalled()
      expect(fixture.commandService.withdrawApproval).not.toHaveBeenCalled()
    }
  )

  it.each([
    ['HEAD', '/api/v1/admin/questions'],
    ['POST', '/api/v1/admin/questions#alias'],
    ['POST', `/api/v1/%${'25'.repeat(32)}61dmin/questions`],
    ['POST', '/api/v1/admin/questions/short/versions'],
    ['GET', `/api/v1/admin/question-versions/${versionId}/approval`],
    [
      'POST',
      `/api/v1/admin/question-versions/${versionId}/approval-withdrawal/`
    ],
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

  it('manifest의 dormant 12개 전부를 auth/service/DB/cookie 전에 generic 404로 닫는다', async () => {
    const fixture = createFixture()
    const readerCallsBefore = Object.values(reader).map(
      (read) => vi.mocked(read).mock.calls.length
    )

    expect(phase7DormantAfterSlice3RA2OperationManifest).toHaveLength(12)
    for (const entry of phase7DormantAfterSlice3RA2OperationManifest) {
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

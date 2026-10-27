import { describe, expect, it, vi } from 'vitest'
import type { QuestionReportRateLimiter } from '../admin/questionReportRateLimiter.js'
import type { QuestionReportRepository } from '../admin/questionReportRepository.js'
import { createQuestionReportService } from '../admin/questionReportService.js'
import type { AuthGateway } from '../auth/authGateway.js'
import type { GuestPrincipalService } from '../auth/guestPrincipalService.js'
import type { PrincipalService } from '../auth/principalService.js'
import { parseApiEnvironment } from '../config/env.js'
import { ApplicationError } from '../errors/applicationError.js'
import { createJsonLogger } from '../observability/logger.js'
import type { QuestionReader } from '../question/questionService.js'
import { createApiApp } from './createApp.js'

const userId = '11111111-1111-4111-8111-111111111111'
const questionVersionId = '019d0000-0000-7000-8000-000000000001'
const questionId = '019d0000-0000-7000-8000-0000000000bb'
const origin = 'https://app.example.test'
const environment = parseApiEnvironment({
  NODE_ENV: 'production',
  DEPLOYMENT_ENVIRONMENT: 'TEST',
  RELEASE_ID: 'a'.repeat(40),
  ADMIN_CMS_MODE: 'disabled',
  HOST: '127.0.0.1',
  PORT: '3001',
  LOG_LEVEL: 'error',
  DATABASE_URL:
    'postgresql://nihongo_test_app_login:placeholder@localhost/nihongo_test?schema=public&sslmode=require',
  AUTH_GATEWAY_DATABASE_URL:
    'postgresql://nihongo_test_auth_gateway_login:placeholder@localhost/nihongo_test?schema=public&sslmode=require',
  TRUSTED_ORIGINS: origin,
  BETTER_AUTH_URL: origin,
  BETTER_AUTH_SECRET: 'test-auth-placeholder-only-1234567890',
  GUEST_COOKIE_SECRET: 'test-guest-placeholder-only-1234567890',
  AUTH_EMAIL_FROM: 'placeholder@example.test',
  AUTH_EMAIL_DELIVERY_MODE: 'webhook',
  AUTH_EMAIL_WEBHOOK_URL: 'https://mail.example.test',
  AUTH_EMAIL_WEBHOOK_SECRET: 'test-webhook-placeholder-only-1234567890',
  AUTH_TRUSTED_PROXY_CIDRS: '127.0.0.1/32'
})

const fixture = ({
  authenticated = true,
  reportsWired = true
}: { authenticated?: boolean; reportsWired?: boolean } = {}) => {
  const resolveAuthenticatedUser = vi.fn<
    PrincipalService['resolveAuthenticatedUser']
  >(async () =>
    authenticated
      ? {
          clearSessionCookie: false,
          headers: new Headers(),
          phase7Session: {
            id: userId,
            token: 'session-token',
            createdAt: new Date('2026-10-27T00:00:00Z'),
            expiresAt: new Date('2026-11-03T00:00:00Z'),
            isFresh: true
          },
          user: { id: userId, name: '학습자', role: 'USER', targetLevel: 'N5' }
        }
      : { clearSessionCookie: false, headers: new Headers(), user: null }
  )
  const rateLimiter = {
    consume: vi.fn<QuestionReportRateLimiter['consume']>(async () => undefined)
  }
  const repository = {
    findEntitledTarget: vi.fn<QuestionReportRepository['findEntitledTarget']>(
      async () => ({ questionId })
    ),
    findEntitledDuplicateState: vi.fn<
      QuestionReportRepository['findEntitledDuplicateState']
    >(async () => ({ questionId, hasOpenDuplicate: false })),
    create: vi.fn<QuestionReportRepository['create']>(
      async (_authority, targetQuestionId, request) => ({
        id: '019d0000-0000-7000-8000-0000000000aa',
        questionId: targetQuestionId,
        questionVersionId: request.questionVersionId,
        status: 'OPEN',
        rowVersion: 1,
        assignee: null,
        resolution: null,
        createdAt: '2026-10-28T00:00:00.000Z',
        updatedAt: '2026-10-28T00:00:00.000Z'
      })
    )
  }
  const app = createApiApp({
    auth: {
      environment,
      gateway: { handle: vi.fn() } as unknown as AuthGateway,
      guestPrincipalService: {} as GuestPrincipalService,
      principalService: {
        resolveAuthenticatedUser,
        getAuthenticatedUser: vi.fn()
      }
    },
    checkReadiness: async () => undefined,
    logger: createJsonLogger('error', () => undefined),
    questionReader: {} as QuestionReader,
    ...(reportsWired
      ? {
          questionReports: {
            rateLimiter,
            service: createQuestionReportService({
              rateLimiter,
              repository: repository as unknown as QuestionReportRepository
            })
          }
        }
      : {})
  })
  return { app, rateLimiter, repository }
}

const postReport = (
  app: ReturnType<typeof createApiApp>,
  body: unknown = {
    questionVersionId,
    reason: 'ANSWER_ERROR',
    description: '정답 표시가 해설과 다릅니다.'
  },
  headers: Record<string, string> = {}
) =>
  app.request('/api/v1/question-reports', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: origin,
      'Sec-Fetch-Site': 'same-origin',
      ...headers
    },
    body: JSON.stringify(body)
  })

describe('production learner question reports without the technical CMS', () => {
  it('creates an authenticated learner report', async () => {
    const { app, rateLimiter, repository } = fixture()
    const response = await postReport(app)

    expect(response.status).toBe(201)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(await response.json()).toMatchObject({
      questionVersionId,
      status: 'OPEN',
      rowVersion: 1
    })
    expect(rateLimiter.consume).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: userId, group: 'REPORT_ACTOR' })
    )
    expect(rateLimiter.consume).toHaveBeenCalledWith({
      group: 'REPORT_VERSION',
      value: questionVersionId
    })
    expect(repository.findEntitledTarget).toHaveBeenCalledWith(
      userId,
      questionVersionId
    )
    expect(repository.create).toHaveBeenCalledWith(
      { actorId: userId, rawSessionToken: 'session-token' },
      questionId,
      expect.objectContaining({ questionVersionId, reason: 'ANSWER_ERROR' })
    )
  })

  it('requires login before limiting or writing', async () => {
    const { app, rateLimiter, repository } = fixture({
      authenticated: false
    })
    const response = await postReport(app)

    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({
      code: 'AUTHENTICATION_REQUIRED'
    })
    expect(rateLimiter.consume).not.toHaveBeenCalled()
    expect(repository.create).not.toHaveBeenCalled()
  })

  it('rejects an untrusted origin before writing', async () => {
    const { app, repository } = fixture()
    const response = await postReport(app, undefined, {
      Origin: 'https://evil.example.test',
      'Sec-Fetch-Site': 'cross-site'
    })

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'UNTRUSTED_ORIGIN' })
    expect(repository.create).not.toHaveBeenCalled()
  })

  it('rejects invalid input before writing', async () => {
    const { app, repository } = fixture()
    const response = await postReport(app, {
      questionVersionId,
      reason: 'NOT_A_REASON',
      description: '정답이 이상합니다.',
      extra: true
    })

    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ code: 'VALIDATION_ERROR' })
    expect(repository.create).not.toHaveBeenCalled()
  })

  it('keeps the per-actor report rate limit', async () => {
    const { app, rateLimiter, repository } = fixture()
    rateLimiter.consume.mockRejectedValueOnce(
      new ApplicationError({
        code: 'RATE_LIMITED',
        message: '문제 신고 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
        retryable: true,
        retryAfterSeconds: 30,
        phase7Disposition: 'NO_TX'
      })
    )
    const response = await postReport(app)

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('30')
    expect(repository.create).not.toHaveBeenCalled()
  })

  it('rejects a question version the learner cannot report', async () => {
    const { app, repository } = fixture()
    repository.findEntitledTarget.mockResolvedValueOnce(null)
    const response = await postReport(app)

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({
      code: 'RESOURCE_NOT_FOUND'
    })
    expect(repository.create).not.toHaveBeenCalled()
  })

  it('rejects an open duplicate report', async () => {
    const { app, repository } = fixture()
    repository.findEntitledDuplicateState.mockResolvedValueOnce({
      questionId,
      hasOpenDuplicate: true
    })
    const response = await postReport(app)

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      code: 'QUESTION_REPORT_DUPLICATE'
    })
    expect(repository.create).not.toHaveBeenCalled()
  })

  it('keeps admin report reads closed in production', async () => {
    const { app } = fixture()
    const response = await app.request('/api/v1/admin/question-reports', {
      headers: { Origin: origin, 'Sec-Fetch-Site': 'same-origin' }
    })

    expect(response.status).toBe(404)
  })

  it('fails closed when the report service is not wired', async () => {
    const { app } = fixture({ reportsWired: false })
    const response = await postReport(app)

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({
      code: 'RESOURCE_NOT_FOUND'
    })
  })
})

import { describe, expect, it, vi } from 'vitest'
import type { QuestionReportRateLimiter } from '../admin/questionReportRateLimiter.js'
import type { AuthGateway } from '../auth/authGateway.js'
import type { GuestPrincipalService } from '../auth/guestPrincipalService.js'
import type { PrincipalService } from '../auth/principalService.js'
import { parseApiEnvironment } from '../config/env.js'
import { ApplicationError } from '../errors/applicationError.js'
import { createJsonLogger } from '../observability/logger.js'
import type { QuestionReader } from '../question/questionService.js'
import type { UserReportService } from '../report/userReportService.js'
import { createApiApp } from './createApp.js'

const userId = '11111111-1111-4111-8111-111111111111'
const origin = 'https://app.example.test'
const environment = parseApiEnvironment({
  NODE_ENV: 'production',
  DEPLOYMENT_ENVIRONMENT: 'TEST',
  RELEASE_ID: 'a'.repeat(40),
  HOST: '127.0.0.1',
  PORT: '3001',
  LOG_LEVEL: 'error',
  DATABASE_URL:
    'postgresql://nihongo_test_app_login:placeholder@localhost/nihongo_test?schema=public&sslmode=require',
  TRUSTED_ORIGINS: origin,
  BETTER_AUTH_URL: origin,
  BETTER_AUTH_SECRET: 'test-auth-placeholder-only-1234567890',
  GUEST_COOKIE_SECRET: 'test-guest-placeholder-only-1234567890',
  AUTH_TRUSTED_PROXY_CIDRS: '127.0.0.1/32'
})

const fixture = (limited: boolean) => {
  const rateLimiter = {
    consume: vi.fn<QuestionReportRateLimiter['consume']>(async () => {
      if (limited)
        throw new ApplicationError({
          code: 'RATE_LIMITED',
          message:
            '문제 신고 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
          retryable: true,
          retryAfterSeconds: 60
        })
    })
  }
  const createReport = vi.fn<UserReportService['createReport']>(async () => ({
    reportId: '019d0000-0000-7000-8000-0000000000aa',
    status: 'RECEIVED',
    createdAt: '2026-10-28T00:00:00.000Z'
  }))
  const app = createApiApp({
    accountRestrictionReader: { isRestricted: async () => false },
    auth: {
      environment,
      gateway: { handle: vi.fn() } as unknown as AuthGateway,
      guestPrincipalService: {} as GuestPrincipalService,
      principalService: {
        resolveAuthenticatedUser: vi.fn<
          PrincipalService['resolveAuthenticatedUser']
        >(async () => ({
          clearSessionCookie: false,
          headers: new Headers(),
          ownedSessionProof: {
            id: userId,
            token: 'session-token',
            createdAt: new Date('2026-10-27T00:00:00Z'),
            expiresAt: new Date('2026-11-03T00:00:00Z'),
            isFresh: true
          },
          user: { id: userId, name: '학습자', role: 'USER', targetLevel: 'N5' }
        })),
        getAuthenticatedUser: vi.fn()
      }
    },
    checkReadiness: async () => undefined,
    logger: createJsonLogger('error', () => undefined),
    questionReader: {} as QuestionReader,
    userReports: {
      rateLimiter,
      service: { createReport } as unknown as UserReportService
    }
  })
  return { app, createReport, rateLimiter }
}

const postReport = (app: ReturnType<typeof createApiApp>) =>
  app.request('/api/v1/reports', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: origin,
      'Sec-Fetch-Site': 'same-origin'
    },
    body: JSON.stringify({
      kind: 'APP_ERROR',
      location: '/study',
      description: '화면이 멈춥니다.'
    })
  })

describe('learner report creation rate limit (#603 S2)', () => {
  it('limits each create by reporter and client IP before writing', async () => {
    const { app, createReport, rateLimiter } = fixture(false)
    expect((await postReport(app)).status).toBe(201)
    expect(rateLimiter.consume).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: userId, group: 'REPORT_ACTOR' })
    )
    expect(createReport).toHaveBeenCalledTimes(1)
  })

  it('rejects a limited create with 429 and writes nothing', async () => {
    const { app, createReport } = fixture(true)
    const response = await postReport(app)
    expect(response.status).toBe(429)
    expect(await response.json()).toMatchObject({ code: 'RATE_LIMITED' })
    expect(createReport).not.toHaveBeenCalled()
  })
})

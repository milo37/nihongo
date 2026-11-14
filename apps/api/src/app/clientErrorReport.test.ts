import { describe, expect, it, vi } from 'vitest'
import type { AuthGateway } from '../auth/authGateway.js'
import type { GuestPrincipalService } from '../auth/guestPrincipalService.js'
import type { PrincipalService } from '../auth/principalService.js'
import { parseApiEnvironment } from '../config/env.js'
import { ApplicationError } from '../errors/applicationError.js'
import type { ApplicationRateLimiter } from '../middleware/applicationRateLimiter.js'
import { createJsonLogger } from '../observability/logger.js'
import { createApiApp } from './createApp.js'

const origin = 'https://app.example.test'
const environment = parseApiEnvironment({
  NODE_ENV: 'production',
  DEPLOYMENT_ENVIRONMENT: 'TEST',
  RELEASE_ID: 'a'.repeat(40),
  HOST: '127.0.0.1',
  PORT: '3001',
  LOG_LEVEL: 'info',
  DATABASE_URL:
    'postgresql://nihongo_test_app_login:placeholder@localhost/nihongo_test?schema=public&sslmode=require',
  TRUSTED_ORIGINS: origin,
  BETTER_AUTH_URL: origin,
  BETTER_AUTH_SECRET: 'test-auth-placeholder-only-1234567890',
  GUEST_COOKIE_SECRET: 'test-guest-placeholder-only-1234567890',
  AUTH_TRUSTED_PROXY_CIDRS: '127.0.0.1/32'
})

const report = {
  schemaVersion: 1,
  occurredAt: '2026-11-13T12:00:00.000Z',
  releaseId: 'b'.repeat(40),
  source: 'UNEXPECTED_API_ERROR',
  routeKey: 'routes.practiceSession',
  requestId: '019d0000-0000-7000-8000-0000000000aa',
  statusClass: '5xx'
}

const fixture = (limited = false) => {
  const lines: Record<string, unknown>[] = []
  const rateLimiter = {
    consume: vi.fn<ApplicationRateLimiter['consume']>(async () => {
      if (limited)
        throw new ApplicationError({
          code: 'RATE_LIMITED',
          message: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
          retryable: true,
          retryAfterSeconds: 60
        })
    })
  }
  const app = createApiApp({
    auth: {
      environment,
      gateway: { handle: vi.fn() } as unknown as AuthGateway,
      guestPrincipalService: {} as GuestPrincipalService,
      principalService: {} as PrincipalService
    },
    checkReadiness: async () => undefined,
    logger: createJsonLogger(
      'info',
      (line) => lines.push(JSON.parse(line) as Record<string, unknown>),
      { deploymentEnvironment: 'TEST', releaseId: 'a'.repeat(40) }
    ),
    questionReadSecurity: { environment, rateLimiter }
  })
  const reported = () =>
    lines.filter((line) => line.event === 'client.error.reported')
  return { app, rateLimiter, reported }
}

const post = (
  app: ReturnType<typeof createApiApp>,
  body: unknown,
  headers: Record<string, string> = { Origin: origin }
) =>
  app.request('/api/v1/client-errors', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  })

describe('POST /api/v1/client-errors (JLP-762)', () => {
  it('writes one warn line with the client labels and answers 204', async () => {
    const { app, rateLimiter, reported } = fixture()
    const response = await post(app, report)
    expect(response.status).toBe(204)
    expect(await response.text()).toBe('')
    expect(reported()).toEqual([
      expect.objectContaining({
        level: 'warn',
        event: 'client.error.reported',
        deploymentEnvironment: 'TEST',
        releaseId: 'a'.repeat(40),
        clientReleaseId: 'b'.repeat(40),
        occurredAt: report.occurredAt,
        source: 'UNEXPECTED_API_ERROR',
        routeKey: 'routes.practiceSession',
        clientRequestId: report.requestId,
        statusClass: '5xx'
      })
    ])
    expect(rateLimiter.consume).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'client-error-report',
        max: 20,
        windowMs: 60_000
      })
    )
  })

  it('needs no sign-in and accepts a report without the optional fields', async () => {
    const { app, reported } = fixture()
    const {
      requestId: _requestId,
      statusClass: _statusClass,
      ...minimal
    } = report
    const response = await post(app, { ...minimal, source: 'WINDOW_ERROR' })
    expect(response.status).toBe(204)
    expect(reported()).toHaveLength(1)
    expect(reported()[0]).not.toHaveProperty('clientRequestId')
  })

  it.each([
    ['an unknown field', { ...report, message: 'TypeError: x is undefined' }],
    ['an unknown source', { ...report, source: 'CONSOLE' }],
    ['a free-text route', { ...report, routeKey: '/practice/session/1' }],
    ['a short release id', { ...report, releaseId: 'abc' }],
    [
      'a screen-side environment',
      { ...report, deploymentEnvironment: 'PRODUCTION' }
    ]
  ])('rejects %s with 422 and logs nothing', async (_label, body) => {
    const { app, reported } = fixture()
    const response = await post(app, body)
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ code: 'VALIDATION_ERROR' })
    expect(reported()).toHaveLength(0)
  })

  it('rejects a body over 2 KB', async () => {
    const { app, reported } = fixture()
    const response = await post(
      app,
      JSON.stringify({ ...report, routeKey: 'routes.' + 'a'.repeat(3_000) })
    )
    expect(response.status).toBe(413)
    expect(reported()).toHaveLength(0)
  })

  it('rejects another site with the write security of every API write', async () => {
    const { app, rateLimiter, reported } = fixture()
    const response = await post(app, report, {
      Origin: 'https://evil.example.test'
    })
    expect(response.status).toBe(403)
    expect(rateLimiter.consume).not.toHaveBeenCalled()
    expect(reported()).toHaveLength(0)
  })

  it('stops at the per-IP limit before reading the body', async () => {
    const { app, reported } = fixture(true)
    const response = await post(app, report)
    expect(response.status).toBe(429)
    expect(reported()).toHaveLength(0)
  })
})

import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import { importGuestResultResponseSchema } from '@nihongo/contracts/study/import-guest-result'
import { createApiErrorHandler } from '../app/createApp.js'
import { createGuestPrincipalService } from '../auth/guestPrincipalService.js'
import type { PrincipalService } from '../auth/principalService.js'
import { parseApiEnvironment } from '../config/env.js'
import type { PrismaClient } from '../generated/prisma/client.js'
import { requestContext } from '../middleware/requestContext.js'
import type { ApiVariables } from '../middleware/requestContext.js'
import { createJsonLogger } from '../observability/logger.js'
import {
  createGuestResultImportService,
  GuestResultImportUnavailableError,
  type GuestResultImportRepository
} from '../study/guestResultImport.js'
import { createGuestResultImportRoutes } from './guestResultImport.js'
import { GUEST_COOKIE_NAME } from './principal.js'

const environment = parseApiEnvironment({
  NODE_ENV: 'test',
  DEPLOYMENT_ENVIRONMENT: 'TEST',
  DATABASE_URL:
    'postgresql://nihongo_test_app_login:unit-only@127.0.0.1:5432/nihongo_test?schema=nihongo_' +
    'a'.repeat(32) +
    '_test&sslmode=verify-full',
  AUTH_TRUSTED_PROXY_CIDRS: '127.0.0.1/32,::1/128',
  BETTER_AUTH_SECRET: 'a'.repeat(48),
  GUEST_COOKIE_SECRET: 'b'.repeat(48),
  BETTER_AUTH_URL: 'http://127.0.0.1:4200',
  TRUSTED_ORIGINS: 'http://127.0.0.1:4200',
  HOST: '127.0.0.1',
  PORT: '4201',
  RELEASE_ID: '1'.repeat(40),
  LOG_LEVEL: 'silent'
})

const userId = '018f6b7a-1f4b-7d5e-8a91-4c27df9c10a1'
const sessionId = '018f6b7a-1f4b-7d5e-8a91-4c27df9c10b2'
const observedAt = new Date('2026-11-10T03:00:00.000Z')

const createHarness = ({
  importLast = async () => ({
    importedSessionId: sessionId,
    wrongAnswerCount: 2
  }),
  session = 'member',
  restricted = false
}: {
  importLast?: GuestResultImportRepository['importLast']
  session?: 'member' | 'none' | 'expired'
  restricted?: boolean
} = {}) => {
  const repository = { importLast: vi.fn(importLast) }
  const guestPrincipalService = createGuestPrincipalService({
    client: {} as PrismaClient,
    secret: 'guest-fixture-secret'
  })
  const principalService = {
    resolveAuthenticatedUser: async () => ({
      clearSessionCookie: session === 'expired',
      headers: new Headers(),
      user:
        session === 'member'
          ? { id: userId, name: 'member', role: 'USER', targetLevel: null }
          : null
    })
  } as unknown as PrincipalService
  const app = new Hono<{ Variables: ApiVariables }>()
  app.use('*', requestContext)
  app.use('*', async (context, next) => {
    const url = new URL(context.req.url)
    context.set('rawRequestTarget', url.pathname + url.search)
    context.set('requestStartedAt', Date.now())
    await next()
  })
  app.route(
    '/api/v1/me/guest-result-import',
    createGuestResultImportRoutes({
      accountRestrictionReader: { isRestricted: async () => restricted },
      environment,
      guestPrincipalService,
      guestResultImportService: createGuestResultImportService(repository),
      now: () => observedAt,
      principalService,
      rateLimiter: { consume: vi.fn(async () => undefined) }
    })
  )
  app.onError(createApiErrorHandler({ logger: createJsonLogger('silent') }))
  const credential = guestPrincipalService.prepareCredential()
  return { app, credential, repository }
}

const post = (
  app: Hono<{ Variables: ApiVariables }>,
  { body = {}, cookie }: { body?: unknown; cookie?: string } = {}
) =>
  app.request('/api/v1/me/guest-result-import', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: `${GUEST_COOKIE_NAME}=${cookie}` } : {})
    },
    body: JSON.stringify(body)
  })

describe('POST /api/v1/me/guest-result-import (JLP-823)', () => {
  it('moves the guest result of this device and clears the guest cookie', async () => {
    const { app, credential, repository } = createHarness()
    const response = await post(app, { cookie: credential.cookieValue })

    expect(response.status).toBe(200)
    expect(
      importGuestResultResponseSchema.parse(await response.json())
    ).toEqual({ importedSessionId: sessionId, wrongAnswerCount: 2 })
    expect(repository.importLast).toHaveBeenCalledWith({
      guest: { id: credential.id, tokenDigest: credential.tokenDigest },
      observedAt,
      userId
    })
    expect(response.headers.get('set-cookie')).toContain(
      `${GUEST_COOKIE_NAME}=;`
    )
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  it('returns nothing without a guest cookie', async () => {
    const { app, repository } = createHarness()
    const response = await post(app)

    expect(await response.json()).toEqual({
      importedSessionId: null,
      wrongAnswerCount: 0
    })
    expect(repository.importLast).not.toHaveBeenCalled()
    expect(response.headers.get('set-cookie')).toBeNull()
  })

  it('returns nothing for a tampered cookie and still clears it', async () => {
    const { app, repository } = createHarness()
    const response = await post(app, { cookie: 'tampered' })

    expect(await response.json()).toEqual({
      importedSessionId: null,
      wrongAnswerCount: 0
    })
    expect(repository.importLast).not.toHaveBeenCalled()
    expect(response.headers.get('set-cookie')).toContain(
      `${GUEST_COOKIE_NAME}=;`
    )
  })

  it.each([
    ['none', 'AUTHENTICATION_REQUIRED'],
    ['expired', 'AUTH_SESSION_EXPIRED']
  ] as const)('needs a member session (%s)', async (session, code) => {
    const { app, credential, repository } = createHarness({ session })
    const response = await post(app, { cookie: credential.cookieValue })

    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ code })
    expect(repository.importLast).not.toHaveBeenCalled()
  })

  it('refuses a restricted member', async () => {
    const { app, credential, repository } = createHarness({
      restricted: true
    })
    const response = await post(app, { cookie: credential.cookieValue })

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'ACCOUNT_RESTRICTED' })
    expect(repository.importLast).not.toHaveBeenCalled()
  })

  it('takes an empty body only', async () => {
    const { app, repository } = createHarness()
    const response = await post(app, { body: { sessionId } })

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'INVALID_REQUEST' })
    expect(repository.importLast).not.toHaveBeenCalled()
  })

  it('maps an unavailable database to 503', async () => {
    const { app, credential } = createHarness({
      importLast: async () => {
        throw new GuestResultImportUnavailableError({ cause: new Error('x') })
      }
    })
    const response = await post(app, { cookie: credential.cookieValue })

    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({
      code: 'SERVICE_UNAVAILABLE'
    })
  })
})

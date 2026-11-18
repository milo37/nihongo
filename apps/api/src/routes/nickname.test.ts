import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import { updateNicknameResponseSchema } from '@nihongo/contracts/auth/update-nickname'
import { createApiErrorHandler } from '../app/createApp.js'
import type { PrincipalService } from '../auth/principalService.js'
import { parseApiEnvironment } from '../config/env.js'
import {
  createNicknameService,
  NicknameRepositoryUnavailableError,
  type NicknameRepository
} from '../member/nickname.js'
import { requestContext } from '../middleware/requestContext.js'
import type { ApiVariables } from '../middleware/requestContext.js'
import { createJsonLogger } from '../observability/logger.js'
import { createNicknameRoutes } from './nickname.js'

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

const createHarness = (
  update: NicknameRepository['update'] = async (_userId, nickname) => nickname,
  session: 'member' | 'none' | 'expired' = 'member'
) => {
  const rateLimiter = { consume: vi.fn(async () => undefined) }
  const repository = { update: vi.fn(update) }
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
    '/api/v1/me/nickname',
    createNicknameRoutes({
      environment,
      principalService,
      rateLimiter,
      nicknameService: createNicknameService(repository)
    })
  )
  app.onError(createApiErrorHandler({ logger: createJsonLogger('silent') }))
  return { app, rateLimiter, repository }
}

const put = (app: Hono<{ Variables: ApiVariables }>, body: unknown) =>
  app.request('/api/v1/me/nickname', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })

describe('PUT /api/v1/me/nickname (#1096)', () => {
  it('stores the trimmed nickname for the signed-in member', async () => {
    const harness = createHarness()
    const response = await put(harness.app, { nickname: '  하루 마루 ' })
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(updateNicknameResponseSchema.parse(await response.json())).toEqual({
      nickname: '하루 마루'
    })
    expect(harness.repository.update).toHaveBeenCalledWith(userId, '하루 마루')
    expect(harness.rateLimiter.consume).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'nickname-write',
        windowMs: 60_000,
        max: 30
      })
    )
  })

  it('rejects a nickname outside 2~12 characters or with a line break', async () => {
    const harness = createHarness()
    for (const body of [
      {},
      { nickname: null },
      { nickname: '   ' },
      { nickname: ' 하 ' },
      { nickname: '하'.repeat(13) },
      { nickname: '하\n루' },
      { nickname: '하루', userId }
    ]) {
      const response = await put(harness.app, body)
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({
        code: 'INVALID_REQUEST',
        message: '닉네임을 2자 이상 입력해 주세요'
      })
    }
    expect(harness.repository.update).not.toHaveBeenCalled()
  })

  it('asks a guest or an expired session to sign in', async () => {
    const guest = createHarness(undefined, 'none')
    const guestResponse = await put(guest.app, { nickname: '하루' })
    expect(guestResponse.status).toBe(401)
    expect(await guestResponse.json()).toMatchObject({
      code: 'AUTHENTICATION_REQUIRED'
    })
    const expired = createHarness(undefined, 'expired')
    const expiredResponse = await put(expired.app, { nickname: '하루' })
    expect(expiredResponse.status).toBe(401)
    expect(await expiredResponse.json()).toMatchObject({
      code: 'AUTH_SESSION_EXPIRED'
    })
    expect(guest.repository.update).not.toHaveBeenCalled()
    expect(expired.repository.update).not.toHaveBeenCalled()
  })

  it('treats a member who is no longer ACTIVE as signed out', async () => {
    const harness = createHarness(async () => null)
    const response = await put(harness.app, { nickname: '하루' })
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({
      code: 'AUTHENTICATION_REQUIRED'
    })
  })

  it('answers SERVICE_UNAVAILABLE when the database is down', async () => {
    const harness = createHarness(async () => {
      throw new NicknameRepositoryUnavailableError({
        cause: new Error('down')
      })
    })
    const response = await put(harness.app, { nickname: '하루' })
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      retryable: true
    })
  })
})

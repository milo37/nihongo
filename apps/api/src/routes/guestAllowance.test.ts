import { guestAllowanceExamples } from '@nihongo/contracts/study/get-guest-allowance'
import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import { createApiErrorHandler } from '../app/createApp.js'
import { createGuestPrincipalService } from '../auth/guestPrincipalService.js'
import type { PrincipalService } from '../auth/principalService.js'
import type { ApiEnvironment } from '../config/env.js'
import type { PrismaClient } from '../generated/prisma/client.js'
import {
  requestContext,
  type ApiVariables
} from '../middleware/requestContext.js'
import { createJsonLogger } from '../observability/logger.js'
import type { GuestAllowanceReader } from '../study/guestAllowance.js'
import { createGuestAllowanceRoutes } from './guestAllowance.js'
import { GUEST_COOKIE_NAME } from './principal.js'

const fixture = () => {
  const environment = {
    NODE_ENV: 'test',
    AUTH_TRUSTED_PROXY_CIDRS: []
  } as unknown as ApiEnvironment
  const principalService = {
    resolveAuthenticatedUser: async (headers: Headers) => ({
      clearSessionCookie: false,
      headers: new Headers(),
      user:
        headers.get('Authorization') === 'Bearer member'
          ? { id: 'member', name: 'M', role: 'USER', targetLevel: 'N5' }
          : null
    })
  } as unknown as PrincipalService
  const guestPrincipalService = createGuestPrincipalService({
    client: {} as PrismaClient,
    secret: 'guest-fixture-secret'
  })
  const read = vi.fn<GuestAllowanceReader['read']>(
    async () => guestAllowanceExamples.one
  )
  const at = new Date('2026-11-08T05:00:00.000Z')
  const app = new Hono<{ Variables: ApiVariables }>()
  app.use('*', requestContext)
  app.use('*', async (context, next) => {
    context.set('rawRequestTarget', new URL(context.req.url).pathname)
    context.set('requestStartedAt', Date.now())
    await next()
  })
  app.onError(createApiErrorHandler({ logger: createJsonLogger('silent') }))
  app.route(
    '/guest-allowance',
    createGuestAllowanceRoutes({
      environment,
      guestAllowanceReader: { read },
      guestPrincipalService,
      principalService,
      rateLimiter: { consume: async () => undefined },
      now: () => at
    })
  )
  return { app, at, guestPrincipalService, read }
}

describe('GET /guest-allowance (#737)', () => {
  it('tells a member they are not limited without reading guest counts', async () => {
    const f = fixture()
    const response = await f.app.request('/guest-allowance', {
      headers: { Authorization: 'Bearer member' }
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ kind: 'USER' })
    expect(f.read).not.toHaveBeenCalled()
  })

  it('reads a visitor without a guest cookie and issues none', async () => {
    const f = fixture()
    const response = await f.app.request('/guest-allowance')
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(response.headers.get('Set-Cookie')).toBeNull()
    expect(await response.json()).toEqual(guestAllowanceExamples.one)
    expect(f.read).toHaveBeenCalledWith({
      at: f.at,
      clientIp: expect.any(String),
      guest: null
    })
  })

  it('refuses any query part without reading counts', async () => {
    const f = fixture()
    const response = await f.app.request('/guest-allowance?remaining=9')
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'INVALID_REQUEST' })
    expect(f.read).not.toHaveBeenCalled()
  })

  it('passes a verified guest cookie and ignores a tampered one', async () => {
    const f = fixture()
    const credential = f.guestPrincipalService.prepareCredential()
    const inspected = f.guestPrincipalService.inspectCookie(
      credential.cookieValue
    )
    if (inspected.kind !== 'VERIFIED')
      throw new Error('Verified guest fixture가 필요합니다.')
    await f.app.request('/guest-allowance', {
      headers: { Cookie: `${GUEST_COOKIE_NAME}=${credential.cookieValue}` }
    })
    expect(f.read).toHaveBeenLastCalledWith(
      expect.objectContaining({
        guest: {
          guestPrincipalId: inspected.id,
          tokenDigest: inspected.tokenDigest
        }
      })
    )
    await f.app.request('/guest-allowance', {
      headers: { Cookie: `${GUEST_COOKIE_NAME}=tampered` }
    })
    expect(f.read).toHaveBeenLastCalledWith(
      expect.objectContaining({ guest: null })
    )
  })
})

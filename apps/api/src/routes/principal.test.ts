import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiEnvironment } from '../config/env.js'
import type { GuestPrincipalService } from '../auth/guestPrincipalService.js'
import type { PrincipalService } from '../auth/principalService.js'
import { createPrincipalRoutes, GUEST_COOKIE_NAME } from './principal.js'

const environment = {
  NODE_ENV: 'test',
  HOST: '127.0.0.1',
  PORT: 3001,
  DATABASE_URL: 'postgresql://localhost/nihongo_test',
  TRUSTED_ORIGINS: ['http://localhost:5173'],
  LOG_LEVEL: 'silent',
  BETTER_AUTH_SECRET: 'auth-secret-that-is-at-least-32-characters',
  BETTER_AUTH_URL: 'http://localhost:3001',
  GUEST_COOKIE_SECRET: 'guest-secret-that-is-at-least-32-characters',
  AUTH_EMAIL_FROM: 'auth@example.test',
  AUTH_EMAIL_DELIVERY_MODE: 'test-sink',
  AUTH_TRUSTED_PROXY_CIDRS: ['127.0.0.1/32']
} satisfies ApiEnvironment

const guestPrincipalService = {
  clear: vi.fn().mockResolvedValue(undefined),
  create: vi.fn(),
  deleteExpired: vi.fn(),
  inspectCookie: vi.fn(() => ({ kind: 'ABSENT' as const })),
  prepareCredential: vi.fn(),
  resolveExisting: vi.fn()
} satisfies GuestPrincipalService

const getSetCookies = (response: Response): string[] =>
  response.headers.getSetCookie?.() ?? [
    response.headers.get('Set-Cookie') ?? ''
  ]

describe('principal routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('강제 폐기 시 rolling cookie 뒤에 만료 cookie를 추가한다', async () => {
    const principalService = {
      getAuthenticatedUser: vi.fn().mockResolvedValue(null),
      resolveAuthenticatedUser: vi.fn().mockResolvedValue({
        clearSessionCookie: true,
        headers: new Headers({ 'Set-Cookie': 'rolling=stale; HttpOnly' }),
        user: null
      })
    } satisfies PrincipalService
    const routes = createPrincipalRoutes({
      environment,
      guestPrincipalService,
      principalService
    })

    const response = await routes.request('/me')
    const setCookies = response.headers.getSetCookie?.() ?? [
      response.headers.get('Set-Cookie') ?? ''
    ]
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ kind: 'GUEST' })
    expect(setCookies.join('\n')).toContain('rolling=stale')
    expect(setCookies.join('\n')).toContain('nihongo.session_token=')
    expect(setCookies.join('\n')).toContain('Max-Age=0')
  })

  it.each(['USER', 'ADMIN'] as const)(
    '%s session은 guest clear를 no-op하고 rolling cookie를 보존한다',
    async (role) => {
      const principalService = {
        getAuthenticatedUser: vi.fn(),
        resolveAuthenticatedUser: vi.fn().mockResolvedValue({
          clearSessionCookie: false,
          headers: new Headers({
            'Set-Cookie': 'nihongo.session_token=rolling; Path=/; HttpOnly'
          }),
          user: {
            id: crypto.randomUUID(),
            name: `Study ${role}`,
            role,
            targetLevel: 'N5'
          }
        })
      } satisfies PrincipalService
      const routes = createPrincipalRoutes({
        environment,
        guestPrincipalService,
        principalService
      })

      const response = await routes.request('/guest-principal', {
        method: 'DELETE',
        headers: {
          Cookie: `${GUEST_COOKIE_NAME}=signed-guest`
        }
      })
      const setCookies = getSetCookies(response).join('\n')

      expect(response.status).toBe(204)
      expect(guestPrincipalService.clear).not.toHaveBeenCalled()
      expect(setCookies).toContain('nihongo.session_token=rolling')
      expect(setCookies).not.toContain(`${GUEST_COOKIE_NAME}=`)
      expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    }
  )

  it('guest clear는 auth 만료 cookie와 guest 삭제 cookie를 모두 보존한다', async () => {
    const principalService = {
      getAuthenticatedUser: vi.fn(),
      resolveAuthenticatedUser: vi.fn().mockResolvedValue({
        clearSessionCookie: true,
        headers: new Headers({ 'Set-Cookie': 'rolling=stale; HttpOnly' }),
        user: null
      })
    } satisfies PrincipalService
    const routes = createPrincipalRoutes({
      environment,
      guestPrincipalService,
      principalService
    })

    const response = await routes.request('/guest-principal', {
      method: 'DELETE',
      headers: { Cookie: `${GUEST_COOKIE_NAME}=signed-guest` }
    })
    const setCookies = getSetCookies(response).join('\n')

    expect(response.status).toBe(204)
    expect(guestPrincipalService.clear).toHaveBeenCalledWith('signed-guest')
    expect(setCookies).toContain('rolling=stale')
    expect(setCookies).toContain('nihongo.session_token=')
    expect(setCookies).toContain('__Secure-nihongo.session_token=')
    expect(setCookies).toContain('Max-Age=0')
    expect(setCookies).toContain(`${GUEST_COOKIE_NAME}=`)
  })
})

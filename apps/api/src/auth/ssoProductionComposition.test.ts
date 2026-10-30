import { createHash } from 'node:crypto'
import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import { parseApiEnvironment } from '../config/env.js'
import { createAuthRuntimePlan } from '../config/authRuntimePlan.js'
import { createOwnedAuthReadiness } from './ownedAuthReadiness.js'
import { AuthGatewayError } from './authGateway.js'
import { createAdminReauthenticationService } from '../admin/adminReauthenticationService.js'
import { createSsoAuthentication } from './createSsoAuthentication.js'
import { createApiApp } from '../app/createApp.js'
import { createJsonLogger } from '../observability/logger.js'
import { createPhase7SessionCookie } from './sessionCookie.js'
import { createAdminCommandGuard } from '../admin/adminCommandGuard.js'
import type { PrismaClient } from '../generated/prisma/client.js'
import type { AdminQuestionReader } from '../admin/adminQuestionService.js'
import type { ApiVariables } from '../middleware/requestContext.js'
import type { SsoProvider, SsoTransaction } from './ssoProtocol.js'

const uuid = '11111111-1111-4111-8111-111111111111'
const input = {
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
  TRUSTED_ORIGINS: 'https://app.example.test',
  BETTER_AUTH_URL: 'https://app.example.test',
  BETTER_AUTH_SECRET: 'test-auth-placeholder-only-1234567890',
  GUEST_COOKIE_SECRET: 'test-guest-placeholder-only-1234567890',
  GOOGLE_CLIENT_ID: 'test-google',
  GOOGLE_CLIENT_SECRET: 'placeholder',
  APPLE_CLIENT_ID: 'test-apple',
  APPLE_CLIENT_SECRET: 'placeholder',
  AUTH_EMAIL_FROM: 'placeholder@example.test',
  AUTH_EMAIL_DELIVERY_MODE: 'webhook',
  AUTH_EMAIL_WEBHOOK_URL: 'https://mail.example.test',
  AUTH_EMAIL_WEBHOOK_SECRET: 'test-webhook-placeholder-only-1234567890',
  AUTH_TRUSTED_PROXY_CIDRS: '127.0.0.1/32'
}
const fixture = (overrides: Record<string, string> = {}) => {
  const environment = parseApiEnvironment({ ...input, ...overrides })
  const states = new Map<string, SsoTransaction>()
  let fresh = false
  let elapsed = 0
  const gatewayQuery = vi.fn(
    async (sql: string, ...args: unknown[]): Promise<unknown> => {
      if (sql.includes('create_sso_transaction_v2')) {
        states.set(String(args[1]), {
          provider: args[0],
          stateDigest: args[1],
          bindingDigest: args[2],
          nonce: args[3],
          codeVerifier: args[4],
          callbackURL: args[5]
        } as SsoTransaction)
        return [{ created: true }]
      }
      if (sql.includes('consume_sso_transaction_v2')) {
        const tx = states.get(String(args[1]))
        if (!tx || tx.provider !== args[0] || tx.bindingDigest !== args[2])
          return []
        states.delete(String(args[1]))
        const { stateDigest: _s, bindingDigest: _b, ...row } = tx
        return [row]
      }
      if (sql.includes('resolve_sso_identity'))
        return [
          {
            result: {
              outcome: 'RESOLVED',
              userId: uuid,
              authorityGeneration: 1,
              role: 'ADMIN',
              accountStatus: 'ACTIVE'
            }
          }
        ]
      if (sql.includes('issue_v1_session'))
        return [
          {
            id: args[4],
            familyId: uuid,
            createdAt: new Date('2026-10-19T00:00:00Z'),
            expiresAt: new Date('2026-10-26T00:00:00Z'),
            authorityGeneration: 1
          }
        ]
      if (sql.includes('confirm_v1_session')) return [{ confirmed: true }]
      if (sql.includes('owned_sign_out')) return [{ signedOut: true }]
      if (sql.includes('refresh_current')) return []
      return []
    }
  )
  const appQuery = vi.fn(
    async (sql: string): Promise<unknown> => [
      {
        userId: uuid,
        name: '관리자',
        role: 'ADMIN',
        targetLevel: null,
        sessionId: uuid,
        createdAt: new Date('2026-10-19T00:00:00Z'),
        expiresAt: new Date('2026-10-26T00:00:00Z'),
        isFresh: sql.includes('phase7_sso_admin_session_is_fresh')
          ? fresh && elapsed < 300_000
          : true
      }
    ]
  )
  const client = (query: unknown) =>
    ({ $queryRawUnsafe: query }) as Pick<PrismaClient, '$queryRawUnsafe'>
  const provider: SsoProvider = {
    authorizationURL: async ({ state, nonce, codeVerifier }) => {
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
      url.search = new URLSearchParams({
        state,
        nonce,
        code_challenge_method: 'S256',
        code_challenge: createHash('sha256')
          .update(codeVerifier)
          .digest('base64url')
      }).toString()
      return url.href
    },
    exchange: vi.fn(async () => ({
      provider: 'google' as const,
      accountId: 'linked-subject',
      email: 'same-contact@example.test',
      name: '관리자'
    }))
  }
  const rateLimiter = { consume: vi.fn(async () => undefined) }
  const auth = createSsoAuthentication({
    environment,
    applicationClient: client(appQuery),
    gatewayClient: client(gatewayQuery),
    rateLimiter,
    providers: { google: provider }
  })
  const cookie = createPhase7SessionCookie({
    token: 'private-current-session',
    secret: environment.BETTER_AUTH_SECRET,
    isProduction: environment.NODE_ENV === 'production',
    rememberMe: true,
    expiresAt: new Date('2026-10-26T00:00:00Z')
  }).split(';')[0]!
  return {
    environment,
    auth,
    gatewayQuery,
    appQuery,
    rateLimiter,
    cookie,
    setFresh: (value: boolean) => {
      fresh = value
    },
    setElapsed: (value: number) => {
      elapsed = value
    }
  }
}

describe('production-shaped SSO composition with CMS disabled (fake DB ports)', () => {
  it('selects current roles/profile and provides public login/callback/Phase7 sign-out/rate limit', async () => {
    const f = fixture()
    expect(createAuthRuntimePlan(f.environment)).toMatchObject({
      ownedAuth: true,
      migrationProfile: 'current',
      applicationRole: 'nihongo_app',
      gatewayRole: 'nihongo_auth_gateway',
      cmsEnabled: false
    })
    const response = await f.auth.gateway.handle(
      new Request('https://app.example.test/api/auth/sign-in/social', {
        method: 'POST',
        headers: {
          Origin: 'https://app.example.test',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ provider: 'google', callbackURL: '/bookmarks' })
      })
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as { url: string }
    const state = new URL(body.url).searchParams.get('state')!
    const binding = response.headers.getSetCookie()[0]!.split(';')[0]!
    const callback = await f.auth.gateway.handle(
      new Request(
        `https://app.example.test/api/auth/callback/google?state=${state}&code=private-code`,
        { headers: { Cookie: binding } }
      )
    )
    expect(callback.headers.get('Location')).toBe(
      'https://app.example.test/bookmarks'
    )
    expect(callback.headers.get('Set-Cookie')).toContain(
      '__Secure-nihongo.session_token='
    )
    const logout = await f.auth.gateway.handle(
      new Request('https://app.example.test/api/auth/sign-out', {
        method: 'POST',
        headers: {
          Origin: 'https://app.example.test',
          'Content-Type': 'application/json',
          Cookie: f.cookie
        },
        body: '{}'
      })
    )
    expect(logout.status).toBe(200)
    expect(
      f.gatewayQuery.mock.calls.some(([sql]) => sql.includes('owned_sign_out'))
    ).toBe(true)
    expect(f.rateLimiter.consume).toHaveBeenCalled()
    expect(
      f.gatewayQuery.mock.calls.some(([sql]) =>
        /password|credential|verification/iu.test(sql)
      )
    ).toBe(false)
  })
  it('mounts canonical principal and leaves all CMS admin routes absent', async () => {
    const f = fixture()
    const app = createApiApp({
      auth: {
        environment: f.environment,
        ...f.auth,
        guestPrincipalService: {
          resolve: async () => ({ cookie: null, guest: null })
        } as never
      },
      checkReadiness: async () => undefined,
      logger: createJsonLogger('error'),
      questionReader: {
        getQuestion: async () => {
          throw new Error('not used')
        },
        listQuestions: async () => ({
          items: [],
          total: 0,
          page: 1,
          pageSize: 20
        })
      }
    })
    const response = await app.request('/api/v1/admin/questions', {
      headers: { Cookie: f.cookie }
    })
    expect(response.status).toBe(404)
    const user = await f.auth.principalService.getAuthenticatedUser(
      new Headers({ Cookie: f.cookie })
    )
    expect(user?.id).toBe(uuid)
  })
  it('denies ordinary ADMIN sessions and consumes only fresh SSO proof up to the exact five-minute boundary', async () => {
    const f = fixture()
    const app = new Hono<{ Variables: ApiVariables }>()
    app.onError((error, c) =>
      c.json({ code: 'code' in error ? error.code : 'UNKNOWN' }, 401)
    )
    app.use('*', async (c, next) => {
      c.set('rawRequestTarget', c.req.url)
      c.set('requestId', uuid)
      await next()
    })
    const guard = createAdminCommandGuard({
      environment: f.environment,
      principalService: f.auth.principalService,
      assertCapability: async () => undefined,
      rateLimiter: { consume: async () => undefined },
      operationResolver: () => 'approveQuestionVersion'
    })
    app.post('/sensitive', guard, (c) => c.json({ success: true }))
    const command = () =>
      app.request('/sensitive', {
        method: 'POST',
        headers: {
          Cookie: f.cookie,
          Origin: 'https://app.example.test',
          'Content-Type': 'application/json'
        },
        body: '{}'
      })
    expect((await command()).status).toBe(401)
    f.setFresh(true)
    f.setElapsed(299_999)
    expect((await command()).status).toBe(200)
    f.setElapsed(300_000)
    expect((await command()).status).toBe(401)
    expect(
      f.appQuery.mock.calls.every(([sql]) =>
        sql.includes('phase7_sso_admin_session_is_fresh')
      )
    ).toBe(true)
  })
  it('starts without mail configuration and rejects all legacy routes before any DB or mail work', async () => {
    const f = fixture()
    const {
      AUTH_EMAIL_FROM: _from,
      AUTH_EMAIL_DELIVERY_MODE: _delivery,
      AUTH_EMAIL_WEBHOOK_URL: _url,
      AUTH_EMAIL_WEBHOOK_SECRET: _secret,
      ...noMail
    } = input
    expect(() => parseApiEnvironment(noMail)).not.toThrow()
    const before = f.gatewayQuery.mock.calls.length
    for (const path of [
      'sign-in/email',
      'sign-up/email',
      'reset-password',
      'request-password-reset',
      'send-verification-email',
      'verify-email',
      'change-password'
    ]) {
      await expect(
        f.auth.gateway.handle(
          new Request('https://app.example.test/api/auth/' + path, {
            method: 'POST',
            body: '{}'
          })
        )
      ).rejects.toBeInstanceOf(AuthGatewayError)
    }
    expect(f.gatewayQuery.mock.calls.length).toBe(before)
    const service = createAdminReauthenticationService({} as never)
    await expect(
      service.reauthenticate({
        actorId: uuid,
        headers: new Headers(),
        password: 'retired-placeholder',
        rawSessionToken: 'private',
        requestId: uuid
      })
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' })
  })
  it('retains role attestation, both runtime-ready checks and current DB readiness with CMS disabled', async () => {
    const f = fixture()
    const checkReadiness = vi.fn(async () => undefined)
    const query = vi.fn(async () => [])
    const attest = vi.fn(async () => undefined)
    await createOwnedAuthReadiness({
      checkDatabaseReadiness: checkReadiness,
      applicationClient: { $queryRawUnsafe: query } as never,
      gatewayClient: { $queryRawUnsafe: query } as never,
      applicationUrl: f.environment.DATABASE_URL,
      gatewayUrl: f.environment.AUTH_GATEWAY_DATABASE_URL!,
      attest
    })()
    expect(checkReadiness).toHaveBeenCalledOnce()
    expect(attest).toHaveBeenCalledOnce()
    expect(query).toHaveBeenCalledTimes(2)
    expect(attest.mock.calls[0]).toBeDefined()
  })
  it('keeps technical CMS reads available without any legacy reauthentication service and legacy admin404 touches nothing', async () => {
    const f = fixture({ NODE_ENV: 'test', ADMIN_CMS_MODE: 'technical' })
    const listQuestions = vi.fn(async () => ({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0
    }))
    const capability = vi.fn(async () => undefined)
    const app = createApiApp({
      auth: {
        environment: f.environment,
        ...f.auth,
        guestPrincipalService: {} as never
      },
      admin: {
        assertCapability: capability,
        reader: { listQuestions } as unknown as AdminQuestionReader,
        rateLimiter: { consume: async () => undefined }
      },
      checkReadiness: async () => undefined,
      logger: createJsonLogger('error'),
      questionReader: {
        getQuestion: async () => {
          throw new Error('unused')
        },
        listQuestions: async () => ({
          items: [],
          page: 1,
          pageSize: 20,
          total: 0
        })
      }
    })
    const read = await app.request(
      'https://app.example.test/api/v1/admin/questions',
      { headers: { Cookie: f.cookie } }
    )
    expect(read.status).toBe(200)
    expect(listQuestions).toHaveBeenCalledOnce()
    expect(capability).toHaveBeenCalledOnce()
    const before = f.gatewayQuery.mock.calls.length
    const mail = vi.spyOn(globalThis, 'fetch')
    try {
      const retired = await app.request(
        'https://app.example.test/api/v1/admin/reauthentication',
        {
          method: 'POST',
          headers: {
            Cookie: f.cookie,
            Origin: 'https://app.example.test',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ password: 'retired-placeholder' })
        }
      )
      expect(retired.status).toBe(404)
      expect(f.gatewayQuery.mock.calls.length).toBe(before)
      expect(mail).not.toHaveBeenCalled()
      expect(capability).toHaveBeenCalledOnce()
    } finally {
      mail.mockRestore()
    }
  })
  it('rejects missing/wrong gateway authority and unsafe production TLS without weakening CMS mode', () => {
    expect(() =>
      parseApiEnvironment({ ...input, AUTH_GATEWAY_DATABASE_URL: undefined })
    ).toThrow()
    expect(() =>
      parseApiEnvironment({
        ...input,
        AUTH_GATEWAY_DATABASE_URL: input.DATABASE_URL
      })
    ).toThrow()
    expect(() =>
      parseApiEnvironment({
        ...input,
        AUTH_GATEWAY_DATABASE_URL: input.AUTH_GATEWAY_DATABASE_URL.replace(
          '&sslmode=require',
          ''
        )
      })
    ).toThrow()
    expect(() =>
      parseApiEnvironment({ ...input, ADMIN_CMS_MODE: 'technical' })
    ).toThrow()
  })
})

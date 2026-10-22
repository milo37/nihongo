import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { SsoProviderId } from '@nihongo/contracts/auth/sign-in-social'
import { createAuthGateway, AuthGatewayError } from './authGateway.js'
import { parseApiEnvironment } from '../config/env.js'
import { createSsoPublicRuntime } from './ssoPublicRuntime.js'
import { createSsoBindingCookie } from './ssoProtocol.js'
import type {
  SsoProvider,
  SsoTransaction,
  SsoTransactionStore
} from './ssoProtocol.js'
import type { SsoIdentityResult } from './ssoIdentityRepository.js'

const environment = parseApiEnvironment({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://unused:unused@localhost/unused_test',
  BETTER_AUTH_SECRET: 'test-auth-placeholder-only-1234567890',
  GUEST_COOKIE_SECRET: 'test-guest-placeholder-only-1234567890',
  AUTH_EMAIL_FROM: 'test@example.test'
})
const fixture = (provider: SsoProviderId = 'google') => {
  const transactions = new Map<string, SsoTransaction>()
  const store = {
    create: vi.fn(async (value: SsoTransaction) => {
      transactions.set(value.stateDigest, value)
    }),
    consume: vi.fn(
      async (state: string, binding: string, providerId: SsoProviderId) => {
        const transaction = transactions.get(state)
        if (
          !transaction ||
          transaction.bindingDigest !== binding ||
          transaction.provider !== providerId
        )
          return null
        transactions.delete(state)
        const {
          stateDigest: _state,
          bindingDigest: _binding,
          ...result
        } = transaction
        return result
      }
    )
  } satisfies SsoTransactionStore
  const exchange = vi.fn(async () => ({
    provider,
    accountId: 'provider-sub',
    email: 'contact@example.test',
    name: '학습자'
  }))
  const authorizationURL: SsoProvider['authorizationURL'] = async ({
    state,
    nonce,
    codeVerifier
  }) => {
    const url = new URL(
      provider === 'apple'
        ? 'https://appleid.apple.com/auth/authorize'
        : 'https://accounts.google.com/o/oauth2/v2/auth'
    )
    url.search = new URLSearchParams({
      state,
      nonce,
      code_challenge: createHash('sha256')
        .update(codeVerifier)
        .digest('base64url'),
      code_challenge_method: 'S256',
      response_type: 'code',
      ...(provider === 'apple' ? { response_mode: 'form_post' } : {})
    }).toString()
    return url.href
  }
  const signIn = vi.fn(
    async (): Promise<SsoIdentityResult> => ({
      kind: 'SESSION_CONFIRMED',
      token: 'private-session-placeholder',
      createdAt: new Date('2026-10-19T00:00:00Z'),
      expiresAt: new Date('2026-10-26T00:00:00Z')
    })
  )
  const runtime = createSsoPublicRuntime({
    environment,
    providers: { [provider]: { authorizationURL, exchange } },
    store,
    identities: { signIn }
  })
  const rateLimiter = { consume: vi.fn(async () => undefined) }
  const facade = { handle: vi.fn(async () => Response.json({ success: true })) }
  const gateway = createAuthGateway({
    environment: { ...environment, ADMIN_CMS_MODE: 'technical' },
    phase7Facade: facade,
    technicalRateLimiter: rateLimiter,
    ssoRuntime: runtime
  })
  const start = async () => {
    const response = await gateway.handle(
      new Request('http://localhost:3001/api/auth/sign-in/social', {
        method: 'POST',
        headers: {
          Origin: 'http://localhost:5173',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ provider, callbackURL: '/bookmarks?level=N3' })
      })
    )
    const body = (await response.json()) as { url: string; redirect: true }
    const cookie = response.headers.get('Set-Cookie')!.split(';')[0]!
    const state = new URL(body.url).searchParams.get('state')!
    return { response, body, cookie, state }
  }
  const callback = (cookie: string, state: string, extra = '') =>
    provider === 'google'
      ? new Request(
          `http://localhost:3001/api/auth/callback/google?state=${state}&code=private-code${extra}`,
          { headers: { Cookie: cookie } }
        )
      : new Request('https://app.example.test/api/auth/callback/apple', {
          method: 'POST',
          headers: {
            Cookie: cookie,
            'Content-Type': 'application/x-www-form-urlencoded',
            Origin: 'https://appleid.apple.com',
            'Sec-Fetch-Site': 'cross-site'
          },
          body: `state=${state}&code=private-code${extra}`
        })
  return {
    runtime,
    gateway,
    start,
    callback,
    signIn,
    exchange,
    facade,
    rateLimiter,
    store
  }
}

describe('public SSO HTTP boundary', () => {
  it.each(['apple', 'google'] as const)(
    'starts and confirms %s then replays fail closed',
    async (provider) => {
      const f = fixture(provider)
      const { response, cookie, state } = await f.start()
      expect(response.status).toBe(200)
      expect(response.headers.get('Cache-Control')).toBe('private, no-store')
      if (provider === 'apple')
        expect(response.headers.get('Set-Cookie')).toContain(
          'SameSite=None; Max-Age=600; Secure'
        )
      const result = await f.gateway.handle(f.callback(cookie, state))
      expect(result.status).toBe(303)
      expect(result.headers.get('Location')).toBe(
        'http://localhost:5173/bookmarks?level=N3'
      )
      expect(result.headers.get('Set-Cookie')).toContain(
        'nihongo.session_token='
      )
      expect(result.headers.get('Location')).not.toContain('private')
      expect(f.signIn).toHaveBeenCalledOnce()
      const replay = await f.gateway.handle(f.callback(cookie, state))
      expect(replay.headers.get('Location')).toContain('sso=INVALID_CALLBACK')
      expect(f.exchange).toHaveBeenCalledOnce()
      expect(f.signIn).toHaveBeenCalledOnce()
    }
  )
  it('does not exchange without the exact browser cookie or with duplicate state', async () => {
    const f = fixture()
    const { cookie, state } = await f.start()
    expect(
      (await f.gateway.handle(f.callback('', state))).headers.get('Location')
    ).toContain('sso=INVALID_CALLBACK')
    expect(
      (
        await f.gateway.handle(f.callback(cookie, state, `&state=${state}`))
      ).headers.get('Location')
    ).toContain('sso=INVALID_CALLBACK')
    expect(f.exchange).not.toHaveBeenCalled()
    expect(f.signIn).not.toHaveBeenCalled()
  })
  it('keeps provider cancellation finite and does not leak callback secrets', async () => {
    const f = fixture()
    const { cookie, state } = await f.start()
    const result = await f.gateway.handle(
      new Request(
        `http://localhost:3001/api/auth/callback/google?state=${state}&error=access_denied&error_description=private-details`,
        { headers: { Cookie: cookie } }
      )
    )
    expect(result.headers.get('Location')).toContain('sso=CANCELLED')
    expect(result.headers.get('Location')).not.toContain('private')
    expect(f.signIn).not.toHaveBeenCalled()
  })
  it('does not set a session cookie if identity/session confirmation fails', async () => {
    const f = fixture()
    const { cookie, state } = await f.start()
    f.signIn.mockRejectedValue(new Error('private database detail'))
    const result = await f.gateway.handle(f.callback(cookie, state))
    expect(result.headers.get('Location')).toContain('sso=FAILED')
    expect(result.headers.get('Set-Cookie')).not.toContain(
      'nihongo.session_token='
    )
    expect(await result.text()).toBe('')
  })
  it.each([
    'TRANSITION_REQUIRED',
    'IDENTITY_CONFLICT',
    'ACCOUNT_UNAVAILABLE'
  ] as const)('never signs in on %s', async (kind) => {
    const f = fixture()
    const { cookie, state } = await f.start()
    f.signIn.mockResolvedValue({ kind })
    const result = await f.gateway.handle(f.callback(cookie, state))
    expect(result.headers.get('Location')).toContain('sso=FAILED')
    expect(result.headers.get('Set-Cookie')).not.toContain(
      'nihongo.session_token='
    )
  })
  it('unconfigured selected provider returns inline 503 without changing session', async () => {
    const f = fixture('google')
    const response = await f.runtime.start(
      new Request('http://localhost:3001'),
      { provider: 'apple' }
    )
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ code: 'SSO_UNAVAILABLE' })
    expect(response.headers.get('Set-Cookie')).toBeNull()
  })
  it('rejects role/unknown providers and duplicate JSON before store creation', async () => {
    const f = fixture()
    expect(
      (
        await f.runtime.start(new Request('http://localhost:3001'), {
          provider: 'google',
          role: 'ADMIN'
        })
      ).status
    ).toBe(400)
    expect(
      (
        await f.runtime.start(new Request('http://localhost:3001'), {
          provider: 'kakao'
        })
      ).status
    ).toBe(400)
    await expect(
      f.gateway.handle(
        new Request('http://localhost:3001/api/auth/sign-in/social', {
          method: 'POST',
          headers: {
            Origin: 'http://localhost:5173',
            'Content-Type': 'application/json'
          },
          body: '{"provider":"apple","provider":"google"}'
        })
      )
    ).rejects.toMatchObject({ code: 'INVALID_JSON' })
    expect(f.store.create).not.toHaveBeenCalled()
  })
  it('rejects cross-site JSON start, wrong callback method and legacy password routes', async () => {
    const f = fixture()
    await expect(
      f.gateway.handle(
        new Request('http://localhost:3001/api/auth/sign-in/social', {
          method: 'POST',
          headers: {
            Origin: 'https://evil.example',
            'Content-Type': 'application/json'
          },
          body: '{}'
        })
      )
    ).rejects.toBeInstanceOf(AuthGatewayError)
    for (const path of [
      'sign-in/email',
      'sign-up/email',
      'request-password-reset',
      'reset-password',
      'change-password',
      'verify-email',
      'send-verification-email'
    ]) {
      await expect(
        f.gateway.handle(
          new Request(`http://localhost:3001/api/auth/${path}`, {
            method: 'POST',
            body: '{}'
          })
        )
      ).rejects.toMatchObject({ code: 'AUTH_ROUTE_NOT_FOUND' })
    }
    await expect(
      f.gateway.handle(
        new Request('http://localhost:3001/api/auth/callback/apple')
      )
    ).rejects.toMatchObject({ code: 'AUTH_ROUTE_NOT_FOUND' })
    expect(f.facade.handle).not.toHaveBeenCalled()
  })
  it('rejects oversized Apple form and cross-provider cookie bindings', async () => {
    const f = fixture('apple')
    const { state } = await f.start()
    const wrongCookie = createSsoBindingCookie(
      'b'.repeat(43),
      false,
      'google'
    ).split(';')[0]!
    const invalid = await f.gateway.handle(f.callback(wrongCookie, state))
    expect(invalid.headers.get('Location')).toContain('sso=INVALID_CALLBACK')
    const response = await f.runtime.callback(
      new Request('https://app.example.test/api/auth/callback/apple', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'x='.padEnd(9000, 'a')
      }),
      'apple'
    )
    expect(response.headers.get('Location')).toContain('sso=FAILED')
    expect(f.exchange).not.toHaveBeenCalled()
  })
})

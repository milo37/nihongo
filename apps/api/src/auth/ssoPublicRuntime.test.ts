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
import type {
  SsoConsent,
  SsoConsentState,
  SsoIdentityResult
} from './ssoIdentityRepository.js'

const environment = parseApiEnvironment({
  NODE_ENV: 'test',
  DATABASE_URL:
    'postgresql://nihongo_test_app_login:unused@127.0.0.1:5432/nihongo_test?schema=nihongo_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa_test',
  BETTER_AUTH_SECRET: 'test-auth-placeholder-only-1234567890',
  GUEST_COOKIE_SECRET: 'test-guest-placeholder-only-1234567890'
})
const fixture = (
  provider: SsoProviderId = 'google',
  consent: SsoConsentState = 'PROCEED'
) => {
  let clock = Date.parse('2026-11-17T05:00:00Z')
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
  // JLP-718: Google also returns a revoke closure, as the real provider does.
  const exchange = vi.fn(async () => ({
    provider,
    accountId: 'provider-sub',
    email: 'contact@example.test',
    name: '학습자',
    ...(provider === 'google' ? { revokeGrant: async () => true } : {})
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
  const consentState = vi.fn(
    async (): Promise<SsoConsent> =>
      consent === 'EXISTING'
        ? { state: consent, memberName: '  Existing Member Name ' }
        : { state: consent }
  )
  const signUpWithConsent = vi.fn(
    async (): Promise<SsoIdentityResult> => ({
      kind: 'SESSION_CONFIRMED',
      token: 'private-session-placeholder',
      createdAt: new Date('2026-11-17T05:01:00Z'),
      expiresAt: new Date('2026-11-24T05:01:00Z')
    })
  )
  const runtime = createSsoPublicRuntime({
    environment,
    providers: { [provider]: { authorizationURL, exchange } },
    store,
    identities: { signIn, consentState, signUpWithConsent },
    now: () => clock
  })
  const rateLimiter = { consume: vi.fn(async () => undefined) }
  const facade = { handle: vi.fn(async () => Response.json({ success: true })) }
  const gateway = createAuthGateway({
    environment,
    ownedAuthFacade: facade,
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
    consentState,
    signUpWithConsent,
    exchange,
    facade,
    rateLimiter,
    store,
    advance: (milliseconds: number) => {
      clock += milliseconds
    }
  }
}
const pendingOf = (response: Response): string =>
  response.headers
    .getSetCookie()
    .find((value) => value.startsWith('nihongo.sso_signup_pending='))!
    .split(';')[0]!
const consentRequest = (
  method: 'GET' | 'POST',
  cookie: string,
  body?: unknown,
  path = '/api/auth/sso/signup-consent'
) =>
  new Request(`http://localhost:3001${path}`, {
    method,
    headers: {
      Cookie: cookie,
      ...(method === 'POST'
        ? {
            Origin: 'http://localhost:5173',
            'Content-Type': 'application/json'
          }
        : {})
    },
    ...(method === 'POST' ? { body: JSON.stringify(body) } : {})
  })

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
  // #1131 QA: the revoke closure must not reach the strict identity schemas.
  it('passes only the plain identity to consent and sign-in', async () => {
    const f = fixture('google')
    const { cookie, state } = await f.start()
    await f.gateway.handle(f.callback(cookie, state))
    const identity = {
      provider: 'google',
      accountId: 'provider-sub',
      email: 'contact@example.test',
      name: '학습자'
    }
    expect(f.consentState).toHaveBeenCalledWith(identity)
    expect(f.signIn).toHaveBeenCalledWith(identity, expect.anything())
  })
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

describe('sign-up consent before the account (#1085)', () => {
  it.each(['NEW', 'EXISTING'] as const)(
    'returns %s to the login page with a pending and no session',
    async (kind) => {
      const f = fixture('google', kind)
      const { cookie, state } = await f.start()
      const result = await f.gateway.handle(f.callback(cookie, state))
      expect(result.status).toBe(303)
      expect(result.headers.get('Location')).toBe(
        'http://localhost:5173/login?sso=CONSENT_REQUIRED&redirect=%2Fbookmarks%3Flevel%3DN3'
      )
      const cookies = result.headers.getSetCookie()
      expect(cookies.join('\n')).not.toContain('nihongo.session_token=')
      const pending = cookies.find((v) =>
        v.startsWith('nihongo.sso_signup_pending=')
      )!
      expect(pending).toContain('HttpOnly; SameSite=Lax; Max-Age=600')
      // Encrypted: neither the email nor the name is readable.
      const value = pending.split(';')[0]!.split('=')[1]!
      expect(Buffer.from(value, 'base64url').toString('latin1')).not.toMatch(
        /contact@example|provider-sub/u
      )
      expect(f.signIn).not.toHaveBeenCalled()
      const read = await f.gateway.handle(
        consentRequest('GET', pendingOf(result))
      )
      expect(read.status).toBe(200)
      expect(await read.json()).toEqual({
        kind,
        expiresAt: '2026-11-17T05:10:00.000Z',
        redirect: '/bookmarks?level=N3',
        // #1096: NEW prefills the provider name, EXISTING the current name,
        // trimmed and cut to 12 characters.
        nicknameDefault: kind === 'NEW' ? '학습자' : 'Existing Mem'
      })
    }
  )

  it('creates the account with its consent and sets the session on agree', async () => {
    const f = fixture('google', 'NEW')
    const { cookie, state } = await f.start()
    const pending = pendingOf(await f.gateway.handle(f.callback(cookie, state)))
    for (const [body, code] of [
      [{ nickname: '하루', ageConfirmed: true }, 'SIGNUP_CONSENT_REQUIRED'],
      // #1096: a bad nickname answers first, with or without the boxes.
      [{ nickname: ' 하 ', ageConfirmed: true }, 'SIGNUP_NICKNAME_INVALID'],
      [{ ageConfirmed: true, termsConfirmed: true }, 'SIGNUP_NICKNAME_INVALID'],
      [
        { nickname: '하'.repeat(13), ageConfirmed: true, termsConfirmed: true },
        'SIGNUP_NICKNAME_INVALID'
      ]
    ] as const) {
      const missing = await f.gateway.handle(
        consentRequest('POST', pending, body)
      )
      expect(missing.status).toBe(400)
      expect(await missing.json()).toEqual({ code })
    }
    expect(f.signUpWithConsent).not.toHaveBeenCalled()
    const agreed = await f.gateway.handle(
      consentRequest('POST', pending, {
        nickname: '  하루 마루 ',
        ageConfirmed: true,
        termsConfirmed: true
      })
    )
    expect(agreed.status).toBe(200)
    expect(await agreed.json()).toEqual({
      signedIn: true,
      redirect: '/bookmarks?level=N3'
    })
    const cookies = agreed.headers.getSetCookie().join('\n')
    expect(cookies).toContain('nihongo.session_token=')
    expect(cookies).toContain('nihongo.sso_signup_pending=; Path=/')
    expect(f.signUpWithConsent).toHaveBeenCalledWith(
      {
        provider: 'google',
        accountId: 'provider-sub',
        email: 'contact@example.test',
        name: '학습자'
      },
      '하루 마루',
      expect.objectContaining({ ipAddress: 'unresolved' })
    )
    expect(f.signIn).not.toHaveBeenCalled()
  })

  it('cancels with nothing stored and refuses a stale, forged or missing pending', async () => {
    const f = fixture('google', 'NEW')
    const { cookie, state } = await f.start()
    const pending = pendingOf(await f.gateway.handle(f.callback(cookie, state)))
    const cancelled = await f.gateway.handle(
      consentRequest('POST', pending, {}, '/api/auth/sso/signup-consent/cancel')
    )
    expect(cancelled.status).toBe(200)
    expect(await cancelled.json()).toEqual({ cancelled: true })
    expect(cancelled.headers.get('Set-Cookie')).toContain(
      'nihongo.sso_signup_pending=; Path=/'
    )
    const body = { nickname: '하루', ageConfirmed: true, termsConfirmed: true }
    const forged = `${pending.slice(0, -4)}AAAA`
    for (const value of [forged, '']) {
      const response = await f.gateway.handle(
        consentRequest('POST', value, body)
      )
      expect(response.status).toBe(404)
      expect(await response.json()).toEqual({ code: 'SIGNUP_PENDING_EXPIRED' })
    }
    f.advance(600_000)
    const late = await f.gateway.handle(consentRequest('POST', pending, body))
    expect(late.status).toBe(404)
    expect(await late.json()).toEqual({ code: 'SIGNUP_PENDING_EXPIRED' })
    expect(f.signUpWithConsent).not.toHaveBeenCalled()
    await expect(
      f.gateway.handle(
        new Request('http://localhost:3001/api/auth/sso/signup-consent', {
          method: 'POST',
          headers: {
            Cookie: pending,
            Origin: 'https://evil.example',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body)
        })
      )
    ).rejects.toBeInstanceOf(AuthGatewayError)
  })

  it('answers 409 when the identity can no longer sign up', async () => {
    const f = fixture('google', 'EXISTING')
    f.signUpWithConsent.mockResolvedValueOnce({ kind: 'TRANSITION_REQUIRED' })
    const { cookie, state } = await f.start()
    const pending = pendingOf(await f.gateway.handle(f.callback(cookie, state)))
    const response = await f.gateway.handle(
      consentRequest('POST', pending, {
        nickname: '하루',
        ageConfirmed: true,
        termsConfirmed: true
      })
    )
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ code: 'SIGNUP_UNAVAILABLE' })
    expect(response.headers.get('Set-Cookie')).not.toContain(
      'nihongo.session_token='
    )
  })
})

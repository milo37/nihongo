import { describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  createAuthorizationURL: vi.fn(),
  validateAuthorizationCode: vi.fn(),
  verifyProviderIdToken: vi.fn(),
  getUserInfo: vi.fn()
}))
vi.mock('better-auth/social-providers', () => ({ google: () => mocks }))
vi.mock('better-auth/oauth2', () => ({
  verifyProviderIdToken: mocks.verifyProviderIdToken
}))
import {
  createGoogleSsoProvider,
  revokeGoogleToken
} from './ssoGoogleProvider.js'

const create = () =>
  createGoogleSsoProvider({
    clientId: 'test-client-id',
    clientSecret: 'test-placeholder-only',
    callbackURL: 'http://localhost:3001/api/auth/callback/google'
  })

describe('Google SSO token verification boundary', () => {
  it('verifies signature/issuer/audience/expiry and exact nonce before reading claims', async () => {
    vi.clearAllMocks()
    mocks.validateAuthorizationCode.mockResolvedValue({
      idToken: 'test-id-token'
    })
    mocks.verifyProviderIdToken.mockResolvedValue(true)
    mocks.getUserInfo.mockResolvedValue({
      user: {
        email: 'CONTACT@example.test',
        emailVerified: true,
        name: '학습자',
        role: 'ADMIN'
      },
      data: { sub: 'google-sub' }
    })
    expect(
      await create().exchange({
        code: 'test-code',
        nonce: 'expected-nonce',
        codeVerifier: 'pkce'
      })
    ).toEqual({
      provider: 'google',
      accountId: 'google-sub',
      email: 'contact@example.test',
      name: '학습자'
    })
    expect(mocks.verifyProviderIdToken).toHaveBeenCalledWith(
      mocks,
      'test-id-token',
      'expected-nonce'
    )
    expect(
      mocks.verifyProviderIdToken.mock.invocationCallOrder[0]!
    ).toBeLessThan(mocks.getUserInfo.mock.invocationCallOrder[0]!)
  })
  it('rejects wrong nonce/signature without decoding a profile', async () => {
    vi.clearAllMocks()
    mocks.validateAuthorizationCode.mockResolvedValue({
      idToken: 'test-id-token'
    })
    mocks.verifyProviderIdToken.mockResolvedValue(false)
    expect(
      await create().exchange({
        code: 'test-code',
        nonce: 'wrong-nonce',
        codeVerifier: 'pkce'
      })
    ).toBeNull()
    expect(mocks.getUserInfo).not.toHaveBeenCalled()
  })
  it('rejects missing ID token and unverified contact email', async () => {
    vi.clearAllMocks()
    mocks.validateAuthorizationCode.mockResolvedValue({})
    expect(
      await create().exchange({
        code: 'code',
        nonce: 'nonce',
        codeVerifier: 'pkce'
      })
    ).toBeNull()
    expect(mocks.verifyProviderIdToken).not.toHaveBeenCalled()
    mocks.validateAuthorizationCode.mockResolvedValue({ idToken: 'token' })
    mocks.verifyProviderIdToken.mockResolvedValue(true)
    mocks.getUserInfo.mockResolvedValue({
      user: {
        email: 'contact@example.test',
        emailVerified: false,
        name: 'name'
      },
      data: { sub: 'sub' }
    })
    expect(
      await create().exchange({
        code: 'code',
        nonce: 'nonce',
        codeVerifier: 'pkce'
      })
    ).toBeNull()
  })
  it('rejects a profile without a verified raw provider subject', async () => {
    vi.clearAllMocks()
    mocks.validateAuthorizationCode.mockResolvedValue({ idToken: 'token' })
    mocks.verifyProviderIdToken.mockResolvedValue(true)
    mocks.getUserInfo.mockResolvedValue({
      user: {
        email: 'contact@example.test',
        emailVerified: true,
        name: 'name'
      },
      data: {}
    })
    expect(
      await create().exchange({
        code: 'code',
        nonce: 'nonce',
        codeVerifier: 'pkce'
      })
    ).toBeNull()
  })
  it('adds an OIDC nonce and uses the fixed callback for authorization', async () => {
    mocks.createAuthorizationURL.mockResolvedValue(
      new URL('https://accounts.google.com/o/oauth2/v2/auth')
    )
    const url = await create().authorizationURL({
      state: 'state',
      nonce: 'nonce',
      codeVerifier: 'pkce'
    })
    expect(new URL(url).searchParams.get('nonce')).toBe('nonce')
    expect(mocks.createAuthorizationURL).toHaveBeenCalledWith({
      state: 'state',
      codeVerifier: 'pkce',
      redirectURI: 'http://localhost:3001/api/auth/callback/google'
    })
  })
  it.each([
    'https://evil.example/not-callback',
    'https://service.example/api/auth/callback/google?redirect=evil',
    'https://user@service.example/api/auth/callback/google',
    'http://service.example/api/auth/callback/google'
  ])('rejects invalid callback %s', (callbackURL) => {
    expect(() =>
      createGoogleSsoProvider({
        clientId: 'test',
        clientSecret: 'placeholder',
        callbackURL
      })
    ).toThrow('Invalid SSO callback origin.')
  })
})

describe('JLP-718 Google grant revoke', () => {
  const answer = (status: number, body: unknown = {}) =>
    vi.fn(async () => Response.json(body, { status }))

  it('posts the token as a form and treats an already revoked token as done', async () => {
    const ok = answer(200)
    expect(await revokeGoogleToken('access-token', ok)).toBe(true)
    const [url, init] = ok.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://oauth2.googleapis.com/revoke')
    expect(init.method).toBe('POST')
    expect(String(init.body)).toBe('token=access-token')
    expect(
      await revokeGoogleToken('t', answer(400, { error: 'invalid_token' }))
    ).toBe(true)
    for (const failed of [
      answer(400, { error: 'invalid_request' }),
      answer(503)
    ])
      expect(await revokeGoogleToken('t', failed)).toBe(false)
  })

  it('the exchange carries a revoke for its own access token, never the token', async () => {
    vi.clearAllMocks()
    mocks.validateAuthorizationCode.mockResolvedValue({
      idToken: 'test-id-token',
      accessToken: 'exchange-access-token'
    })
    mocks.verifyProviderIdToken.mockResolvedValue(true)
    mocks.getUserInfo.mockResolvedValue({
      user: { email: 'a@example.test', emailVerified: true, name: '학습자' },
      data: { sub: 'google-sub' }
    })
    const fetchMock = answer(200)
    const identity = await createGoogleSsoProvider({
      clientId: 'test-client-id',
      clientSecret: 'test-placeholder-only',
      callbackURL: 'http://localhost:3001/api/auth/callback/google',
      fetch: fetchMock
    }).exchange({ code: 'c', nonce: 'n', codeVerifier: 'v' })
    expect(JSON.stringify(identity)).not.toContain('exchange-access-token')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(await identity?.revokeGrant?.()).toBe(true)
    expect(
      String(
        (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body
      )
    ).toBe('token=exchange-access-token')
  })
})

import { describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  createAuthorizationURL: vi.fn(),
  validateAuthorizationCode: vi.fn(),
  verifyIdToken: vi.fn(),
  getUserInfo: vi.fn()
}))
vi.mock('better-auth/social-providers', () => ({ google: () => mocks }))
import { createGoogleSsoProvider } from './ssoGoogleProvider.js'

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
    mocks.verifyIdToken.mockResolvedValue(true)
    mocks.getUserInfo.mockResolvedValue({
      user: {
        id: 'google-sub',
        email: 'CONTACT@example.test',
        emailVerified: true,
        name: '학습자',
        role: 'ADMIN'
      }
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
    expect(mocks.verifyIdToken).toHaveBeenCalledWith(
      'test-id-token',
      'expected-nonce'
    )
    expect(mocks.verifyIdToken.mock.invocationCallOrder[0]!).toBeLessThan(
      mocks.getUserInfo.mock.invocationCallOrder[0]!
    )
  })
  it('rejects wrong nonce/signature without decoding a profile', async () => {
    vi.clearAllMocks()
    mocks.validateAuthorizationCode.mockResolvedValue({
      idToken: 'test-id-token'
    })
    mocks.verifyIdToken.mockResolvedValue(false)
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
    expect(mocks.verifyIdToken).not.toHaveBeenCalled()
    mocks.validateAuthorizationCode.mockResolvedValue({ idToken: 'token' })
    mocks.verifyIdToken.mockResolvedValue(true)
    mocks.getUserInfo.mockResolvedValue({
      user: {
        id: 'sub',
        email: 'contact@example.test',
        emailVerified: false,
        name: 'name'
      }
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

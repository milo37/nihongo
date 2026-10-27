import { describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  createAuthorizationURL: vi.fn(),
  validateAuthorizationCode: vi.fn(),
  verifyProviderIdToken: vi.fn(),
  getUserInfo: vi.fn()
}))
vi.mock('better-auth/social-providers', () => ({ apple: () => mocks }))
vi.mock('better-auth/oauth2', () => ({
  verifyProviderIdToken: mocks.verifyProviderIdToken
}))
import { createAppleSsoProvider } from './ssoAppleProvider.js'
import { createSsoBindingCookie, createSsoLoginService } from './ssoProtocol.js'
import type { SsoTransaction } from './ssoProtocol.js'

const create = () =>
  createAppleSsoProvider({
    clientId: 'apple-service-id',
    clientSecret: 'test-placeholder-only',
    callbackURL: 'https://app.example.test/api/auth/callback/apple'
  })

describe('Apple SSO boundary', () => {
  it('uses code-only form_post with nonce and an exact HTTPS callback', async () => {
    mocks.createAuthorizationURL.mockResolvedValue(
      new URL(
        'https://appleid.apple.com/auth/authorize?response_type=code+id_token&response_mode=form_post'
      )
    )
    const url = new URL(
      await create().authorizationURL({
        state: 'state',
        nonce: 'nonce',
        codeVerifier: 'verifier'
      })
    )
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('response_mode')).toBe('form_post')
    expect(url.searchParams.get('nonce')).toBe('nonce')
    expect(createSsoBindingCookie('b'.repeat(43), false, 'apple')).toContain(
      'SameSite=None; Max-Age=600; Secure'
    )
  })
  it('verifies nonce/signature before decoding and preserves provider/sub as identity', async () => {
    vi.clearAllMocks()
    mocks.validateAuthorizationCode.mockResolvedValue({
      idToken: 'signed-test-token'
    })
    mocks.verifyProviderIdToken.mockResolvedValue(true)
    mocks.getUserInfo.mockResolvedValue({
      user: {
        email: 'relay@privaterelay.appleid.com',
        emailVerified: true,
        name: '',
        role: 'ADMIN'
      },
      data: { sub: 'same-sub-across-providers' }
    })
    expect(
      await create().exchange({
        code: 'code',
        nonce: 'nonce',
        codeVerifier: 'verifier'
      })
    ).toEqual({
      provider: 'apple',
      accountId: 'same-sub-across-providers',
      email: 'relay@privaterelay.appleid.com',
      name: '학습자'
    })
    expect(mocks.verifyProviderIdToken).toHaveBeenCalledWith(
      mocks,
      'signed-test-token',
      'nonce'
    )
    expect(
      mocks.verifyProviderIdToken.mock.invocationCallOrder[0]!
    ).toBeLessThan(mocks.getUserInfo.mock.invocationCallOrder[0]!)
  })
  it('rejects wrong nonce/signature without a profile read', async () => {
    vi.clearAllMocks()
    mocks.validateAuthorizationCode.mockResolvedValue({ idToken: 'token' })
    mocks.verifyProviderIdToken.mockResolvedValue(false)
    expect(
      await create().exchange({
        code: 'code',
        nonce: 'nonce',
        codeVerifier: 'verifier'
      })
    ).toBeNull()
    expect(mocks.getUserInfo).not.toHaveBeenCalled()
  })
  it('rejects a profile without a verified raw provider subject', async () => {
    vi.clearAllMocks()
    mocks.validateAuthorizationCode.mockResolvedValue({ idToken: 'token' })
    mocks.verifyProviderIdToken.mockResolvedValue(true)
    mocks.getUserInfo.mockResolvedValue({
      user: {
        email: 'relay@privaterelay.appleid.com',
        emailVerified: true,
        name: 'name'
      },
      data: {}
    })
    expect(
      await create().exchange({
        code: 'code',
        nonce: 'nonce',
        codeVerifier: 'verifier'
      })
    ).toBeNull()
  })
  it('rejects a verified identity from another provider even when email/sub match', async () => {
    const transaction: Omit<SsoTransaction, 'stateDigest' | 'bindingDigest'> = {
      provider: 'apple',
      nonce: 'n'.repeat(43),
      codeVerifier: 'v'.repeat(86),
      callbackURL: '/bookmarks'
    }
    const exchange = vi.fn(async () => ({
      provider: 'google' as const,
      accountId: 'same-sub-across-providers',
      email: 'relay@privaterelay.appleid.com',
      name: '학습자'
    }))
    const service = createSsoLoginService({
      providerId: 'apple',
      provider: { authorizationURL: vi.fn(), exchange },
      store: { create: vi.fn(), consume: vi.fn(async () => transaction) }
    })
    const result = await service.finish({
      query: new URLSearchParams({ state: 's'.repeat(43), code: 'code' }),
      binding: 'b'.repeat(43)
    })
    expect(result.kind).toBe('FAILED')
  })
  it('rejects a Google transaction on an Apple callback before token exchange', async () => {
    const exchange = vi.fn()
    const service = createSsoLoginService({
      providerId: 'apple',
      provider: { authorizationURL: vi.fn(), exchange },
      store: {
        create: vi.fn(),
        consume: vi.fn(async () => ({
          provider: 'google' as const,
          nonce: 'n'.repeat(43),
          codeVerifier: 'v'.repeat(86),
          callbackURL: '/'
        }))
      }
    })
    expect(
      (
        await service.finish({
          query: new URLSearchParams({ state: 's'.repeat(43), code: 'code' }),
          binding: 'b'.repeat(43)
        })
      ).kind
    ).toBe('INVALID_CALLBACK')
    expect(exchange).not.toHaveBeenCalled()
  })
  it('rejects HTTP/other callback paths', () => {
    for (const host of ['localhost', '127.0.0.1', '[::1]']) {
      expect(() =>
        createAppleSsoProvider({
          clientId: 'test',
          clientSecret: 'placeholder',
          callbackURL: `https://${host}/api/auth/callback/apple`
        })
      ).toThrow()
    }
    expect(() =>
      createAppleSsoProvider({
        clientId: 'test',
        clientSecret: 'placeholder',
        callbackURL: 'http://localhost:3001/api/auth/callback/apple'
      })
    ).toThrow()
    expect(() =>
      createAppleSsoProvider({
        clientId: 'test',
        clientSecret: 'placeholder',
        callbackURL: 'https://app.example.test/api/auth/callback/google'
      })
    ).toThrow()
  })
})

import { createHash } from 'node:crypto'
import { safeAdminFreshReturnPath } from '@nihongo/contracts/auth/admin-fresh-sso'
import { describe, expect, it, vi } from 'vitest'
import {
  createSsoBindingCookie,
  createSsoLoginService,
  readSsoBindingCookie,
  safeSsoReturnPath,
  ssoTransactionDigest,
  SsoUnavailableError
} from './ssoProtocol.js'
import type {
  SsoProvider,
  SsoTransaction,
  SsoTransactionStore,
  SsoVerifiedIdentity
} from './ssoProtocol.js'

const fixture = () => {
  const transactions = new Map<string, SsoTransaction>()
  const store = {
    create: vi.fn(async (transaction: SsoTransaction) => {
      transactions.set(transaction.stateDigest, transaction)
    }),
    consume: vi.fn(
      async (state: string, binding: string, provider = 'google') => {
        const transaction = transactions.get(state)
        if (
          !transaction ||
          transaction.bindingDigest !== binding ||
          transaction.provider !== provider
        )
          return null
        transactions.delete(state)
        return transaction
      }
    )
  } satisfies SsoTransactionStore
  const provider = {
    authorizationURL: vi.fn(async ({ state, nonce, codeVerifier }) => {
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
    }),
    exchange: vi.fn(
      async (): Promise<SsoVerifiedIdentity | null> => ({
        provider: 'google' as const,
        accountId: 'provider-subject',
        email: 'contact@example.test',
        name: '학습자'
      })
    )
  } satisfies SsoProvider
  const service = createSsoLoginService({ provider, store })
  return { provider, service, store, transactions }
}

const callback = (url: string) =>
  new URLSearchParams({
    state: new URL(url).searchParams.get('state')!,
    code: 'authorization-code'
  })

describe('SSO return policy', () => {
  it.each([
    'https://evil.example/path',
    '//evil.example',
    '/\\evil.example',
    '/login?redirect=/practice',
    '/reset-password',
    '/api/auth/callback/google',
    '/practice/../login',
    '/practice/%2e%2e/login',
    '/%2f%2fevil.example',
    '/practice#token',
    '/practice?token=secret',
    '/practice?page=1&page=2',
    '/practice\n',
    '/admin/questions/../login'
  ])('replaces unsafe/self-return destination %s', (path) => {
    expect(safeSsoReturnPath(path)).toBe('/')
  })
  it('preserves a business path and supported filters', () => {
    expect(
      safeSsoReturnPath('/bookmarks?level=N3&subject=READING&page=2')
    ).toBe('/bookmarks?level=N3&subject=READING&page=2')
    expect(
      safeSsoReturnPath(
        '/practice/session/11111111-1111-4111-8111-111111111111'
      )
    ).toBe('/practice/session/11111111-1111-4111-8111-111111111111')
  })
})

describe('browser-bound one-use SSO protocol', () => {
  it('stores digests, sends PKCE/nonce and returns only a verified provider identity', async () => {
    const { provider, service, store } = fixture()
    const start = await service.start('/bookmarks?page=2')
    const state = new URL(start.url).searchParams.get('state')!
    const saved = store.create.mock.calls[0]![0]
    expect(saved.stateDigest).toBe(ssoTransactionDigest(state))
    expect(saved.bindingDigest).toBe(ssoTransactionDigest(start.binding))
    expect(saved.stateDigest).not.toBe(state)
    expect(saved.bindingDigest).not.toBe(start.binding)
    const result = await service.finish({
      query: callback(start.url),
      binding: start.binding
    })
    expect(result).toEqual({
      kind: 'IDENTITY_VERIFIED',
      callbackURL: '/bookmarks?page=2',
      identity: {
        provider: 'google',
        accountId: 'provider-subject',
        email: 'contact@example.test',
        name: '학습자'
      }
    })
    expect(provider.exchange).toHaveBeenCalledWith({
      code: 'authorization-code',
      nonce: saved.nonce,
      codeVerifier: saved.codeVerifier
    })
    expect(result).not.toHaveProperty('role')
    expect(result).not.toHaveProperty('token')
  })
  it('rejects another browser without consuming the original transaction', async () => {
    const { provider, service } = fixture()
    const start = await service.start('/dashboard')
    expect(
      (
        await service.finish({
          query: callback(start.url),
          binding: 'x'.repeat(43)
        })
      ).kind
    ).toBe('INVALID_CALLBACK')
    expect(provider.exchange).not.toHaveBeenCalled()
    expect(
      (
        await service.finish({
          query: callback(start.url),
          binding: start.binding
        })
      ).kind
    ).toBe('IDENTITY_VERIFIED')
  })
  it('permits only one concurrent callback and rejects replay', async () => {
    const { provider, service } = fixture()
    const start = await service.start('/')
    const results = await Promise.all(
      [1, 2].map(
        async () =>
          await service.finish({
            query: callback(start.url),
            binding: start.binding
          })
      )
    )
    expect(results.map(({ kind }) => kind).sort()).toEqual([
      'IDENTITY_VERIFIED',
      'INVALID_CALLBACK'
    ])
    expect(provider.exchange).toHaveBeenCalledTimes(1)
  })
  it('rejects expired/missing state before provider access', async () => {
    const { provider, service, transactions } = fixture()
    const start = await service.start('/')
    transactions.clear() // A real store also excludes expired rows atomically.
    expect(
      (
        await service.finish({
          query: callback(start.url),
          binding: start.binding
        })
      ).kind
    ).toBe('INVALID_CALLBACK')
    expect(provider.exchange).not.toHaveBeenCalled()
  })
  it('rejects duplicate parameters and code/error ambiguity', async () => {
    const { provider, service, store } = fixture()
    const start = await service.start('/')
    const duplicate = callback(start.url)
    duplicate.append('state', 'x'.repeat(43))
    const ambiguous = callback(start.url)
    ambiguous.set('error', 'access_denied')
    for (const query of [duplicate, ambiguous]) {
      expect(
        (await service.finish({ query, binding: start.binding })).kind
      ).toBe('INVALID_CALLBACK')
    }
    expect(store.consume).not.toHaveBeenCalled()
    expect(provider.exchange).not.toHaveBeenCalled()
  })
  it('cancellation consumes state, preserves return path and drops raw provider errors', async () => {
    const { provider, service } = fixture()
    const start = await service.start('/dashboard')
    const query = callback(start.url)
    query.delete('code')
    query.set('error', 'access_denied')
    query.set('error_description', 'untrusted-provider-text')
    expect(await service.finish({ query, binding: start.binding })).toEqual({
      kind: 'CANCELLED',
      callbackURL: '/dashboard'
    })
    expect(provider.exchange).not.toHaveBeenCalled()
    expect((await service.finish({ query, binding: start.binding })).kind).toBe(
      'INVALID_CALLBACK'
    )
  })
  it('fails closed on verification/transport/storage failure', async () => {
    for (const boundary of ['verify', 'transport', 'storage']) {
      const { provider, service, store } = fixture()
      const start = await service.start('/bookmarks')
      if (boundary === 'verify') provider.exchange.mockResolvedValueOnce(null)
      if (boundary === 'transport')
        provider.exchange.mockRejectedValueOnce(new Error('private detail'))
      if (boundary === 'storage')
        store.consume.mockRejectedValueOnce(new Error('private detail'))
      const result = await service.finish({
        query: callback(start.url),
        binding: start.binding
      })
      expect(result.kind).toBe('FAILED')
      expect(JSON.stringify(result)).not.toContain('private detail')
    }
  })
  it('does not create state when provider is missing or returns an unsafe URL/PKCE', async () => {
    const { provider, store } = fixture()
    await expect(
      createSsoLoginService({ provider: undefined, store }).start('/')
    ).rejects.toBeInstanceOf(SsoUnavailableError)
    for (const url of [
      'https://evil.example',
      'https://accounts.google.com/o/oauth2/v2/auth?code_challenge_method=S256'
    ]) {
      provider.authorizationURL.mockResolvedValueOnce(url)
      await expect(
        createSsoLoginService({ provider, store }).start('/')
      ).rejects.toBeInstanceOf(SsoUnavailableError)
    }
    expect(store.create).not.toHaveBeenCalled()
  })
  it('uses host-only HttpOnly cookies and rejects duplicate bindings', () => {
    const binding = 'a'.repeat(43)
    const cookie = createSsoBindingCookie(binding, true)
    expect(cookie).toContain('__Host-nihongo.sso_binding=')
    expect(cookie).toContain(
      'Path=/; HttpOnly; SameSite=Lax; Max-Age=600; Secure'
    )
    expect(cookie).not.toContain('Domain=')
    expect(createSsoBindingCookie(null, true)).toContain('Max-Age=0')
    expect(
      readSsoBindingCookie(
        new Headers({ Cookie: `__Host-nihongo.sso_binding=${binding}` }),
        true
      )
    ).toBe(binding)
    expect(
      readSsoBindingCookie(
        new Headers({
          Cookie: `__Host-nihongo.sso_binding=${binding}; __Host-nihongo.sso_binding=${binding}`
        }),
        true
      )
    ).toBeNull()
  })
})

describe('Google fresh report transaction return policy', () => {
  it.each([
    {
      path: '/admin/reports/11111111-1111-4111-8111-111111111111',
      expected: '/admin/reports/11111111-1111-4111-8111-111111111111'
    },
    {
      path: '/admin/reports?status=OPEN&reason=OTHER&page=2',
      expected: '/admin/reports?status=OPEN&reason=OTHER&page=2'
    },
    { path: '/admin/reports?returnTo=%2F%2Fevil.test', expected: '/' }
  ])(
    'binds only the agreed report callback $path',
    async ({ path, expected }) => {
      const { provider, store } = fixture()
      const service = createSsoLoginService({
        provider,
        store,
        purpose: 'ADMIN_FRESH',
        returnPathPolicy: safeAdminFreshReturnPath
      })
      const start = await service.start(path)
      expect(new URL(start.url).searchParams.get('state')).toMatch(/^F/u)
      expect(store.create.mock.calls[0]![0].callbackURL).toBe(expected)
      const result = await service.finish({
        query: callback(start.url),
        binding: start.binding
      })
      expect(result).toMatchObject({
        kind: 'IDENTITY_VERIFIED',
        callbackURL: expected,
        identity: { provider: 'google' }
      })
      expect(result).not.toHaveProperty('role')
      expect(result).not.toHaveProperty('token')
      expect(
        (
          await service.finish({
            query: callback(start.url),
            binding: start.binding
          })
        ).kind
      ).toBe('INVALID_CALLBACK')
      expect(provider.exchange).toHaveBeenCalledTimes(1)
    }
  )
})

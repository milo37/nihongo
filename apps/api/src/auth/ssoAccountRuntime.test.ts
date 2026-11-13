import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { SsoProviderId } from '@nihongo/contracts/auth/sign-in-social'
import type {
  AccountSsoPurpose,
  SsoAccountCapabilities,
  SsoAccountDeletion
} from '@nihongo/contracts/auth/sso-account-management'
import { parseApiEnvironment } from '../config/env.js'
import { createAuthGateway, AuthGatewayError } from './authGateway.js'
import { createSessionCookie } from './sessionCookie.js'
import { createSsoPublicRuntime } from './ssoPublicRuntime.js'
import {
  createSsoAccountRuntime,
  SSO_ACCOUNT_PATHS
} from './ssoAccountRuntime.js'
import type { SsoProvider, SsoTransaction } from './ssoProtocol.js'
import type { SsoIdentityResult } from './ssoIdentityRepository.js'
import type {
  SsoAccountPort,
  SsoAccountContext
} from './ssoAccountRepository.js'
const environment = parseApiEnvironment({
  NODE_ENV: 'test',
  DATABASE_URL:
    'postgresql://nihongo_test_app_login:unused@127.0.0.1:5432/nihongo_test?schema=nihongo_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa_test',
  BETTER_AUTH_SECRET: 'test-auth-placeholder-only-1234567890',
  GUEST_COOKIE_SECRET: 'test-guest-placeholder-only-1234567890'
})
const uid = '11111111-1111-4111-8111-111111111111',
  sid = '22222222-2222-4222-8222-222222222222',
  privateToken = 'synthetic-private-session-token'
const sessionCookie = createSessionCookie({
  isProduction: false,
  secret: environment.BETTER_AUTH_SECRET,
  token: privateToken,
  now: new Date(),
  expiresAt: new Date(Date.now() + 86400000),
  rememberMe: false
}).split(';')[0]!
const pairs = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((v) => v.split(';')[0]!)
    .join('; ')
const capabilities: SsoAccountCapabilities = {
  providers: [
    {
      provider: 'google',
      reauthAvailable: true,
      canUnlink: false,
      unlinkBlockedReason: 'LAST_SIGN_IN_METHOD'
    }
  ],
  linkableProviders: ['apple'],
  unlinkRequiresFresh: false,
  canDelete: true,
  deletionBlockedReason: null,
  deleteRequiresFresh: true,
  freshVerified: false
}
const deletion: SsoAccountDeletion = {
  appStatus: 'DELETION_PENDING',
  deletionScheduledAt: '2026-11-19T10:00:00.000Z',
  providerCleanup: [{ provider: 'google', status: 'PENDING' }]
}
const restore = {
  userId: uid,
  requestId: '33333333-3333-4333-8333-333333333333',
  authorityGeneration: 4,
  deletionScheduledAt: '2026-11-19T10:00:00.000Z'
}
const fixture = () => {
  const transactions = new Map<
      string,
      SsoTransaction & { context: SsoAccountContext }
    >(),
    proofs = new Map<
      string,
      { context: SsoAccountContext; callbackURL: string }
    >()
  const controls = {
    wrongIdentity: false,
    stale: false,
    fail: false,
    allowLogin: false,
    restorable: false,
    restoreCode: null as
      | null
      | 'SSO_ACCOUNT_RESTORE_UNAVAILABLE'
      | 'SSO_ACCOUNT_RESTORE_TOO_LATE'
  }
  let receiptDigest = ''
  const port = {
    prepare: vi.fn(
      async (
        token: string,
        provider: SsoProviderId,
        purpose: AccountSsoPurpose,
        proof: string | null
      ): Promise<SsoAccountContext | null> =>
        token !== privateToken || (purpose === 'ACCOUNT_LINK' && !proof)
          ? null
          : {
              purpose,
              provider,
              accountId:
                purpose === 'ACCOUNT_FRESH' ? 'synthetic-linked-sub' : null,
              userId: uid,
              sessionId: sid,
              role: 'USER',
              authorityGeneration: 1,
              tokenDigest: 'a'.repeat(64),
              ...(purpose === 'ACCOUNT_LINK'
                ? { freshProofDigest: proof! }
                : {})
            }
    ),
    create: vi.fn(async (tx: SsoTransaction, context: SsoAccountContext) => {
      transactions.set(tx.stateDigest, { ...tx, context })
    }),
    consume: vi.fn(
      async (
        state: string,
        binding: string,
        provider: SsoProviderId,
        purpose: AccountSsoPurpose
      ) => {
        const row = transactions.get(state)
        if (
          !row ||
          row.bindingDigest !== binding ||
          row.provider !== provider ||
          row.context.purpose !== purpose
        )
          return null
        transactions.delete(state)
        const { stateDigest: _s, bindingDigest: _b, ...value } = row
        return value
      }
    ),
    stageProof: vi.fn(
      async (
        context: SsoAccountContext,
        _identity: unknown,
        digest: string,
        callbackURL: string
      ) => {
        proofs.set(digest, { context, callbackURL })
        return true
      }
    ),
    complete: vi.fn(
      async (digest: string, token: string, purpose: AccountSsoPurpose) => {
        const p = proofs.get(digest)
        return !controls.stale &&
          token === privateToken &&
          p?.context.purpose === purpose
          ? p.callbackURL
          : null
      }
    ),
    capabilities: vi.fn(async () =>
      controls.fail
        ? Promise.reject(new Error('synthetic-private-database-payload'))
        : capabilities
    ),
    unlink: vi.fn<SsoAccountPort['unlink']>(async () => ({
      unlinked: true,
      sessionRevoked: true
    })),
    requestErasure: vi.fn(
      async (_token: string, _proof: string | null, digest: string) => {
        receiptDigest = digest
        return deletion
      }
    ),
    erasureStatus: vi.fn(async (digest: string) =>
      digest === receiptDigest ? deletion : null
    ),
    restore: vi.fn<SsoAccountPort['restore']>(async () =>
      controls.restoreCode
        ? { code: controls.restoreCode }
        : {
            kind: 'SESSION_CONFIRMED',
            token: privateToken,
            createdAt: new Date(),
            expiresAt: new Date(Date.now() + 86400000)
          }
    )
  } satisfies SsoAccountPort
  const provider = (id: SsoProviderId): SsoProvider => ({
    authorizationURL: async ({ state, nonce, codeVerifier }) => {
      const url = new URL(
        id === 'apple'
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
        ...(id === 'apple' ? { response_mode: 'form_post' } : {})
      }).toString()
      return url.href
    },
    exchange: async () => ({
      provider: id,
      accountId: controls.wrongIdentity
        ? 'synthetic-other-sub'
        : 'synthetic-linked-sub',
      email: 'contact@example.test',
      name: '학습자'
    })
  })
  const providers = { apple: provider('apple'), google: provider('google') }
  const runtime = createSsoAccountRuntime({ environment, providers, port })
  const signIn = vi.fn(async (): Promise<SsoIdentityResult> => {
    if (controls.restorable) return { kind: 'RESTORE_AVAILABLE', restore }
    if (!controls.allowLogin)
      throw new Error('Account purposes cannot create ordinary LOGIN sessions.')
    return {
      kind: 'SESSION_CONFIRMED' as const,
      token: privateToken,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 86400000)
    }
  })
  const normalTransactions = new Map<string, SsoTransaction>()
  const social = createSsoPublicRuntime({
    environment,
    providers,
    store: {
      create: async (tx) => {
        normalTransactions.set(tx.stateDigest, tx)
      },
      consume: async (state, binding, provider) => {
        const row = normalTransactions.get(state)
        if (!row || row.bindingDigest !== binding || row.provider !== provider)
          return null
        normalTransactions.delete(state)
        const { stateDigest: _s, bindingDigest: _b, ...tx } = row
        return tx
      }
    },
    identities: { signIn },
    accountRuntime: runtime
  })
  const gateway = createAuthGateway({
    environment,
    ownedAuthFacade: { handle: async () => Response.json({ success: true }) },
    technicalRateLimiter: { consume: vi.fn(async () => undefined) },
    ssoRuntime: social,
    ssoAccountRuntime: runtime
  })
  const request = (
    path: string,
    method = 'GET',
    body: unknown = {},
    cookies = sessionCookie,
    origin = 'http://localhost:5173'
  ) =>
    new Request('http://localhost:3001' + path, {
      method,
      headers: {
        Cookie: cookies,
        Origin: origin,
        'Content-Type': 'application/json'
      },
      ...(method === 'POST' ? { body: JSON.stringify(body) } : {})
    })
  const flow = async (
    purpose: AccountSsoPurpose,
    providerId: SsoProviderId = 'google',
    cookies = sessionCookie
  ) => {
    const start = await gateway.handle(
      request(
        '/api/auth/sign-in/social',
        'POST',
        { purpose, provider: providerId, callbackURL: '/login' },
        cookies
      )
    )
    const body = (await start.json()) as { url?: string }
    if (!body.url) throw new Error('Synthetic start did not succeed.')
    const state = new URL(body.url).searchParams.get('state')!
    const callback =
      providerId === 'apple'
        ? new Request('https://app.example.test/api/auth/callback/apple', {
            method: 'POST',
            headers: {
              Cookie: pairs(start),
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({ state, code: 'synthetic-code' })
          })
        : new Request(
            'http://localhost:3001/api/auth/callback/google?' +
              new URLSearchParams({ state, code: 'synthetic-code' }),
            { headers: { Cookie: pairs(start) } }
          )
    const staged = await gateway.handle(callback)
    return {
      start,
      state,
      staged,
      finish: () =>
        gateway.handle(
          new Request(staged.headers.get('Location')!, {
            headers: { Cookie: cookies + '; ' + pairs(staged) }
          })
        )
    }
  }
  return { port, controls, gateway, runtime, signIn, request, flow }
}
describe('SSO account HTTP runtime without DB or external network', () => {
  it('a new canonical LOGIN clears prior account proofs and deletion receipt', async () => {
    const f = fixture()
    f.controls.allowLogin = true
    const start = await f.gateway.handle(
      f.request('/api/auth/sign-in/social', 'POST', {
        provider: 'google',
        callbackURL: '/bookmarks'
      })
    )
    const body = (await start.json()) as { url: string }
    const state = new URL(body.url).searchParams.get('state')!
    const callback = await f.gateway.handle(
      new Request(
        'http://localhost:3001/api/auth/callback/google?' +
          new URLSearchParams({ state, code: 'synthetic-login-code' }),
        {
          headers: {
            Cookie:
              pairs(start) + '; nihongo.sso_account_receipt=' + 'r'.repeat(43)
          }
        }
      )
    )
    expect(callback.status).toBe(303)
    for (const kind of ['fresh', 'link', 'receipt'])
      expect(
        callback.headers
          .getSetCookie()
          .some(
            (value) =>
              value.startsWith('nihongo.sso_account_' + kind + '=;') &&
              value.includes('Max-Age=0')
          )
      ).toBe(true)
  })

  it.each(['google', 'apple'] as const)(
    '%s fresh uses canonical completion, no LOGIN session',
    async (provider) => {
      const f = fixture(),
        roundtrip = await f.flow('ACCOUNT_FRESH', provider)
      expect(roundtrip.state.startsWith('A')).toBe(true)
      expect(f.port.complete).not.toHaveBeenCalled()
      const finished = await roundtrip.finish()
      expect(finished.status).toBe(303)
      expect(
        new URL(finished.headers.get('Location')!).searchParams.get(
          'ssoAccountFresh'
        )
      ).toBe('REAUTHENTICATED')
      expect(finished.headers.get('Set-Cookie')).not.toContain('session_token')
      expect(f.signIn).not.toHaveBeenCalled()
    }
  )
  it('LINK requires existing fresh proof and keeps distinct purpose/outcome', async () => {
    const f = fixture()
    expect(
      (
        await f.gateway.handle(
          f.request('/api/auth/sign-in/social', 'POST', {
            purpose: 'ACCOUNT_LINK',
            provider: 'apple'
          })
        )
      ).status
    ).toBe(403)
    const fresh = await (await f.flow('ACCOUNT_FRESH')).finish()
    const link = await f.flow(
      'ACCOUNT_LINK',
      'apple',
      sessionCookie + '; ' + pairs(fresh)
    )
    expect(link.state.startsWith('L')).toBe(true)
    const finished = await link.finish()
    expect(
      new URL(finished.headers.get('Location')!).searchParams.get(
        'ssoAccountLink'
      )
    ).toBe('LINKED')
    expect(f.signIn).not.toHaveBeenCalled()
  })
  it('wrong provider identity never stages fresh proof', async () => {
    const f = fixture()
    f.controls.wrongIdentity = true
    const r = await f.flow('ACCOUNT_FRESH')
    expect(
      new URL(r.staged.headers.get('Location')!).searchParams.get(
        'ssoAccountFresh'
      )
    ).toBe('FAILED')
    expect(f.port.stageProof).not.toHaveBeenCalled()
  })
  it('missing canonical cookie or stale generation cannot complete', async () => {
    const f = fixture(),
      r = await f.flow('ACCOUNT_FRESH')
    const missing = await f.gateway.handle(
      new Request(r.staged.headers.get('Location')!, {
        headers: { Cookie: pairs(r.staged) }
      })
    )
    expect(
      new URL(missing.headers.get('Location')!).searchParams.get(
        'ssoAccountFresh'
      )
    ).toBe('INVALID_CALLBACK')
    f.controls.stale = true
    expect(
      new URL((await r.finish()).headers.get('Location')!).searchParams.get(
        'ssoAccountFresh'
      )
    ).toBe('FAILED')
  })
  it('capabilities contain only safe linked-provider facts', async () => {
    const f = fixture(),
      r = await f.gateway.handle(f.request(SSO_ACCOUNT_PATHS.capabilities))
    expect(await r.json()).toEqual(capabilities)
    expect(r.headers.get('Cache-Control')).toBe('private, no-store')
    expect(f.port.capabilities).toHaveBeenCalledWith(
      privateToken,
      ['apple', 'google'],
      null
    )
  })
  it('guest, injected target and wrong origin never mutate', async () => {
    const f = fixture()
    expect(
      (
        await f.gateway.handle(
          f.request(
            SSO_ACCOUNT_PATHS.unlink,
            'POST',
            { provider: 'google' },
            ''
          )
        )
      ).status
    ).toBe(401)
    expect(
      (
        await f.gateway.handle(
          f.request(SSO_ACCOUNT_PATHS.unlink, 'POST', {
            provider: 'google',
            userId: uid
          })
        )
      ).status
    ).toBe(400)
    await expect(
      f.gateway.handle(
        f.request(
          SSO_ACCOUNT_PATHS.deletion,
          'POST',
          {},
          sessionCookie,
          'https://evil.test'
        )
      )
    ).rejects.toMatchObject({ code: 'UNTRUSTED_ORIGIN' })
    expect(f.port.unlink).not.toHaveBeenCalled()
    expect(f.port.requestErasure).not.toHaveBeenCalled()
  })
  it.each([
    'SSO_LAST_SIGN_IN_METHOD',
    'SSO_PROVIDER_UNAVAILABLE',
    'SSO_FRESH_REQUIRED'
  ] as const)('typed unlink rejection %s retains session', async (code) => {
    const f = fixture()
    f.port.unlink.mockResolvedValueOnce({ code })
    const r = await f.gateway.handle(
      f.request(SSO_ACCOUNT_PATHS.unlink, 'POST', { provider: 'google' })
    )
    expect(r.status).toBe(code === 'SSO_FRESH_REQUIRED' ? 403 : 409)
    expect(await r.json()).toEqual({ code })
    expect(r.headers.has('Set-Cookie')).toBe(false)
  })
  it('unlink success expires canonical credentials and reports all-family policy', async () => {
    const f = fixture(),
      r = await f.gateway.handle(
        f.request(SSO_ACCOUNT_PATHS.unlink, 'POST', { provider: 'google' })
      )
    expect(await r.json()).toEqual({ unlinked: true, sessionRevoked: true })
    expect(r.headers.get('Set-Cookie')).toContain('Max-Age=0')
  })
  it('delete202 is accepted and private read-only receipt works after logout', async () => {
    const f = fixture(),
      r = await f.gateway.handle(f.request(SSO_ACCOUNT_PATHS.deletion, 'POST'))
    expect(r.status).toBe(202)
    expect(await r.json()).toEqual(deletion)
    const cookie = pairs(r)
    expect(cookie).toContain('nihongo.sso_account_receipt=')
    expect(r.headers.get('Set-Cookie')).toContain('HttpOnly')
    const status = await f.gateway.handle(
      f.request(SSO_ACCOUNT_PATHS.status, 'GET', {}, cookie)
    )
    expect(await status.json()).toEqual(deletion)
    const absent = await f.gateway.handle(
      f.request(SSO_ACCOUNT_PATHS.status, 'GET', {}, '')
    )
    expect(absent.status).toBe(404)
    expect(await absent.json()).toEqual({
      code: 'SSO_DELETION_RECEIPT_UNAVAILABLE'
    })
  })
  describe('JLP-845 restore in the grace period', () => {
    const signInPending = async (f: ReturnType<typeof fixture>) => {
      f.controls.restorable = true
      const start = await f.gateway.handle(
        f.request(
          '/api/auth/sign-in/social',
          'POST',
          { provider: 'google', callbackURL: '/bookmarks' },
          ''
        )
      )
      const body = (await start.json()) as { url: string }
      const state = new URL(body.url).searchParams.get('state')!
      return f.gateway.handle(
        new Request(
          'http://localhost:3001/api/auth/callback/google?' +
            new URLSearchParams({ state, code: 'synthetic-login-code' }),
          { headers: { Cookie: pairs(start) } }
        )
      )
    }
    const restoreCookie = (response: Response) =>
      response.headers
        .getSetCookie()
        .find(
          (v) =>
            v.startsWith('nihongo.sso_account_restore=') &&
            !v.includes('Max-Age=0')
        )
        ?.split(';')[0]

    it('signing in to a pending account issues no session, only a restore proof', async () => {
      const f = fixture()
      const callback = await signInPending(f)
      expect(callback.status).toBe(303)
      const location = new URL(callback.headers.get('Location')!)
      expect(location.pathname).toBe('/login')
      expect(location.searchParams.get('sso')).toBe('RESTORE_AVAILABLE')
      expect(location.searchParams.get('redirect')).toBe('/bookmarks')
      const cookies = callback.headers.getSetCookie()
      expect(
        cookies.some(
          (v) => v.includes('session_token=') && !v.includes('Max-Age=0')
        )
      ).toBe(false)
      const proof = cookies.find((v) =>
        v.startsWith('nihongo.sso_account_restore=')
      )!
      expect(proof).toContain('HttpOnly')
      expect(proof).toContain('Max-Age=600')
      expect(proof).not.toContain(uid)
      const state = await f.gateway.handle(
        f.request(
          SSO_ACCOUNT_PATHS.restore,
          'GET',
          {},
          restoreCookie(callback)!
        )
      )
      expect(state.status).toBe(200)
      expect(await state.json()).toEqual({
        deletionScheduledAt: restore.deletionScheduledAt
      })
    })

    it('restore issues a session and clears the proof', async () => {
      const f = fixture()
      const proof = restoreCookie(await signInPending(f))!
      const r = await f.gateway.handle(
        f.request(SSO_ACCOUNT_PATHS.restore, 'POST', {}, proof)
      )
      expect(r.status).toBe(200)
      expect(await r.json()).toEqual({ restored: true })
      expect(f.port.restore).toHaveBeenCalledExactlyOnceWith(
        restore,
        expect.objectContaining({ userAgent: '' })
      )
      const cookies = r.headers.getSetCookie()
      expect(
        cookies.some(
          (v) => v.includes('session_token=') && !v.includes('Max-Age=0')
        )
      ).toBe(true)
      expect(
        cookies.some(
          (v) =>
            v.startsWith('nihongo.sso_account_restore=;') &&
            v.includes('Max-Age=0')
        )
      ).toBe(true)
    })

    it.each([
      ['SSO_ACCOUNT_RESTORE_TOO_LATE', 409],
      ['SSO_ACCOUNT_RESTORE_UNAVAILABLE', 404]
    ] as const)(
      'restore refusal %s gives %i and no session',
      async (code, status) => {
        const f = fixture()
        const proof = restoreCookie(await signInPending(f))!
        f.controls.restoreCode = code
        const r = await f.gateway.handle(
          f.request(SSO_ACCOUNT_PATHS.restore, 'POST', {}, proof)
        )
        expect(r.status).toBe(status)
        expect(await r.json()).toEqual({ code })
        expect(
          r.headers
            .getSetCookie()
            .some(
              (v) => v.includes('session_token=') && !v.includes('Max-Age=0')
            )
        ).toBe(false)
      }
    )

    it('decline keeps the schedule, clears the proof and calls no restore', async () => {
      const f = fixture()
      const proof = restoreCookie(await signInPending(f))!
      const r = await f.gateway.handle(
        f.request(SSO_ACCOUNT_PATHS.restoreDecline, 'POST', {}, proof)
      )
      expect(r.status).toBe(200)
      expect(await r.json()).toEqual({
        declined: true,
        deletionScheduledAt: restore.deletionScheduledAt
      })
      expect(f.port.restore).not.toHaveBeenCalled()
    })

    it('a missing, forged or expired proof is refused', async () => {
      const f = fixture()
      const proof = restoreCookie(await signInPending(f))!
      const [body, mac] = proof.split('=')[1]!.split('.') as [string, string]
      const forged = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
      forged.userId = '44444444-4444-4444-8444-444444444444'
      for (const cookie of [
        '',
        'nihongo.sso_account_restore=' +
          Buffer.from(JSON.stringify(forged)).toString('base64url') +
          '.' +
          mac
      ]) {
        for (const [path, method] of [
          [SSO_ACCOUNT_PATHS.restore, 'GET'],
          [SSO_ACCOUNT_PATHS.restore, 'POST'],
          [SSO_ACCOUNT_PATHS.restoreDecline, 'POST']
        ] as const) {
          const r = await f.gateway.handle(f.request(path, method, {}, cookie))
          expect(r.status).toBe(404)
          expect(await r.json()).toEqual({
            code: 'SSO_ACCOUNT_RESTORE_UNAVAILABLE'
          })
        }
      }
      expect(f.port.restore).not.toHaveBeenCalled()
      const later = createSsoAccountRuntime({
        environment,
        providers: {},
        port: f.port,
        now: () => Date.now() + 601_000
      })
      const expired = await later.handle(
        f.request(SSO_ACCOUNT_PATHS.restore, 'POST', {}, proof),
        SSO_ACCOUNT_PATHS.restore,
        {}
      )
      expect(expired.status).toBe(404)
    })

    it('restore writes need a trusted origin and an empty body', async () => {
      const f = fixture()
      const proof = restoreCookie(await signInPending(f))!
      await expect(
        f.gateway.handle(
          f.request(
            SSO_ACCOUNT_PATHS.restore,
            'POST',
            {},
            proof,
            'https://evil.example'
          )
        )
      ).rejects.toBeInstanceOf(AuthGatewayError)
      const r = await f.gateway.handle(
        f.request(SSO_ACCOUNT_PATHS.restore, 'POST', { userId: uid }, proof)
      )
      expect(r.status).toBe(400)
      expect(f.port.restore).not.toHaveBeenCalled()
    })
  })
  it('unknown server outcome exposes no database error or success cookies', async () => {
    const f = fixture()
    f.controls.fail = true
    const r = await f.gateway.handle(f.request(SSO_ACCOUNT_PATHS.capabilities))
    expect(r.status).toBe(503)
    expect(await r.json()).toEqual({
      code: 'SSO_ACCOUNT_OPERATION_UNAVAILABLE'
    })
    expect(r.headers.has('Set-Cookie')).toBe(false)
  })
  it('duplicate JSON and query-bearing writes remain blocked by gateway', async () => {
    const f = fixture()
    await expect(
      f.gateway.handle(
        new Request('http://localhost:3001' + SSO_ACCOUNT_PATHS.unlink, {
          method: 'POST',
          headers: {
            Origin: 'http://localhost:5173',
            'Content-Type': 'application/json'
          },
          body: '{"provider":"apple","provider":"google"}'
        })
      )
    ).rejects.toBeInstanceOf(AuthGatewayError)
    await expect(
      f.gateway.handle(
        f.request(SSO_ACCOUNT_PATHS.capabilities + '?userId=other')
      )
    ).rejects.toMatchObject({ code: 'INVALID_AUTH_PAYLOAD' })
  })
})

import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { SsoProviderId } from '@nihongo/contracts/auth/sign-in-social'
import type { ApiEnvironment } from '../config/env.js'
import {
  createSsoAdminFreshRuntime,
  ADMIN_FRESH_COMPLETE_PATH
} from './ssoAdminFreshRuntime.js'
import type {
  AdminFreshContext,
  AdminFreshTransaction,
  SsoAdminFreshPort
} from './ssoAdminFreshRepository.js'
import { createPhase7SessionCookie } from './phase7SessionCookie.js'
import { ssoTransactionDigest } from './ssoProtocol.js'
import type {
  SsoProvider,
  SsoTransaction,
  SsoVerifiedIdentity
} from './ssoProtocol.js'

const environment = {
  NODE_ENV: 'production',
  ADMIN_CMS_MODE: 'disabled',
  BETTER_AUTH_URL: 'https://app.example.test',
  TRUSTED_ORIGINS: ['https://app.example.test'],
  BETTER_AUTH_SECRET: 'test-auth-placeholder-only-1234567890',
  GUEST_COOKIE_SECRET: 'test-guest-placeholder-only-1234567890',
  AUTH_TRUSTED_PROXY_CIDRS: []
} as unknown as ApiEnvironment
const uuid = (n: string) =>
  `${n.repeat(8)}-${n.repeat(4)}-4${n.repeat(3)}-8${n.repeat(3)}-${n.repeat(12)}`
const fixture = (provider: SsoProviderId = 'google') => {
  let role = 'ADMIN'
  let generation = 7
  let activeToken = 'original-private-token'
  let linked = true
  let issueFails = false
  const initialToken = activeToken
  const context: AdminFreshContext = {
    intentId: uuid('1'),
    userId: uuid('2'),
    sessionId: uuid('3'),
    authorityGeneration: 7,
    provider,
    accountId: 'linked-subject'
  }
  const transactions = new Map<
    string,
    SsoTransaction & { context: AdminFreshContext }
  >()
  const proofs = new Map<
    string,
    { context: AdminFreshContext; callbackURL: string }
  >()
  const valid = (ctx: AdminFreshContext) =>
    role === 'ADMIN' && generation === ctx.authorityGeneration && linked
  const port = {
    prepare: vi.fn(async (token: string, p: SsoProviderId) =>
      token === activeToken && p === provider && valid(context) ? context : null
    ),
    create: vi.fn(async (tx: SsoTransaction, ctx: AdminFreshContext) => {
      transactions.set(tx.stateDigest, { ...tx, context: ctx })
    }),
    consume: vi.fn(
      async (
        state: string,
        binding: string,
        p: SsoProviderId
      ): Promise<AdminFreshTransaction | null> => {
        const tx = transactions.get(state)
        if (!tx || tx.bindingDigest !== binding || tx.provider !== p)
          return null
        transactions.delete(state)
        const { stateDigest: _state, bindingDigest: _binding, ...value } = tx
        return value
      }
    ),
    stageProof: vi.fn(
      async (
        ctx: AdminFreshContext,
        identity: SsoVerifiedIdentity,
        digest: string,
        callbackURL: string
      ) => {
        if (
          !valid(ctx) ||
          identity.provider !== ctx.provider ||
          identity.accountId !== ctx.accountId
        )
          return false
        proofs.set(digest, { context: ctx, callbackURL })
        return true
      }
    ),
    complete: vi.fn(async (digest: string, oldToken: string) => {
      const proof = proofs.get(digest)
      if (
        !proof ||
        oldToken !== initialToken ||
        oldToken !== activeToken ||
        !valid(proof.context)
      )
        return null
      if (issueFails) throw new Error('database statement rolled back')
      proofs.delete(digest)
      activeToken = 'replacement-private-token'
      return {
        id: uuid('4'),
        userId: context.userId,
        token: activeToken,
        createdAt: new Date('2026-10-19T00:00:00Z'),
        expiresAt: new Date('2026-10-20T00:00:00Z'),
        callbackURL: proof.callbackURL
      }
    }),
    abort: vi.fn(async () => undefined)
  } satisfies SsoAdminFreshPort
  const exchange = vi.fn<SsoProvider['exchange']>(async () => ({
    provider,
    accountId: context.accountId,
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
      code_challenge_method: 'S256',
      code_challenge: createHash('sha256')
        .update(codeVerifier)
        .digest('base64url'),
      response_type: 'code',
      ...(provider === 'apple' ? { response_mode: 'form_post' } : {})
    }).toString()
    return url.href
  }
  const runtime = createSsoAdminFreshRuntime({
    environment,
    providers: { [provider]: { authorizationURL, exchange } },
    port
  })
  const sessionCookie = (token = activeToken) =>
    createPhase7SessionCookie({
      token,
      secret: environment.BETTER_AUTH_SECRET,
      isProduction: true,
      rememberMe: true,
      expiresAt: new Date('2026-10-26T00:00:00Z')
    }).split(';')[0]!
  const start = async () => {
    const response = await runtime.start(
      new Request('https://app.example.test/api/auth/sign-in/social', {
        headers: { Cookie: sessionCookie() }
      }),
      {
        purpose: 'ADMIN_FRESH',
        provider,
        callbackURL: '/admin/questions?page=2'
      }
    )
    const body = (await response.json()) as { url: string }
    const bindingCookie = response.headers.get('Set-Cookie')!.split(';')[0]!
    return {
      response,
      state: new URL(body.url).searchParams.get('state')!,
      bindingCookie,
      binding: bindingCookie.split('=')[1]!
    }
  }
  const oauth = (state: string, binding: string, extra?: { error?: string }) =>
    runtime.callback(
      new Request('https://app.example.test/api/auth/callback/' + provider),
      provider,
      new URLSearchParams({
        state,
        ...(extra?.error ? { error: extra.error } : { code: 'private-code' })
      }),
      binding
    )
  const finish = (proofCookie: string, token = activeToken) =>
    runtime.complete(
      new Request('https://app.example.test' + ADMIN_FRESH_COMPLETE_PATH, {
        headers: { Cookie: proofCookie + '; ' + sessionCookie(token) }
      })
    )
  const proofCookie = (response: Response) =>
    response.headers
      .getSetCookie()
      .find((value) => value.startsWith('__Host-nihongo.sso_fresh='))!
      .split(';')[0]!
  return {
    runtime,
    port,
    exchange,
    context,
    start,
    oauth,
    finish,
    proofCookie,
    sessionCookie,
    originalToken: initialToken,
    getToken: () => activeToken,
    setRole: (value: string) => {
      role = value
    },
    setGeneration: (value: number) => {
      generation = value
    },
    switchSession: () => {
      activeToken = 'another-private-token'
    },
    unlink: () => {
      linked = false
    },
    failIssue: () => {
      issueFails = true
    },
    transactions
  }
}

describe('separate ADMIN_FRESH flow', () => {
  it.each(['apple', 'google'] as const)(
    'rotates only after %s proof and exact current session finalization',
    async (provider) => {
      const f = fixture(provider)
      const start = await f.start()
      expect(start.response.status).toBe(200)
      expect(start.state).toMatch(/^F[A-Za-z0-9_-]{42}$/u)
      const callback = await f.oauth(start.state, start.binding)
      expect(callback.headers.get('Location')).toBe(
        'https://app.example.test' + ADMIN_FRESH_COMPLETE_PATH
      )
      expect(f.getToken()).toBe(f.originalToken)
      expect(f.port.complete).not.toHaveBeenCalled()
      const result = await f.finish(f.proofCookie(callback))
      expect(result.headers.get('Location')).toBe(
        'https://app.example.test/admin/questions?page=2&ssoFresh=REAUTHENTICATED'
      )
      expect(
        result.headers
          .getSetCookie()
          .some((value) => value.startsWith('__Secure-nihongo.session_token='))
      ).toBe(true)
      expect(result.headers.get('Location')).not.toMatch(/token|code|state/iu)
      expect(f.getToken()).not.toBe(f.originalToken)
    }
  )
  it.each(['USER', 'DELETED'])(
    'denies %s at start without state, member creation or cookie writes',
    async (role) => {
      const f = fixture()
      f.setRole(role)
      const response = await f.runtime.start(
        new Request('https://app.example.test', {
          headers: { Cookie: f.sessionCookie() }
        }),
        { purpose: 'ADMIN_FRESH', provider: 'google' }
      )
      expect(response.status).toBe(403)
      expect(response.headers.get('Set-Cookie')).toBeNull()
      expect(f.port.create).not.toHaveBeenCalled()
      expect(f.getToken()).toBe(f.originalToken)
    }
  )
  it('rejects unsigned/no session and strict purpose/role injection', async () => {
    const f = fixture()
    expect(
      (
        await f.runtime.start(new Request('https://app.example.test'), {
          purpose: 'ADMIN_FRESH',
          provider: 'google'
        })
      ).status
    ).toBe(401)
    expect(
      (
        await f.runtime.start(new Request('https://app.example.test'), {
          purpose: 'ADMIN_FRESH',
          provider: 'google',
          userId: f.context.userId,
          role: 'ADMIN'
        })
      ).status
    ).toBe(400)
    expect(f.port.prepare).not.toHaveBeenCalled()
  })
  it('rejects foreign provider account without creating proof or calling a generic sign-in', async () => {
    const f = fixture()
    const start = await f.start()
    f.exchange.mockResolvedValue({
      provider: 'google',
      accountId: 'other-admin-subject',
      email: 'contact@example.test',
      name: '같은 연락 이메일'
    })
    const result = await f.oauth(start.state, start.binding)
    expect(result.headers.get('Location')).toContain('ssoFresh=FAILED')
    expect(f.port.stageProof).not.toHaveBeenCalled()
    expect(f.port.complete).not.toHaveBeenCalled()
    expect(f.port.abort).toHaveBeenCalledOnce()
    expect(f.getToken()).toBe(f.originalToken)
  })
  it.each(['role', 'generation', 'unlink'] as const)(
    'rejects %s race after OAuth and preserves the old session',
    async (race) => {
      const f = fixture()
      const start = await f.start()
      if (race === 'role') f.setRole('USER')
      else if (race === 'generation') f.setGeneration(8)
      else f.unlink()
      const result = await f.oauth(start.state, start.binding)
      expect(result.headers.get('Location')).toContain('ssoFresh=FAILED')
      expect(f.getToken()).toBe(f.originalToken)
      expect(f.port.complete).not.toHaveBeenCalled()
    }
  )
  it('rejects the same User in a different current session at final GET', async () => {
    const f = fixture('apple')
    const start = await f.start()
    const callback = await f.oauth(start.state, start.binding)
    f.switchSession()
    const response = await f.finish(f.proofCookie(callback))
    expect(response.headers.get('Location')).toContain('ssoFresh=FAILED')
    expect(f.getToken()).toBe('another-private-token')
    expect(response.headers.get('Set-Cookie')).not.toContain(
      '__Secure-nihongo.session_token='
    )
  })
  it.each(['role', 'generation', 'unlink'] as const)(
    'rechecks %s race again at final GET',
    async (race) => {
      const f = fixture()
      const start = await f.start()
      const callback = await f.oauth(start.state, start.binding)
      if (race === 'role') f.setRole('USER')
      else if (race === 'generation') f.setGeneration(8)
      else f.unlink()
      const result = await f.finish(f.proofCookie(callback))
      expect(result.headers.get('Location')).toContain('ssoFresh=FAILED')
      expect(f.getToken()).toBe(f.originalToken)
    }
  )
  it('cancels without changing current session and does not replay a command', async () => {
    const f = fixture()
    const start = await f.start()
    const result = await f.oauth(start.state, start.binding, {
      error: 'access_denied'
    })
    expect(result.headers.get('Location')).toContain('ssoFresh=CANCELLED')
    expect(f.getToken()).toBe(f.originalToken)
    expect(f.port.stageProof).not.toHaveBeenCalled()
    expect(f.port.complete).not.toHaveBeenCalled()
  })
  it('accepts only one concurrent callback and rejects replay/wrong browser/provider', async () => {
    const f = fixture()
    const start = await f.start()
    const wrong = await f.oauth(start.state, 'x'.repeat(43))
    expect(wrong.headers.get('Location')).toContain('INVALID_CALLBACK')
    const values = await Promise.all([
      f.oauth(start.state, start.binding),
      f.oauth(start.state, start.binding)
    ])
    expect(
      values.filter((r) =>
        r.headers.get('Location')?.endsWith(ADMIN_FRESH_COMPLETE_PATH)
      )
    ).toHaveLength(1)
    expect(f.port.stageProof).toHaveBeenCalledOnce()
    expect(f.exchange).toHaveBeenCalledOnce()
    expect(f.getToken()).toBe(f.originalToken)
  })
  it('fails issuance before success cookie and preserves the old session on definite rollback', async () => {
    const f = fixture()
    const start = await f.start()
    const callback = await f.oauth(start.state, start.binding)
    f.failIssue()
    const result = await f.finish(f.proofCookie(callback))
    expect(result.headers.get('Location')).toContain('ssoFresh=FAILED')
    expect(result.headers.get('Set-Cookie')).not.toContain(
      '__Secure-nihongo.session_token='
    )
    expect(f.getToken()).toBe(f.originalToken)
  })
  it('rejects missing/wrong nonce verification and cross-provider identity without changing session', async () => {
    for (const identity of [
      null,
      {
        provider: 'apple' as const,
        accountId: 'linked-subject',
        email: 'same@example.test',
        name: 'other'
      }
    ]) {
      const f = fixture()
      const start = await f.start()
      f.exchange.mockResolvedValue(identity)
      const result = await f.oauth(start.state, start.binding)
      expect(result.headers.get('Location')).toContain('ssoFresh=FAILED')
      expect(f.port.stageProof).not.toHaveBeenCalled()
      expect(f.getToken()).toBe(f.originalToken)
    }
  })
  it('rotates at most once under concurrent final GET and does not replay a sensitive operation', async () => {
    const f = fixture()
    const start = await f.start()
    const callback = await f.oauth(start.state, start.binding)
    const proof = f.proofCookie(callback)
    const values = await Promise.all([
      f.finish(proof, f.originalToken),
      f.finish(proof, f.originalToken)
    ])
    expect(
      values.filter((r) =>
        r.headers.get('Location')?.includes('REAUTHENTICATED')
      )
    ).toHaveLength(1)
    expect(
      values.filter((r) =>
        r.headers
          .getSetCookie()
          .some((v) => v.startsWith('__Secure-nihongo.session_token='))
      )
    ).toHaveLength(1)
  })
  it('rejects completion with query, absent proof or missing current Lax cookie', async () => {
    const f = fixture()
    const start = await f.start()
    const callback = await f.oauth(start.state, start.binding)
    const result = await f.runtime.complete(
      new Request('https://app.example.test' + ADMIN_FRESH_COMPLETE_PATH, {
        headers: { Cookie: f.proofCookie(callback) }
      })
    )
    expect(result.headers.get('Location')).toContain('INVALID_CALLBACK')
    expect(f.port.complete).not.toHaveBeenCalled()
    expect(f.getToken()).toBe(f.originalToken)
    expect(ssoTransactionDigest(start.binding)).toHaveLength(64)
  })
})

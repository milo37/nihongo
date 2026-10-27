import { describe, expect, it, vi } from 'vitest'
import {
  createHttpSsoProviderRevokeAdapter,
  runSsoProviderRevokeBatch,
  SSO_PROVIDER_REVOKE_TIMEOUT_MS,
  unavailableSsoProviderRevokeAdapter
} from './ssoProviderRevoke.js'

const id = '11111111-1111-4111-8111-111111111111'

describe('SSO provider revoke boundary', () => {
  it('records only real outcomes and leaves unavailable providers pending', async () => {
    const worker = {
      claimProviderCleanups: vi.fn(async () => [
        {
          id,
          providers: [
            { provider: 'apple' as const, subject: null },
            { provider: 'google' as const, subject: 'g-sub' }
          ]
        },
        { id, providers: [{ provider: 'google' as const, subject: 'g-2' }] },
        { id, providers: [{ provider: 'apple' as const, subject: 'a-sub' }] }
      ]),
      recordProviderCleanup: vi.fn(async () => true)
    }
    const revoke = vi
      .fn()
      .mockResolvedValueOnce('REVOKED')
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce('UNAVAILABLE')
    expect(
      await runSsoProviderRevokeBatch(worker, revoke, 'TEST', 3, 300)
    ).toEqual({
      revoked: 1,
      failed: 1,
      unavailable: 2,
      deferred: 0,
      claimLimitReached: true
    })
    expect(worker.claimProviderCleanups).toHaveBeenCalledWith(3, 300, 'TEST')
    expect(revoke).toHaveBeenCalledTimes(3)
    expect(worker.recordProviderCleanup.mock.calls).toEqual([
      [id, 'google', 'COMPLETED', 'TEST'],
      [id, 'google', 'FAILED', 'TEST']
    ])
  })

  it('never calls a provider once the lease could expire mid-call', async () => {
    // Worst case batch: every call takes the full adapter timeout.
    let clock = 0
    const worker = {
      claimProviderCleanups: vi.fn(async () =>
        Array.from({ length: 20 }, () => ({
          id,
          providers: [
            { provider: 'apple' as const, subject: 'a' },
            { provider: 'google' as const, subject: 'g' }
          ]
        }))
      ),
      recordProviderCleanup: vi.fn(async () => true)
    }
    const revoke = vi.fn(async () => {
      clock += SSO_PROVIDER_REVOKE_TIMEOUT_MS
      return 'REVOKED' as const
    })
    const result = await runSsoProviderRevokeBatch(
      worker,
      revoke,
      'TEST',
      20,
      300,
      () => clock
    )
    // 300s lease minus a 20s reserve: calls start at 0..280s, 29 calls.
    expect(revoke).toHaveBeenCalledTimes(29)
    expect(clock).toBeLessThanOrEqual(300_000 - SSO_PROVIDER_REVOKE_TIMEOUT_MS)
    expect(result).toEqual({
      revoked: 29,
      failed: 0,
      unavailable: 0,
      deferred: 11,
      claimLimitReached: true
    })
    expect(worker.recordProviderCleanup).toHaveBeenCalledTimes(29)
  })

  it('rejects a lease shorter than one call before claiming', async () => {
    const worker = {
      claimProviderCleanups: vi.fn(),
      recordProviderCleanup: vi.fn()
    }
    await expect(
      runSsoProviderRevokeBatch(
        worker,
        unavailableSsoProviderRevokeAdapter,
        'TEST',
        1,
        20
      )
    ).rejects.toThrow('Provider lease is shorter than one revoke call.')
    expect(worker.claimProviderCleanups).not.toHaveBeenCalled()
  })

  it('the default adapter never revokes', async () => {
    await expect(
      unavailableSsoProviderRevokeAdapter({ provider: 'google', subject: 's' })
    ).resolves.toBe('UNAVAILABLE')
  })

  it('calls provider revoke endpoints only with a vault token', async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 200 }))
    const tokens = {
      refreshToken: vi.fn(async ({ subject }: { subject: string }) =>
        subject === 'none' ? null : `token-${subject}`
      )
    }
    const google = createHttpSsoProviderRevokeAdapter({
      tokens,
      apple: null,
      fetch
    })
    await expect(google({ provider: 'google', subject: 'none' })).resolves.toBe(
      'UNAVAILABLE'
    )
    await expect(google({ provider: 'apple', subject: 'a' })).resolves.toBe(
      'UNAVAILABLE'
    )
    expect(fetch).not.toHaveBeenCalled()
    await expect(google({ provider: 'google', subject: 'g' })).resolves.toBe(
      'REVOKED'
    )
    const apple = createHttpSsoProviderRevokeAdapter({
      tokens,
      apple: { clientId: 'client', clientSecret: 'secret' },
      fetch
    })
    fetch.mockResolvedValueOnce(new Response(null, { status: 400 }))
    await expect(apple({ provider: 'apple', subject: 'a' })).resolves.toBe(
      'FAILED'
    )
    const calls = fetch.mock.calls as unknown as Array<
      [string, { body: URLSearchParams }]
    >
    expect(calls.map(([url, init]) => [url, init.body.toString()])).toEqual([
      ['https://oauth2.googleapis.com/revoke', 'token=token-g'],
      [
        'https://appleid.apple.com/auth/revoke',
        'client_id=client&client_secret=secret&token=token-a&token_type_hint=refresh_token'
      ]
    ])
  })

  it.each([
    [
      'google',
      400,
      { error: 'invalid_token', error_description: 'Token expired' },
      'REVOKED'
    ],
    ['google', 400, { error: 'invalid_request' }, 'FAILED'],
    ['google', 400, 'not json', 'FAILED'],
    ['google', 401, { error: 'invalid_token' }, 'FAILED'],
    ['google', 503, { error: 'invalid_token' }, 'FAILED'],
    ['apple', 400, { error: 'invalid_token' }, 'FAILED']
  ] as const)(
    'maps %s %i %j to %s',
    async (provider, status, body, outcome) => {
      const fetch = vi.fn(
        async () =>
          new Response(typeof body === 'string' ? body : JSON.stringify(body), {
            status
          })
      )
      const adapter = createHttpSsoProviderRevokeAdapter({
        tokens: { refreshToken: async () => 'token' },
        apple: { clientId: 'client', clientSecret: 'secret' },
        fetch
      })
      await expect(adapter({ provider, subject: 's' })).resolves.toBe(outcome)
      expect(fetch).toHaveBeenCalledOnce()
    }
  )

  it('bounds the vault lookup and request with one call timeout', async () => {
    const order: string[] = []
    const signal = new AbortController().signal
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => {
      order.push('timeout')
      return signal
    })
    try {
      const fetch = vi.fn(async () => new Response(null, { status: 200 }))
      const adapter = createHttpSsoProviderRevokeAdapter({
        tokens: {
          refreshToken: async () => {
            order.push('vault')
            return 'token'
          }
        },
        apple: null,
        fetch
      })
      await expect(adapter({ provider: 'google', subject: 's' })).resolves.toBe(
        'REVOKED'
      )
      expect(timeout).toHaveBeenCalledExactlyOnceWith(
        SSO_PROVIDER_REVOKE_TIMEOUT_MS
      )
      expect(order).toEqual(['timeout', 'vault'])
      expect(fetch).toHaveBeenCalledWith(
        'https://oauth2.googleapis.com/revoke',
        expect.objectContaining({ signal })
      )
    } finally {
      timeout.mockRestore()
    }
  })
})

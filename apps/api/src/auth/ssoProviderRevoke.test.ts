import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createHttpSsoProviderRevokeAdapter,
  runSsoProviderRevokeBatch,
  SSO_PROVIDER_REVOKE_TIMEOUT_MS,
  unavailableSsoProviderRevokeAdapter
} from './ssoProviderRevoke.js'

const id = '11111111-1111-4111-8111-111111111111'
const leaseToken = '22222222-2222-4222-8222-222222222222'
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('SSO provider revoke boundary', () => {
  it('records only real outcomes and leaves unavailable providers pending', async () => {
    const worker = {
      claimProviderCleanups: vi.fn(async () => [
        {
          id,
          leaseToken,
          providers: [
            { provider: 'apple' as const, subject: null },
            { provider: 'google' as const, subject: 'g-sub' }
          ]
        },
        {
          id,
          leaseToken,
          providers: [{ provider: 'google' as const, subject: 'g-2' }]
        },
        {
          id,
          leaseToken,
          providers: [{ provider: 'apple' as const, subject: 'a-sub' }]
        }
      ]),
      beginProviderCleanup: vi.fn(async () => true),
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
      [id, 'google', 'COMPLETED', leaseToken, 'TEST'],
      [id, 'apple', 'UNAVAILABLE', leaseToken, 'TEST']
    ])
  })

  it('never calls a provider once the lease could expire mid-call', async () => {
    // Worst case batch: every call settles just before the adapter timeout.
    let clock = 0
    const worker = {
      claimProviderCleanups: vi.fn(async () =>
        Array.from({ length: 20 }, () => ({
          id,
          leaseToken,
          providers: [
            { provider: 'apple' as const, subject: 'a' },
            { provider: 'google' as const, subject: 'g' }
          ]
        }))
      ),
      beginProviderCleanup: vi.fn(async () => true),
      recordProviderCleanup: vi.fn(async () => true)
    }
    const revoke = vi.fn(async () => {
      clock += SSO_PROVIDER_REVOKE_TIMEOUT_MS - 1
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
    // 300s lease minus 20s reserve: 29 calls can settle before the deadline.
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
      beginProviderCleanup: vi.fn(async () => true),
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

  it('passes the same cancellation signal through vault and fetch', async () => {
    let vaultSignal: AbortSignal | undefined
    const fetch = vi.fn(async () => new Response(null, { status: 200 }))
    const adapter = createHttpSsoProviderRevokeAdapter({
      tokens: {
        refreshToken: async (_target, signal) => {
          vaultSignal = signal
          return 'token'
        }
      },
      apple: null,
      fetch
    })
    await expect(adapter({ provider: 'google', subject: 's' })).resolves.toBe(
      'REVOKED'
    )
    expect(vaultSignal).toBeInstanceOf(AbortSignal)
    expect(fetch).toHaveBeenCalledWith(
      'https://oauth2.googleapis.com/revoke',
      expect.objectContaining({ signal: vaultSignal })
    )
  })

  const claimedWorker = () => ({
    claimProviderCleanups: vi.fn(async () => [
      {
        id,
        leaseToken,
        providers: [{ provider: 'google' as const, subject: 'g' }]
      }
    ]),
    beginProviderCleanup: vi.fn(async () => true),
    recordProviderCleanup: vi.fn(async () => true)
  })
  const fakeClock = () => Date.now()

  it('does not start a queued operation after its deadline before timers run', async () => {
    let clock = 0
    const worker = claimedWorker()
    queueMicrotask(() => {
      clock = 400_000
    })
    await expect(
      runSsoProviderRevokeBatch(worker, vi.fn(), 'TEST', 1, 300, () => clock)
    ).rejects.toThrow('deadline exceeded')
    expect(worker.claimProviderCleanups).not.toHaveBeenCalled()
    expect(worker.beginProviderCleanup).not.toHaveBeenCalled()
  })

  it('does not dispatch or record when SQL rejects claim ownership', async () => {
    const worker = claimedWorker()
    worker.beginProviderCleanup.mockResolvedValue(false)
    const revoke = vi.fn()
    expect(
      await runSsoProviderRevokeBatch(worker, revoke, 'TEST', 1, 300)
    ).toMatchObject({ failed: 1, revoked: 0 })
    expect(revoke).not.toHaveBeenCalled()
    expect(worker.recordProviderCleanup).not.toHaveBeenCalled()
  })

  it('bounds an adapter that ignores cancellation and never records its late result', async () => {
    vi.useFakeTimers()
    const worker = claimedWorker()
    let finish: (value: 'REVOKED') => void = () => {}
    let signal: AbortSignal | undefined
    const revoke = vi.fn((_target, input?: AbortSignal) => {
      signal = input
      return new Promise<'REVOKED'>((resolve) => {
        finish = resolve
      })
    })
    const pending = runSsoProviderRevokeBatch(
      worker,
      revoke,
      'TEST',
      1,
      300,
      fakeClock
    )
    await vi.advanceTimersByTimeAsync(10_000)
    expect(await pending).toMatchObject({ revoked: 0, failed: 1 })
    expect(signal?.aborted).toBe(true)
    expect(worker.recordProviderCleanup).not.toHaveBeenCalled()
    finish('REVOKED')
    await vi.advanceTimersByTimeAsync(400_000)
    expect(worker.recordProviderCleanup).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('refuses a late synchronous adapter result even before the timer fires', async () => {
    let clock = 0
    const worker = claimedWorker()
    const result = await runSsoProviderRevokeBatch(
      worker,
      async () => {
        clock = 400_000
        return 'REVOKED'
      },
      'TEST',
      1,
      300,
      () => clock
    )
    expect(result).toMatchObject({ revoked: 0, failed: 1 })
    expect(worker.recordProviderCleanup).not.toHaveBeenCalled()
  })

  it('bounds DB recording and does not count a late acknowledgement as completion', async () => {
    vi.useFakeTimers()
    const worker = claimedWorker()
    let finish: (value: boolean) => void = () => {}
    worker.recordProviderCleanup.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const pending = runSsoProviderRevokeBatch(
      worker,
      async () => 'REVOKED',
      'TEST',
      1,
      30,
      fakeClock
    )
    await vi.advanceTimersByTimeAsync(10_000)
    expect(await pending).toMatchObject({ revoked: 0, failed: 1 })
    finish(true)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(worker.recordProviderCleanup).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('never dispatches after a late or rejected begin acknowledgement', async () => {
    vi.useFakeTimers()
    const worker = claimedWorker()
    let finish: (value: boolean) => void = () => {}
    worker.beginProviderCleanup.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const revoke = vi.fn(async () => 'REVOKED' as const)
    const pending = runSsoProviderRevokeBatch(
      worker,
      revoke,
      'TEST',
      1,
      300,
      fakeClock
    )
    await vi.advanceTimersByTimeAsync(10_000)
    expect(await pending).toMatchObject({ failed: 1 })
    finish(true)
    await vi.advanceTimersByTimeAsync(1)
    expect(revoke).not.toHaveBeenCalled()
    expect(worker.recordProviderCleanup).not.toHaveBeenCalled()
  })

  it('bounds claim waiting without ever dispatching its late claims', async () => {
    vi.useFakeTimers()
    const worker = claimedWorker()
    worker.claimProviderCleanups.mockImplementation(() => new Promise(() => {}))
    const revoke = vi.fn()
    const pending = expect(
      runSsoProviderRevokeBatch(worker, revoke, 'TEST', 1, 300, fakeClock)
    ).rejects.toThrow('deadline exceeded')
    await vi.advanceTimersByTimeAsync(10_000)
    await pending
    expect(revoke).not.toHaveBeenCalled()
    expect(worker.beginProviderCleanup).not.toHaveBeenCalled()
  })

  it('enforces the shared lease deadline even when the event loop delays recording', async () => {
    let clock = 0
    const worker = claimedWorker()
    worker.recordProviderCleanup.mockImplementation(async () => {
      clock = 305_000
      return true
    })
    const result = await runSsoProviderRevokeBatch(
      worker,
      async () => {
        clock += 9_000
        return 'REVOKED'
      },
      'TEST',
      1,
      300,
      () => clock
    )
    expect(result).toMatchObject({ revoked: 0, failed: 1 })
  })

  it.each(['vault', 'fetch', 'body'] as const)(
    'bounds a hanging %s without relying on its abort support',
    async (stage) => {
      vi.useFakeTimers()
      let finishVault: (token: string) => void = () => {}
      const fetch = vi.fn(async () => {
        if (stage === 'fetch') return new Promise<Response>(() => {})
        if (stage === 'body')
          return {
            ok: false,
            status: 400,
            json: () => new Promise(() => {})
          } as Response
        return new Response(null, { status: 200 })
      })
      const adapter = createHttpSsoProviderRevokeAdapter({
        tokens: {
          refreshToken: async () =>
            stage === 'vault'
              ? new Promise<string>((resolve) => {
                  finishVault = resolve
                })
              : 'token'
        },
        apple: null,
        fetch
      })
      const pending = expect(
        adapter({ provider: 'google', subject: 's' })
      ).rejects.toThrow('deadline exceeded')
      await vi.advanceTimersByTimeAsync(10_000)
      await pending
      finishVault('late-token')
      await vi.advanceTimersByTimeAsync(2_000)
      expect(fetch).toHaveBeenCalledTimes(stage === 'vault' ? 0 : 1)
      expect(vi.getTimerCount()).toBe(0)
    }
  )

  it('does not enter the vault when the batch already cancelled', async () => {
    const controller = new AbortController()
    controller.abort()
    const refreshToken = vi.fn(async () => 'token')
    const fetch = vi.fn()
    const adapter = createHttpSsoProviderRevokeAdapter({
      tokens: { refreshToken },
      apple: null,
      fetch
    })
    await expect(
      adapter({ provider: 'google', subject: 's' }, controller.signal)
    ).rejects.toThrow()
    expect(refreshToken).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('does not dispatch a late vault result before its abort timer runs', async () => {
    let clock = 0
    vi.spyOn(performance, 'now').mockImplementation(() => clock)
    const fetch = vi.fn()
    const adapter = createHttpSsoProviderRevokeAdapter({
      tokens: {
        refreshToken: async () => {
          clock = SSO_PROVIDER_REVOKE_TIMEOUT_MS + 1
          return 'late-token'
        }
      },
      apple: null,
      fetch
    })
    await expect(adapter({ provider: 'google', subject: 's' })).rejects.toThrow(
      'deadline exceeded'
    )
    expect(fetch).not.toHaveBeenCalled()
  })
})

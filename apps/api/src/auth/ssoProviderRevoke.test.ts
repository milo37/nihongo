import { describe, expect, it, vi } from 'vitest'
import {
  createHttpSsoProviderRevokeAdapter,
  runSsoProviderRevokeBatch,
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
      claimLimitReached: true
    })
    expect(worker.claimProviderCleanups).toHaveBeenCalledWith(3, 300, 'TEST')
    expect(revoke).toHaveBeenCalledTimes(3)
    expect(worker.recordProviderCleanup.mock.calls).toEqual([
      [id, 'google', 'COMPLETED', 'TEST'],
      [id, 'google', 'FAILED', 'TEST']
    ])
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
})

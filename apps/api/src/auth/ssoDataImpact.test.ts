import { describe, expect, it, vi } from 'vitest'
import { readSsoDataImpact } from './ssoDataImpact.js'
import { createSsoTransactionStore } from './ssoTransactionRepository.js'

describe('SSO aggregate diagnostic and owned transaction port', () => {
  it('returns aggregate decimal counts without identity/credential values', async () => {
    const $queryRawUnsafe = vi.fn().mockResolvedValue([
      { metric: 'users', count: 3n },
      { metric: 'credential_accounts', count: 2n }
    ])
    expect(await readSsoDataImpact({ $queryRawUnsafe })).toEqual([
      { metric: 'users', count: '3' },
      { metric: 'credential_accounts', count: '2' }
    ])
    expect($queryRawUnsafe).toHaveBeenCalledTimes(1)
    const sql = $queryRawUnsafe.mock.calls[0]![0] as string
    expect(sql).not.toMatch(
      /\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE)\b/iu
    )
  })
  it('rejects unexpected columns rather than exposing raw query data', async () => {
    await expect(
      readSsoDataImpact({
        $queryRawUnsafe: vi.fn().mockResolvedValue([
          {
            metric: 'users',
            count: 1n,
            email: 'must-not-return@example.test'
          }
        ])
      })
    ).rejects.toThrow()
  })
  it('consumes through the owned function with parameterized digests', async () => {
    const $queryRawUnsafe = vi.fn().mockResolvedValue([
      {
        provider: 'google',
        nonce: 'n'.repeat(43),
        codeVerifier: 'v'.repeat(86),
        callbackURL: '/bookmarks'
      }
    ])
    const store = createSsoTransactionStore({ $queryRawUnsafe })
    expect(
      await store.consume('state-digest', 'browser-digest', 'google')
    ).toEqual({
      provider: 'google',
      nonce: 'n'.repeat(43),
      codeVerifier: 'v'.repeat(86),
      callbackURL: '/bookmarks'
    })
    expect($queryRawUnsafe).toHaveBeenCalledWith(
      'SELECT * FROM "phase7_consume_sso_transaction_v2"($1, $2, $3)',
      'google',
      'state-digest',
      'browser-digest'
    )
  })
  it('fails closed on malformed/multiple transaction results or failed creation', async () => {
    const $queryRawUnsafe = vi.fn().mockResolvedValue([{ unexpected: true }])
    const store = createSsoTransactionStore({ $queryRawUnsafe })
    await expect(store.consume('s', 'b', 'google')).rejects.toThrow()
    $queryRawUnsafe.mockResolvedValueOnce([{}, {}])
    await expect(store.consume('s', 'b', 'google')).rejects.toThrow()
    $queryRawUnsafe.mockResolvedValueOnce([])
    expect(await store.consume('s', 'b', 'google')).toBeNull()
    $queryRawUnsafe.mockResolvedValueOnce([{ created: false }])
    await expect(
      store.create({
        provider: 'google',
        stateDigest: 's',
        bindingDigest: 'b',
        nonce: 'n',
        codeVerifier: 'v',
        callbackURL: '/'
      })
    ).rejects.toThrow('SSO transaction creation failed.')
  })
})

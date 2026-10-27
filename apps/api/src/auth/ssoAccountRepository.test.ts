import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '../generated/prisma/client.js'
import {
  createSsoAccountRepository,
  createSsoAccountErasureWorker,
  runSsoAccountErasureBatch,
  ssoAccountContextSchema
} from './ssoAccountRepository.js'
const user = '11111111-1111-4111-8111-111111111111',
  session = '22222222-2222-4222-8222-222222222222'
const context = {
  purpose: 'ACCOUNT_FRESH',
  userId: user,
  sessionId: session,
  role: 'USER',
  authorityGeneration: 1,
  tokenDigest: 'a'.repeat(64),
  provider: 'google',
  accountId: 'subject'
} as const
const client = (query: unknown) =>
  ({ $queryRawUnsafe: query }) as Pick<PrismaClient, '$queryRawUnsafe'>
describe('SSO account repository boundaries', () => {
  it('strict contexts bind role, generation, session and purpose', () => {
    expect(ssoAccountContextSchema.parse(context)).toEqual(context)
    expect(
      ssoAccountContextSchema.safeParse({
        ...context,
        purpose: 'ACCOUNT_LINK',
        accountId: null
      }).success
    ).toBe(false)
    expect(
      ssoAccountContextSchema.safeParse({ ...context, role: 'SUPERUSER' })
        .success
    ).toBe(false)
  })
  it('preparation uses fixed definer and rejects mismatched provider context', async () => {
    const query = vi.fn(async () => [{ result: context }]),
      repo = createSsoAccountRepository(client(query))
    expect(
      await repo.prepare('private', 'google', 'ACCOUNT_FRESH', null)
    ).toEqual(context)
    expect(query).toHaveBeenCalledWith(
      'SELECT "phase7_prepare_sso_account_fresh"($1,$2) AS result',
      'private',
      'google'
    )
    await expect(
      repo.prepare('private', 'apple', 'ACCOUNT_FRESH', null)
    ).rejects.toThrow('purpose mismatch')
  })
  it('LINK preparation forwards only canonical token and private proof binding', async () => {
    const linked = {
      ...context,
      purpose: 'ACCOUNT_LINK',
      provider: 'apple',
      accountId: null,
      freshProofDigest: 'b'.repeat(64)
    }
    const query = vi.fn(async () => [{ result: linked }]),
      repo = createSsoAccountRepository(client(query))
    expect(
      await repo.prepare('private', 'apple', 'ACCOUNT_LINK', 'b'.repeat(64))
    ).toEqual(linked)
    expect(query).toHaveBeenCalledWith(
      'SELECT "phase7_prepare_sso_account_link"($1,$2,$3) AS result',
      'private',
      'apple',
      'b'.repeat(64)
    )
  })
  it('wrong linked subject cannot even submit proof SQL', async () => {
    const query = vi.fn(),
      repo = createSsoAccountRepository(client(query))
    expect(
      await repo.stageProof(
        context,
        {
          provider: 'google',
          accountId: 'other',
          email: 'same@example.test',
          name: 'other'
        },
        'c'.repeat(64),
        '/login'
      )
    ).toBe(false)
    expect(query).not.toHaveBeenCalled()
  })
  it('consumption cannot cross purpose even on a malformed DB row', async () => {
    const query = vi.fn(async () => [
        {
          provider: 'google',
          nonce: 'n'.repeat(43),
          codeVerifier: 'v'.repeat(86),
          callbackURL: '/login',
          context
        }
      ]),
      repo = createSsoAccountRepository(client(query))
    await expect(
      repo.consume('a', 'b', 'google', 'ACCOUNT_LINK')
    ).rejects.toThrow('purpose mismatch')
  })
  it('mutation rejects impossible success and extra private fields', async () => {
    const query = vi.fn(async () => [
        { result: { unlinked: true, sessionRevoked: true, userId: user } }
      ]),
      repo = createSsoAccountRepository(client(query))
    await expect(
      repo.unlink('private', 'google', ['apple'], null)
    ).rejects.toThrow()
  })
  it('no missing/extra result rows can become mutation success', async () => {
    for (const rows of [[], [{ result: null }, { result: null }]]) {
      const repo = createSsoAccountRepository(client(vi.fn(async () => rows)))
      await expect(
        repo.requestErasure('private', null, 'd'.repeat(64))
      ).rejects.toThrow('unavailable')
    }
  })
  it('worker physical erasure and provider cleanup remain separate calls', async () => {
    const query = vi.fn(async () => [{ completed: true }]),
      worker = createSsoAccountErasureWorker(client(query))
    expect(await worker.complete(user, 'TEST')).toBe(true)
    expect(query).toHaveBeenCalledWith(
      'SELECT "phase7_complete_sso_account_erasure"($1::uuid,$2::"AdminAuditEnvironment") AS completed',
      user,
      'TEST'
    )
    expect(
      await worker.recordProviderCleanup(user, 'apple', 'FAILED', 'TEST')
    ).toBe(true)
    expect(query).toHaveBeenLastCalledWith(
      'SELECT "phase7_record_sso_provider_cleanup"($1::uuid,$2,$3,$4::"AdminAuditEnvironment") AS completed',
      user,
      'apple',
      'FAILED',
      'TEST'
    )
    expect(query).toHaveBeenCalledTimes(2)
  })
  it('worker queue uses the fixed worker definer and rejects leaked fields', async () => {
    const queue = [
      {
        id: user,
        appStatus: 'DELETION_PENDING',
        providerCleanup: [{ provider: 'google', status: 'PENDING' }]
      }
    ]
    const query = vi.fn(async () => [{ result: queue }]),
      worker = createSsoAccountErasureWorker(client(query))
    expect(await worker.list(20, 'PRODUCTION')).toEqual(queue)
    expect(query).toHaveBeenCalledWith(
      'SELECT "phase7_list_sso_account_erasures"($1::integer,$2::"AdminAuditEnvironment") AS result',
      20,
      'PRODUCTION'
    )
    await expect(worker.list(101, 'TEST')).rejects.toThrow()
    query.mockResolvedValueOnce([
      { result: [{ ...queue[0], userId: user }] as unknown as typeof queue }
    ])
    await expect(worker.list(20, 'TEST')).rejects.toThrow()
    expect(query).toHaveBeenCalledTimes(2)
  })
  it('provider claim uses the leased worker definer and rejects leaked fields', async () => {
    const claims = [
      { id: user, providers: [{ provider: 'google', subject: 'sub-1' }] }
    ]
    const query = vi.fn(async () => [{ result: claims }]),
      worker = createSsoAccountErasureWorker(client(query))
    expect(await worker.claimProviderCleanups(20, 300, 'TEST')).toEqual(claims)
    expect(query).toHaveBeenCalledWith(
      'SELECT "phase7_claim_sso_provider_cleanups"($1::integer,$2::integer,$3::"AdminAuditEnvironment") AS result',
      20,
      300,
      'TEST'
    )
    await expect(worker.claimProviderCleanups(20, 29, 'TEST')).rejects.toThrow()
    query.mockResolvedValueOnce([
      {
        result: [{ ...claims[0], userId: user }] as unknown as typeof claims
      }
    ])
    await expect(
      worker.claimProviderCleanups(20, 300, 'TEST')
    ).rejects.toThrow()
    expect(query).toHaveBeenCalledTimes(2)
  })
  it.each([
    ['empty', []],
    [
      'duplicate',
      [
        { provider: 'google', status: 'PENDING' },
        { provider: 'google', status: 'FAILED' }
      ]
    ]
  ])('worker queue rejects %s provider cleanup', async (_label, cleanup) => {
    const query = vi.fn(async () => [
        {
          result: [
            {
              id: user,
              appStatus: 'DELETION_PENDING',
              providerCleanup: cleanup
            }
          ]
        }
      ]),
      worker = createSsoAccountErasureWorker(client(query))
    await expect(worker.list(20, 'TEST')).rejects.toThrow()
  })
  it('batch completes app erasure, retries failures and never completes without provider cleanup', async () => {
    const ids = [1, 2, 3, 4, 5, 6].map((n) => `${n}${user.slice(1)}`) as [
      string,
      string,
      string,
      string,
      string,
      string
    ]
    const google = (status: 'PENDING' | 'COMPLETED' | 'FAILED') => [
      { provider: 'google' as const, status }
    ]
    const worker = {
      list: vi.fn(async () => [
        {
          id: ids[0],
          appStatus: 'DELETION_PENDING' as const,
          providerCleanup: google('COMPLETED')
        },
        {
          id: ids[1],
          appStatus: 'DELETION_PENDING' as const,
          providerCleanup: google('PENDING')
        },
        {
          id: ids[2],
          appStatus: 'DELETION_PENDING' as const,
          providerCleanup: google('COMPLETED')
        },
        {
          id: ids[3],
          appStatus: 'DELETION_PENDING' as const,
          providerCleanup: google('COMPLETED')
        },
        {
          id: ids[4],
          appStatus: 'DELETED' as const,
          providerCleanup: google('FAILED')
        },
        {
          id: ids[5],
          appStatus: 'DELETION_PENDING' as const,
          providerCleanup: []
        }
      ]),
      complete: vi.fn(async (id: string) => {
        if (id === ids[2]) throw new Error('transient')
        return id !== ids[3]
      })
    }
    expect(await runSsoAccountErasureBatch(worker, 'TEST', 5)).toEqual({
      completedIds: [ids[0]],
      providerCleanupPendingIds: [ids[1], ids[4], ids[5]],
      failedIds: [ids[2], ids[3]],
      batchLimitReached: true
    })
    expect(worker.list).toHaveBeenCalledWith(5, 'TEST')
    expect(worker.complete).toHaveBeenCalledTimes(3)
    expect(worker.complete).not.toHaveBeenCalledWith(ids[4], 'TEST')
    expect(worker.complete).not.toHaveBeenCalledWith(ids[5], 'TEST')
  })
})

import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '../generated/prisma/client.js'
import {
  createSsoAccountRepository,
  createSsoAccountErasureWorker,
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
    expect(await worker.recordProviderCleanup(user, 'apple', 'FAILED')).toBe(
      true
    )
    expect(query).toHaveBeenCalledTimes(2)
  })
})

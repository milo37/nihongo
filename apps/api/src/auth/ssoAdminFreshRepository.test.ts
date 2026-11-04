import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '../generated/prisma/client.js'
import { createSsoAdminFreshRepository } from './ssoAdminFreshRepository.js'
const userId = '11111111-1111-4111-8111-111111111111'
const context = {
  intentId: userId,
  userId,
  sessionId: userId,
  authorityGeneration: 7,
  provider: 'google' as const,
  accountId: 'linked-subject'
}
// The repository runs the API implementation (#504 P7 PR3b-1); its SQL is
// covered by the database integration tests. Each call is recorded by name.
const authority = vi.hoisted(() => ({
  calls: [] as Array<{ name: string; args: unknown[] }>,
  answer: (_name: string, _args: unknown[]): Promise<unknown> =>
    Promise.resolve(undefined)
}))
vi.mock('./adminFreshAuthority.js', () => {
  const recorded =
    (name: string) =>
    (_client: unknown, ...args: unknown[]) => {
      authority.calls.push({ name, args })
      return authority.answer(name, args)
    }
  return {
    abortReauthentication: recorded('abortReauthentication'),
    cancelAdminFreshProof: recorded('cancelAdminFreshProof'),
    completeAdminFresh: recorded('completeAdminFresh'),
    consumeAdminFreshTransaction: recorded('consumeAdminFreshTransaction'),
    createAdminFreshTransaction: recorded('createAdminFreshTransaction'),
    prepareAdminFresh: recorded('prepareAdminFresh'),
    reconcileAdminFresh: recorded('reconcileAdminFresh'),
    stageAdminFreshProof: recorded('stageAdminFreshProof')
  }
})
const fixture = (
  mode: 'success' | 'lost-response' | 'rollback' | 'unknown' = 'success'
) => {
  let completed: unknown[] = []
  authority.calls = []
  authority.answer = async (name, args) => {
    if (name === 'prepareAdminFresh') return context
    if (name === 'completeAdminFresh') {
      if (mode === 'rollback') throw new Error('statement rolled back')
      const input = args[0] as { newSessionId: string }
      completed = [
        {
          id: input.newSessionId,
          familyId: userId,
          userId,
          authorityGeneration: 7,
          createdAt: new Date('2026-10-19T00:00:00Z'),
          expiresAt: new Date('2026-10-20T00:00:00Z'),
          callbackURL: '/login'
        }
      ]
      if (mode === 'lost-response' || mode === 'unknown')
        throw new Error('response lost after commit')
      return completed
    }
    if (name === 'reconcileAdminFresh') {
      if (mode === 'unknown') throw new Error('reconciliation unavailable')
      return mode === 'lost-response' ? completed : []
    }
    return true
  }
  return {
    port: createSsoAdminFreshRepository({} as unknown as PrismaClient),
    calls: () => authority.calls.map(({ name }) => name)
  }
}
describe('ADMIN_FRESH atomic rotation and outcome recovery', () => {
  it('uses the current old token and exact proof in one atomic rotation call', async () => {
    const f = fixture()
    const result = await f.port.complete(
      'a'.repeat(64),
      'exact-old-private-token',
      { ipAddress: '127.0.0.1', userAgent: 'test' }
    )
    expect(result?.userId).toBe(userId)
    expect(f.calls()).toEqual(['completeAdminFresh'])
    expect(authority.calls[0]?.args[0]).toMatchObject({
      proofDigest: 'a'.repeat(64),
      rawOldToken: 'exact-old-private-token'
    })
  })
  it('reconciles a committed rotation before returning a cookie token after response loss', async () => {
    const f = fixture('lost-response')
    const result = await f.port.complete('a'.repeat(64), 'old', {
      ipAddress: '127.0.0.1',
      userAgent: 'test'
    })
    expect(result?.token).toMatch(/^[A-Za-z0-9_-]{43}$/u)
    expect(f.calls()).toEqual(['completeAdminFresh', 'reconcileAdminFresh'])
  })
  it('compensates only a non-finalized proof after a definite rollback; never restores the old session', async () => {
    const f = fixture('rollback')
    await expect(
      f.port.complete('a'.repeat(64), 'old', {
        ipAddress: '127.0.0.1',
        userAgent: 'test'
      })
    ).rejects.toThrow('rotation unavailable')
    expect(f.calls()).toEqual([
      'completeAdminFresh',
      'reconcileAdminFresh',
      'cancelAdminFreshProof'
    ])
  })
  it('keeps unresolved commit outcome distinct and does not delete a finalized session', async () => {
    const f = fixture('unknown')
    await expect(
      f.port.complete('a'.repeat(64), 'old', {
        ipAddress: '127.0.0.1',
        userAgent: 'test'
      })
    ).rejects.toThrow('commit outcome is unknown')
    expect(f.calls()).toEqual(['completeAdminFresh', 'reconcileAdminFresh'])
  })
  it('rejects other provider/sub before attempting proof staging', async () => {
    const f = fixture()
    expect(
      await f.port.stageProof(
        context,
        {
          provider: 'apple',
          accountId: context.accountId,
          email: 'same@example.test',
          name: 'same'
        },
        'a'.repeat(64),
        '/login'
      )
    ).toBe(false)
    expect(
      await f.port.stageProof(
        context,
        {
          provider: 'google',
          accountId: 'other-account',
          email: 'same@example.test',
          name: 'same'
        },
        'a'.repeat(64),
        '/login'
      )
    ).toBe(false)
    expect(f.calls()).toEqual([])
  })
})

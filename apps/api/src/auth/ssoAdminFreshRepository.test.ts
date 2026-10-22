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
const fixture = (
  mode: 'success' | 'lost-response' | 'rollback' | 'unknown' = 'success'
) => {
  let completed: unknown[] = []
  const query = vi.fn(
    async (sql: string, ...values: unknown[]): Promise<unknown> => {
      if (sql.includes('prepare_sso')) return [{ context }]
      if (sql.includes('complete_sso')) {
        if (mode === 'rollback') throw new Error('statement rolled back')
        completed = [
          {
            id: values[2],
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
      if (sql.includes('reconcile_sso')) {
        if (mode === 'unknown') throw new Error('reconciliation unavailable')
        return mode === 'lost-response' ? completed : []
      }
      return [{ created: true }]
    }
  )
  return {
    port: createSsoAdminFreshRepository({
      $queryRawUnsafe: query
    } as unknown as Pick<PrismaClient, '$queryRawUnsafe'>),
    query
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
    expect(f.query).toHaveBeenCalledOnce()
    expect(f.query.mock.calls[0]?.slice(1, 3)).toEqual([
      'a'.repeat(64),
      'exact-old-private-token'
    ])
  })
  it('reconciles a committed rotation before returning a cookie token after response loss', async () => {
    const f = fixture('lost-response')
    const result = await f.port.complete('a'.repeat(64), 'old', {
      ipAddress: '127.0.0.1',
      userAgent: 'test'
    })
    expect(result?.token).toMatch(/^[A-Za-z0-9_-]{43}$/u)
    expect(f.query.mock.calls[1]?.[0]).toContain('reconcile_sso')
    expect(f.query.mock.calls.some(([sql]) => sql.includes('cancel'))).toBe(
      false
    )
  })
  it('compensates only a non-finalized proof after a definite rollback; never restores the old session', async () => {
    const f = fixture('rollback')
    await expect(
      f.port.complete('a'.repeat(64), 'old', {
        ipAddress: '127.0.0.1',
        userAgent: 'test'
      })
    ).rejects.toThrow('rotation unavailable')
    expect(
      f.query.mock.calls.map(([sql]) => sql.match(/phase7_\w+/u)?.[0])
    ).toEqual([
      'phase7_complete_sso_admin_fresh',
      'phase7_reconcile_sso_admin_fresh',
      'phase7_cancel_sso_admin_fresh_proof'
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
    expect(
      f.query.mock.calls.some(
        ([sql]) => sql.includes('cancel') || sql.includes('sign_out')
      )
    ).toBe(false)
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
    expect(f.query).not.toHaveBeenCalled()
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '../generated/prisma/client.js'
import {
  confirmOwnedSession,
  issueOwnedSession,
  signOutOwnedSession
} from './ownedSessionAuthority.js'
import { createSsoIdentityRepository } from './ssoIdentityRepository.js'

vi.mock('./ownedSessionAuthority.js', () => ({
  confirmOwnedSession: vi.fn(),
  issueOwnedSession: vi.fn(),
  signOutOwnedSession: vi.fn(async () => true)
}))
const issueMock = vi.mocked(issueOwnedSession)
const confirmMock = vi.mocked(confirmOwnedSession)
const signOutMock = vi.mocked(signOutOwnedSession)
beforeEach(() => {
  issueMock.mockReset()
  confirmMock.mockReset()
  signOutMock.mockClear()
})

const userId = '11111111-1111-4111-8111-111111111111'
const familyId = '22222222-2222-4222-8222-222222222222'
const identity = {
  provider: 'google' as const,
  accountId: 'verified-subject',
  email: 'CONTACT@example.test',
  name: '학습자'
}
const metadata = { ipAddress: '127.0.0.1', userAgent: 'test' }
const fixture = (
  options: {
    confirmed?: boolean
    issueThrows?: boolean
    mapping?: unknown
    malformedSession?: boolean
  } = {}
) => {
  const calls: Array<{ sql: string; values: unknown[] }> = []
  const query = vi.fn(
    async (sql: string, ...values: unknown[]): Promise<unknown> => {
      calls.push({ sql, values })
      if (sql.includes('resolve_sso_identity'))
        return [
          {
            result: options.mapping ?? {
              outcome: 'RESOLVED',
              userId,
              authorityGeneration: 7,
              role: 'ADMIN',
              accountStatus: 'ACTIVE'
            }
          }
        ]
      throw new Error('unexpected query')
    }
  )
  confirmMock.mockImplementation(async () => options.confirmed ?? true)
  issueMock.mockImplementation(async (_client, input) => {
    if (options.issueThrows) throw new Error('private db failure')
    return {
      id: options.malformedSession ? familyId : input.sessionId,
      familyId,
      authorityGeneration: 7,
      createdAt: new Date('2026-10-19T00:00:00Z'),
      expiresAt: new Date('2026-10-26T00:00:00Z')
    }
  })
  const client = { $queryRawUnsafe: query } as unknown as PrismaClient
  return { repo: createSsoIdentityRepository(client), calls, query }
}
describe('SSO stable identity and confirmed session', () => {
  it('issues and confirms against canonical internal ID/generation/role, not profile claims', async () => {
    const f = fixture()
    const result = await f.repo.signIn(identity, metadata)
    expect(result.kind).toBe('SESSION_CONFIRMED')
    expect(f.calls[0]?.values).toEqual([
      'google',
      'verified-subject',
      'contact@example.test',
      '학습자'
    ])
    expect(issueMock).toHaveBeenCalledOnce()
    expect(issueMock.mock.calls[0]?.[1]).toMatchObject({
      userId,
      authorityGeneration: 7,
      role: 'ADMIN',
      accountStatus: 'ACTIVE',
      remember: true
    })
    expect(confirmMock.mock.calls[0]?.[1]).toMatchObject({
      userId,
      authorityGeneration: 7,
      role: 'ADMIN',
      accountStatus: 'ACTIVE'
    })
    expect(signOutMock).not.toHaveBeenCalled()
  })
  it.each([
    { confirmed: false },
    { issueThrows: true },
    { malformedSession: true }
  ])(
    'compensates any unconfirmed/uncertain issuance without returning token: %j',
    async (options) => {
      const f = fixture(options)
      await expect(f.repo.signIn(identity, metadata)).rejects.toThrow(
        'SSO session unavailable.'
      )
      expect(signOutMock).toHaveBeenCalledOnce()
      expect(signOutMock.mock.calls[0]?.[1]).toMatch(/^[A-Za-z0-9_-]{43}$/u)
    }
  )
  it.each([
    'TRANSITION_REQUIRED',
    'IDENTITY_CONFLICT',
    'ACCOUNT_UNAVAILABLE'
  ] as const)('does not issue a session for %s', async (outcome) => {
    const f = fixture({ mapping: { outcome } })
    expect(await f.repo.signIn(identity, metadata)).toEqual({ kind: outcome })
    expect(f.calls).toHaveLength(1)
    expect(issueMock).not.toHaveBeenCalled()
  })
  it('rejects missing authority or injected role fields before using them', async () => {
    const f = fixture({
      mapping: {
        outcome: 'RESOLVED',
        userId,
        role: 'ADMIN',
        accountStatus: 'ACTIVE'
      }
    })
    await expect(f.repo.signIn(identity, metadata)).rejects.toThrow()
    expect(f.calls).toHaveLength(1)
    await expect(
      f.repo.signIn({ ...identity, role: 'ADMIN' } as typeof identity, metadata)
    ).rejects.toThrow()
    expect(f.calls).toHaveLength(1)
  })
})

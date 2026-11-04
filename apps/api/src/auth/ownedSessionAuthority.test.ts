import { describe, expect, it, vi } from 'vitest'
import {
  issueOwnedSession,
  refreshRememberedSession,
  rotationFenceTokenDigest,
  signOutOwnedSession,
  type OwnedSessionClient
} from './ownedSessionAuthority.js'

const token = 'owned-session-secret-token-value'
const userId = '11111111-1111-4111-8111-111111111111'

// A client that records every statement and answers from `answer`.
const fakeClient = (answer: (sql: string) => unknown[]) => {
  const statements: Array<{ sql: string; values: unknown[] }> = []
  const record = (sql: string, values: unknown[]) => {
    statements.push({ sql, values })
    if (sql.startsWith('DO $raise$')) {
      const message = /MESSAGE = '([^']*)'/u.exec(sql)?.[1] ?? 'raised'
      throw Object.assign(new Error(message), { code: '42501' })
    }
  }
  const client = {
    $queryRawUnsafe: vi.fn(async (sql: string, ...values: unknown[]) => {
      record(sql, values)
      return answer(sql)
    }),
    $executeRawUnsafe: vi.fn(async (sql: string, ...values: unknown[]) => {
      record(sql, values)
      return 1
    }),
    $transaction: vi.fn(async (operation: (transaction: unknown) => unknown) =>
      operation(client)
    )
  }
  return { client: client as unknown as OwnedSessionClient, statements }
}

const expectTokenOnlyBound = (
  statements: Array<{ sql: string; values: unknown[] }>
) => {
  expect(statements.length).toBeGreaterThan(0)
  for (const { sql } of statements) expect(sql).not.toContain(token)
}

describe('owned Session authority keeps the raw token out of SQL text and errors', () => {
  it('stale issuance fails with a fixed message and binds the token', async () => {
    const { client, statements } = fakeClient((sql) =>
      sql.includes('FROM "User" WHERE "id"')
        ? [{ authorityGeneration: 2, role: 'USER', accountStatus: 'ACTIVE' }]
        : [{ ready: true }]
    )
    const failure = await issueOwnedSession(client, {
      userId,
      authorityGeneration: 1,
      role: 'USER',
      accountStatus: 'ACTIVE',
      sessionId: '22222222-2222-4222-8222-222222222222',
      token,
      ipAddress: '127.0.0.1',
      userAgent: 'test',
      remember: true
    }).catch((error: unknown) => error as Error)
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toBe(
      'V1 Session issuance proof is stale.'
    )
    expect(String(failure)).not.toContain(token)
    expectTokenOnlyBound(statements)
  })

  it('sign-out binds the token and its fence digest, never the token text', async () => {
    const { client, statements } = fakeClient(() => [])
    await expect(signOutOwnedSession(client, token)).resolves.toBe(true)
    expectTokenOnlyBound(statements)
    expect(statements.some(({ values }) => values.includes(token))).toBe(true)
    expect(
      statements.some(({ values }) =>
        values.includes(rotationFenceTokenDigest(token))
      )
    ).toBe(true)
  })

  it('refresh binds the token', async () => {
    const { client, statements } = fakeClient(() => [])
    await expect(refreshRememberedSession(client, token)).resolves.toEqual([])
    expectTokenOnlyBound(statements)
  })
})

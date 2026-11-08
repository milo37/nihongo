import { describe, expect, it, vi } from 'vitest'
import {
  ADMIN_SESSION_ABSOLUTE_TTL_MS,
  createOwnedPrincipalService
} from './principalService.js'
import { createSessionCookie } from './sessionCookie.js'

const secret = 'a'.repeat(32)
const signedInAt = new Date('2026-11-03T00:00:00.000Z')
const cookie = createSessionCookie({
  token: 'synthetic-session-token',
  secret,
  isProduction: false,
  rememberMe: false,
  expiresAt: new Date('2026-11-10T00:00:00.000Z')
}).split(';')[0]!

const createService = (
  role: 'USER' | 'ADMIN',
  elapsedMs: number,
  isFresh = false
) => {
  const query = vi.fn(async (sql: string): Promise<unknown> => {
    // The remembered-session refresh finds nothing to refresh.
    if (
      sql.includes('AS due') ||
      sql.startsWith('SELECT "require_runtime_ready"')
    )
      return []
    return [
      {
        userId: '11111111-1111-4111-8111-111111111111',
        name: '사용자',
        role,
        targetLevel: null,
        sessionId: '22222222-2222-4222-8222-222222222222',
        createdAt: signedInAt,
        expiresAt: new Date('2026-11-10T00:00:00.000Z'),
        isFresh,
        checkedAt: new Date(signedInAt.getTime() + elapsedMs)
      }
    ]
  })
  const client = { $queryRawUnsafe: query } as never
  return createOwnedPrincipalService({
    client,
    refreshClient: client,
    isProduction: false,
    secret,
    now: () => new Date(signedInAt.getTime() + elapsedMs)
  })
}

const resolve = (service: ReturnType<typeof createService>) =>
  service.resolveAuthenticatedUser(new Headers({ Cookie: cookie }), {
    classifyAdminAuthorityLoss: true
  })

describe('ADMIN 8 hour absolute session limit', () => {
  it('exposes the expiry time to an admin inside the limit', async () => {
    const result = await resolve(
      createService('ADMIN', ADMIN_SESSION_ABSOLUTE_TTL_MS - 1)
    )
    expect(result.user?.adminSessionExpiresAt).toBe('2026-11-03T08:00:00.000Z')
    expect(result.user?.adminFreshUntil).toBeNull()
    expect(result.clearSessionCookie).toBe(false)
  })

  it('exposes the fresh sign-in window end only when the session is fresh', async () => {
    const result = await resolve(createService('ADMIN', 60_000, true))
    expect(result.user?.adminFreshUntil).toBe('2026-11-03T00:30:00.000Z')
    // #683: remaining time is measured on the server clock.
    expect(result.user?.adminServerTime).toBe('2026-11-03T00:01:00.000Z')
  })

  it('expires the admin session at exactly 8 hours', async () => {
    const result = await resolve(
      createService('ADMIN', ADMIN_SESSION_ABSOLUTE_TTL_MS)
    )
    expect(result.user).toBeNull()
    expect(result.clearSessionCookie).toBe(true)
    expect(result.adminAuthorityFailure).toBe('AUTH_SESSION_EXPIRED')
  })

  it('does not limit learner sessions or expose an expiry time', async () => {
    const result = await resolve(
      createService('USER', ADMIN_SESSION_ABSOLUTE_TTL_MS * 3)
    )
    expect(result.user?.role).toBe('USER')
    expect(result.user).not.toHaveProperty('adminSessionExpiresAt')
    expect(result.user).not.toHaveProperty('adminFreshUntil')
    expect(result.user).not.toHaveProperty('adminServerTime')
  })
})

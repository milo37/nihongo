import { describe, expect, it, vi } from 'vitest'
import {
  ADMIN_SESSION_ABSOLUTE_TTL_MS,
  createOwnedPrincipalService
} from './principalService.js'
import { createSessionCookie } from './sessionCookie.js'

const secret = 'synthetic-admin-session-limit-secret-0123456789'
const signedInAt = new Date('2026-11-03T00:00:00.000Z')
const cookie = createSessionCookie({
  token: 'synthetic-session-token',
  secret,
  isProduction: false,
  rememberMe: false,
  expiresAt: new Date('2026-11-10T00:00:00.000Z')
}).split(';')[0]!

const createService = (role: 'USER' | 'ADMIN', elapsedMs: number) => {
  const query = vi.fn(async (sql: string): Promise<unknown> => {
    if (sql.includes('refresh_current_remembered_session')) return []
    return [
      {
        userId: '11111111-1111-4111-8111-111111111111',
        name: '사용자',
        role,
        targetLevel: null,
        sessionId: '22222222-2222-4222-8222-222222222222',
        createdAt: signedInAt,
        expiresAt: new Date('2026-11-10T00:00:00.000Z'),
        isFresh: false
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
    expect(result.clearSessionCookie).toBe(false)
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
  })
})

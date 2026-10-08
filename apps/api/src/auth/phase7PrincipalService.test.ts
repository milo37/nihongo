import { describe, expect, it, vi } from 'vitest'
import { createPhase7PrincipalService } from './principalService.js'
import { createPhase7SessionCookie } from './phase7SessionCookie.js'

const secret = 'phase7-principal-secret-that-is-at-least-32-characters'

const signedHeaders = (): Headers => {
  const cookie = createPhase7SessionCookie({
    expiresAt: new Date(Date.now() + 60_000),
    isProduction: false,
    rememberMe: true,
    secret,
    token: 'raw-token'
  })
  return new Headers({ Cookie: cookie.split(';')[0]! })
}

describe('Phase 7 principal service', () => {
  it('bounded DB facade의 유효 V1 projection만 principal로 반환한다', async () => {
    const principalQuery = vi.fn().mockResolvedValue([
      {
        userId: '018f6b7a-1f4b-7d5e-8a91-4c27df9c10a1',
        name: '관리자',
        role: 'ADMIN',
        targetLevel: 'N2',
        sessionId: '018f6b7a-1f4b-7d5e-8a91-4c27df9c10a2',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000)
      }
    ])
    const refreshQuery = vi.fn().mockResolvedValue([
      {
        id: '018f6b7a-1f4b-7d5e-8a91-4c27df9c10a2',
        updatedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
        refreshed: false
      }
    ])
    const service = createPhase7PrincipalService({
      client: { $queryRawUnsafe: principalQuery } as never,
      isProduction: false,
      refreshClient: { $queryRawUnsafe: refreshQuery } as never,
      secret
    })

    await expect(
      service.resolveAuthenticatedUser(signedHeaders())
    ).resolves.toMatchObject({
      clearSessionCookie: false,
      user: {
        id: '018f6b7a-1f4b-7d5e-8a91-4c27df9c10a1',
        name: '관리자',
        role: 'ADMIN',
        targetLevel: 'N2'
      }
    })
    expect(refreshQuery).toHaveBeenCalledWith(
      'SELECT * FROM "phase7_refresh_current_remembered_session"($1)',
      'raw-token'
    )
    expect(principalQuery).toHaveBeenCalledWith(
      expect.stringContaining(
        'FROM "phase7_resolve_v1_principal"($1) AS principal'
      ),
      'raw-token'
    )
    expect(principalQuery.mock.calls[0]?.[0]).toContain('AS "isFresh"')
    expect(principalQuery.mock.calls[0]?.[0]).not.toContain('FROM "User"')
  })

  it('DB가 24시간 rolling refresh를 수행한 경우에만 새 서명 cookie를 반환한다', async () => {
    const updatedAt = new Date('2026-08-28T00:00:00.000Z')
    const expiresAt = new Date('2026-09-04T00:00:00.000Z')
    const refreshQuery = vi.fn().mockResolvedValue([
      {
        id: '018f6b7a-1f4b-7d5e-8a91-4c27df9c10a2',
        updatedAt,
        expiresAt,
        refreshed: true
      }
    ])
    const principalQuery = vi.fn().mockResolvedValue([
      {
        userId: '018f6b7a-1f4b-7d5e-8a91-4c27df9c10a1',
        name: '관리자',
        role: 'ADMIN',
        targetLevel: 'N2',
        sessionId: '018f6b7a-1f4b-7d5e-8a91-4c27df9c10a2',
        createdAt: new Date(),
        expiresAt
      }
    ])
    const service = createPhase7PrincipalService({
      client: { $queryRawUnsafe: principalQuery } as never,
      isProduction: false,
      refreshClient: { $queryRawUnsafe: refreshQuery } as never,
      secret
    })

    const resolution = await service.resolveAuthenticatedUser(signedHeaders())

    expect(resolution.clearSessionCookie).toBe(false)
    expect(resolution.headers.get('Set-Cookie')).toMatch(
      /^nihongo\.session_token=raw-token\./
    )
    expect(resolution.headers.get('Set-Cookie')).toContain('Max-Age=604800')
  })

  it('서명 오류는 DB 0, stale authority는 cookie 만료 대상으로 처리한다', async () => {
    const principalQuery = vi.fn().mockResolvedValue([])
    const refreshQuery = vi.fn().mockResolvedValue([])
    const service = createPhase7PrincipalService({
      client: { $queryRawUnsafe: principalQuery } as never,
      isProduction: false,
      refreshClient: { $queryRawUnsafe: refreshQuery } as never,
      secret
    })

    await expect(
      service.resolveAuthenticatedUser(
        new Headers({ Cookie: 'nihongo.session_token=forged' })
      )
    ).resolves.toMatchObject({ clearSessionCookie: true, user: null })
    expect(principalQuery).not.toHaveBeenCalled()
    expect(refreshQuery).not.toHaveBeenCalled()

    await expect(
      service.resolveAuthenticatedUser(signedHeaders())
    ).resolves.toMatchObject({ clearSessionCookie: true, user: null })
    expect(principalQuery).toHaveBeenCalledOnce()
    expect(refreshQuery).toHaveBeenCalledOnce()
  })

  it.each(['ADMIN_REQUIRED', 'AUTH_SESSION_EXPIRED'] as const)(
    '관리자 command 요청에서만 principal zero-row를 %s로 분류한다',
    async (outcome) => {
      const principalQuery = vi.fn(
        async (statement: string, ..._parameters: unknown[]) =>
          statement.includes('phase7_classify_admin_authority')
            ? [{ outcome }]
            : []
      )
      const service = createPhase7PrincipalService({
        client: { $queryRawUnsafe: principalQuery } as never,
        isProduction: false,
        refreshClient: {
          $queryRawUnsafe: vi.fn().mockResolvedValue([])
        } as never,
        secret
      })

      await expect(
        service.resolveAuthenticatedUser(signedHeaders(), {
          classifyAdminAuthorityLoss: true,
          refreshRememberedSession: false
        })
      ).resolves.toMatchObject({
        adminAuthorityFailure: outcome,
        clearSessionCookie: true,
        user: null
      })
      expect(principalQuery.mock.calls.map(([statement]) => statement)).toEqual(
        [
          expect.stringContaining('phase7_resolve_v1_principal'),
          'SELECT * FROM "phase7_classify_admin_authority"($1)'
        ]
      )
      expect(principalQuery.mock.calls[1]?.[1]).toBe('raw-token')
    }
  )

  it('관리자 classifier가 malformed이면 fail closed하고 public 기본 호출에는 classifier를 쓰지 않는다', async () => {
    const principalQuery = vi.fn(async (statement: string) =>
      statement.includes('phase7_classify_admin_authority') ? [] : []
    )
    const service = createPhase7PrincipalService({
      client: { $queryRawUnsafe: principalQuery } as never,
      isProduction: false,
      refreshClient: {
        $queryRawUnsafe: vi.fn().mockResolvedValue([])
      } as never,
      secret
    })

    await expect(
      service.resolveAuthenticatedUser(signedHeaders(), {
        classifyAdminAuthorityLoss: true,
        refreshRememberedSession: false
      })
    ).rejects.toThrow('Phase 7 ADMIN authority classification failed.')

    principalQuery.mockClear()
    await expect(
      service.resolveAuthenticatedUser(signedHeaders(), {
        refreshRememberedSession: false
      })
    ).resolves.toMatchObject({ clearSessionCookie: true, user: null })
    expect(principalQuery).toHaveBeenCalledOnce()
    expect(principalQuery.mock.calls[0]?.[0]).not.toContain(
      'phase7_classify_admin_authority'
    )
  })

  it('refresh와 principal의 session proof가 다르면 fail closed한다', async () => {
    const service = createPhase7PrincipalService({
      client: {
        $queryRawUnsafe: vi.fn().mockResolvedValue([
          {
            userId: '018f6b7a-1f4b-7d5e-8a91-4c27df9c10a1',
            name: '관리자',
            role: 'ADMIN',
            targetLevel: 'N2',
            sessionId: '018f6b7a-1f4b-7d5e-8a91-4c27df9c10a2',
            createdAt: new Date(),
            expiresAt: new Date(Date.now() + 60_000)
          }
        ])
      } as never,
      isProduction: false,
      refreshClient: {
        $queryRawUnsafe: vi.fn().mockResolvedValue([
          {
            id: '018f6b7a-1f4b-7d5e-8a91-4c27df9c10a3',
            updatedAt: new Date(),
            expiresAt: new Date(Date.now() + 60_000),
            refreshed: true
          }
        ])
      } as never,
      secret
    })

    await expect(
      service.resolveAuthenticatedUser(signedHeaders())
    ).resolves.toMatchObject({ clearSessionCookie: true, user: null })
  })
})

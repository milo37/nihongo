import { describe, expect, it, vi } from 'vitest'
import { createPhase7PrincipalService } from './principalService.js'
import { createPhase7SessionCookie } from './phase7SessionCookie.js'

const secret = 'phase7-principal-secret-that-is-at-least-32-characters'

const signedHeaders = (): Headers => {
  const cookie = createPhase7SessionCookie({
    expiresAt: new Date(Date.now() + 60_000),
    isProduction: false,
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
      'SELECT * FROM "phase7_resolve_v1_principal"($1)',
      'raw-token'
    )
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

import { hashPassword } from 'better-auth/crypto'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { parseApiEnvironment } from '../config/env.js'
import type { PrismaClient } from '../generated/prisma/client.js'
import { createPhase7ReauthenticationAuthApi } from './createPhase7ReauthenticationAuth.js'
import { createPhase7ReauthenticationCustomAdapter } from './phase7ReauthenticationAdapter.js'
import { createPhase7ReauthenticationContext } from './phase7ReauthenticationContext.js'
import { createPhase7SessionCookie } from './phase7SessionCookie.js'

const secret = 'phase7-real-better-auth-secret-000000000000'
const userId = '019d0000-0000-7000-8000-000000000001'
const oldSessionId = '019d0000-0000-7000-8000-000000000002'
const accountId = '019d0000-0000-7000-8000-000000000003'
const intentId = '019d0000-0000-7000-8000-000000000004'
const oldToken = 'old-better-auth-session-token'
const password = 'phase7-real-password'
let passwordHash = ''

beforeAll(async () => {
  passwordHash = await hashPassword(password)
})

const environment = parseApiEnvironment({
  NODE_ENV: 'test',
  ADMIN_CMS_MODE: 'technical',
  DATABASE_URL:
    'postgresql://nihongo_test_app_login:password@127.0.0.1:55432/nihongo_test?schema=public',
  AUTH_GATEWAY_DATABASE_URL:
    'postgresql://nihongo_test_auth_gateway_login:password@127.0.0.1:55432/nihongo_test?schema=public',
  TRUSTED_ORIGINS: 'http://localhost:5173',
  BETTER_AUTH_SECRET: secret,
  GUEST_COOKIE_SECRET: 'phase7-guest-cookie-secret-00000000000000',
  AUTH_EMAIL_FROM: 'auth@example.com'
})

describe('Phase 7 restricted Better Auth runtime', () => {
  it('real verifyPassword와 signInEmail이 owned adapter facade만 호출한다', async () => {
    const now = new Date()
    const query = vi.fn(
      async (statement: string, ...parameters: readonly unknown[]) => {
        if (statement.includes('adapter_session')) {
          return [
            {
              id: oldSessionId,
              expiresAt: new Date(now.getTime() + 60 * 60_000),
              token: oldToken,
              createdAt: now,
              updatedAt: now,
              ipAddress: '203.0.113.9',
              userAgent: 'phase7-test',
              userId,
              userName: '관리자',
              userEmail: 'admin@example.com',
              userEmailVerified: true,
              userImage: null,
              userCreatedAt: now,
              userUpdatedAt: now,
              userRole: 'ADMIN',
              userTargetLevel: 'N2',
              userAccountStatus: 'ACTIVE',
              userDeletedAt: null
            }
          ]
        }
        if (statement.includes('adapter_accounts')) {
          return [
            {
              id: accountId,
              accountId: userId,
              providerId: 'credential',
              userId,
              password: passwordHash,
              createdAt: now,
              updatedAt: now
            }
          ]
        }
        if (statement.includes('adapter_subject')) {
          return [
            {
              id: userId,
              name: '관리자',
              email: 'admin@example.com',
              emailVerified: true,
              image: null,
              createdAt: now,
              updatedAt: now,
              role: 'ADMIN',
              targetLevel: 'N2',
              accountStatus: 'ACTIVE',
              deletedAt: null,
              accountId,
              credentialAccountId: userId,
              credentialProviderId: 'credential',
              credentialPassword: passwordHash,
              accountCreatedAt: now,
              accountUpdatedAt: now
            }
          ]
        }
        if (statement.includes('stage_reauthentication_session')) {
          return [
            {
              id: parameters[1],
              expiresAt: parameters[4],
              token: parameters[2],
              createdAt: now,
              updatedAt: now,
              ipAddress: parameters[5],
              userAgent: parameters[6],
              userId
            }
          ]
        }
        throw new Error(`Unexpected owned adapter statement: ${statement}`)
      }
    )
    const context = createPhase7ReauthenticationContext()
    const authApi = createPhase7ReauthenticationAuthApi({
      client: { $queryRawUnsafe: query } as unknown as PrismaClient,
      context,
      environment
    })
    const cookie = createPhase7SessionCookie({
      expiresAt: new Date(now.getTime() + 60 * 60_000),
      isProduction: false,
      rememberMe: true,
      secret,
      token: oldToken
    })
    const headers = new Headers({
      Cookie: cookie.split(';')[0]!,
      Origin: 'http://localhost:5173',
      'User-Agent': 'phase7-real-runtime-test'
    })

    const result = await context.run(intentId, async () => {
      await expect(
        authApi.verifyPassword({ headers, body: { password } })
      ).resolves.toEqual({ status: true })
      return await authApi.signInEmail({
        headers,
        body: { email: 'admin@example.com', password, rememberMe: false },
        returnHeaders: true
      })
    })

    expect(result.response.token).toEqual(expect.any(String))
    expect(result.headers.getSetCookie()).toHaveLength(2)
    expect(result.headers.getSetCookie()[0]).toContain('.session_token=')
    expect(result.headers.getSetCookie()[1]).toContain('.dont_remember=')
    expect(query.mock.calls.map(([statement]) => String(statement))).toEqual([
      expect.stringContaining('adapter_session'),
      expect.stringContaining('adapter_accounts'),
      expect.stringContaining('adapter_subject'),
      expect.stringContaining('stage_reauthentication_session')
    ])
  })

  it('query shape drift의 select·limit·join descriptor를 DB 호출 전에 거부한다', async () => {
    const query = vi.fn()
    const adapter = createPhase7ReauthenticationCustomAdapter({
      client: { $queryRawUnsafe: query } as unknown as PrismaClient,
      getIntentId: () => intentId
    })
    const now = new Date()
    const session = {
      id: oldSessionId,
      expiresAt: new Date(now.getTime() + 60_000),
      token: oldToken,
      createdAt: now,
      updatedAt: now,
      ipAddress: null,
      userAgent: null,
      userId
    }
    const exactWhere = (field: string, value: string) => [
      {
        connector: 'AND' as const,
        field,
        mode: 'sensitive' as const,
        operator: 'eq' as const,
        value
      }
    ]

    await expect(
      adapter.create({ model: 'session', data: session, select: ['id'] })
    ).rejects.toThrow('create:session:select-or-shape')
    await expect(
      adapter.findMany({
        model: 'account',
        where: exactWhere('userId', userId),
        limit: 101
      })
    ).rejects.toThrow('findMany:account:shape')
    await expect(
      adapter.findOne({
        model: 'session',
        where: exactWhere('token', oldToken),
        join: {
          user: {
            limit: 1,
            on: { from: 'id', to: 'userId' },
            relation: 'one-to-one'
          }
        }
      })
    ).rejects.toThrow('findOne:session:shape')
    await expect(
      adapter.findOne({
        model: 'user',
        where: exactWhere('email', 'admin@example.com'),
        join: {
          account: {
            limit: 1,
            on: { from: 'id', to: 'userId' },
            relation: 'one-to-one'
          }
        }
      })
    ).rejects.toThrow('findOne:user:shape')
    expect(query).not.toHaveBeenCalled()
  })
})

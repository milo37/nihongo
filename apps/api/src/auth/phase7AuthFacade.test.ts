import { hashPassword, verifyPassword } from 'better-auth/crypto'
import { describe, expect, it, vi } from 'vitest'
import type { ApiEnvironment } from '../config/env.js'
import { Prisma } from '../generated/prisma/client.js'
import { createPhase7AuthFacade } from './phase7AuthFacade.js'
import {
  createPhase7SessionCookie,
  readPhase7SessionToken
} from './phase7SessionCookie.js'

const environment = {
  NODE_ENV: 'test',
  ADMIN_CMS_MODE: 'technical',
  HOST: '127.0.0.1',
  PORT: 3001,
  DATABASE_URL:
    'postgresql://nihongo_test_app_login:password@localhost/nihongo_test?schema=phase7_test',
  AUTH_GATEWAY_DATABASE_URL:
    'postgresql://nihongo_test_auth_gateway_login:password@localhost/nihongo_test?schema=phase7_test',
  TRUSTED_ORIGINS: ['http://localhost:5173'],
  LOG_LEVEL: 'silent',
  BETTER_AUTH_SECRET: 'auth-secret-that-is-at-least-32-characters',
  BETTER_AUTH_URL: 'http://localhost:3001',
  GUEST_COOKIE_SECRET: 'guest-secret-that-is-at-least-32-characters',
  AUTH_EMAIL_FROM: 'auth@example.test',
  AUTH_EMAIL_DELIVERY_MODE: 'test-sink',
  AUTH_TRUSTED_PROXY_CIDRS: ['127.0.0.1/32']
} satisfies ApiEnvironment

const request = (
  path: string,
  body: Record<string, unknown>,
  cookie?: string
) =>
  new Request(`http://localhost:3001${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {})
    },
    body: JSON.stringify(body)
  })

describe('Phase 7 owned auth facade', () => {
  it.each([
    [
      '/api/auth/change-password',
      {
        currentPassword: 'password-old!',
        newPassword: 'password-new!',
        extra: true
      }
    ],
    [
      '/api/auth/request-password-reset',
      { email: 'user@example.com', redirectTo: 'https://attacker.example' }
    ],
    [
      '/api/auth/reset-password',
      { token: 'token', newPassword: 'password-new!', callbackURL: '/' }
    ],
    [
      '/api/auth/send-verification-email',
      { email: 'user@example.com', callbackURL: '/' }
    ],
    [
      '/api/auth/sign-in/email',
      {
        email: 'user@example.com',
        password: 'password-old!',
        rememberMe: false
      }
    ],
    ['/api/auth/sign-out', { callbackURL: '/' }],
    [
      '/api/auth/sign-up/email',
      {
        email: 'user@example.com',
        name: '사용자',
        password: 'password-old!',
        targetLevel: 'N2',
        rememberMe: true
      }
    ],
    ['/api/auth/verify-email', { token: 'token', callbackURL: '/' }]
  ])('%s unknown field를 DB 전에 거부한다', async (path, payload) => {
    const query = vi.fn()
    const facade = createPhase7AuthFacade({
      client: { $queryRawUnsafe: query } as never,
      emailDispatcher: {
        abort: vi.fn(),
        drain: vi.fn(),
        enqueue: vi.fn()
      },
      environment
    })

    const result = await facade.handle(request(path, payload), path, payload)
    expect(result.status).toBe(400)
    expect(query).not.toHaveBeenCalled()
  })

  it.each([
    [
      '/api/auth/sign-in/email',
      { email: 'user@example.com', password: `password-old!\ud800` }
    ],
    [
      '/api/auth/sign-up/email',
      {
        email: 'user@example.com',
        name: '사용자',
        password: `password-old!\ud800`,
        targetLevel: 'N2'
      }
    ],
    [
      '/api/auth/reset-password',
      { token: 'token', newPassword: `password-new!\ud800` }
    ],
    [
      '/api/auth/change-password',
      {
        currentPassword: `password-old!\ud800`,
        newPassword: 'password-new!'
      }
    ]
  ])(
    '%s unpaired surrogate password를 DB 전에 거부한다',
    async (path, payload) => {
      const query = vi.fn()
      const facade = createPhase7AuthFacade({
        client: { $queryRawUnsafe: query } as never,
        emailDispatcher: {
          abort: vi.fn(),
          drain: vi.fn(),
          enqueue: vi.fn()
        },
        environment
      })

      const result = await facade.handle(request(path, payload), path, payload)
      expect(result.status).toBe(400)
      expect(query).not.toHaveBeenCalled()
    }
  )

  it('password raw 128 경계를 NFKC normalize 전에 고정한다', async () => {
    const query = vi.fn().mockResolvedValue([])
    const facade = createPhase7AuthFacade({
      client: { $queryRawUnsafe: query } as never,
      emailDispatcher: {
        abort: vi.fn(),
        drain: vi.fn(),
        enqueue: vi.fn()
      },
      environment
    })
    const base = {
      email: 'user@example.com',
      name: '사용자',
      targetLevel: 'N2'
    }
    const accepted = { ...base, password: 'ﬃ'.repeat(128) }
    const rejected = { ...base, password: 'ﬃ'.repeat(129) }

    const acceptedResponse = await facade.handle(
      request('/api/auth/sign-up/email', accepted),
      '/api/auth/sign-up/email',
      accepted
    )
    const rejectedResponse = await facade.handle(
      request('/api/auth/sign-up/email', rejected),
      '/api/auth/sign-up/email',
      rejected
    )

    expect(acceptedResponse.status).toBe(200)
    expect(rejectedResponse.status).toBe(400)
    expect(query).toHaveBeenCalledOnce()
    expect(
      await verifyPassword({
        hash: query.mock.calls[0]?.[6] as string,
        password: 'ffi'.repeat(128)
      })
    ).toBe(true)
  })

  it('strict sign-in proof 뒤 DB issuer 반환값으로만 signed cookie를 발행한다', async () => {
    const passwordHash = await hashPassword('Password1234!')
    const query = vi.fn(async (sql: string, ...values: unknown[]) => {
      if (sql.includes('phase7_resolve_sign_in_credential')) {
        return [
          {
            userId: '018f6b7a-1f4b-7d5e-8a91-4c27df9c10a1',
            passwordHash,
            emailVerified: true,
            authorityGeneration: 3,
            role: 'ADMIN',
            accountStatus: 'ACTIVE'
          }
        ]
      }
      if (sql.includes('phase7_issue_v1_session')) {
        return [
          {
            id: values[4],
            familyId: '018f6b7a-1f4b-7d5e-8a91-4c27df9c10a2',
            createdAt: new Date('2026-08-28T00:00:00.000Z'),
            expiresAt: new Date('2026-09-04T00:00:00.000Z'),
            authorityGeneration: 3
          }
        ]
      }
      if (sql.includes('phase7_confirm_v1_session_issuance')) {
        return [{ confirmed: true }]
      }
      throw new Error('unexpected SQL')
    })
    const facade = createPhase7AuthFacade({
      client: { $queryRawUnsafe: query } as never,
      emailDispatcher: {
        abort: vi.fn(),
        drain: vi.fn(),
        enqueue: vi.fn()
      },
      environment
    })
    const response = await facade.handle(
      request('/api/auth/sign-in/email', {
        email: 'ADMIN@EXAMPLE.COM',
        password: 'Ｐａｓｓｗｏｒｄ１２３４！'
      }),
      '/api/auth/sign-in/email',
      { email: 'ADMIN@EXAMPLE.COM', password: 'Ｐａｓｓｗｏｒｄ１２３４！' }
    )

    expect(response.status).toBe(200)
    const setCookie = response.headers.get('Set-Cookie')
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('Max-Age=604800')
    expect(
      readPhase7SessionToken({
        cookieHeader: setCookie,
        isProduction: false,
        secret: environment.BETTER_AUTH_SECRET
      }).token
    ).toHaveLength(43)
    expect(query.mock.calls[0]?.[1]).toBe('admin@example.com')
    expect(query.mock.calls[1]?.at(-1)).toBe('')
    expect(query).toHaveBeenCalledTimes(3)
    expect(query.mock.calls[2]?.[0]).toContain(
      'phase7_confirm_v1_session_issuance'
    )
    expect(query.mock.calls[2]?.slice(1)).toEqual([
      query.mock.calls[1]?.[6],
      query.mock.calls[1]?.[5],
      '018f6b7a-1f4b-7d5e-8a91-4c27df9c10a1',
      3,
      'ADMIN',
      'ACTIVE'
    ])
  })

  it.each(['authorityGeneration', 'role', 'accountStatus'])(
    'issuer commit 후 post-gate %s drift는 보상 1회 뒤 generic 401, cookie 0으로 닫는다',
    async () => {
      const passwordHash = await hashPassword('Password1234!')
      const query = vi.fn(async (sql: string, ...values: unknown[]) => {
        if (sql.includes('phase7_resolve_sign_in_credential')) {
          return [
            {
              userId: '018f6b7a-1f4b-7d5e-8a91-4c27df9c10a1',
              passwordHash,
              emailVerified: true,
              authorityGeneration: 3,
              role: 'ADMIN',
              accountStatus: 'ACTIVE'
            }
          ]
        }
        if (sql.includes('phase7_issue_v1_session')) {
          return [
            {
              id: values[4],
              familyId: '018f6b7a-1f4b-7d5e-8a91-4c27df9c10a2',
              createdAt: new Date('2026-08-28T00:00:00.000Z'),
              expiresAt: new Date('2026-09-04T00:00:00.000Z'),
              authorityGeneration: 3
            }
          ]
        }
        if (sql.includes('phase7_confirm_v1_session_issuance')) {
          return [{ confirmed: false }]
        }
        if (sql.includes('phase7_owned_sign_out')) {
          return [{ signedOut: true }]
        }
        throw new Error('unexpected SQL')
      })
      const facade = createPhase7AuthFacade({
        client: { $queryRawUnsafe: query } as never,
        emailDispatcher: {
          abort: vi.fn(),
          drain: vi.fn(),
          enqueue: vi.fn()
        },
        environment
      })
      const payload = {
        email: 'admin@example.com',
        password: 'Password1234!'
      }

      const result = await facade.handle(
        request('/api/auth/sign-in/email', payload),
        '/api/auth/sign-in/email',
        payload
      )

      expect(result.status).toBe(401)
      expect(await result.json()).toEqual({
        code: 'INVALID_EMAIL_OR_PASSWORD',
        message: 'Invalid email or password.'
      })
      expect(result.headers.getSetCookie()).toEqual([])
      expect(query).toHaveBeenCalledTimes(4)
      expect(query.mock.calls[2]?.[0]).toContain(
        'phase7_confirm_v1_session_issuance'
      )
      expect(query.mock.calls[2]?.slice(1)).toEqual([
        query.mock.calls[1]?.[6],
        query.mock.calls[1]?.[5],
        '018f6b7a-1f4b-7d5e-8a91-4c27df9c10a1',
        3,
        'ADMIN',
        'ACTIVE'
      ])
      expect(query.mock.calls[3]).toEqual([
        'SELECT "phase7_owned_sign_out"($1) AS "signedOut"',
        query.mock.calls[1]?.[6]
      ])
    }
  )

  it('post-gate lookup 실패는 보상 1회 뒤 503, cookie 0으로 닫는다', async () => {
    const passwordHash = await hashPassword('Password1234!')
    const query = vi.fn(async (sql: string, ...values: unknown[]) => {
      if (sql.includes('phase7_resolve_sign_in_credential')) {
        return [
          {
            userId: '018f6b7a-1f4b-7d5e-8a91-4c27df9c10a1',
            passwordHash,
            emailVerified: true,
            authorityGeneration: 3,
            role: 'ADMIN',
            accountStatus: 'ACTIVE'
          }
        ]
      }
      if (sql.includes('phase7_issue_v1_session')) {
        return [
          {
            id: values[4],
            familyId: '018f6b7a-1f4b-7d5e-8a91-4c27df9c10a2',
            createdAt: new Date('2026-08-28T00:00:00.000Z'),
            expiresAt: new Date('2026-09-04T00:00:00.000Z'),
            authorityGeneration: 3
          }
        ]
      }
      if (sql.includes('phase7_confirm_v1_session_issuance')) {
        throw new Error('post-gate lookup unavailable')
      }
      if (sql.includes('phase7_owned_sign_out')) {
        return [{ signedOut: true }]
      }
      throw new Error('unexpected SQL')
    })
    const facade = createPhase7AuthFacade({
      client: { $queryRawUnsafe: query } as never,
      emailDispatcher: {
        abort: vi.fn(),
        drain: vi.fn(),
        enqueue: vi.fn()
      },
      environment
    })
    const payload = {
      email: 'admin@example.com',
      password: 'Password1234!'
    }

    const result = await facade.handle(
      request('/api/auth/sign-in/email', payload),
      '/api/auth/sign-in/email',
      payload
    )

    expect(result.status).toBe(503)
    expect(await result.json()).toEqual({
      code: 'AUTH_SERVICE_UNAVAILABLE',
      message: 'Authentication service is unavailable.'
    })
    expect(result.headers.getSetCookie()).toEqual([])
    expect(query).toHaveBeenCalledTimes(4)
    expect(query.mock.calls[3]).toEqual([
      'SELECT "phase7_owned_sign_out"($1) AS "signedOut"',
      query.mock.calls[1]?.[6]
    ])
  })

  it.each(['false', 'throw'])(
    'post-gate drift 보상 %s는 503, cookie 0으로 fail-closed한다',
    async (compensationFailure) => {
      const passwordHash = await hashPassword('Password1234!')
      const query = vi.fn(async (sql: string, ...values: unknown[]) => {
        if (sql.includes('phase7_resolve_sign_in_credential')) {
          return [
            {
              userId: '018f6b7a-1f4b-7d5e-8a91-4c27df9c10a1',
              passwordHash,
              emailVerified: true,
              authorityGeneration: 3,
              role: 'ADMIN',
              accountStatus: 'ACTIVE'
            }
          ]
        }
        if (sql.includes('phase7_issue_v1_session')) {
          return [
            {
              id: values[4],
              familyId: '018f6b7a-1f4b-7d5e-8a91-4c27df9c10a2',
              createdAt: new Date('2026-08-28T00:00:00.000Z'),
              expiresAt: new Date('2026-09-04T00:00:00.000Z'),
              authorityGeneration: 3
            }
          ]
        }
        if (sql.includes('phase7_confirm_v1_session_issuance')) {
          return [{ confirmed: false }]
        }
        if (sql.includes('phase7_owned_sign_out')) {
          if (compensationFailure === 'throw') {
            throw new Error('compensation unavailable')
          }
          return [{ signedOut: false }]
        }
        throw new Error('unexpected SQL')
      })
      const facade = createPhase7AuthFacade({
        client: { $queryRawUnsafe: query } as never,
        emailDispatcher: {
          abort: vi.fn(),
          drain: vi.fn(),
          enqueue: vi.fn()
        },
        environment
      })
      const payload = {
        email: 'admin@example.com',
        password: 'Password1234!'
      }

      const result = await facade.handle(
        request('/api/auth/sign-in/email', payload),
        '/api/auth/sign-in/email',
        payload
      )

      expect(result.status).toBe(503)
      expect(await result.json()).toEqual({
        code: 'AUTH_SERVICE_UNAVAILABLE',
        message: 'Authentication service is unavailable.'
      })
      expect(result.headers.getSetCookie()).toEqual([])
      expect(query).toHaveBeenCalledTimes(4)
      expect(query.mock.calls[3]?.[0]).toContain('phase7_owned_sign_out')
      expect(query.mock.calls[3]?.[1]).toBe(query.mock.calls[1]?.[6])
    }
  )

  it('valid password의 미검증 계정은 verification mail 1회 뒤 session·cookie 0의 403을 반환한다', async () => {
    const passwordHash = await hashPassword('Password1234!')
    const enqueue = vi.fn()
    const query = vi.fn().mockResolvedValue([
      {
        userId: '018f6b7a-1f4b-7d5e-8a91-4c27df9c10a1',
        passwordHash,
        emailVerified: false,
        authorityGeneration: 3,
        role: 'USER',
        accountStatus: 'ACTIVE'
      }
    ])
    const facade = createPhase7AuthFacade({
      client: { $queryRawUnsafe: query } as never,
      emailDispatcher: { abort: vi.fn(), drain: vi.fn(), enqueue },
      environment
    })
    const payload = {
      email: 'UNVERIFIED@EXAMPLE.COM',
      password: 'Ｐａｓｓｗｏｒｄ１２３４！'
    }

    const result = await facade.handle(
      request('/api/auth/sign-in/email', payload),
      '/api/auth/sign-in/email',
      payload
    )

    expect(result.status).toBe(403)
    expect(await result.json()).toEqual({
      code: 'EMAIL_NOT_VERIFIED',
      message: 'Email is not verified.'
    })
    expect(result.headers.getSetCookie()).toEqual([])
    expect(query).toHaveBeenCalledOnce()
    expect(query.mock.calls[0]?.[0]).toContain(
      'phase7_resolve_sign_in_credential'
    )
    expect(query.mock.calls[0]?.[1]).toBe('unverified@example.com')
    expect(enqueue).toHaveBeenCalledOnce()
    expect(enqueue.mock.calls[0]?.[0]).toMatchObject({
      from: environment.AUTH_EMAIL_FROM,
      purpose: 'EMAIL_VERIFICATION',
      recipient: 'unverified@example.com'
    })
    const verificationUrl = new URL(enqueue.mock.calls[0]![0].url)
    expect(verificationUrl.search).toBe('')
    expect(verificationUrl.hash).toMatch(/^#token=/u)
  })

  it.each(['missing', 'wrong-password'])(
    '%s sign-in은 verification mail·session·cookie를 만들지 않는다',
    async (scenario) => {
      const passwordHash = await hashPassword('Password1234!')
      const enqueue = vi.fn()
      const query = vi.fn().mockResolvedValue(
        scenario === 'missing'
          ? []
          : [
              {
                userId: '018f6b7a-1f4b-7d5e-8a91-4c27df9c10a1',
                passwordHash,
                emailVerified: false,
                authorityGeneration: 3,
                role: 'USER',
                accountStatus: 'ACTIVE'
              }
            ]
      )
      const facade = createPhase7AuthFacade({
        client: { $queryRawUnsafe: query } as never,
        emailDispatcher: { abort: vi.fn(), drain: vi.fn(), enqueue },
        environment
      })
      const payload = {
        email: 'unverified@example.com',
        password:
          scenario === 'missing' ? 'Password1234!' : 'WrongPassword1234!'
      }

      const result = await facade.handle(
        request('/api/auth/sign-in/email', payload),
        '/api/auth/sign-in/email',
        payload
      )

      expect(result.status).toBe(401)
      expect(await result.json()).toEqual({
        code: 'INVALID_EMAIL_OR_PASSWORD',
        message: 'Invalid email or password.'
      })
      expect(result.headers.getSetCookie()).toEqual([])
      expect(query).toHaveBeenCalledOnce()
      expect(enqueue).not.toHaveBeenCalled()
    }
  )

  it.each(['authorityGeneration', 'role', 'accountStatus'])(
    '발급 직전 %s drift는 generic 401, cookie 0, 추가 write 0으로 닫는다',
    async () => {
      const passwordHash = await hashPassword('Password1234!')
      const staleIssuer = new Prisma.PrismaClientKnownRequestError(
        'Raw query failed. Code: `42501`.',
        {
          clientVersion: '7.9.1',
          code: 'P2010',
          meta: {
            code: '42501',
            message: 'ERROR: V1 Session issuance proof is stale.'
          }
        }
      )
      const query = vi
        .fn()
        .mockResolvedValueOnce([
          {
            userId: '018f6b7a-1f4b-7d5e-8a91-4c27df9c10a1',
            passwordHash,
            emailVerified: true,
            authorityGeneration: 3,
            role: 'ADMIN',
            accountStatus: 'ACTIVE'
          }
        ])
        .mockRejectedValueOnce(staleIssuer)
      const facade = createPhase7AuthFacade({
        client: { $queryRawUnsafe: query } as never,
        emailDispatcher: {
          abort: vi.fn(),
          drain: vi.fn(),
          enqueue: vi.fn()
        },
        environment
      })
      const payload = {
        email: 'admin@example.com',
        password: 'Password1234!'
      }

      const result = await facade.handle(
        request('/api/auth/sign-in/email', payload),
        '/api/auth/sign-in/email',
        payload
      )

      expect(result.status).toBe(401)
      expect(await result.json()).toEqual({
        code: 'INVALID_EMAIL_OR_PASSWORD',
        message: 'Invalid email or password.'
      })
      expect(result.headers.getSetCookie()).toEqual([])
      expect(query).toHaveBeenCalledTimes(2)
      expect(query.mock.calls[1]?.[0]).toContain('phase7_issue_v1_session')
      expect(
        query.mock.calls.some(([sql]) =>
          String(sql).includes('phase7_owned_sign_out')
        )
      ).toBe(false)
    }
  )

  it('adapter-pg nested metadata의 stale issuer도 generic 401로 좁힌다', async () => {
    const passwordHash = await hashPassword('Password1234!')
    const staleIssuer = new Prisma.PrismaClientKnownRequestError(
      'Raw query failed. Code: `42501`.',
      {
        clientVersion: '7.9.1',
        code: 'P2010',
        meta: {
          driverAdapterError: {
            cause: {
              kind: 'postgres',
              originalCode: '42501',
              originalMessage: 'V1 Session issuance proof is stale.'
            },
            name: 'DriverAdapterError'
          }
        }
      }
    )
    const query = vi
      .fn()
      .mockResolvedValueOnce([
        {
          userId: '018f6b7a-1f4b-7d5e-8a91-4c27df9c10a1',
          passwordHash,
          emailVerified: true,
          authorityGeneration: 3,
          role: 'ADMIN',
          accountStatus: 'ACTIVE'
        }
      ])
      .mockRejectedValueOnce(staleIssuer)
    const facade = createPhase7AuthFacade({
      client: { $queryRawUnsafe: query } as never,
      emailDispatcher: {
        abort: vi.fn(),
        drain: vi.fn(),
        enqueue: vi.fn()
      },
      environment
    })
    const payload = {
      email: 'admin@example.com',
      password: 'Password1234!'
    }

    const result = await facade.handle(
      request('/api/auth/sign-in/email', payload),
      '/api/auth/sign-in/email',
      payload
    )

    expect(result.status).toBe(401)
    expect(await result.json()).toEqual({
      code: 'INVALID_EMAIL_OR_PASSWORD',
      message: 'Invalid email or password.'
    })
    expect(result.headers.getSetCookie()).toEqual([])
    expect(query).toHaveBeenCalledTimes(2)
  })

  it.each([
    'V1 Session issuance requires activated authority.',
    'V1 Session lost authority before issuance completed.'
  ])(
    'issuer의 다른 42501(%s)은 infra 503, cookie 0으로 유지한다',
    async (databaseMessage) => {
      const passwordHash = await hashPassword('Password1234!')
      const issuerFailure = new Prisma.PrismaClientKnownRequestError(
        'Raw query failed. Code: `42501`.',
        {
          clientVersion: '7.9.1',
          code: 'P2010',
          meta: {
            code: '42501',
            message: `ERROR: ${databaseMessage}`
          }
        }
      )
      const query = vi
        .fn()
        .mockResolvedValueOnce([
          {
            userId: '018f6b7a-1f4b-7d5e-8a91-4c27df9c10a1',
            passwordHash,
            emailVerified: true,
            authorityGeneration: 3,
            role: 'ADMIN',
            accountStatus: 'ACTIVE'
          }
        ])
        .mockRejectedValueOnce(issuerFailure)
      const facade = createPhase7AuthFacade({
        client: { $queryRawUnsafe: query } as never,
        emailDispatcher: {
          abort: vi.fn(),
          drain: vi.fn(),
          enqueue: vi.fn()
        },
        environment
      })
      const payload = {
        email: 'admin@example.com',
        password: 'Password1234!'
      }

      const result = await facade.handle(
        request('/api/auth/sign-in/email', payload),
        '/api/auth/sign-in/email',
        payload
      )

      expect(result.status).toBe(503)
      expect(await result.json()).toEqual({
        code: 'AUTH_SERVICE_UNAVAILABLE',
        message: 'Authentication service is unavailable.'
      })
      expect(result.headers.getSetCookie()).toEqual([])
      expect(query).toHaveBeenCalledTimes(2)
    }
  )

  it.each([
    {
      originalCode: '42501',
      originalMessage: 'V1 Session issuance requires activated authority.'
    },
    {
      originalCode: '42501',
      originalMessage: 'V1 Session lost authority before issuance completed.'
    },
    {
      originalCode: '55000',
      originalMessage: 'V1 Session issuance proof is stale.'
    }
  ])(
    'adapter-pg nested metadata의 non-stale $originalCode 오류는 503으로 유지한다',
    async ({ originalCode, originalMessage }) => {
      const passwordHash = await hashPassword('Password1234!')
      const issuerFailure = new Prisma.PrismaClientKnownRequestError(
        `Raw query failed. Code: \`${originalCode}\`.`,
        {
          clientVersion: '7.9.1',
          code: 'P2010',
          meta: {
            driverAdapterError: {
              cause: {
                kind: 'postgres',
                originalCode,
                originalMessage
              },
              name: 'DriverAdapterError'
            }
          }
        }
      )
      const query = vi
        .fn()
        .mockResolvedValueOnce([
          {
            userId: '018f6b7a-1f4b-7d5e-8a91-4c27df9c10a1',
            passwordHash,
            emailVerified: true,
            authorityGeneration: 3,
            role: 'ADMIN',
            accountStatus: 'ACTIVE'
          }
        ])
        .mockRejectedValueOnce(issuerFailure)
      const facade = createPhase7AuthFacade({
        client: { $queryRawUnsafe: query } as never,
        emailDispatcher: {
          abort: vi.fn(),
          drain: vi.fn(),
          enqueue: vi.fn()
        },
        environment
      })
      const payload = {
        email: 'admin@example.com',
        password: 'Password1234!'
      }

      const result = await facade.handle(
        request('/api/auth/sign-in/email', payload),
        '/api/auth/sign-in/email',
        payload
      )

      expect(result.status).toBe(503)
      expect(await result.json()).toEqual({
        code: 'AUTH_SERVICE_UNAVAILABLE',
        message: 'Authentication service is unavailable.'
      })
      expect(result.headers.getSetCookie()).toEqual([])
      expect(query).toHaveBeenCalledTimes(2)
    }
  )

  it('flat/nested raw metadata가 충돌하면 fail-closed 503으로 유지한다', async () => {
    const passwordHash = await hashPassword('Password1234!')
    const conflictingFailure = new Prisma.PrismaClientKnownRequestError(
      'Raw query failed. Code: `42501`.',
      {
        clientVersion: '7.9.1',
        code: 'P2010',
        meta: {
          code: '42501',
          driverAdapterError: {
            cause: {
              kind: 'postgres',
              originalCode: '42501',
              originalMessage:
                'V1 Session issuance requires activated authority.'
            },
            name: 'DriverAdapterError'
          },
          message: 'V1 Session issuance proof is stale.'
        }
      }
    )
    const query = vi
      .fn()
      .mockResolvedValueOnce([
        {
          userId: '018f6b7a-1f4b-7d5e-8a91-4c27df9c10a1',
          passwordHash,
          emailVerified: true,
          authorityGeneration: 3,
          role: 'ADMIN',
          accountStatus: 'ACTIVE'
        }
      ])
      .mockRejectedValueOnce(conflictingFailure)
    const facade = createPhase7AuthFacade({
      client: { $queryRawUnsafe: query } as never,
      emailDispatcher: {
        abort: vi.fn(),
        drain: vi.fn(),
        enqueue: vi.fn()
      },
      environment
    })
    const payload = {
      email: 'admin@example.com',
      password: 'Password1234!'
    }

    const result = await facade.handle(
      request('/api/auth/sign-in/email', payload),
      '/api/auth/sign-in/email',
      payload
    )

    expect(result.status).toBe(503)
    expect(result.headers.getSetCookie()).toEqual([])
    expect(query).toHaveBeenCalledTimes(2)
  })

  it('unknown input은 credential/DB call 전에 거부한다', async () => {
    const query = vi.fn()
    const facade = createPhase7AuthFacade({
      client: { $queryRawUnsafe: query } as never,
      emailDispatcher: {
        abort: vi.fn(),
        drain: vi.fn(),
        enqueue: vi.fn()
      },
      environment
    })
    const payload = {
      email: 'admin@example.com',
      password: 'password-password',
      rememberMe: false
    }
    const response = await facade.handle(
      request('/api/auth/sign-in/email', payload),
      '/api/auth/sign-in/email',
      payload
    )

    expect(response.status).toBe(400)
    expect(query).not.toHaveBeenCalled()
  })

  it('sign-up duplicate도 동일 success이며 신규 가입은 Session 없이 fragment 검증 링크만 보낸다', async () => {
    const enqueue = vi.fn()
    const query = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          userId: '018f6b7a-1f4b-7d5e-8a91-4c27df9c10a1',
          email: 'new@example.com'
        }
      ])
    const facade = createPhase7AuthFacade({
      client: { $queryRawUnsafe: query } as never,
      emailDispatcher: { abort: vi.fn(), drain: vi.fn(), enqueue },
      environment
    })
    const duplicate = {
      email: 'existing@example.com',
      name: '기존 사용자',
      password: 'ｐａｓｓｗｏｒｄ－ｐａｓｓｗｏｒｄ',
      targetLevel: 'N2'
    }
    const created = { ...duplicate, email: 'new@example.com' }

    const duplicateResponse = await facade.handle(
      request('/api/auth/sign-up/email', duplicate),
      '/api/auth/sign-up/email',
      duplicate
    )
    expect(enqueue).not.toHaveBeenCalled()
    const createdResponse = await facade.handle(
      request('/api/auth/sign-up/email', created),
      '/api/auth/sign-up/email',
      created
    )

    expect(await duplicateResponse.json()).toEqual({ success: true })
    expect(await createdResponse.json()).toEqual({ success: true })
    expect(duplicateResponse.headers.getSetCookie()).toEqual([])
    expect(createdResponse.headers.getSetCookie()).toEqual([])
    expect(enqueue).toHaveBeenCalledOnce()
    const url = new URL(enqueue.mock.calls[0]![0].url)
    expect(url.search).toBe('')
    expect(url.hash).toMatch(/^#token=/u)
    expect(
      query.mock.calls.every(([sql]) =>
        String(sql).includes('phase7_sign_up_credential')
      )
    ).toBe(true)
    expect(
      await verifyPassword({
        hash: query.mock.calls[1]?.[6] as string,
        password: 'password-password'
      })
    ).toBe(true)
  })

  it('password-reset 요청은 known/비대상 동일 wire이며 known만 fragment 링크를 보낸다', async () => {
    const enqueue = vi.fn()
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('phase7_request_password_reset')) {
        return [{ issued: true }]
      }
      throw new Error('unexpected SQL')
    })
    const knownFacade = createPhase7AuthFacade({
      client: { $queryRawUnsafe: query } as never,
      emailDispatcher: { abort: vi.fn(), drain: vi.fn(), enqueue },
      environment
    })
    const knownPayload = { email: 'known@example.com' }
    const knownResponse = await knownFacade.handle(
      request('/api/auth/request-password-reset', knownPayload),
      '/api/auth/request-password-reset',
      knownPayload
    )

    const missingEnqueue = vi.fn()
    const missingQuery = vi.fn().mockResolvedValue([{ issued: false }])
    const missingFacade = createPhase7AuthFacade({
      client: { $queryRawUnsafe: missingQuery } as never,
      emailDispatcher: {
        abort: vi.fn(),
        drain: vi.fn(),
        enqueue: missingEnqueue
      },
      environment
    })
    const missingPayload = { email: 'missing@example.com' }
    const missingResponse = await missingFacade.handle(
      request('/api/auth/request-password-reset', missingPayload),
      '/api/auth/request-password-reset',
      missingPayload
    )

    expect(await knownResponse.json()).toEqual({ success: true })
    expect(await missingResponse.json()).toEqual({ success: true })
    expect(enqueue).toHaveBeenCalledOnce()
    expect(missingEnqueue).not.toHaveBeenCalled()
    const resetUrl = new URL(enqueue.mock.calls[0]![0].url)
    expect(resetUrl.search).toBe('')
    expect(resetUrl.hash).toMatch(/^#token=/u)
    expect(query).toHaveBeenCalledOnce()
    expect(missingQuery).toHaveBeenCalledOnce()
    expect(query.mock.calls[0]?.[0]).toContain('phase7_request_password_reset')
    expect(missingQuery.mock.calls[0]?.[0]).toContain(
      'phase7_request_password_reset'
    )
    expect(query.mock.calls[0]?.slice(1)).toHaveLength(3)
    expect(missingQuery.mock.calls[0]?.slice(1)).toHaveLength(3)
    expect(String(missingQuery.mock.calls[0]?.[0])).not.toMatch(
      /(?:INSERT|UPDATE|DELETE)\s/iu
    )
  })

  it('reset-password는 bounded token resolve와 atomic consume 뒤 cookie만 만료한다', async () => {
    const passwordHash = await hashPassword('password-old!')
    const query = vi
      .fn()
      .mockResolvedValueOnce([
        {
          userId: '018f6b7a-1f4b-7d5e-8a91-4c27df9c10a1',
          passwordHash,
          authorityGeneration: 4
        }
      ])
      .mockResolvedValueOnce([
        {
          userId: '018f6b7a-1f4b-7d5e-8a91-4c27df9c10a1',
          authorityGeneration: 5
        }
      ])
    const facade = createPhase7AuthFacade({
      client: { $queryRawUnsafe: query } as never,
      emailDispatcher: {
        abort: vi.fn(),
        drain: vi.fn(),
        enqueue: vi.fn()
      },
      environment
    })
    const payload = {
      token: 'reset-token',
      newPassword: 'ｐａｓｓｗｏｒｄ－ｎｅｗ！'
    }
    const result = await facade.handle(
      request('/api/auth/reset-password', payload),
      '/api/auth/reset-password',
      payload
    )

    expect(result.status).toBe(200)
    expect(result.headers.getSetCookie()).toHaveLength(2)
    expect(query.mock.calls[0]?.[0]).toContain(
      'phase7_resolve_password_reset_credential'
    )
    expect(query.mock.calls[1]?.[0]).toContain('phase7_consume_password_reset')
    expect(query.mock.calls[1]).toHaveLength(3)
    expect(query.mock.calls[1]?.[1]).toBe(payload.token)
    expect(query.mock.calls[1]?.[2]).toEqual(expect.any(String))
    expect(
      await verifyPassword({
        hash: query.mock.calls[1]?.[2] as string,
        password: 'password-new!'
      })
    ).toBe(true)
  })

  it('owned sign-out 성공 뒤 두 cookie만 만료한다', async () => {
    const signInCookie = createPhase7SessionCookie({
      expiresAt: new Date(Date.now() + 60_000),
      isProduction: false,
      rememberMe: true,
      secret: environment.BETTER_AUTH_SECRET,
      token: 'owned-token'
    }).split(';')[0]!
    const query = vi.fn().mockResolvedValue([{ signedOut: true }])
    const facade = createPhase7AuthFacade({
      client: { $queryRawUnsafe: query } as never,
      emailDispatcher: {
        abort: vi.fn(),
        drain: vi.fn(),
        enqueue: vi.fn()
      },
      environment
    })
    const response = await facade.handle(
      request('/api/auth/sign-out', {}, signInCookie),
      '/api/auth/sign-out',
      {}
    )

    expect(response.status).toBe(200)
    expect(response.headers.getSetCookie()).toHaveLength(2)
    expect(query).toHaveBeenCalledWith(
      'SELECT "phase7_owned_sign_out"($1) AS "signedOut"',
      'owned-token'
    )
  })

  it('change-password는 live V1 credential과 atomic revoke 뒤 cookie만 만료한다', async () => {
    const passwordHash = await hashPassword('password-old!')
    const cookie = createPhase7SessionCookie({
      expiresAt: new Date(Date.now() + 60_000),
      isProduction: false,
      rememberMe: true,
      secret: environment.BETTER_AUTH_SECRET,
      token: 'change-token'
    }).split(';')[0]!
    const query = vi
      .fn()
      .mockResolvedValueOnce([
        {
          userId: '018f6b7a-1f4b-7d5e-8a91-4c27df9c10a1',
          passwordHash,
          authorityGeneration: 1,
          role: 'USER',
          accountStatus: 'ACTIVE'
        }
      ])
      .mockResolvedValueOnce([{ changed: true }])
    const facade = createPhase7AuthFacade({
      client: { $queryRawUnsafe: query } as never,
      emailDispatcher: {
        abort: vi.fn(),
        drain: vi.fn(),
        enqueue: vi.fn()
      },
      environment
    })
    const payload = {
      currentPassword: 'ｐａｓｓｗｏｒｄ－ｏｌｄ！',
      newPassword: 'ｐａｓｓｗｏｒｄ－ｎｅｗ！'
    }
    const result = await facade.handle(
      request('/api/auth/change-password', payload, cookie),
      '/api/auth/change-password',
      payload
    )

    expect(result.status).toBe(200)
    expect(result.headers.getSetCookie()).toHaveLength(2)
    expect(query.mock.calls[0]?.[0]).toContain(
      'phase7_resolve_session_credential'
    )
    expect(query.mock.calls[1]?.[0]).toContain('phase7_change_password_v1')
    expect(query.mock.calls[1]?.[1]).toBe('change-token')
    expect(
      await verifyPassword({
        hash: query.mock.calls[1]?.[3] as string,
        password: 'password-new!'
      })
    ).toBe(true)
  })
})

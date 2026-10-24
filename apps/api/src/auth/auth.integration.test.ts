import { randomUUID } from 'node:crypto'
import { hashPassword } from 'better-auth/crypto'
import { Client } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createApiApp } from '../app/createApp.js'
import { createPhase7SsoSessionFixture } from '../db/fixtures/phase7SsoSession.js'
import { parseApiEnvironment } from '../config/env.js'
import {
  createDatabaseRuntime,
  createRoleDatabaseRuntime
} from '../db/database.js'
import {
  createPostgresStartupOptions,
  getPostgresSchema
} from '../db/databaseOptions.js'
import { assertSafeTestDatabase } from '../db/databaseTargetGuard.js'
import { createApplicationRateLimiter } from '../middleware/applicationRateLimiter.js'
import { createJsonLogger } from '../observability/logger.js'
import type { QuestionReader } from '../question/questionService.js'
import { createAdminProvisioner } from './adminProvisioning.js'
import { createAuthGateway } from './authGateway.js'
import { createAuthRuntime } from './createAuth.js'
import { createAuthEmailDispatcher } from './emailDispatcher.js'
import { InMemoryAuthEmailPort } from './emailPort.js'
import { createGuestPrincipalService } from './guestPrincipalService.js'
import { createPhase7AuthFacade } from './phase7AuthFacade.js'
import {
  createPhase7PrincipalService,
  createPrincipalService
} from './principalService.js'
import { GUEST_COOKIE_NAME } from '../routes/principal.js'

const environment = parseApiEnvironment(process.env)
assertSafeTestDatabase({
  nodeEnvironment: environment.NODE_ENV,
  databaseUrl: environment.DATABASE_URL,
  productionDatabaseUrl: process.env.PRODUCTION_DATABASE_URL
})

const isPhase10CurrentSource =
  process.env.PHASE10_CURRENT_SOURCE_INTEGRATION === '1'
const fixtureDatabaseUrl = process.env.PHASE10_FIXTURE_DATABASE_URL
const erasureWorkerDatabaseUrl = process.env.PHASE7_API_ERASURE_DATABASE_URL
const authGatewayDatabaseUrl = environment.AUTH_GATEWAY_DATABASE_URL
if (
  isPhase10CurrentSource &&
  (!fixtureDatabaseUrl || !erasureWorkerDatabaseUrl || !authGatewayDatabaseUrl)
) {
  throw new Error(
    'Phase 10 auth tests require fixture, erasure, and auth-gateway databases.'
  )
}
for (const databaseUrl of [
  fixtureDatabaseUrl,
  erasureWorkerDatabaseUrl,
  authGatewayDatabaseUrl
]) {
  if (databaseUrl) {
    assertSafeTestDatabase({
      nodeEnvironment: environment.NODE_ENV,
      databaseUrl,
      productionDatabaseUrl: process.env.PRODUCTION_DATABASE_URL
    })
  }
}

const database = createDatabaseRuntime(
  environment.DATABASE_URL,
  isPhase10CurrentSource
    ? { migrationProfile: 'current', startupRole: 'nihongo_app' }
    : {}
)
const fixtureDatabase = fixtureDatabaseUrl
  ? createDatabaseRuntime(fixtureDatabaseUrl)
  : database
const authGatewayDatabase = isPhase10CurrentSource
  ? createRoleDatabaseRuntime(authGatewayDatabaseUrl!, 'nihongo_auth_gateway')
  : undefined
const erasureWorkerClient = erasureWorkerDatabaseUrl
  ? new Client({
      connectionString: erasureWorkerDatabaseUrl,
      options: createPostgresStartupOptions(
        getPostgresSchema(erasureWorkerDatabaseUrl)
      )
    })
  : undefined
const emailPort = new InMemoryAuthEmailPort()
const emailDispatcher = createAuthEmailDispatcher({ emailPort })
const auth = isPhase10CurrentSource
  ? undefined
  : createAuthRuntime({
      client: database.client,
      emailDispatcher,
      environment
    })
const guestPrincipalService = createGuestPrincipalService({
  client: database.client,
  secret: environment.GUEST_COOKIE_SECRET
})
const principalService = isPhase10CurrentSource
  ? createPhase7PrincipalService({
      client: database.client,
      isProduction: false,
      refreshClient: authGatewayDatabase!.client,
      secret: environment.BETTER_AUTH_SECRET
    })
  : createPrincipalService({
      authApi: auth!.api,
      client: database.client
    })
const technicalAuthRateLimiter = createApplicationRateLimiter({
  client: database.client,
  keySecret: environment.GUEST_COOKIE_SECRET
})
const questionReader: QuestionReader = {
  getQuestion: async () => Promise.reject(new Error('Not used.')),
  listQuestions: async () => ({ items: [], page: 1, pageSize: 20, total: 0 })
}
const app = createApiApp({
  auth: {
    environment,
    gateway: isPhase10CurrentSource
      ? createAuthGateway({
          delay: async () => undefined,
          environment,
          phase7Facade: createPhase7AuthFacade({
            client: authGatewayDatabase!.client,
            emailDispatcher,
            environment
          }),
          technicalRateLimiter: technicalAuthRateLimiter
        })
      : createAuthGateway({
          auth: auth!,
          client: database.client,
          environment
        }),
    guestPrincipalService,
    principalService
  },
  checkReadiness: database.checkReadiness,
  logger: createJsonLogger('silent'),
  questionReader
})
const origin = environment.TRUSTED_ORIGINS[0]

if (!origin) {
  throw new Error('Auth integration test에는 trusted origin이 필요합니다.')
}

const postAuth = async (
  path: string,
  body: Record<string, unknown>,
  cookie?: string
): Promise<Response> =>
  await app.request(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: origin,
      ...(cookie ? { Cookie: cookie } : {})
    },
    body: JSON.stringify(body)
  })

const getCookieHeader = (response: Response): string => {
  const getSetCookie = response.headers.getSetCookie?.bind(response.headers)
  const setCookies = getSetCookie
    ? getSetCookie()
    : [response.headers.get('Set-Cookie')].filter(
        (value): value is string => value !== null
      )

  return setCookies
    .map((cookie) => cookie.split(';', 1)[0])
    .filter((cookie): cookie is string => Boolean(cookie))
    .join('; ')
}

const expectCookieOnlySuccess = async (response: Response): Promise<void> => {
  const serialized = JSON.stringify(await response.json())
  expect(response.status).toBe(200)
  expect(serialized).toBe('{"success":true}')
  expect(serialized).not.toMatch(/token|password|email|cookie/iu)
}

const createdUserIds = new Set<string>()

const createFixtureUser = async ({
  accountStatus = 'ACTIVE',
  email,
  emailVerified = true,
  name,
  passwordHash = 'phase10-fixture-password-hash',
  role = 'USER'
}: {
  readonly accountStatus?: 'ACTIVE' | 'DELETION_PENDING' | 'DELETED'
  readonly email: string
  readonly emailVerified?: boolean
  readonly name: string
  readonly passwordHash?: string
  readonly role?: 'USER' | 'ADMIN'
}): Promise<{ readonly email: string; readonly id: string }> => {
  const userId = randomUUID()
  await fixtureDatabase.client.$transaction(async (fixture) => {
    await fixture.user.create({
      data: {
        accountStatus,
        email,
        emailVerified,
        id: userId,
        name,
        role
      }
    })
    await fixture.account.create({
      data: {
        accountId: userId,
        password: passwordHash,
        providerId: 'credential',
        userId
      }
    })
  })
  createdUserIds.add(userId)
  return { email, id: userId }
}

const eraseUser = async (userId: string): Promise<void> => {
  if (erasureWorkerClient) {
    await erasureWorkerClient.query(`SELECT "phase7_erase_user"($1, 'TEST')`, [
      userId
    ])
  } else {
    await fixtureDatabase.client.user.delete({ where: { id: userId } })
  }
}

beforeAll(async () => {
  await database.checkReadiness()
  if (erasureWorkerClient) {
    await erasureWorkerClient.connect()
    await erasureWorkerClient.query(`SET ROLE "nihongo_erasure_worker"`)
  }
})

beforeEach(async () => {
  if (!isPhase10CurrentSource) return
  await database.client.rateLimit.deleteMany({
    where: { key: { startsWith: 'application:auth:' } }
  })
})

afterAll(async () => {
  if (createdUserIds.size > 0) {
    if (erasureWorkerClient) {
      for (const userId of createdUserIds) await eraseUser(userId)
    } else {
      await fixtureDatabase.client.user.deleteMany({
        where: { id: { in: [...createdUserIds] } }
      })
    }
  }
  await database.client.guestPrincipal.deleteMany({
    where: { createdAt: { gte: new Date(Date.now() - 60 * 60 * 1_000) } }
  })
  await database.client.rateLimit.deleteMany()
  await emailDispatcher.drain()
  if (erasureWorkerClient) {
    await erasureWorkerClient.end()
  }
  if (fixtureDatabase !== database) {
    await fixtureDatabase.disconnect()
  }
  await authGatewayDatabase?.disconnect()
  await database.disconnect()
})

describe(
  isPhase10CurrentSource
    ? 'Phase 7 V1 auth gateway PostgreSQL vertical slice'
    : 'Better Auth PostgreSQL vertical slice',
  () => {
    it('SSO USER principal, retired credential rejection and logout retain server authority', async () => {
      if (!authGatewayDatabase)
        throw new Error('Current SSO gateway fixture is required.')
      const before = await Promise.all([
        fixtureDatabase.client.user.count(),
        fixtureDatabase.client.account.count(),
        fixtureDatabase.client.session.count(),
        fixtureDatabase.client.verification.count()
      ])
      const rejected = await postAuth('/api/auth/sign-up/email', {
        email: 'retired-escalation@example.test',
        name: 'Retired signup',
        password: 'retired-password',
        role: 'ADMIN',
        targetLevel: 'N2'
      })
      expect(rejected.status).toBe(404)
      expect(await rejected.json()).toMatchObject({
        code: 'AUTH_ROUTE_NOT_FOUND'
      })
      expect(rejected.headers.get('Set-Cookie')).toBeNull()
      expect(
        await Promise.all([
          fixtureDatabase.client.user.count(),
          fixtureDatabase.client.account.count(),
          fixtureDatabase.client.session.count(),
          fixtureDatabase.client.verification.count()
        ])
      ).toEqual(before)
      const session = await createPhase7SsoSessionFixture({
        owner: fixtureDatabase.client,
        gateway: authGatewayDatabase.client,
        secret: environment.BETTER_AUTH_SECRET,
        role: 'USER'
      })
      createdUserIds.add(session.userId)
      const principalResponse = await app.request('/api/v1/me', {
        headers: { Cookie: session.cookie }
      })
      const principal = await principalResponse.json()
      expect(principalResponse.status).toBe(200)
      expect(principal).toMatchObject({
        kind: 'USER',
        user: { id: session.userId, role: 'USER', targetLevel: null }
      })
      expect(JSON.stringify(principal)).not.toMatch(/email|token|password/iu)
      expect(
        await fixtureDatabase.client.session.count({
          where: { userId: session.userId }
        })
      ).toBe(1)
      expect(emailPort.messages).toHaveLength(0)
      const signOut = await postAuth('/api/auth/sign-out', {}, session.cookie)
      await expectCookieOnlySuccess(signOut)
      expect(
        await fixtureDatabase.client.session.count({
          where: { userId: session.userId }
        })
      ).toBe(0)
      const guest = await app.request('/api/v1/me', {
        headers: { Cookie: session.cookie }
      })
      expect(await guest.json()).toEqual({ kind: 'GUEST' })
    })

    it('/me는 guest row를 만들지 않고 명시적 guest credential만 digest·clear한다', async () => {
      const initialCount = await database.client.guestPrincipal.count()
      for (const cookie of [undefined, `${GUEST_COOKIE_NAME}=tampered`]) {
        const response = await app.request('/api/v1/me', {
          ...(cookie ? { headers: { Cookie: cookie } } : {})
        })
        expect(await response.json()).toEqual({ kind: 'GUEST' })
        expect(getCookieHeader(response)).toBe('')
      }
      expect(await database.client.guestPrincipal.count()).toBe(initialCount)

      const createdGuest = await guestPrincipalService.create()
      expect(createdGuest.cookieValue).not.toBeNull()
      if (!createdGuest.cookieValue) return

      const storedGuest =
        await database.client.guestPrincipal.findUniqueOrThrow({
          where: { id: createdGuest.id },
          select: { id: true, tokenDigest: true }
        })
      const rawCredential = createdGuest.cookieValue.split('.')[1]
      expect(rawCredential).toBeDefined()
      expect(storedGuest.tokenDigest).not.toBe(rawCredential)
      expect(await database.client.guestPrincipal.count()).toBe(
        initialCount + 1
      )

      const clearResponse = await app.request('/api/v1/guest-principal', {
        method: 'DELETE',
        headers: {
          Cookie: `${GUEST_COOKIE_NAME}=${createdGuest.cookieValue}`,
          Origin: origin
        }
      })
      expect(clearResponse.status).toBe(204)
      expect(
        await database.client.guestPrincipal.findUnique({
          where: { id: storedGuest.id }
        })
      ).toBeNull()

      const expiredCredential = guestPrincipalService.prepareCredential()
      const expiredAt = new Date(Date.now() - 60 * 60 * 1_000)
      const expiredCreatedAt = new Date(
        expiredAt.getTime() - 7 * 24 * 60 * 60 * 1_000
      )
      await database.client.guestPrincipal.create({
        data: {
          id: expiredCredential.id,
          tokenDigest: expiredCredential.tokenDigest,
          createdAt: expiredCreatedAt,
          lastSeenAt: expiredCreatedAt,
          expiresAt: expiredAt
        }
      })
      const futureGuest = await guestPrincipalService.create()
      expect(await guestPrincipalService.deleteExpired(1)).toBe(1)
      expect(
        await database.client.guestPrincipal.findUnique({
          where: { id: expiredCredential.id }
        })
      ).toBeNull()
      expect(
        await database.client.guestPrincipal.findUnique({
          where: { id: futureGuest.id }
        })
      ).not.toBeNull()
      await guestPrincipalService.clear(futureGuest.cookieValue ?? undefined)
    })

    it('ADMIN을 공개 route 없이 멱등적으로 provision하고 password를 덮어쓰지 않는다', async () => {
      const email = `slice2-admin-${randomUUID()}@example.test`
      const password = 'Slice2-admin-password-2026!'
      const provisioner = createAdminProvisioner({
        client: fixtureDatabase.client,
        hashPassword
      })

      const created = await provisioner.provision({
        email,
        name: '운영 관리자',
        password,
        reference: 'SLICE2-INTEGRATION',
        targetLevel: 'N1'
      })
      createdUserIds.add(created.userId)
      expect(created.outcome).toBe('CREATED')
      expect(created.referenceDigest).toMatch(/^[a-f0-9]{64}$/u)
      expect(
        await fixtureDatabase.client.user.findUniqueOrThrow({
          where: { id: created.userId },
          select: {
            accountStatus: true,
            emailVerified: true,
            role: true,
            targetLevel: true
          }
        })
      ).toEqual({
        accountStatus: 'ACTIVE',
        emailVerified: true,
        role: 'ADMIN',
        targetLevel: 'N1'
      })

      const originalCredential =
        await fixtureDatabase.client.account.findFirstOrThrow({
          where: { userId: created.userId, providerId: 'credential' },
          select: { password: true }
        })
      const repeated = await provisioner.provision({
        email,
        name: '변경 시도',
        password: 'Different-admin-password-2026!',
        reference: 'SLICE2-INTEGRATION-RERUN'
      })
      expect(repeated).toMatchObject({
        outcome: 'ALREADY_PROVISIONED',
        userId: created.userId
      })

      expect(
        await fixtureDatabase.client.account.findFirstOrThrow({
          where: { userId: created.userId, providerId: 'credential' },
          select: { password: true }
        })
      ).toEqual(originalCredential)
      if (!authGatewayDatabase)
        throw new Error('Current SSO gateway fixture is required.')
      const adminSession = await createPhase7SsoSessionFixture({
        owner: fixtureDatabase.client,
        gateway: authGatewayDatabase.client,
        secret: environment.BETTER_AUTH_SECRET,
        role: 'ADMIN',
        existingUser: { id: created.userId, email, name: 'Admin SSO fixture' }
      })
      const adminPrincipal = await app.request('/api/v1/me', {
        headers: { Cookie: adminSession.cookie }
      })
      expect(await adminPrincipal.json()).toMatchObject({
        kind: 'USER',
        user: { id: created.userId, role: 'ADMIN', targetLevel: 'N1' }
      })

      const existingUser = await createFixtureUser({
        email: `slice2-existing-${randomUUID()}@example.test`,
        name: '기존 사용자'
      })
      await expect(
        provisioner.provision({
          email: existingUser.email,
          name: '승격 시도',
          password,
          reference: 'SLICE2-INVALID-PROMOTION'
        })
      ).rejects.toMatchObject({ code: 'EXISTING_NON_ADMIN_ACCOUNT' })

      const invalidAdmin = await createFixtureUser({
        email: `slice2-invalid-admin-${randomUUID()}@example.test`,
        emailVerified: false,
        name: '미인증 관리자',
        passwordHash: await hashPassword(password),
        role: 'ADMIN'
      })
      await expect(
        provisioner.provision({
          email: invalidAdmin.email,
          name: '재시도 관리자',
          password,
          reference: 'SLICE2-INVALID-ADMIN'
        })
      ).rejects.toMatchObject({ code: 'INVALID_EXISTING_ADMIN' })

      const rollbackEmail = `slice2-rollback-${randomUUID()}@example.test`
      const rollbackProvisioner = createAdminProvisioner({
        client: fixtureDatabase.client,
        createUserId: () => existingUser.id,
        hashPassword
      })
      await expect(
        rollbackProvisioner.provision({
          email: rollbackEmail,
          name: '롤백 관리자',
          password,
          reference: 'SLICE2-ROLLBACK'
        })
      ).rejects.toMatchObject({ code: 'ACCOUNT_CREATION_FAILED' })
      expect(
        await fixtureDatabase.client.user.findUnique({
          where: { email: rollbackEmail }
        })
      ).toBeNull()

      const concurrentEmail = `slice2-concurrent-${randomUUID()}@example.test`
      const concurrent = await Promise.all([
        provisioner.provision({
          email: concurrentEmail,
          name: '동시 관리자',
          password,
          reference: 'SLICE2-CONCURRENT-A'
        }),
        provisioner.provision({
          email: concurrentEmail,
          name: '동시 관리자',
          password,
          reference: 'SLICE2-CONCURRENT-B'
        })
      ])
      expect(concurrent.map(({ outcome }) => outcome).toSorted()).toEqual([
        'ALREADY_PROVISIONED',
        'CREATED'
      ])
      expect(new Set(concurrent.map(({ userId }) => userId)).size).toBe(1)
      createdUserIds.add(concurrent[0]!.userId)
      expect(
        await fixtureDatabase.client.account.count({
          where: {
            providerId: 'credential',
            userId: concurrent[0]!.userId
          }
        })
      ).toBe(1)

      if (!isPhase10CurrentSource) {
        await expect(
          database.client.question.create({
            data: {
              createdByLabelSnapshot: 'ACTIVE_ADMIN',
              createdByUserId: existingUser.id,
              id: randomUUID(),
              lifecycleStatus: 'ACTIVE'
            }
          })
        ).rejects.toThrow()
      }

      await expect(
        fixtureDatabase.client.user.create({
          data: {
            email: `slice2-name-${randomUUID()}@example.test`,
            emailVerified: true,
            name: '가'.repeat(81),
            role: 'USER',
            accountStatus: 'ACTIVE'
          }
        })
      ).rejects.toMatchObject({ code: 'P2000' })
    })

    it('승인되지 않은 auth/demo route와 안전하지 않은 write를 fail closed한다', async () => {
      const [deleteUser, demoAdmin, missingOrigin, wrongContentType] =
        await Promise.all([
          postAuth('/api/auth/delete-user', {}),
          postAuth('/api/auth/login/admin', {}),
          app.request('/api/auth/sign-out', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}'
          }),
          app.request('/api/auth/sign-out', {
            method: 'POST',
            headers: { Origin: origin, 'Content-Type': 'text/plain' },
            body: 'email=user'
          })
        ])

      expect(deleteUser.status).toBe(404)
      expect(demoAdmin.status).toBe(404)
      expect(missingOrigin.status).toBe(403)
      expect(wrongContentType.status).toBe(415)
      expect(wrongContentType.headers.get('Access-Control-Allow-Origin')).toBe(
        origin
      )
      expect(
        wrongContentType.headers.get('Access-Control-Expose-Headers')
      ).toBe('Retry-After, X-Request-Id')

      const corsPrincipal = await app.request('/api/v1/me', {
        headers: { Origin: origin }
      })
      expect(corsPrincipal.headers.get('Access-Control-Allow-Origin')).toBe(
        origin
      )
      expect(
        corsPrincipal.headers.get('Access-Control-Allow-Credentials')
      ).toBe('true')
      const preflight = await app.request('/api/v1/guest-principal', {
        method: 'OPTIONS',
        headers: {
          Origin: origin,
          'Access-Control-Request-Method': 'DELETE'
        }
      })
      expect(preflight.status).toBe(204)
      expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe(origin)
      const untrustedCors = await app.request('/api/v1/me', {
        headers: { Origin: 'https://attacker.example' }
      })
      expect(untrustedCors.headers.has('Access-Control-Allow-Origin')).toBe(
        false
      )
    })

    it(
      isPhase10CurrentSource
        ? 'sanctioned erasure 이후 계정과 세션 권한을 즉시 무효화한다'
        : '30일 absolute session cap과 비활성 계정을 즉시 무효화한다',
      async () => {
        const email = `slice2-expiry-${randomUUID()}@example.test`
        const password = 'Slice2-expiry-password-2026!'
        const user = await createFixtureUser({
          email,
          name: '만료 테스트',
          passwordHash: await hashPassword(password)
        })

        if (isPhase10CurrentSource) {
          if (!authGatewayDatabase)
            throw new Error('Current SSO gateway fixture is required.')
          const session = await createPhase7SsoSessionFixture({
            owner: fixtureDatabase.client,
            gateway: authGatewayDatabase.client,
            secret: environment.BETTER_AUTH_SECRET,
            role: 'USER',
            existingUser: { id: user.id, email, name: 'Erasure SSO fixture' }
          })
          const cookie = session.cookie
          const principalResponse = await app.request('/api/v1/me', {
            headers: { Cookie: cookie }
          })
          expect(await principalResponse.json()).toMatchObject({
            kind: 'USER',
            user: { id: user.id }
          })

          await eraseUser(user.id)
          createdUserIds.delete(user.id)
          const invalidated = await app.request('/api/v1/me', {
            headers: { Cookie: cookie }
          })
          expect(await invalidated.json()).toEqual({ kind: 'GUEST' })
          expect(
            await fixtureDatabase.client.session.count({
              where: { userId: user.id }
            })
          ).toBe(0)
          return
        }

        const oldSession = await fixtureDatabase.client.session.create({
          data: {
            userId: user.id,
            token: `test-${randomUUID()}`,
            expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
            createdAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1_000),
            updatedAt: new Date()
          }
        })

        const principal = createPrincipalService({
          authApi: {
            getSession: async () => ({
              headers: new Headers({ 'Set-Cookie': 'rolling=stale' }),
              response: {
                session: { id: oldSession.id, createdAt: oldSession.createdAt },
                user: { id: user.id }
              }
            })
          },
          client: database.client
        })
        expect(await principal.getAuthenticatedUser(new Headers())).toBeNull()
        expect(
          await fixtureDatabase.client.session.findUnique({
            where: { id: oldSession.id }
          })
        ).toBeNull()

        await fixtureDatabase.client.user.update({
          where: { id: user.id },
          data: { accountStatus: 'DELETION_PENDING' }
        })
        const blockedSession = await fixtureDatabase.client.session.create({
          data: {
            userId: user.id,
            token: `test-${randomUUID()}`,
            expiresAt: new Date(Date.now() + 60 * 60 * 1_000)
          }
        })
        const blockedPrincipal = createPrincipalService({
          authApi: {
            getSession: async () => ({
              headers: new Headers({ 'Set-Cookie': 'rolling=stale' }),
              response: {
                session: {
                  id: blockedSession.id,
                  createdAt: blockedSession.createdAt
                },
                user: { id: user.id }
              }
            })
          },
          client: database.client
        })
        expect(
          await blockedPrincipal.getAuthenticatedUser(new Headers())
        ).toBeNull()
        expect(
          await fixtureDatabase.client.session.findUnique({
            where: { id: blockedSession.id }
          })
        ).toBeNull()
      }
    )
  }
)

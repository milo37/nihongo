import { randomUUID } from 'node:crypto'
import { hashPassword } from 'better-auth/crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApiApp } from '../app/createApp.js'
import { parseApiEnvironment } from '../config/env.js'
import { createDatabaseRuntime } from '../db/database.js'
import { assertSafeTestDatabase } from '../db/databaseTargetGuard.js'
import { createJsonLogger } from '../observability/logger.js'
import type { QuestionReader } from '../question/questionService.js'
import { createAdminProvisioner } from './adminProvisioning.js'
import { createAuthGateway } from './authGateway.js'
import { createAuthRuntime } from './createAuth.js'
import { createAuthEmailDispatcher } from './emailDispatcher.js'
import { InMemoryAuthEmailPort } from './emailPort.js'
import { createGuestPrincipalService } from './guestPrincipalService.js'
import { createPrincipalService } from './principalService.js'
import { GUEST_COOKIE_NAME } from '../routes/principal.js'

const environment = parseApiEnvironment(process.env)
assertSafeTestDatabase({
  nodeEnvironment: environment.NODE_ENV,
  databaseUrl: environment.DATABASE_URL,
  productionDatabaseUrl: process.env.PRODUCTION_DATABASE_URL
})

const database = createDatabaseRuntime(environment.DATABASE_URL)
const emailPort = new InMemoryAuthEmailPort()
const emailDispatcher = createAuthEmailDispatcher({ emailPort })
const auth = createAuthRuntime({
  client: database.client,
  emailDispatcher,
  environment
})
const guestPrincipalService = createGuestPrincipalService({
  client: database.client,
  secret: environment.GUEST_COOKIE_SECRET
})
const principalService = createPrincipalService({
  authApi: auth.api,
  client: database.client
})
const questionReader: QuestionReader = {
  getQuestion: async () => Promise.reject(new Error('Not used.')),
  listQuestions: async () => ({ items: [], page: 1, pageSize: 20, total: 0 })
}
const app = createApiApp({
  auth: {
    environment,
    gateway: createAuthGateway({ auth, client: database.client, environment }),
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

const createdUserIds: string[] = []
const createdQuestionIds: string[] = []

beforeAll(async () => {
  await database.checkReadiness()
  await database.client.rateLimit.deleteMany()
})

afterAll(async () => {
  if (createdQuestionIds.length > 0) {
    await database.client.question.deleteMany({
      where: { id: { in: createdQuestionIds } }
    })
  }
  if (createdUserIds.length > 0) {
    await database.client.user.deleteMany({
      where: { id: { in: createdUserIds } }
    })
  }
  await database.client.guestPrincipal.deleteMany({
    where: { createdAt: { gte: new Date(Date.now() - 60 * 60 * 1_000) } }
  })
  await database.client.rateLimit.deleteMany()
  await emailDispatcher.drain()
  await database.disconnect()
})

describe('Better Auth PostgreSQL vertical slice', () => {
  it('USER 가입·이메일 인증·cookie 로그인·logout을 서버 권위로 처리한다', async () => {
    const email = `slice2-${randomUUID()}@example.test`
    const password = 'Slice2-password-2026!'
    const signUpResponse = await postAuth('/api/auth/sign-up/email', {
      email,
      name: '슬라이스 사용자',
      password,
      role: 'ADMIN',
      targetLevel: 'N2'
    })
    await expectCookieOnlySuccess(signUpResponse)

    const createdUser = await database.client.user.findUniqueOrThrow({
      where: { email },
      select: { id: true, role: true, emailVerified: true }
    })
    createdUserIds.push(createdUser.id)
    expect(createdUser).toMatchObject({ role: 'USER', emailVerified: false })

    const rejectedLogin = await postAuth('/api/auth/sign-in/email', {
      email,
      password
    })
    expect(rejectedLogin.ok).toBe(false)
    expect(
      await database.client.session.count({
        where: { userId: createdUser.id }
      })
    ).toBe(0)

    const verificationMessage = emailPort.messages.find(
      (message) =>
        message.recipient === email && message.purpose === 'EMAIL_VERIFICATION'
    )
    expect(verificationMessage).toBeDefined()
    if (!verificationMessage) {
      return
    }

    const verificationUrl = new URL(verificationMessage.url)
    const verificationToken = new URLSearchParams(
      verificationUrl.hash.slice(1)
    ).get('token')
    expect(verificationUrl.pathname).toBe('/verify-email')
    expect(verificationToken).toBeTruthy()
    if (!verificationToken) return

    const scannerResponse = await app.request(
      `/api/auth/verify-email?token=${encodeURIComponent(verificationToken)}`
    )
    expect(scannerResponse.status).toBe(404)
    expect(
      await database.client.user.findUniqueOrThrow({
        where: { id: createdUser.id },
        select: { emailVerified: true }
      })
    ).toEqual({ emailVerified: false })

    const verificationResponse = await postAuth('/api/auth/verify-email', {
      token: verificationToken
    })
    await expectCookieOnlySuccess(verificationResponse)
    expect(
      await database.client.user.findUniqueOrThrow({
        where: { id: createdUser.id },
        select: { emailVerified: true }
      })
    ).toEqual({ emailVerified: true })

    const signInResponse = await postAuth('/api/auth/sign-in/email', {
      email,
      password
    })
    const sessionCookie = getCookieHeader(signInResponse)
    await expectCookieOnlySuccess(signInResponse)
    expect(signInResponse.headers.get('Set-Cookie')).toContain('HttpOnly')
    expect(signInResponse.headers.get('Set-Cookie')).toContain('SameSite=Lax')
    expect(sessionCookie).not.toBe('')
    expect(
      await database.client.session.count({
        where: { userId: createdUser.id }
      })
    ).toBe(1)

    const principalResponse = await app.request('/api/v1/me', {
      headers: { Cookie: sessionCookie }
    })
    const principal = await principalResponse.json()
    expect(principal).toEqual({
      kind: 'USER',
      user: {
        id: createdUser.id,
        name: '슬라이스 사용자',
        role: 'USER',
        targetLevel: 'N2'
      }
    })
    expect(JSON.stringify(principal)).not.toMatch(/email|token|password/iu)

    const resetRequestResponse = await postAuth(
      '/api/auth/request-password-reset',
      { email }
    )
    await expectCookieOnlySuccess(resetRequestResponse)

    const resetMessage = emailPort.messages
      .toReversed()
      .find(
        (message) =>
          message.recipient === email && message.purpose === 'PASSWORD_RESET'
      )
    expect(resetMessage).toBeDefined()
    if (!resetMessage) {
      return
    }

    const resetUrl = new URL(resetMessage.url)
    const resetToken = new URLSearchParams(resetUrl.hash.slice(1)).get('token')
    expect(resetUrl.pathname).toBe('/reset-password')
    expect(resetUrl.searchParams.has('token')).toBe(false)
    expect(resetToken).toBeTruthy()
    if (!resetToken) {
      return
    }

    const resetVerification = await database.client.verification.findFirst({
      where: { value: createdUser.id },
      orderBy: { createdAt: 'desc' },
      select: { expiresAt: true }
    })
    expect(resetVerification).not.toBeNull()
    expect(resetVerification?.expiresAt.getTime()).toBeGreaterThan(Date.now())
    expect(resetVerification?.expiresAt.getTime()).toBeLessThanOrEqual(
      Date.now() + 60 * 60 * 1_000
    )

    const nextPassword = 'Slice2-password-reset-2026!'
    const resetResponse = await postAuth('/api/auth/reset-password', {
      newPassword: nextPassword,
      token: resetToken
    })
    await expectCookieOnlySuccess(resetResponse)
    expect(
      await database.client.session.count({
        where: { userId: createdUser.id }
      })
    ).toBe(0)

    const oldPasswordResponse = await postAuth('/api/auth/sign-in/email', {
      email,
      password
    })
    expect(oldPasswordResponse.ok).toBe(false)

    const newPasswordResponse = await postAuth('/api/auth/sign-in/email', {
      email,
      password: nextPassword
    })
    const resetSessionCookie = getCookieHeader(newPasswordResponse)
    await expectCookieOnlySuccess(newPasswordResponse)
    expect(resetSessionCookie).not.toBe('')

    const signOutResponse = await postAuth(
      '/api/auth/sign-out',
      {},
      resetSessionCookie
    )
    await expectCookieOnlySuccess(signOutResponse)
    expect(
      await database.client.session.count({
        where: { userId: createdUser.id }
      })
    ).toBe(0)
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

    const storedGuest = await database.client.guestPrincipal.findUniqueOrThrow({
      where: { id: createdGuest.id },
      select: { id: true, tokenDigest: true }
    })
    const rawCredential = createdGuest.cookieValue.split('.')[1]
    expect(rawCredential).toBeDefined()
    expect(storedGuest.tokenDigest).not.toBe(rawCredential)
    expect(await database.client.guestPrincipal.count()).toBe(initialCount + 1)

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
      client: database.client,
      hashPassword
    })

    const created = await provisioner.provision({
      email,
      name: '운영 관리자',
      password,
      reference: 'SLICE2-INTEGRATION',
      targetLevel: 'N1'
    })
    createdUserIds.push(created.userId)
    expect(created.outcome).toBe('CREATED')
    expect(created.referenceDigest).toMatch(/^[a-f0-9]{64}$/u)
    expect(
      await database.client.user.findUniqueOrThrow({
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

    const originalPasswordResponse = await postAuth('/api/auth/sign-in/email', {
      email,
      password
    })
    await expectCookieOnlySuccess(originalPasswordResponse)
    const overwrittenPasswordResponse = await postAuth(
      '/api/auth/sign-in/email',
      {
        email,
        password: 'Different-admin-password-2026!'
      }
    )
    expect(overwrittenPasswordResponse.ok).toBe(false)

    const existingUser = await database.client.user.create({
      data: {
        accountStatus: 'ACTIVE',
        email: `slice2-existing-${randomUUID()}@example.test`,
        emailVerified: true,
        name: '기존 사용자',
        role: 'USER'
      },
      select: { email: true, id: true }
    })
    createdUserIds.push(existingUser.id)
    await expect(
      provisioner.provision({
        email: existingUser.email,
        name: '승격 시도',
        password,
        reference: 'SLICE2-INVALID-PROMOTION'
      })
    ).rejects.toMatchObject({ code: 'EXISTING_NON_ADMIN_ACCOUNT' })

    const collidingUserId = randomUUID()
    await database.client.account.create({
      data: {
        accountId: collidingUserId,
        password: await hashPassword('Existing-password-2026!'),
        providerId: 'credential',
        userId: existingUser.id
      }
    })
    const rollbackEmail = `slice2-rollback-${randomUUID()}@example.test`
    const rollbackProvisioner = createAdminProvisioner({
      client: database.client,
      createUserId: () => collidingUserId,
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
      await database.client.user.findUnique({ where: { email: rollbackEmail } })
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
    createdUserIds.push(concurrent[0]!.userId)
    expect(
      await database.client.account.count({
        where: {
          providerId: 'credential',
          userId: concurrent[0]!.userId
        }
      })
    ).toBe(1)

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

    await expect(
      database.client.user.create({
        data: {
          email: `slice2-name-${randomUUID()}@example.test`,
          emailVerified: true,
          name: '가'.repeat(81),
          role: 'USER',
          accountStatus: 'ACTIVE'
        }
      })
    ).rejects.toThrow()

    const questionId = randomUUID()
    const questionVersionId = randomUUID()
    createdQuestionIds.push(questionId)
    await database.client.question.create({
      data: {
        createdByLabelSnapshot: 'ACTIVE_ADMIN',
        createdByUserId: created.userId,
        id: questionId,
        lifecycleStatus: 'ACTIVE'
      }
    })
    await database.client.questionVersion.create({
      data: {
        createdByLabelSnapshot: 'ACTIVE_ADMIN',
        createdByUserId: created.userId,
        difficulty: 'NORMAL',
        explanationKo: '관리자 삭제 provenance 검증용 설명입니다.',
        id: questionVersionId,
        level: 'N5',
        passage: null,
        questionId,
        questionText: '관리자 삭제 provenance 검증용 문제입니다.',
        questionType: 'GRAMMAR_SELECT',
        sourceType: 'ORIGINAL',
        status: 'DRAFT',
        subject: 'GRAMMAR',
        versionNumber: 1
      }
    })

    await database.client.user.delete({ where: { id: created.userId } })
    expect(
      await database.client.question.findUniqueOrThrow({
        where: { id: questionId },
        select: {
          createdByLabelSnapshot: true,
          createdByUserId: true
        }
      })
    ).toEqual({
      createdByLabelSnapshot: 'DELETED_ADMIN',
      createdByUserId: null
    })
    expect(
      await database.client.questionVersion.findUniqueOrThrow({
        where: { id: questionVersionId },
        select: {
          createdByLabelSnapshot: true,
          createdByUserId: true
        }
      })
    ).toEqual({
      createdByLabelSnapshot: 'DELETED_ADMIN',
      createdByUserId: null
    })
    await database.client.question.delete({ where: { id: questionId } })
  })

  it('승인되지 않은 auth/demo route와 안전하지 않은 write를 fail closed한다', async () => {
    const [deleteUser, demoAdmin, missingOrigin, wrongContentType] =
      await Promise.all([
        postAuth('/api/auth/delete-user', {}),
        postAuth('/api/auth/login/admin', {}),
        app.request('/api/auth/sign-in/email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}'
        }),
        app.request('/api/auth/sign-in/email', {
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
    expect(wrongContentType.headers.get('Access-Control-Expose-Headers')).toBe(
      'Retry-After, X-Request-Id'
    )

    const corsPrincipal = await app.request('/api/v1/me', {
      headers: { Origin: origin }
    })
    expect(corsPrincipal.headers.get('Access-Control-Allow-Origin')).toBe(
      origin
    )
    expect(corsPrincipal.headers.get('Access-Control-Allow-Credentials')).toBe(
      'true'
    )
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
    expect(untrustedCors.headers.has('Access-Control-Allow-Origin')).toBe(false)
  })

  it('30일 absolute session cap과 비활성 계정을 즉시 무효화한다', async () => {
    const email = `slice2-expiry-${randomUUID()}@example.test`
    const user = await database.client.user.create({
      data: {
        email,
        emailVerified: true,
        name: '만료 테스트',
        role: 'USER',
        accountStatus: 'ACTIVE'
      },
      select: { id: true }
    })
    createdUserIds.push(user.id)
    const oldSession = await database.client.session.create({
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
      await database.client.session.findUnique({
        where: { id: oldSession.id }
      })
    ).toBeNull()

    await database.client.user.update({
      where: { id: user.id },
      data: { accountStatus: 'DELETION_PENDING' }
    })
    const blockedSession = await database.client.session.create({
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
      await database.client.session.findUnique({
        where: { id: blockedSession.id }
      })
    ).toBeNull()
  })
})

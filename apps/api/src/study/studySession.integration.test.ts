import { randomUUID } from 'node:crypto'
import { createStudySessionResponseSchema } from '@nihongo/contracts/study/create-study-session'
import { getStudySessionResponseSchema } from '@nihongo/contracts/study/get-study-session'
import { hashPassword } from 'better-auth/crypto'
import { Client } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createApiApp } from '../app/createApp.js'
import { createAuthGateway } from '../auth/authGateway.js'
import { createAuthRuntime } from '../auth/createAuth.js'
import { createAuthEmailDispatcher } from '../auth/emailDispatcher.js'
import { InMemoryAuthEmailPort } from '../auth/emailPort.js'
import { createGuestPrincipalService } from '../auth/guestPrincipalService.js'
import { createPhase7AuthFacade } from '../auth/phase7AuthFacade.js'
import {
  createPhase7PrincipalService,
  createPrincipalService
} from '../auth/principalService.js'
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
import { Prisma } from '../generated/prisma/client.js'
import { createApplicationRateLimiter } from '../middleware/applicationRateLimiter.js'
import type { ApplicationRateLimiter } from '../middleware/applicationRateLimiter.js'
import { createJsonLogger } from '../observability/logger.js'
import { createPrismaQuestionRepository } from '../question/questionRepository.js'
import { createQuestionService } from '../question/questionService.js'
import { GUEST_COOKIE_NAME } from '../routes/principal.js'
import { createPrismaStudySessionRepository } from './studySessionRepository.js'
import { createStudySessionService } from './studySessionService.js'

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
    'Phase 10 study-session tests require fixture, erasure, and auth-gateway databases.'
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
const emailDispatcher = createAuthEmailDispatcher({
  emailPort
})
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
const repository = createPrismaStudySessionRepository(database.client)
const noOpRateLimiter: ApplicationRateLimiter = {
  consume: async () => undefined
}
const technicalAuthRateLimiter = createApplicationRateLimiter({
  client: database.client,
  keySecret: environment.GUEST_COOKIE_SECRET
})
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
  questionReader: createQuestionService(
    createPrismaQuestionRepository(database.client)
  ),
  study: {
    practiceContractV2Enabled: true,
    rateLimiter: noOpRateLimiter,
    service: createStudySessionService(repository)
  }
})

const origin = environment.TRUSTED_ORIGINS[0]
if (!origin) {
  throw new Error('StudySession integration에는 trusted origin이 필요합니다.')
}

const createdSessionIds = new Set<string>()
const createdGuestIds = new Set<string>()
const createdUserIds = new Set<string>()

const createApplicationClient = (): Client =>
  new Client({
    connectionString: environment.DATABASE_URL,
    options: createPostgresStartupOptions(
      getPostgresSchema(environment.DATABASE_URL),
      isPhase10CurrentSource ? 'nihongo_app' : undefined
    )
  })

interface RawDatabaseErrorIdentity {
  readonly message: string
  readonly sqlState: string
}

const isUnknownRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const readRawDatabaseErrorIdentity = (
  error: unknown
): RawDatabaseErrorIdentity | undefined => {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== 'P2010' ||
    !isUnknownRecord(error.meta)
  ) {
    return undefined
  }
  const identities: RawDatabaseErrorIdentity[] = []
  if (
    typeof error.meta.code === 'string' &&
    typeof error.meta.message === 'string'
  ) {
    identities.push({ message: error.meta.message, sqlState: error.meta.code })
  }
  const driverAdapterError = error.meta.driverAdapterError
  if (isUnknownRecord(driverAdapterError)) {
    const cause = driverAdapterError.cause
    if (
      isUnknownRecord(cause) &&
      typeof cause.originalCode === 'string' &&
      typeof cause.originalMessage === 'string'
    ) {
      identities.push({
        message: cause.originalMessage,
        sqlState: cause.originalCode
      })
    }
  }
  const [identity, ...rest] = identities
  if (
    !identity ||
    rest.some(
      (candidate) =>
        candidate.sqlState !== identity.sqlState ||
        candidate.message !== identity.message
    )
  ) {
    return undefined
  }
  return {
    message:
      identity.message
        .split('\n', 1)[0]
        ?.replace(/^ERROR:\s*/u, '')
        .trim() ?? '',
    sqlState: identity.sqlState
  }
}

const expectRawDatabaseError = async ({
  expectedMessage,
  operation,
  sqlState
}: {
  readonly expectedMessage: string
  readonly operation: () => Promise<unknown>
  readonly sqlState: string
}): Promise<void> => {
  let caughtError: unknown
  try {
    await operation()
  } catch (error: unknown) {
    caughtError = error
  }
  expect(caughtError).toMatchObject({ code: 'P2010' })
  expect(readRawDatabaseErrorIdentity(caughtError)).toEqual({
    message: expectedMessage,
    sqlState
  })
}

const createFixtureUser = async (label: string): Promise<string> => {
  const userId = randomUUID()
  await fixtureDatabase.client.$transaction(async (fixture) => {
    await fixture.user.create({
      data: {
        email: `slice3-${label}-${randomUUID()}@example.test`,
        emailVerified: true,
        id: userId,
        name: `Slice3 ${label}`
      }
    })
    await fixture.account.create({
      data: {
        accountId: userId,
        password: 'phase10-fixture-password-hash',
        providerId: 'credential',
        userId
      }
    })
  })
  createdUserIds.add(userId)
  return userId
}

const eraseUser = async (userId: string): Promise<void> => {
  if (erasureWorkerClient) {
    await erasureWorkerClient.query(`SELECT "phase7_erase_user"($1, 'TEST')`, [
      userId
    ])
  } else {
    await fixtureDatabase.client.user.delete({ where: { id: userId } })
  }
  createdUserIds.delete(userId)
}

const getCookieHeader = (response: Response): string => {
  const setCookies = response.headers.getSetCookie?.()
  const values =
    setCookies && setCookies.length > 0
      ? setCookies
      : [response.headers.get('Set-Cookie')].filter(
          (cookie): cookie is string => cookie !== null
        )
  return values
    .map((cookie) => cookie.split(';', 1)[0] ?? '')
    .filter((cookie) => cookie.startsWith(`${GUEST_COOKIE_NAME}=`))
    .join('; ')
}

const postStudySession = async (
  body: Record<string, unknown>,
  cookie?: string,
  practiceContractVersion?: 1 | 2
): Promise<Response> =>
  await app.request('/api/v1/study-sessions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: origin,
      ...(practiceContractVersion
        ? {
            'X-Nihongo-Practice-Contract': String(practiceContractVersion)
          }
        : {}),
      ...(cookie ? { Cookie: cookie } : {})
    },
    body: JSON.stringify(body)
  })

const postAuth = async (
  path: string,
  body: Record<string, unknown>
): Promise<Response> =>
  await app.request(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: origin
    },
    body: JSON.stringify(body)
  })

const getAllCookieHeader = (response: Response): string => {
  const setCookies =
    response.headers.getSetCookie?.() ??
    [response.headers.get('Set-Cookie')].filter(
      (cookie): cookie is string => cookie !== null
    )
  return setCookies
    .map((cookie) => cookie.split(';', 1)[0])
    .filter((cookie): cookie is string => Boolean(cookie))
    .join('; ')
}

const createAuthenticatedActor = async (
  role: 'USER' | 'ADMIN'
): Promise<{ cookie: string; userId: string }> => {
  const email = `slice3-${role.toLowerCase()}-${randomUUID()}@example.test`
  const password = 'Slice3-password-2026!'
  if (isPhase10CurrentSource) {
    const userId = randomUUID()
    const passwordHash = await hashPassword(password)
    await fixtureDatabase.client.$transaction(async (fixture) => {
      await fixture.user.create({
        data: {
          email,
          emailVerified: true,
          id: userId,
          name: `Slice3 ${role}`,
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
    const signIn = await postAuth('/api/auth/sign-in/email', {
      email,
      password
    })
    expect(signIn.status).toBe(200)
    const cookie = getAllCookieHeader(signIn)
    expect(cookie).not.toBe('')
    return { cookie, userId }
  }
  const signUp = await postAuth('/api/auth/sign-up/email', {
    email,
    name: `Slice3 ${role}`,
    password
  })
  expect(signUp.status).toBe(200)

  const user = await fixtureDatabase.client.user.findUniqueOrThrow({
    where: { email },
    select: { id: true }
  })
  createdUserIds.add(user.id)
  const verification = emailPort.messages.find(
    (message) =>
      message.recipient === email && message.purpose === 'EMAIL_VERIFICATION'
  )
  if (!verification) {
    throw new Error('Email verification fixture가 필요합니다.')
  }
  const token = new URLSearchParams(
    new URL(verification.url).hash.slice(1)
  ).get('token')
  if (!token) {
    throw new Error('Email verification token이 필요합니다.')
  }
  const verified = await postAuth('/api/auth/verify-email', { token })
  expect(verified.status).toBe(200)

  if (role === 'ADMIN') {
    await fixtureDatabase.client.user.update({
      where: { id: user.id },
      data: { role: 'ADMIN' }
    })
  }
  const signIn = await postAuth('/api/auth/sign-in/email', { email, password })
  expect(signIn.status).toBe(200)
  const cookie = getAllCookieHeader(signIn)
  expect(cookie).not.toBe('')
  return { cookie, userId: user.id }
}

const rememberSessionOwner = async (sessionId: string): Promise<void> => {
  createdSessionIds.add(sessionId)
  const session = await database.client.studySession.findUniqueOrThrow({
    where: { id: sessionId },
    select: { guestPrincipalId: true }
  })
  if (session.guestPrincipalId) {
    createdGuestIds.add(session.guestPrincipalId)
  }
}

const collectKeys = (value: unknown, keys: Set<string>): void => {
  if (Array.isArray(value)) {
    value.forEach((item) => collectKeys(item, keys))
    return
  }
  if (!value || typeof value !== 'object') return
  for (const [key, nested] of Object.entries(value)) {
    keys.add(key)
    collectKeys(nested, keys)
  }
}

const waitForPostgresLockWait = async (
  observer: Client,
  processId: number
): Promise<void> => {
  const deadline = Date.now() + 2_000

  while (Date.now() < deadline) {
    const activity = await observer.query<{
      state: string
      waitEventType: string | null
    }>(
      `SELECT state, wait_event_type AS "waitEventType"
       FROM pg_stat_activity
       WHERE pid = $1`,
      [processId]
    )
    if (
      activity.rows[0]?.state === 'active' &&
      activity.rows[0].waitEventType === 'Lock'
    ) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }

  throw new Error('Archive transaction did not wait on the selection row lock.')
}

beforeAll(async () => {
  await database.checkReadiness()
  if (erasureWorkerClient) {
    await erasureWorkerClient.connect()
    await erasureWorkerClient.query(`SET ROLE "nihongo_erasure_worker"`)
  }
  await database.client.rateLimit.deleteMany()
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
      for (const userId of [...createdUserIds]) await eraseUser(userId)
    } else {
      await fixtureDatabase.client.user.deleteMany({
        where: { id: { in: [...createdUserIds] } }
      })
    }
  }
  if (createdGuestIds.size > 0) {
    await database.client.guestPrincipal.deleteMany({
      where: { id: { in: [...createdGuestIds] } }
    })
  }
  await database.client.rateLimit.deleteMany({
    where: { key: { startsWith: 'application:slice3-integration:' } }
  })
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

describe('StudySession PostgreSQL vertical slice', () => {
  it('첫 guest RANDOM 생성과 owner GET을 원자적으로 처리한다', async () => {
    const beforeGuests = await database.client.guestPrincipal.count()
    const response = await postStudySession({
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 5
    })
    const payload = createStudySessionResponseSchema.parse(
      await response.json()
    )
    const cookie = getCookieHeader(response)
    await rememberSessionOwner(payload.session.id)

    expect(response.status).toBe(201)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(response.headers.get('X-Request-Id')).toMatch(/^[0-9a-f-]{36}$/)
    expect(response.headers.get('Set-Cookie')).toContain('HttpOnly')
    expect(response.headers.get('Set-Cookie')).toContain('SameSite=Lax')
    expect(cookie).not.toBe('')
    expect(payload.session).toMatchObject({
      requestedCount: 5,
      actualCount: 5,
      usedFallback: false,
      fallbackReason: null,
      status: 'IN_PROGRESS'
    })
    expect(payload.questions.map(({ ordinal }) => ordinal)).toEqual([
      1, 2, 3, 4, 5
    ])
    expect(await database.client.guestPrincipal.count()).toBe(beforeGuests + 1)

    const stored = await database.client.studySession.findUniqueOrThrow({
      where: { id: payload.session.id },
      include: { questions: true, guestPrincipal: true }
    })
    expect(stored.questions).toHaveLength(5)
    expect(stored.guestPrincipal?.tokenDigest).toMatch(/^[0-9a-f]{64}$/)
    expect(cookie).not.toContain(stored.guestPrincipal?.tokenDigest ?? '')

    const getResponse = await app.request(
      `/api/v1/study-sessions/${payload.session.id}`,
      { headers: { Cookie: cookie } }
    )
    const reloaded = getStudySessionResponseSchema.parse(
      await getResponse.json()
    )

    expect(getResponse.status).toBe(200)
    expect(reloaded).toEqual(payload)

    const keys = new Set<string>()
    collectKeys(reloaded, keys)
    for (const forbidden of [
      'userId',
      'guestPrincipalId',
      'correctOptionId',
      'isCorrect',
      'explanationKo',
      'explanationJa',
      'sourceType',
      'rowVersion',
      'createdByUserId'
    ]) {
      expect(keys.has(forbidden)).toBe(false)
    }
  })

  it('guest insert 뒤 session CHECK가 실패하면 aggregate 전체를 rollback한다', async () => {
    const startedAt = new Date('2026-08-14T00:00:00.000Z')
    const prepared = guestPrincipalService.prepareCredential()
    const credential = {
      ...prepared,
      createdAt: new Date(startedAt.getTime() - 1),
      expiresAt: startedAt
    }

    await expect(
      repository.createRandom({
        level: 'N5',
        subject: 'VOCABULARY',
        owner: { kind: 'NEW_GUEST', credential },
        requestedCount: 1,
        startedAt,
        expiresAt: new Date(startedAt.getTime() + 86_400_000)
      })
    ).rejects.toThrow()

    expect(
      await database.client.guestPrincipal.findUnique({
        where: { id: credential.id }
      })
    ).toBeNull()
    expect(
      await database.client.studySession.count({
        where: { guestPrincipalId: credential.id }
      })
    ).toBe(0)
  })

  it('USER와 ADMIN도 자기 세션만 조회하고 guest cookie보다 서버 session을 우선한다', async () => {
    const owner = await createAuthenticatedActor('USER')
    const foreignUser = await createAuthenticatedActor('USER')
    const admin = await createAuthenticatedActor('ADMIN')
    const response = await postStudySession(
      {
        level: 'N5',
        subject: 'VOCABULARY',
        mode: 'RANDOM',
        count: 1
      },
      `${owner.cookie}; ${GUEST_COOKIE_NAME}=invalid-signed-shape`
    )
    const payload = createStudySessionResponseSchema.parse(
      await response.json()
    )
    createdSessionIds.add(payload.session.id)
    const stored = await database.client.studySession.findUniqueOrThrow({
      where: { id: payload.session.id },
      select: { userId: true, guestPrincipalId: true }
    })

    expect(response.status).toBe(201)
    expect(stored).toEqual({
      userId: owner.userId,
      guestPrincipalId: null
    })
    expect(response.headers.get('Set-Cookie') ?? '').not.toContain(
      `${GUEST_COOKIE_NAME}=`
    )

    const own = await app.request(
      `/api/v1/study-sessions/${payload.session.id}`,
      { headers: { Cookie: owner.cookie } }
    )
    expect(own.status).toBe(200)

    for (const cookie of [foreignUser.cookie, admin.cookie]) {
      const foreign = await app.request(
        `/api/v1/study-sessions/${payload.session.id}`,
        { headers: { Cookie: cookie } }
      )
      expect(foreign.status).toBe(404)
      expect(await foreign.json()).toMatchObject({
        code: 'RESOURCE_NOT_FOUND',
        retryable: false
      })
    }

    const adminCreate = await postStudySession(
      {
        level: 'N5',
        subject: 'VOCABULARY',
        mode: 'RANDOM',
        count: 1
      },
      admin.cookie
    )
    const adminPayload = createStudySessionResponseSchema.parse(
      await adminCreate.json()
    )
    createdSessionIds.add(adminPayload.session.id)
    expect(
      await database.client.studySession.findUniqueOrThrow({
        where: { id: adminPayload.session.id },
        select: { userId: true, guestPrincipalId: true }
      })
    ).toEqual({ userId: admin.userId, guestPrincipalId: null })
  })

  it('USER session은 guest principal clear에서 guest aggregate를 보존한다', async () => {
    const guestCreate = await postStudySession({
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 1
    })
    const guestPayload = createStudySessionResponseSchema.parse(
      await guestCreate.json()
    )
    const guestCookie = getCookieHeader(guestCreate)
    await rememberSessionOwner(guestPayload.session.id)
    const guestOwner = await database.client.studySession.findUniqueOrThrow({
      where: { id: guestPayload.session.id },
      select: { guestPrincipalId: true }
    })
    if (!guestOwner.guestPrincipalId) {
      throw new Error('Guest-owned StudySession fixture가 필요합니다.')
    }
    const user = await createAuthenticatedActor('USER')

    const response = await app.request('/api/v1/guest-principal', {
      method: 'DELETE',
      headers: {
        Cookie: `${user.cookie}; ${guestCookie}`,
        Origin: origin
      }
    })

    expect(response.status).toBe(204)
    expect(response.headers.get('Set-Cookie') ?? '').not.toContain(
      `${GUEST_COOKIE_NAME}=`
    )
    expect(
      await database.client.guestPrincipal.findUnique({
        where: { id: guestOwner.guestPrincipalId }
      })
    ).not.toBeNull()
    expect(
      await database.client.studySession.findUnique({
        where: { id: guestPayload.session.id }
      })
    ).not.toBeNull()
  })

  it('후보가 부족하면 fallback 없이 실제 개수를 반환한다', async () => {
    const response = await postStudySession({
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 20
    })
    const payload = createStudySessionResponseSchema.parse(
      await response.json()
    )
    await rememberSessionOwner(payload.session.id)

    expect(response.status).toBe(201)
    expect(payload.session).toMatchObject({
      requestedCount: 20,
      actualCount: 5,
      usedFallback: false,
      fallbackReason: null
    })
    expect(payload.questions).toHaveLength(5)
  })

  it('미지원 모드·explicit IDs·owner 주입을 422로 막고 guest를 만들지 않는다', async () => {
    const beforeGuests = await database.client.guestPrincipal.count()
    const beforeSessions = await database.client.studySession.count()
    const [modeResponse, explicitResponse, ownerResponse] = await Promise.all([
      postStudySession({
        level: 'N5',
        subject: 'VOCABULARY',
        mode: 'WRONG_NOTE',
        count: 1
      }),
      postStudySession({
        level: 'N5',
        subject: 'VOCABULARY',
        mode: 'RANDOM',
        count: 1,
        explicitQuestionIds: [randomUUID()]
      }),
      postStudySession({
        level: 'N5',
        subject: 'VOCABULARY',
        mode: 'RANDOM',
        count: 1,
        userId: randomUUID()
      })
    ])

    for (const response of [modeResponse, explicitResponse, ownerResponse]) {
      expect(response.status).toBe(422)
      expect(await response.json()).toMatchObject({
        code: 'VALIDATION_ERROR',
        retryable: false
      })
      expect(response.headers.get('Set-Cookie')).toBeNull()
    }
    expect(await database.client.guestPrincipal.count()).toBe(beforeGuests)
    expect(await database.client.studySession.count()).toBe(beforeSessions)
  })

  it('v2 guest mode 정책을 401/404로 분리하고 빈 WEAKNESS owner를 만들지 않는다', async () => {
    const beforeGuests = await database.client.guestPrincipal.count()
    const beforeSessions = await database.client.studySession.count()

    for (const mode of ['WRONG_NOTE', 'DAILY_REVIEW', 'BOOKMARK'] as const) {
      const response = await postStudySession(
        { level: 'N5', subject: 'VOCABULARY', mode, count: 1 },
        undefined,
        2
      )
      expect(response.status).toBe(401)
      expect(await response.json()).toMatchObject({
        code: 'AUTHENTICATION_REQUIRED',
        retryable: false
      })
      expect(response.headers.get('Set-Cookie')).toBeNull()
    }

    const weakness = await postStudySession(
      {
        level: 'N5',
        subject: 'VOCABULARY',
        mode: 'WEAKNESS',
        count: 1
      },
      undefined,
      2
    )
    expect(weakness.status).toBe(404)
    expect(await weakness.json()).toMatchObject({
      code: 'NO_ELIGIBLE_QUESTIONS',
      retryable: false
    })

    expect(await database.client.guestPrincipal.count()).toBe(beforeGuests)
    expect(await database.client.studySession.count()).toBe(beforeSessions)
  })

  it('후보 0건이면 guest/session을 쓰지 않고 404를 반환한다', async () => {
    if (isPhase10CurrentSource) {
      const owner = await createAuthenticatedActor('USER')
      const beforeGuests = await database.client.guestPrincipal.count()
      const beforeSessions = await database.client.studySession.count()
      const response = await postStudySession(
        {
          level: 'N5',
          subject: 'VOCABULARY',
          mode: 'BOOKMARK',
          count: 3
        },
        owner.cookie,
        2
      )
      expect(response.status).toBe(404)
      expect(await response.json()).toMatchObject({
        code: 'NO_ELIGIBLE_QUESTIONS',
        retryable: false
      })
      expect(response.headers.get('Set-Cookie')).toBeNull()
      expect(await database.client.guestPrincipal.count()).toBe(beforeGuests)
      expect(await database.client.studySession.count()).toBe(beforeSessions)
      return
    }
    const candidates = await database.client.question.findMany({
      where: {
        lifecycleStatus: 'ACTIVE',
        currentPublishedVersion: {
          is: { level: 'N1', subject: 'READING', status: 'PUBLISHED' }
        }
      },
      select: { id: true, currentPublishedVersionId: true }
    })
    const candidateIds = candidates.map(({ id }) => id)
    const beforeGuests = await database.client.guestPrincipal.count()
    const beforeSessions = await database.client.studySession.count()

    await database.client.question.updateMany({
      where: { id: { in: candidateIds } },
      data: {
        lifecycleStatus: 'ARCHIVED',
        archivedAt: new Date(),
        currentPublishedVersionId: null
      }
    })
    try {
      const response = await postStudySession({
        level: 'N1',
        subject: 'READING',
        mode: 'RANDOM',
        count: 3
      })

      expect(response.status).toBe(404)
      expect(await response.json()).toMatchObject({
        code: 'NO_ELIGIBLE_QUESTIONS',
        retryable: false
      })
      expect(response.headers.get('Set-Cookie')).toBeNull()
      expect(await database.client.guestPrincipal.count()).toBe(beforeGuests)
      expect(await database.client.studySession.count()).toBe(beforeSessions)
    } finally {
      await database.client.$transaction(
        candidates.map(({ currentPublishedVersionId, id }) =>
          database.client.question.update({
            where: { id },
            data: {
              lifecycleStatus: 'ACTIVE',
              archivedAt: null,
              currentPublishedVersionId
            }
          })
        )
      )
    }
  })

  it('다른 guest와 변조 credential에는 세션 존재를 숨긴다', async () => {
    const first = await postStudySession({
      level: 'N4',
      subject: 'GRAMMAR',
      mode: 'RANDOM',
      count: 1
    })
    const firstPayload = createStudySessionResponseSchema.parse(
      await first.json()
    )
    const firstCookie = getCookieHeader(first)
    await rememberSessionOwner(firstPayload.session.id)

    const second = await postStudySession({
      level: 'N4',
      subject: 'GRAMMAR',
      mode: 'RANDOM',
      count: 1
    })
    const secondPayload = createStudySessionResponseSchema.parse(
      await second.json()
    )
    const secondCookie = getCookieHeader(second)
    await rememberSessionOwner(secondPayload.session.id)

    const [foreign, invalid, absent] = await Promise.all([
      app.request(`/api/v1/study-sessions/${firstPayload.session.id}`, {
        headers: { Cookie: secondCookie }
      }),
      app.request(`/api/v1/study-sessions/${firstPayload.session.id}`, {
        headers: { Cookie: `${GUEST_COOKIE_NAME}=tampered` }
      }),
      app.request(`/api/v1/study-sessions/${firstPayload.session.id}`)
    ])

    expect(firstCookie).not.toBe(secondCookie)
    expect(foreign.status).toBe(404)
    expect(await foreign.json()).toMatchObject({ code: 'RESOURCE_NOT_FOUND' })
    expect(invalid.status).toBe(401)
    expect(await invalid.json()).toMatchObject({
      code: 'GUEST_SESSION_EXPIRED'
    })
    expect(absent.status).toBe(401)
    expect(await absent.json()).toMatchObject({
      code: 'AUTHENTICATION_REQUIRED'
    })
  })

  it('서명은 유효하지만 DB row가 사라진 guest를 새 owner로 원자 회전한다', async () => {
    const first = await postStudySession({
      level: 'N4',
      subject: 'READING',
      mode: 'RANDOM',
      count: 1
    })
    const firstPayload = createStudySessionResponseSchema.parse(
      await first.json()
    )
    const staleCookie = getCookieHeader(first)
    await rememberSessionOwner(firstPayload.session.id)
    const oldOwner = await database.client.studySession.findUniqueOrThrow({
      where: { id: firstPayload.session.id },
      select: { guestPrincipalId: true }
    })
    if (!oldOwner.guestPrincipalId) {
      throw new Error('Guest owner fixture가 필요합니다.')
    }

    await database.client.guestPrincipal.delete({
      where: { id: oldOwner.guestPrincipalId }
    })

    const replacement = await postStudySession(
      {
        level: 'N4',
        subject: 'READING',
        mode: 'RANDOM',
        count: 1
      },
      staleCookie
    )
    const replacementPayload = createStudySessionResponseSchema.parse(
      await replacement.json()
    )
    const replacementCookie = getCookieHeader(replacement)
    await rememberSessionOwner(replacementPayload.session.id)

    expect(replacement.status).toBe(201)
    expect(replacementCookie).not.toBe('')
    expect(replacementCookie).not.toBe(staleCookie)
    expect(
      await database.client.guestPrincipal.findUnique({
        where: { id: oldOwner.guestPrincipalId }
      })
    ).toBeNull()

    const staleGet = await app.request(
      `/api/v1/study-sessions/${replacementPayload.session.id}`,
      { headers: { Cookie: staleCookie } }
    )
    expect(staleGet.status).toBe(401)
    expect(await staleGet.json()).toMatchObject({
      code: 'GUEST_SESSION_EXPIRED'
    })
  })

  it(
    isPhase10CurrentSource
      ? '비인가 Question archive를 42501로 거부하고 pinned payload를 보존한다'
      : 'Question을 archive해도 pinned version payload를 그대로 조회한다',
    async () => {
      const response = await postStudySession({
        level: 'N3',
        subject: 'READING',
        mode: 'RANDOM',
        count: 1
      })
      const payload = createStudySessionResponseSchema.parse(
        await response.json()
      )
      const cookie = getCookieHeader(response)
      await rememberSessionOwner(payload.session.id)
      const questionId = payload.questions[0]?.question.id
      const questionVersionId = payload.questions[0]?.question.questionVersionId
      if (!questionId || !questionVersionId) {
        throw new Error('Pinned question fixture가 필요합니다.')
      }

      const originalQuestion = await database.client.question.findUniqueOrThrow(
        {
          where: { id: questionId },
          select: {
            archivedAt: true,
            currentPublishedVersionId: true,
            lifecycleStatus: true,
            rowVersion: true,
            updatedAt: true
          }
        }
      )
      if (isPhase10CurrentSource) {
        const archiveTime = new Date()
        await expectRawDatabaseError({
          expectedMessage:
            'An armed trusted Phase 7 operation intent is required.',
          operation: async () =>
            await database.client.$executeRaw`
            UPDATE "Question"
            SET
              "lifecycleStatus" = 'ARCHIVED',
              "archivedAt" = ${archiveTime},
              "currentPublishedVersionId" = NULL,
              "rowVersion" = "rowVersion" + 1,
              "updatedAt" = ${archiveTime}
            WHERE "id" = ${questionId}::uuid
          `,
          sqlState: '42501'
        })
        await expect(
          database.client.question.findUniqueOrThrow({
            where: { id: questionId },
            select: {
              archivedAt: true,
              currentPublishedVersionId: true,
              lifecycleStatus: true,
              rowVersion: true,
              updatedAt: true
            }
          })
        ).resolves.toEqual(originalQuestion)
        const reloadedResponse = await app.request(
          `/api/v1/study-sessions/${payload.session.id}`,
          { headers: { Cookie: cookie } }
        )
        expect(reloadedResponse.status).toBe(200)
        expect(
          getStudySessionResponseSchema.parse(await reloadedResponse.json())
        ).toEqual(payload)
        return
      }

      await database.client.question.update({
        where: { id: questionId },
        data: {
          lifecycleStatus: 'ARCHIVED',
          archivedAt: new Date(),
          currentPublishedVersionId: null
        }
      })
      try {
        const reloadedResponse = await app.request(
          `/api/v1/study-sessions/${payload.session.id}`,
          { headers: { Cookie: cookie } }
        )
        const reloaded = getStudySessionResponseSchema.parse(
          await reloadedResponse.json()
        )
        expect(reloaded).toEqual(payload)
      } finally {
        await database.client.question.update({
          where: { id: questionId },
          data: {
            archivedAt: originalQuestion.archivedAt,
            currentPublishedVersionId:
              originalQuestion.currentPublishedVersionId,
            lifecycleStatus: originalQuestion.lifecycleStatus,
            rowVersion: originalQuestion.rowVersion,
            updatedAt: originalQuestion.updatedAt
          }
        })
      }
    }
  )

  it(
    isPhase10CurrentSource
      ? 'selection 중 비인가 archive를 원자 거부하고 version pin을 보존한다'
      : '동시 archive를 selection lock 뒤로 직렬화하고 pinned payload를 보존한다',
    async () => {
      const archiveClient = createApplicationClient()
      const observerClient = createApplicationClient()
      const credential = guestPrincipalService.prepareCredential()
      const startedAt = new Date()
      let releaseSelection = (): void => undefined
      const selectionRelease = new Promise<void>((resolve) => {
        releaseSelection = resolve
      })
      let reportSelection!: (
        selected: readonly {
          questionId: string
          questionVersionId: string
        }[]
      ) => void
      const selectionLocked = new Promise<
        readonly { questionId: string; questionVersionId: string }[]
      >((resolve) => {
        reportSelection = resolve
      })
      const raceRepository = createPrismaStudySessionRepository(
        database.client,
        {
          afterSelectionLocked: async (selected) => {
            reportSelection(selected)
            await selectionRelease
          }
        }
      )
      const raceService = createStudySessionService(
        raceRepository,
        () => startedAt
      )
      let createPromise: ReturnType<typeof raceService.create> | undefined
      let archiveUpdate: Promise<unknown> | undefined
      let archiveTransactionOpen = false
      let archiveCommitted = false
      let archiveError: unknown
      let selectedQuestionId: string | undefined
      let originalQuestion:
        | {
            archivedAt: Date | null
            currentPublishedVersionId: string | null
            lifecycleStatus: 'ACTIVE' | 'ARCHIVED'
            rowVersion?: number
            updatedAt: Date
          }
        | undefined

      try {
        await Promise.all([archiveClient.connect(), observerClient.connect()])
        createPromise = raceService.create(
          {
            level: 'N5',
            subject: 'VOCABULARY',
            mode: 'RANDOM',
            count: 3
          },
          { kind: 'NEW_GUEST', credential }
        )
        const selected = await Promise.race([
          selectionLocked,
          createPromise.then(() => {
            throw new Error(
              'StudySession creation bypassed the lock test hook.'
            )
          })
        ])
        const target = selected[0]
        if (!target) {
          throw new Error(
            'Selection lock fixture requires one selected question.'
          )
        }
        selectedQuestionId = target.questionId

        const original = await observerClient.query<{
          archivedAt: Date | null
          currentPublishedVersionId: string | null
          lifecycleStatus: 'ACTIVE' | 'ARCHIVED'
          rowVersion?: number
          updatedAt: Date
        }>(
          `SELECT
           "archivedAt",
           "currentPublishedVersionId",
           "lifecycleStatus",
           ${isPhase10CurrentSource ? '"rowVersion",' : ''}
           "updatedAt"
         FROM "Question"
         WHERE "id" = $1`,
          [target.questionId]
        )
        originalQuestion = original.rows[0]
        expect(originalQuestion).toMatchObject({
          lifecycleStatus: 'ACTIVE',
          currentPublishedVersionId: target.questionVersionId
        })

        const backend = await archiveClient.query<{ processId: number }>(
          'SELECT pg_backend_pid() AS "processId"'
        )
        const processId = backend.rows[0]?.processId
        if (processId === undefined) {
          throw new Error('Archive PostgreSQL backend PID is missing.')
        }

        await archiveClient.query('BEGIN')
        archiveTransactionOpen = true
        let archiveSettled = false
        archiveUpdate = archiveClient
          .query(
            isPhase10CurrentSource
              ? `UPDATE "Question"
               SET
                 "lifecycleStatus" = 'ARCHIVED',
                 "archivedAt" = $2,
                 "currentPublishedVersionId" = NULL,
                 "rowVersion" = "rowVersion" + 1,
                 "updatedAt" = $2
               WHERE "id" = $1`
              : `UPDATE "Question"
               SET
                 "lifecycleStatus" = 'ARCHIVED',
                 "archivedAt" = $2,
                 "currentPublishedVersionId" = NULL,
                 "updatedAt" = $2
               WHERE "id" = $1`,
            [target.questionId, new Date()]
          )
          .catch((error: unknown) => {
            archiveError = error
          })
          .finally(() => {
            archiveSettled = true
          })

        if (isPhase10CurrentSource) {
          releaseSelection()
        } else {
          await waitForPostgresLockWait(observerClient, processId)
          expect(archiveSettled).toBe(false)
          releaseSelection()
        }

        const created = await createPromise
        await archiveUpdate
        expect(archiveSettled).toBe(true)

        if (isPhase10CurrentSource) {
          expect(archiveError).toMatchObject({
            code: '42501',
            message: 'An armed trusted Phase 7 operation intent is required.'
          })
          await archiveClient.query('ROLLBACK')
          archiveTransactionOpen = false
        } else {
          expect(archiveError).toBeUndefined()
          await archiveClient.query('COMMIT')
          archiveTransactionOpen = false
          archiveCommitted = true
        }

        expect(created.payload.session).toMatchObject({
          actualCount: 3,
          requestedCount: 3,
          status: 'IN_PROGRESS'
        })
        expect(
          created.payload.questions.map(({ question }) => ({
            questionId: question.id,
            questionVersionId: question.questionVersionId
          }))
        ).toEqual(selected)

        const getResponse = await app.request(
          `/api/v1/study-sessions/${created.payload.session.id}`,
          {
            headers: {
              Cookie: `${GUEST_COOKIE_NAME}=${credential.cookieValue}`
            }
          }
        )
        expect(getResponse.status).toBe(200)
        expect(
          getStudySessionResponseSchema.parse(await getResponse.json())
        ).toEqual(created.payload)
        if (isPhase10CurrentSource) {
          await expect(
            observerClient.query<{
              archivedAt: Date | null
              currentPublishedVersionId: string | null
              lifecycleStatus: 'ACTIVE' | 'ARCHIVED'
              rowVersion: number
              updatedAt: Date
            }>(
              `SELECT
               "archivedAt",
               "currentPublishedVersionId",
               "lifecycleStatus",
               "rowVersion",
               "updatedAt"
             FROM "Question"
             WHERE "id" = $1`,
              [target.questionId]
            )
          ).resolves.toMatchObject({ rows: [originalQuestion] })
        } else {
          expect(
            await database.client.question.findUniqueOrThrow({
              where: { id: target.questionId },
              select: { lifecycleStatus: true, currentPublishedVersionId: true }
            })
          ).toEqual({
            lifecycleStatus: 'ARCHIVED',
            currentPublishedVersionId: null
          })
        }
      } finally {
        releaseSelection()
        await createPromise?.catch(() => undefined)
        await archiveUpdate?.catch(() => undefined)
        if (archiveTransactionOpen) {
          await archiveClient.query('ROLLBACK').catch(() => undefined)
        }
        if (
          archiveCommitted &&
          selectedQuestionId !== undefined &&
          originalQuestion !== undefined
        ) {
          await observerClient.query(
            `UPDATE "Question"
           SET
             "lifecycleStatus" = $2,
             "archivedAt" = $3,
             "currentPublishedVersionId" = $4,
             "updatedAt" = $5
           WHERE "id" = $1`,
            [
              selectedQuestionId,
              originalQuestion.lifecycleStatus,
              originalQuestion.archivedAt,
              originalQuestion.currentPublishedVersionId,
              originalQuestion.updatedAt
            ]
          )
        }
        await database.client.studySession.deleteMany({
          where: { guestPrincipalId: credential.id }
        })
        await database.client.guestPrincipal.deleteMany({
          where: { id: credential.id }
        })
        await Promise.all([
          archiveClient.end().catch(() => undefined),
          observerClient.end().catch(() => undefined)
        ])
      }
    },
    15_000
  )

  it('owner scoped GET에서 만료 상태를 영속하고 foreign user는 404다', async () => {
    const [ownerUserId, foreignUserId] = await Promise.all([
      createFixtureUser('owner'),
      createFixtureUser('foreign')
    ])
    const startedAt = new Date(Date.now() - 48 * 60 * 60 * 1_000)
    const expired = (
      await repository.createRandom({
        owner: { kind: 'USER', userId: ownerUserId },
        level: 'N2',
        subject: 'VOCABULARY',
        requestedCount: 1,
        startedAt,
        expiresAt: new Date(startedAt.getTime() + 24 * 60 * 60 * 1_000)
      })
    ).session
    createdSessionIds.add(expired.id)

    await expect(
      repository.findOwnedById(
        expired.id,
        { kind: 'USER', userId: foreignUserId },
        new Date()
      )
    ).resolves.toBeNull()

    const owned = await repository.findOwnedById(
      expired.id,
      { kind: 'USER', userId: ownerUserId },
      new Date()
    )
    expect(owned?.status).toBe('EXPIRED')
    expect(
      await database.client.studySession.findUniqueOrThrow({
        where: { id: expired.id },
        select: { status: true }
      })
    ).toEqual({ status: 'EXPIRED' })
  })

  it('shared PostgreSQL rate limiter가 초과 요청을 429로 닫는다', async () => {
    const operation = `slice3-integration:${randomUUID()}`
    const limiter = createApplicationRateLimiter({
      client: database.client,
      keySecret: environment.GUEST_COOKIE_SECRET,
      now: () => 1_723_651_200_000
    })
    const input = {
      clientIp: '127.0.0.42',
      operation,
      windowMs: 60_000,
      max: 2
    }

    await limiter.consume(input)
    await limiter.consume(input)
    await expect(limiter.consume(input)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      retryable: true
    })
  })
})

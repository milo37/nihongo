import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApiApp } from './createApp.js'
import { createAuthGateway } from '../auth/authGateway.js'
import { createAuthEmailDispatcher } from '../auth/emailDispatcher.js'
import { InMemoryAuthEmailPort } from '../auth/emailPort.js'
import { createGuestPrincipalService } from '../auth/guestPrincipalService.js'
import { createPhase7AuthFacade } from '../auth/phase7AuthFacade.js'
import { createPhase7PrincipalService } from '../auth/principalService.js'
import { parseApiEnvironment } from '../config/env.js'
import {
  createDatabaseRuntime,
  createRoleDatabaseRuntime,
  type DatabaseRuntime,
  type RoleDatabaseRuntime
} from '../db/database.js'
import { createPostgresStartupOptions } from '../db/databaseOptions.js'
import { assertSafeAdminCmsDatabase } from '../db/databaseTargetGuard.js'
import { attestPhase7RuntimeRoles } from '../db/phase7RuntimeRoleAttestation.js'
import { createApplicationRateLimiter } from '../middleware/applicationRateLimiter.js'
import { createJsonLogger } from '../observability/logger.js'
import { createPrismaQuestionRepository } from '../question/questionRepository.js'
import { createQuestionService } from '../question/questionService.js'

const requireEnvironmentValue = (name: string): string => {
  const value = process.env[name]
  if (!value) throw new Error(`Phase 7 API gate requires ${name}.`)
  return value
}

const environment = parseApiEnvironment(process.env)
const adminDatabaseUrl = requireEnvironmentValue(
  'PHASE7_API_ADMIN_DATABASE_URL'
)
const productionDatabaseUrl = requireEnvironmentValue('PRODUCTION_DATABASE_URL')
const schemaName = new URL(adminDatabaseUrl).searchParams.get('schema')
if (!schemaName || !/^phase7_[a-f0-9]{32}_test$/u.test(schemaName)) {
  throw new Error('Phase 7 API gate received an unsafe schema.')
}

const createAdminConnection = (): Client =>
  new Client({
    connectionString: adminDatabaseUrl,
    options: createPostgresStartupOptions(schemaName)
  })

const adminClient = createAdminConnection()
const emailPort = new InMemoryAuthEmailPort()
const emailDispatcher = createAuthEmailDispatcher({
  concurrency: 1,
  emailPort
})
let applicationRuntime: DatabaseRuntime
let authGatewayRuntime: RoleDatabaseRuntime
let app: ReturnType<typeof createApiApp>
let practiceAuthorityCalls = 0
const apiLogLines: string[] = []

const postAuth = async (
  pathname: string,
  body: Record<string, unknown>,
  cookie?: string
): Promise<Response> =>
  await app.request(pathname, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: environment.TRUSTED_ORIGINS[0]!,
      'Sec-Fetch-Site': 'same-origin',
      'User-Agent': 'phase7-api-gate',
      ...(cookie ? { Cookie: cookie } : {})
    },
    body: JSON.stringify(body)
  })

const resetAuthRateLimits = async (): Promise<void> => {
  await adminClient.query(
    `DELETE FROM "RateLimit" WHERE "key" LIKE 'application:auth:%'`
  )
}

const readLatestEmailToken = ({
  email,
  pathname,
  purpose
}: {
  email: string
  pathname: '/reset-password' | '/verify-email'
  purpose: 'EMAIL_VERIFICATION' | 'PASSWORD_RESET'
}): string => {
  const message = emailPort.messages.findLast(
    (candidate) =>
      candidate.purpose === purpose && candidate.recipient === email
  )
  if (!message) throw new Error(`${purpose} email fixture is unavailable.`)
  const url = new URL(message.url)
  expect(url.origin).toBe(environment.TRUSTED_ORIGINS[0])
  expect(url.pathname).toBe(pathname)
  expect(url.search).toBe('')
  const token = new URLSearchParams(url.hash.slice(1)).get('token')
  if (!token) throw new Error(`${purpose} fragment token is unavailable.`)
  expect(url.hash).toBe(`#${new URLSearchParams({ token }).toString()}`)
  return token
}

const registerVerifiedUser = async ({
  email,
  password
}: {
  email: string
  password: string
}): Promise<string> => {
  const signUp = await postAuth('/api/auth/sign-up/email', {
    email,
    name: 'Phase 7 Auth Gate',
    password,
    targetLevel: 'N3'
  })
  expect(signUp.status).toBe(200)
  expect(signUp.headers.get('Set-Cookie')).toBeNull()
  const token = readLatestEmailToken({
    email,
    pathname: '/verify-email',
    purpose: 'EMAIL_VERIFICATION'
  })
  const verification = await postAuth('/api/auth/verify-email', { token })
  expect(verification.status).toBe(200)
  const user = await adminClient.query<{ id: string }>(
    `SELECT "id" FROM "User" WHERE "email" = $1 AND "emailVerified"`,
    [email]
  )
  const userId = user.rows[0]?.id
  if (!userId) throw new Error('Verified auth subject is unavailable.')
  return userId
}

const requireSessionCookie = (response: Response): string => {
  const sessionCookie = response.headers
    .getSetCookie()
    .find((cookie) => cookie.startsWith('nihongo.session_token='))
  if (!sessionCookie) throw new Error('Issued session cookie is unavailable.')
  expect(sessionCookie).toContain('HttpOnly')
  expect(sessionCookie).toContain('SameSite=Lax')
  return sessionCookie.split(';', 1)[0]!
}

const expectExpiredSessionCookies = (response: Response): void => {
  const cookies = response.headers.getSetCookie()
  expect(cookies).toHaveLength(2)
  expect(cookies).toEqual(
    expect.arrayContaining([
      expect.stringContaining('nihongo.session_token='),
      expect.stringContaining('__Secure-nihongo.session_token=')
    ])
  )
  for (const cookie of cookies) expect(cookie).toContain('Max-Age=0')
}

const readWriteCounts = async (): Promise<{
  audit: number
  family: number
  question: number
  rateLimit: number
  report: number
  review: number
  session: number
}> => {
  const result = await adminClient.query<{
    audit: number
    family: number
    question: number
    rateLimit: number
    report: number
    review: number
    session: number
  }>(
    `SELECT
       (SELECT COUNT(*)::int FROM "AdminAuditLog") AS audit,
       (SELECT COUNT(*)::int FROM "AuthSessionFamily") AS family,
       (SELECT COUNT(*)::int FROM "Question") AS question,
       (SELECT COUNT(*)::int FROM "RateLimit") AS "rateLimit",
       (SELECT COUNT(*)::int FROM "QuestionReport") AS report,
       (SELECT COUNT(*)::int FROM "ContentReview") AS review,
       (SELECT COUNT(*)::int FROM "Session") AS session`
  )
  const row = result.rows[0]
  if (!row) throw new Error('Phase 7 API write counts are unavailable.')
  return row
}

const updateAuthorityGenerationWithoutCleanup = async (
  userId: string
): Promise<void> => {
  await adminClient.query('BEGIN')
  try {
    await adminClient.query('SET LOCAL session_replication_role = replica')
    const result = await adminClient.query(
      `UPDATE "User"
       SET "authorityGeneration" = "authorityGeneration" + 1
       WHERE "id" = $1`,
      [userId]
    )
    if (result.rowCount !== 1) {
      throw new Error('Authority generation drift fixture did not update.')
    }
    await adminClient.query('SET LOCAL session_replication_role = origin')
    await adminClient.query('COMMIT')
  } catch (error: unknown) {
    await adminClient.query('ROLLBACK')
    throw error
  }
}

const exercisePostIssuerAuthorityDrift = async ({
  email,
  password,
  userId
}: {
  email: string
  password: string
  userId: string
}): Promise<Response> => {
  const driftClient = createAdminConnection()
  const barrierKey = 'phase7-api-post-issuer-barrier'
  let advisoryLockHeld = false
  let driftConnected = false
  let driftTransactionOpen = false
  let driftUpdate: Promise<unknown> | undefined
  let signIn: Promise<Response> | undefined

  await adminClient.query(
    `CREATE FUNCTION "phase7_api_wait_after_session_insert"()
     RETURNS trigger LANGUAGE plpgsql
     SET search_path FROM CURRENT
     AS $function$
     BEGIN
       PERFORM pg_catalog.pg_advisory_xact_lock(
         pg_catalog.hashtextextended('${barrierKey}', 0)
       );
       RETURN NEW;
     END;
     $function$`
  )
  await adminClient.query(
    `REVOKE ALL ON FUNCTION "phase7_api_wait_after_session_insert"()
     FROM PUBLIC`
  )
  await adminClient.query(
    `CREATE TRIGGER "phase7_api_wait_after_session_insert_trigger"
     AFTER INSERT ON "Session" FOR EACH ROW
     EXECUTE FUNCTION "phase7_api_wait_after_session_insert"()`
  )

  try {
    await adminClient.query(
      `SELECT pg_advisory_lock(hashtextextended($1, 0))`,
      [barrierKey]
    )
    advisoryLockHeld = true
    signIn = postAuth('/api/auth/sign-in/email', { email, password })
    void signIn.catch(() => undefined)

    let issuerBlocked = false
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const activity = await adminClient.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM pg_stat_activity
         WHERE datname = current_database()
           AND usename = 'nihongo_test_auth_gateway_login'
           AND wait_event_type = 'Lock'`
      )
      if ((activity.rows[0]?.count ?? 0) > 0) {
        issuerBlocked = true
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    if (!issuerBlocked) {
      throw new Error('Post-issuer session insert barrier was not observed.')
    }

    await driftClient.connect()
    driftConnected = true
    await driftClient.query('BEGIN')
    driftTransactionOpen = true
    await driftClient.query('SET LOCAL session_replication_role = replica')
    const driftBackend = await driftClient.query<{ pid: number }>(
      `SELECT pg_backend_pid() AS pid`
    )
    const driftBackendPid = driftBackend.rows[0]?.pid
    if (!driftBackendPid) {
      throw new Error('Post-issuer drift backend is unavailable.')
    }
    driftUpdate = driftClient.query(
      `UPDATE "User"
       SET "authorityGeneration" = "authorityGeneration" + 1
       WHERE "id" = $1`,
      [userId]
    )
    void driftUpdate.catch(() => undefined)

    let driftBlocked = false
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const activity = await adminClient.query<{
        waitEventType: string | null
      }>(
        `SELECT wait_event_type AS "waitEventType"
         FROM pg_stat_activity WHERE pid = $1`,
        [driftBackendPid]
      )
      if (activity.rows[0]?.waitEventType === 'Lock') {
        driftBlocked = true
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    if (!driftBlocked) {
      throw new Error('Post-issuer authority drift waiter was not observed.')
    }

    await adminClient.query(
      `SELECT pg_advisory_unlock(hashtextextended($1, 0))`,
      [barrierKey]
    )
    advisoryLockHeld = false
    await driftUpdate
    driftUpdate = undefined
    await driftClient.query('SET LOCAL session_replication_role = origin')
    await driftClient.query('COMMIT')
    driftTransactionOpen = false
    const response = await signIn
    signIn = undefined
    return response
  } finally {
    if (advisoryLockHeld) {
      await adminClient
        .query(`SELECT pg_advisory_unlock(hashtextextended($1, 0))`, [
          barrierKey
        ])
        .catch(() => undefined)
    }
    await driftUpdate?.catch(() => undefined)
    if (driftTransactionOpen) {
      await driftClient.query('ROLLBACK').catch(() => undefined)
    }
    if (driftConnected) await driftClient.end().catch(() => undefined)
    await signIn?.catch(() => undefined)
    await adminClient
      .query(
        `DROP TRIGGER IF EXISTS
           "phase7_api_wait_after_session_insert_trigger" ON "Session"`
      )
      .catch(() => undefined)
    await adminClient
      .query(`DROP FUNCTION IF EXISTS "phase7_api_wait_after_session_insert"()`)
      .catch(() => undefined)
  }
}

beforeAll(async () => {
  assertSafeAdminCmsDatabase({
    adminCmsMode: environment.ADMIN_CMS_MODE,
    nodeEnvironment: environment.NODE_ENV,
    databaseUrl: environment.DATABASE_URL,
    productionDatabaseUrl
  })
  await adminClient.connect()
  applicationRuntime = createDatabaseRuntime(environment.DATABASE_URL, {
    migrationProfile: 'current',
    startupRole: 'nihongo_app'
  })
  authGatewayRuntime = createRoleDatabaseRuntime(
    environment.AUTH_GATEWAY_DATABASE_URL!,
    'nihongo_auth_gateway'
  )

  const phase7Facade = createPhase7AuthFacade({
    client: authGatewayRuntime.client,
    emailDispatcher,
    environment
  })
  const rateLimiter = createApplicationRateLimiter({
    client: applicationRuntime.client,
    keySecret: environment.GUEST_COOKIE_SECRET
  })
  app = createApiApp({
    assertPracticeRuntimeAuthority: async () => {
      practiceAuthorityCalls += 1
    },
    auth: {
      environment,
      gateway: createAuthGateway({
        environment,
        phase7Facade,
        technicalRateLimiter: rateLimiter
      }),
      guestPrincipalService: createGuestPrincipalService({
        client: applicationRuntime.client,
        secret: environment.GUEST_COOKIE_SECRET
      }),
      principalService: createPhase7PrincipalService({
        client: applicationRuntime.client,
        isProduction: false,
        refreshClient: authGatewayRuntime.client,
        secret: environment.BETTER_AUTH_SECRET
      })
    },
    checkReadiness: applicationRuntime.checkReadiness,
    logger: createJsonLogger('debug', (line) => apiLogLines.push(line)),
    questionReader: createQuestionService(
      createPrismaQuestionRepository(applicationRuntime.client)
    )
  })
}, 30_000)

afterAll(async () => {
  emailDispatcher.abort()
  await Promise.all([
    applicationRuntime?.disconnect(),
    authGatewayRuntime?.disconnect(),
    adminClient.end()
  ])
})

describe('Phase 7 Slice 1 technical API gate', () => {
  it('stale DB capability에서 listener startup 권위를 fail closed한다', async () => {
    const capability = await adminClient.query<{
      databaseName: string
      environment: 'TEST'
      serverAddress: string
      serverPort: number
    }>(
      `SELECT "databaseName", "serverAddress"::text AS "serverAddress",
         "serverPort", "environment"
       FROM "Phase7DatabaseCapability" WHERE "id" = 1`
    )
    const original = capability.rows[0]
    if (!original) throw new Error('Registered capability is unavailable.')

    await adminClient.query(
      `UPDATE "Phase7DatabaseCapability"
       SET "serverPort" = CASE WHEN "serverPort" = 65535
         THEN 65534 ELSE "serverPort" + 1 END
       WHERE "id" = 1`
    )
    try {
      const rejected = await Promise.allSettled([
        applicationRuntime.client.$queryRawUnsafe(
          'SELECT "phase7_require_runtime_ready"()'
        ),
        authGatewayRuntime.client.$queryRawUnsafe(
          'SELECT "phase7_require_runtime_ready"()'
        )
      ])
      expect(rejected.map(({ status }) => status)).toEqual([
        'rejected',
        'rejected'
      ])
    } finally {
      await adminClient.query(
        `UPDATE "Phase7DatabaseCapability"
         SET "databaseName" = $1, "serverAddress" = $2::inet,
           "serverPort" = $3, "environment" = $4
         WHERE "id" = 1`,
        [
          original.databaseName,
          original.serverAddress,
          original.serverPort,
          original.environment
        ]
      )
    }

    await expect(applicationRuntime.checkReadiness()).resolves.toBeUndefined()
    await expect(
      attestPhase7RuntimeRoles({
        application: {
          client: applicationRuntime.client,
          connectionString: environment.DATABASE_URL,
          expectedRole: 'nihongo_app'
        },
        authGateway: {
          client: authGatewayRuntime.client,
          connectionString: environment.AUTH_GATEWAY_DATABASE_URL!,
          expectedRole: 'nihongo_auth_gateway'
        }
      })
    ).resolves.toBeUndefined()
    await expect(
      Promise.all([
        applicationRuntime.client.$queryRawUnsafe(
          'SELECT "phase7_require_runtime_ready"()'
        ),
        authGatewayRuntime.client.$queryRawUnsafe(
          'SELECT "phase7_require_runtime_ready"()'
        )
      ])
    ).resolves.toHaveLength(2)
  })

  it('Phase 7 prefix를 CORS/auth/practice/DB보다 먼저 제외한다', async () => {
    const before = await readWriteCounts()
    const callsBefore = practiceAuthorityCalls
    for (const [pathname, method] of [
      ['/api/v1/admin/questions', 'GET'],
      ['/api/v1/admin/questions', 'POST'],
      ['/api/v1/admin/questions', 'OPTIONS'],
      ['/api/v1/question-reports', 'HEAD']
    ] as const) {
      const response = await app.request(pathname, {
        method,
        headers: { Origin: environment.TRUSTED_ORIGINS[0]! }
      })
      expect(response.status).toBe(404)
      expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
      expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    }
    expect(practiceAuthorityCalls).toBe(callsBefore)
    expect(await readWriteCounts()).toEqual(before)
  })

  it.each([
    {
      pathname: '/api/v1/questions',
      expectedHeaders: ['Content-Type']
    },
    {
      pathname: '/api/v1/study-sessions',
      expectedHeaders: [
        'Content-Type',
        'Idempotency-Key',
        'X-Nihongo-Practice-Contract'
      ]
    },
    {
      pathname:
        '/api/v1/wrong-notes/019d0000-0000-7000-8000-000000000001/review-session',
      expectedHeaders: [
        'Content-Type',
        'Idempotency-Key',
        'X-Nihongo-Practice-Contract'
      ]
    }
  ])(
    '실제 technical app CORS $pathname를 exact method/header로 제한한다',
    async ({ expectedHeaders, pathname }) => {
      const response = await app.request(pathname, {
        method: 'OPTIONS',
        headers: {
          'Access-Control-Request-Headers':
            'Content-Type, Idempotency-Key, X-Nihongo-Practice-Contract',
          'Access-Control-Request-Method': 'PATCH',
          Origin: environment.TRUSTED_ORIGINS[0]!
        }
      })

      expect(response.status).toBe(204)
      expect(
        response.headers.get('Access-Control-Allow-Methods')?.split(',')
      ).toEqual(['DELETE', 'GET', 'OPTIONS', 'PATCH', 'POST', 'PUT'])
      expect(
        response.headers.get('Access-Control-Allow-Headers')?.split(',')
      ).toEqual(expectedHeaders)
      expect(
        response.headers.get('Access-Control-Expose-Headers')?.split(',')
      ).toEqual([
        'Content-Disposition',
        'Idempotency-Replayed',
        'Location',
        'Retry-After',
        'X-Request-Id',
        'X-Nihongo-Practice-Contract'
      ])
    }
  )

  it('stale issuance와 stale session을 cookie/write 0으로 닫는다', async () => {
    const email = `phase7-api-${randomUUID()}@example.test`
    const password = 'phase7-api-password-fixture'
    const signUp = await postAuth('/api/auth/sign-up/email', {
      email,
      name: 'Phase 7 API Gate',
      password,
      targetLevel: 'N3'
    })
    expect(signUp.status).toBe(200)
    expect(signUp.headers.get('Set-Cookie')).toBeNull()
    const verificationMessage = emailPort.messages.find(
      (message) =>
        message.purpose === 'EMAIL_VERIFICATION' && message.recipient === email
    )
    if (!verificationMessage) {
      throw new Error('Verification email fixture was not captured.')
    }
    const verificationToken = new URLSearchParams(
      new URL(verificationMessage.url).hash.slice(1)
    ).get('token')
    if (!verificationToken) {
      throw new Error('Verification token fixture is unavailable.')
    }
    const verification = await postAuth('/api/auth/verify-email', {
      token: verificationToken
    })
    expect(verification.status).toBe(200)

    const user = await adminClient.query<{
      authorityGeneration: number
      id: string
    }>(
      `SELECT "id", "authorityGeneration"
       FROM "User" WHERE "email" = $1`,
      [email]
    )
    const subject = user.rows[0]
    if (!subject) throw new Error('Auth subject fixture is unavailable.')
    expect(subject.authorityGeneration).toBe(1)

    await adminClient.query('BEGIN')
    let lockOpen = true
    let staleSignIn: Promise<Response> | undefined
    let earlyResponse: Response | undefined
    try {
      await adminClient.query(
        `SELECT 1 FROM "User" WHERE "id" = $1 FOR UPDATE`,
        [subject.id]
      )
      staleSignIn = postAuth('/api/auth/sign-in/email', {
        email,
        password
      }).then((response) => {
        earlyResponse = response
        return response
      })
      void staleSignIn.catch(() => undefined)
      let lockObserved = false
      for (let attempt = 0; attempt < 200; attempt += 1) {
        const activity = await adminClient.query<{ count: number }>(
          `SELECT COUNT(*)::int AS count FROM pg_stat_activity
           WHERE datname = current_database()
             AND usename = 'nihongo_test_auth_gateway_login'
             AND wait_event_type = 'Lock'`
        )
        if ((activity.rows[0]?.count ?? 0) > 0) {
          lockObserved = true
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
      if (!lockObserved) {
        throw new Error(
          `Stale issuance lock was not observed (response=${earlyResponse?.status ?? 'pending'}).`
        )
      }
      await adminClient.query('SET LOCAL session_replication_role = replica')
      await adminClient.query(
        `UPDATE "User"
         SET "authorityGeneration" = "authorityGeneration" + 1
         WHERE "id" = $1`,
        [subject.id]
      )
      await adminClient.query('SET LOCAL session_replication_role = origin')
      await adminClient.query('COMMIT')
      lockOpen = false
      const rejected = await staleSignIn
      staleSignIn = undefined
      expect(rejected.status).toBe(401)
      expect(await rejected.json()).toMatchObject({
        code: 'INVALID_EMAIL_OR_PASSWORD'
      })
      expect(rejected.headers.get('Set-Cookie')).toBeNull()
    } finally {
      if (lockOpen) await adminClient.query('ROLLBACK')
      await staleSignIn?.catch(() => undefined)
    }

    const afterStaleIssue = await readWriteCounts()
    expect(afterStaleIssue.session).toBe(0)
    expect(afterStaleIssue.family).toBe(0)
    expect(afterStaleIssue.audit).toBe(0)
    expect(afterStaleIssue.review).toBe(0)
    expect(afterStaleIssue.report).toBe(0)
    expect(afterStaleIssue.question).toBe(0)

    const postIssuerRejected = await exercisePostIssuerAuthorityDrift({
      email,
      password,
      userId: subject.id
    })
    expect(postIssuerRejected.status).toBe(401)
    expect(await postIssuerRejected.json()).toMatchObject({
      code: 'INVALID_EMAIL_OR_PASSWORD'
    })
    expect(postIssuerRejected.headers.get('Set-Cookie')).toBeNull()
    const afterPostIssuerDrift = await adminClient.query<{
      activeFamilyCount: number
      auditCount: number
      revokedFamilyCount: number
      sessionCount: number
    }>(
      `SELECT
         (SELECT COUNT(*)::int FROM "AuthSessionFamily"
          WHERE "userId" = $1 AND "status" = 'ACTIVE')
           AS "activeFamilyCount",
         (SELECT COUNT(*)::int FROM "AuthSessionFamily"
          WHERE "userId" = $1 AND "status" = 'REVOKED')
           AS "revokedFamilyCount",
         (SELECT COUNT(*)::int FROM "Session" WHERE "userId" = $1)
           AS "sessionCount",
         (SELECT COUNT(*)::int FROM "AdminAuditLog") AS "auditCount"`,
      [subject.id]
    )
    expect(afterPostIssuerDrift.rows).toEqual([
      {
        activeFamilyCount: 0,
        auditCount: 0,
        revokedFamilyCount: 1,
        sessionCount: 0
      }
    ])

    const successful = await postAuth('/api/auth/sign-in/email', {
      email,
      password
    })
    expect(successful.status).toBe(200)
    const issuedCookies = successful.headers.getSetCookie()
    const sessionCookie = issuedCookies.find((cookie) =>
      cookie.startsWith('nihongo.session_token=')
    )
    if (!sessionCookie) throw new Error('Issued session cookie is unavailable.')
    expect(sessionCookie).toContain('HttpOnly')
    expect(sessionCookie).toContain('SameSite=Lax')
    const cookieHeader = sessionCookie.split(';', 1)[0]!

    const issuedState = await adminClient.query<{
      authorityGeneration: number
      familyCount: number
      issuerProtocolVersion: string
      sessionCount: number
    }>(
      `SELECT target_user."authorityGeneration",
         (SELECT COUNT(*)::int FROM "AuthSessionFamily"
          WHERE "userId" = target_user."id" AND "status" = 'ACTIVE')
           AS "familyCount",
         (SELECT COUNT(*)::int FROM "Session"
          WHERE "userId" = target_user."id") AS "sessionCount",
         (SELECT "issuerProtocolVersion"::text FROM "Session"
          WHERE "userId" = target_user."id" LIMIT 1)
           AS "issuerProtocolVersion"
       FROM "User" AS target_user WHERE target_user."id" = $1`,
      [subject.id]
    )
    expect(issuedState.rows).toEqual([
      {
        authorityGeneration: 3,
        familyCount: 1,
        issuerProtocolVersion: 'PHASE7_V1',
        sessionCount: 1
      }
    ])

    await updateAuthorityGenerationWithoutCleanup(subject.id)
    const beforeStalePrincipal = await readWriteCounts()
    const stalePrincipal = await app.request('/api/v1/me', {
      headers: { Cookie: cookieHeader }
    })
    expect(stalePrincipal.status).toBe(200)
    expect(await stalePrincipal.json()).toEqual({ kind: 'GUEST' })
    expect(stalePrincipal.headers.getSetCookie()).toEqual(
      expect.arrayContaining([
        expect.stringContaining('nihongo.session_token='),
        expect.stringContaining('__Secure-nihongo.session_token=')
      ])
    )
    expect(await readWriteCounts()).toEqual(beforeStalePrincipal)
  }, 60_000)

  it('send-verification을 strict body와 fragment-only mail로 닫는다', async () => {
    await resetAuthRateLimits()
    const email = `phase7-verification-${randomUUID()}@example.test`
    const password = 'phase7-verification-password'
    const signUp = await postAuth('/api/auth/sign-up/email', {
      email,
      name: 'Phase 7 Verification Gate',
      password,
      targetLevel: 'N4'
    })
    expect(signUp.status).toBe(200)
    const initialMessageCount = emailPort.messages.filter(
      (message) =>
        message.purpose === 'EMAIL_VERIFICATION' && message.recipient === email
    ).length
    expect(initialMessageCount).toBe(1)

    const invalid = await postAuth('/api/auth/send-verification-email', {
      callbackURL: 'http://localhost:5173/forbidden',
      email
    })
    expect(invalid.status).toBe(400)
    expect(
      emailPort.messages.filter((message) => message.recipient === email)
    ).toHaveLength(initialMessageCount)

    const sent = await postAuth('/api/auth/send-verification-email', { email })
    expect(sent.status).toBe(200)
    expect(sent.headers.get('Set-Cookie')).toBeNull()
    expect(
      emailPort.messages.filter(
        (message) =>
          message.purpose === 'EMAIL_VERIFICATION' &&
          message.recipient === email
      )
    ).toHaveLength(initialMessageCount + 1)
    readLatestEmailToken({
      email,
      pathname: '/verify-email',
      purpose: 'EMAIL_VERIFICATION'
    })

    const messageCountBeforeAlias = emailPort.messages.length
    const alias = await postAuth(
      '/api/auth/send-verification-email?callbackURL=%2Fadmin',
      { email }
    )
    expect(alias.status).toBe(400)
    expect(emailPort.messages).toHaveLength(messageCountBeforeAlias)
    const state = await adminClient.query<{
      emailVerified: boolean
      sessionCount: number
    }>(
      `SELECT target_user."emailVerified",
         (SELECT COUNT(*)::int FROM "Session"
          WHERE "userId" = target_user."id") AS "sessionCount"
       FROM "User" AS target_user WHERE target_user."email" = $1`,
      [email]
    )
    expect(state.rows).toEqual([{ emailVerified: false, sessionCount: 0 }])
  }, 30_000)

  it('change-password와 sign-out을 old/duplicate cookie까지 fail closed한다', async () => {
    await resetAuthRateLimits()
    const email = `phase7-change-${randomUUID()}@example.test`
    const oldPassword = 'phase7-change-old-password'
    const newPassword = 'phase7-change-new-password'
    const userId = await registerVerifiedUser({ email, password: oldPassword })
    const initialSignIn = await postAuth('/api/auth/sign-in/email', {
      email,
      password: oldPassword
    })
    expect(initialSignIn.status).toBe(200)
    const oldCookie = requireSessionCookie(initialSignIn)

    const wrongPassword = await postAuth(
      '/api/auth/change-password',
      {
        currentPassword: 'phase7-wrong-current-password',
        newPassword
      },
      oldCookie
    )
    expect(wrongPassword.status).toBe(401)
    expect(wrongPassword.headers.get('Set-Cookie')).toBeNull()

    const duplicateCookie = await postAuth(
      '/api/auth/change-password',
      { currentPassword: oldPassword, newPassword },
      `${oldCookie}; ${oldCookie}`
    )
    expect(duplicateCookie.status).toBe(401)
    expect(duplicateCookie.headers.get('Set-Cookie')).toBeNull()

    const alias = await postAuth(
      '/api/auth/change-password?callbackURL=%2Fadmin',
      { currentPassword: oldPassword, newPassword },
      oldCookie
    )
    expect(alias.status).toBe(400)
    expect(
      (
        await adminClient.query<{ count: number }>(
          `SELECT COUNT(*)::int AS count FROM "Session"
           WHERE "userId" = $1`,
          [userId]
        )
      ).rows
    ).toEqual([{ count: 1 }])

    const changed = await postAuth(
      '/api/auth/change-password',
      { currentPassword: oldPassword, newPassword },
      oldCookie
    )
    expect(changed.status).toBe(200)
    expectExpiredSessionCookies(changed)
    const changedState = await adminClient.query<{
      activeFamilyCount: number
      authorityGeneration: number
      sessionCount: number
    }>(
      `SELECT target_user."authorityGeneration",
         (SELECT COUNT(*)::int FROM "Session"
          WHERE "userId" = target_user."id") AS "sessionCount",
         (SELECT COUNT(*)::int FROM "AuthSessionFamily"
          WHERE "userId" = target_user."id" AND "status" = 'ACTIVE')
           AS "activeFamilyCount"
       FROM "User" AS target_user WHERE target_user."id" = $1`,
      [userId]
    )
    expect(changedState.rows).toEqual([
      { activeFamilyCount: 0, authorityGeneration: 2, sessionCount: 0 }
    ])
    const oldPrincipal = await app.request('/api/v1/me', {
      headers: { Cookie: oldCookie }
    })
    expect(await oldPrincipal.json()).toEqual({ kind: 'GUEST' })

    const oldPasswordSignIn = await postAuth('/api/auth/sign-in/email', {
      email,
      password: oldPassword
    })
    expect(oldPasswordSignIn.status).toBe(401)
    expect(oldPasswordSignIn.headers.get('Set-Cookie')).toBeNull()
    const newPasswordSignIn = await postAuth('/api/auth/sign-in/email', {
      email,
      password: newPassword
    })
    expect(newPasswordSignIn.status).toBe(200)
    const newCookie = requireSessionCookie(newPasswordSignIn)

    const signOutAlias = await postAuth(
      '/api/auth/sign-out?callbackURL=%2F',
      {},
      newCookie
    )
    expect(signOutAlias.status).toBe(400)
    const signOutUnknownBody = await postAuth(
      '/api/auth/sign-out',
      { callbackURL: '/' },
      newCookie
    )
    expect(signOutUnknownBody.status).toBe(400)
    expect(
      (
        await adminClient.query<{ count: number }>(
          `SELECT COUNT(*)::int AS count FROM "Session"
           WHERE "userId" = $1`,
          [userId]
        )
      ).rows
    ).toEqual([{ count: 1 }])

    const signedOut = await postAuth('/api/auth/sign-out', {}, newCookie)
    expect(signedOut.status).toBe(200)
    expectExpiredSessionCookies(signedOut)
    const signedOutState = await adminClient.query<{
      activeFamilyCount: number
      sessionCount: number
    }>(
      `SELECT
         (SELECT COUNT(*)::int FROM "Session" WHERE "userId" = $1)
           AS "sessionCount",
         (SELECT COUNT(*)::int FROM "AuthSessionFamily"
          WHERE "userId" = $1 AND "status" = 'ACTIVE')
           AS "activeFamilyCount"`,
      [userId]
    )
    expect(signedOutState.rows).toEqual([
      { activeFamilyCount: 0, sessionCount: 0 }
    ])
  }, 60_000)

  it('password-reset eligibility race loser를 same wire/write0으로 닫는다', async () => {
    await resetAuthRateLimits()
    const email = `phase7-reset-race-${randomUUID()}@example.test`
    const password = 'phase7-reset-race-password'
    const userId = await registerVerifiedUser({ email, password })
    const messageCountBefore = emailPort.messages.length

    const missingResponse = await postAuth('/api/auth/request-password-reset', {
      email: `missing-${randomUUID()}@example.test`
    })
    expect(missingResponse.status).toBe(200)
    expect(missingResponse.headers.get('Cache-Control')).toBe(
      'private, no-store'
    )
    expect(missingResponse.headers.getSetCookie()).toEqual([])
    const missingBody = await missingResponse.json()
    expect(missingBody).toEqual({ success: true })
    expect(emailPort.messages).toHaveLength(messageCountBefore)
    const domainCountsBefore = await readWriteCounts()

    const readRaceState = async (): Promise<{
      accountVersion: string
      activeFamilyCount: number
      sessionCount: number
      trustedExecutionCount: number
      verificationCount: number
    }> => {
      const state = await adminClient.query<{
        accountVersion: string
        activeFamilyCount: number
        sessionCount: number
        trustedExecutionCount: number
        verificationCount: number
      }>(
        `SELECT credential.xmin::text AS "accountVersion",
           (SELECT COUNT(*)::int FROM "Verification"
            WHERE "resetUserId" = $1) AS "verificationCount",
           (SELECT COUNT(*)::int FROM "Phase7TrustedExecution"
            WHERE "targetUserId" = $1) AS "trustedExecutionCount",
           (SELECT COUNT(*)::int FROM "Session"
            WHERE "userId" = $1) AS "sessionCount",
           (SELECT COUNT(*)::int FROM "AuthSessionFamily"
            WHERE "userId" = $1 AND "status" = 'ACTIVE')
             AS "activeFamilyCount"
         FROM "Account" AS credential
         WHERE credential."userId" = $1
           AND credential."providerId" = 'credential'`,
        [userId]
      )
      const row = state.rows[0]
      if (!row) throw new Error('Reset race credential state is unavailable.')
      return row
    }

    let transactionOpen = false
    let raceRequest: Promise<Response> | undefined
    let raceResponse: Response | undefined
    let stateBefore: Awaited<ReturnType<typeof readRaceState>> | undefined
    let lockWaitObserved = false
    const logStart = apiLogLines.length
    await adminClient.query('BEGIN')
    transactionOpen = true
    try {
      await adminClient.query(`SET LOCAL session_replication_role = replica`)
      await adminClient.query(
        `SELECT 1 FROM "User" WHERE "id" = $1 FOR UPDATE`,
        [userId]
      )
      await adminClient.query(
        `UPDATE "User" SET "accountStatus" = 'DELETION_PENDING'
         WHERE "id" = $1`,
        [userId]
      )
      stateBefore = await readRaceState()

      raceRequest = postAuth('/api/auth/request-password-reset', { email })
      void raceRequest.catch(() => undefined)
      for (let attempt = 0; attempt < 500; attempt += 1) {
        const activity = await adminClient.query<{ waiting: boolean }>(
          `SELECT EXISTS (
             SELECT 1 FROM pg_stat_activity
             WHERE pid <> pg_backend_pid()
               AND query LIKE '%phase7_request_password_reset%'
               AND wait_event_type = 'Lock'
           ) AS waiting`
        )
        if (activity.rows[0]?.waiting) {
          lockWaitObserved = true
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 10))
      }

      await adminClient.query('COMMIT')
      transactionOpen = false
      raceResponse = await raceRequest
      raceRequest = undefined
    } finally {
      if (transactionOpen) {
        await adminClient.query(raceRequest ? 'COMMIT' : 'ROLLBACK')
        transactionOpen = false
      }
      await raceRequest?.catch(() => undefined)
    }

    expect(lockWaitObserved).toBe(true)
    expect(raceResponse).toBeDefined()
    expect(raceResponse!.status).toBe(200)
    expect(raceResponse!.headers.get('Cache-Control')).toBe('private, no-store')
    expect(raceResponse!.headers.getSetCookie()).toEqual([])
    const responseText = await raceResponse!.text()
    expect(JSON.parse(responseText)).toEqual(missingBody)
    expect(responseText).not.toContain(email)
    expect(responseText).not.toContain(userId)
    expect(emailPort.messages).toHaveLength(messageCountBefore)
    expect(await readRaceState()).toEqual(stateBefore)
    const domainCountsAfter = await readWriteCounts()
    expect({
      audit: domainCountsAfter.audit,
      question: domainCountsAfter.question,
      report: domainCountsAfter.report,
      review: domainCountsAfter.review
    }).toEqual({
      audit: domainCountsBefore.audit,
      question: domainCountsBefore.question,
      report: domainCountsBefore.report,
      review: domainCountsBefore.review
    })

    const requestLogs = apiLogLines.slice(logStart).join('\n')
    expect(requestLogs).not.toContain(email)
    expect(requestLogs).not.toContain(userId)
    expect(requestLogs).not.toContain(password)
  }, 60_000)

  it('password-reset request/consume을 fragment token과 session0으로 닫는다', async () => {
    await resetAuthRateLimits()
    const email = `phase7-reset-${randomUUID()}@example.test`
    const oldPassword = 'phase7-reset-old-password'
    const newPassword = 'phase7-reset-new-password'
    const userId = await registerVerifiedUser({ email, password: oldPassword })
    const initialSignIn = await postAuth('/api/auth/sign-in/email', {
      email,
      password: oldPassword
    })
    expect(initialSignIn.status).toBe(200)
    const oldCookie = requireSessionCookie(initialSignIn)

    const noneligibleEmail = `phase7-reset-ineligible-${randomUUID()}@example.test`
    const noneligibleUserId = await registerVerifiedUser({
      email: noneligibleEmail,
      password: 'phase7-reset-ineligible-password'
    })
    await adminClient.query('BEGIN')
    try {
      await adminClient.query(`SET LOCAL session_replication_role = replica`)
      await adminClient.query(
        `UPDATE "User" SET "accountStatus" = 'DELETION_PENDING'
         WHERE "id" = $1`,
        [noneligibleUserId]
      )
      await adminClient.query('COMMIT')
    } catch (error: unknown) {
      await adminClient.query('ROLLBACK')
      throw error
    }

    const messageCountBeforeInvalid = emailPort.messages.length
    const invalidRequest = await postAuth('/api/auth/request-password-reset', {
      callbackURL: 'http://localhost:5173/reset-password',
      email
    })
    expect(invalidRequest.status).toBe(400)
    expect(invalidRequest.headers.get('Cache-Control')).toBe(
      'private, no-store'
    )
    expect(emailPort.messages).toHaveLength(messageCountBeforeInvalid)

    const intentsBeforeMissing = await adminClient.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM "Verification"
       WHERE "purpose" = 'PASSWORD_RESET_V1'`
    )
    const missingRequest = await postAuth('/api/auth/request-password-reset', {
      email: `missing-${randomUUID()}@example.test`
    })
    expect(missingRequest.status).toBe(200)
    expect(missingRequest.headers.get('Cache-Control')).toBe(
      'private, no-store'
    )
    expect(emailPort.messages).toHaveLength(messageCountBeforeInvalid)
    expect(
      (
        await adminClient.query<{ count: number }>(
          `SELECT COUNT(*)::int AS count FROM "Verification"
           WHERE "purpose" = 'PASSWORD_RESET_V1'`
        )
      ).rows
    ).toEqual(intentsBeforeMissing.rows)

    const noneligibleRequest = await postAuth(
      '/api/auth/request-password-reset',
      { email: noneligibleEmail }
    )
    expect(noneligibleRequest.status).toBe(200)
    expect(noneligibleRequest.headers.get('Cache-Control')).toBe(
      'private, no-store'
    )
    expect(noneligibleRequest.headers.get('Set-Cookie')).toBeNull()
    expect(await noneligibleRequest.clone().json()).toEqual(
      await missingRequest.clone().json()
    )
    expect(emailPort.messages).toHaveLength(messageCountBeforeInvalid)
    expect(
      (
        await adminClient.query<{ count: number }>(
          `SELECT COUNT(*)::int AS count FROM "Verification"
           WHERE "purpose" = 'PASSWORD_RESET_V1'
             AND "resetUserId" = $1`,
          [noneligibleUserId]
        )
      ).rows
    ).toEqual([{ count: 0 }])

    await resetAuthRateLimits()
    const resetRequest = await postAuth('/api/auth/request-password-reset', {
      email
    })
    expect(resetRequest.status).toBe(200)
    expect(resetRequest.headers.get('Cache-Control')).toBe('private, no-store')
    expect(resetRequest.headers.get('Set-Cookie')).toBeNull()
    expect(await resetRequest.clone().json()).toEqual(
      await missingRequest.clone().json()
    )
    const resetToken = readLatestEmailToken({
      email,
      pathname: '/reset-password',
      purpose: 'PASSWORD_RESET'
    })
    const resetIntent = await adminClient.query<{
      intentCount: number
      rawTokenStored: boolean
      selectorIsHex: boolean
    }>(
      `SELECT COUNT(*)::int AS "intentCount",
         COALESCE(bool_or("value" = $2 OR "tokenSelector" = $2), false)
           AS "rawTokenStored",
         COALESCE(bool_and("tokenSelector" ~ '^[0-9a-f]{64}$'), false)
           AS "selectorIsHex"
       FROM "Verification"
       WHERE "purpose" = 'PASSWORD_RESET_V1' AND "resetUserId" = $1`,
      [userId, resetToken]
    )
    expect(resetIntent.rows).toEqual([
      { intentCount: 1, rawTokenStored: false, selectorIsHex: true }
    ])

    const alias = await postAuth(
      `/api/auth/reset-password?token=${encodeURIComponent(resetToken)}`,
      { newPassword, token: resetToken }
    )
    expect(alias.status).toBe(400)
    const invalidToken = await postAuth('/api/auth/reset-password', {
      newPassword,
      token: `${resetToken}invalid`
    })
    expect(invalidToken.status).toBe(400)
    expect(
      (
        await adminClient.query<{ count: number }>(
          `SELECT COUNT(*)::int AS count FROM "Session"
           WHERE "userId" = $1`,
          [userId]
        )
      ).rows
    ).toEqual([{ count: 1 }])

    const reset = await postAuth('/api/auth/reset-password', {
      newPassword,
      token: resetToken
    })
    expect(reset.status).toBe(200)
    expectExpiredSessionCookies(reset)
    const resetState = await adminClient.query<{
      activeFamilyCount: number
      authorityGeneration: number
      resetIntentCount: number
      sessionCount: number
    }>(
      `SELECT target_user."authorityGeneration",
         (SELECT COUNT(*)::int FROM "Session"
          WHERE "userId" = target_user."id") AS "sessionCount",
         (SELECT COUNT(*)::int FROM "AuthSessionFamily"
          WHERE "userId" = target_user."id" AND "status" = 'ACTIVE')
           AS "activeFamilyCount",
         (SELECT COUNT(*)::int FROM "Verification"
          WHERE "resetUserId" = target_user."id"
            AND "purpose" = 'PASSWORD_RESET_V1') AS "resetIntentCount"
       FROM "User" AS target_user WHERE target_user."id" = $1`,
      [userId]
    )
    expect(resetState.rows).toEqual([
      {
        activeFamilyCount: 0,
        authorityGeneration: 2,
        resetIntentCount: 0,
        sessionCount: 0
      }
    ])
    const oldPrincipal = await app.request('/api/v1/me', {
      headers: { Cookie: oldCookie }
    })
    expect(await oldPrincipal.json()).toEqual({ kind: 'GUEST' })
    const oldPasswordSignIn = await postAuth('/api/auth/sign-in/email', {
      email,
      password: oldPassword
    })
    expect(oldPasswordSignIn.status).toBe(401)
    const newPasswordSignIn = await postAuth('/api/auth/sign-in/email', {
      email,
      password: newPassword
    })
    expect(newPasswordSignIn.status).toBe(200)
    const newCookie = requireSessionCookie(newPasswordSignIn)
    const signedOut = await postAuth('/api/auth/sign-out', {}, newCookie)
    expect(signedOut.status).toBe(200)
    expectExpiredSessionCookies(signedOut)
  }, 60_000)
})

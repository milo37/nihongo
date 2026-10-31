import { createHash } from 'node:crypto'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApiApp } from './createApp.js'
import {
  createPhase7SsoIdentityFixture,
  createPhase7SsoSessionFixture
} from '../db/fixtures/phase7SsoSession.js'
import { createAuthGateway } from '../auth/authGateway.js'
import { createSsoIdentityRepository } from '../auth/ssoIdentityRepository.js'
import { createSsoPublicRuntime } from '../auth/ssoPublicRuntime.js'
import { createSsoTransactionStore } from '../auth/ssoTransactionRepository.js'
import type { SsoVerifiedIdentity } from '../auth/ssoProtocol.js'
import { createAuthEmailDispatcher } from '../auth/emailDispatcher.js'
import { InMemoryAuthEmailPort } from '../auth/emailPort.js'
import { createGuestPrincipalService } from '../auth/guestPrincipalService.js'
import { createPhase7AuthFacade } from '../auth/authFacade.js'
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
let verifiedProviderIdentity: SsoVerifiedIdentity | null = null
let beforeSsoIssue: (() => Promise<void>) | undefined
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

const ssoOwner: Parameters<typeof createPhase7SsoSessionFixture>[0]['owner'] = {
  $queryRawUnsafe: async <T>(sql: string, ...values: unknown[]) =>
    (await adminClient.query(sql, values)).rows as T
}
const createSsoSession = async () =>
  await createPhase7SsoSessionFixture({
    owner: ssoOwner,
    gateway: authGatewayRuntime.client,
    secret: environment.BETTER_AUTH_SECRET,
    role: 'USER'
  })

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
  account: number
  user: number
  verification: number
  audit: number
  family: number
  question: number
  rateLimit: number
  report: number
  review: number
  session: number
}> => {
  const result = await adminClient.query<{
    account: number
    user: number
    verification: number
    audit: number
    family: number
    question: number
    rateLimit: number
    report: number
    review: number
    session: number
  }>(
    `SELECT
       (SELECT COUNT(*)::int FROM "Account") AS account,
       (SELECT COUNT(*)::int FROM "User") AS "user",
       (SELECT COUNT(*)::int FROM "Verification") AS verification,
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
  callback,
  userId
}: {
  callback: () => Promise<Response>
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
    signIn = callback()
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
        ssoRuntime: createSsoPublicRuntime({
          environment,
          providers: {
            google: {
              authorizationURL: async ({ state, nonce, codeVerifier }) => {
                const url = new URL(
                  'https://accounts.google.com/o/oauth2/v2/auth'
                )
                url.search = new URLSearchParams({
                  state,
                  nonce,
                  code_challenge_method: 'S256',
                  code_challenge: createHash('sha256')
                    .update(codeVerifier)
                    .digest('base64url')
                }).toString()
                return url.href
              },
              exchange: async () => verifiedProviderIdentity
            }
          },
          store: createSsoTransactionStore(authGatewayRuntime.client),
          identities: createSsoIdentityRepository(
            new Proxy(authGatewayRuntime.client, {
              get(target, key) {
                if (key === '$queryRawUnsafe')
                  return async (sql: string, ...values: unknown[]) => {
                    const rows = await target.$queryRawUnsafe(sql, ...values)
                    if (
                      sql.includes('"phase7_resolve_sso_identity"') &&
                      beforeSsoIssue
                    )
                      await beforeSsoIssue()
                    return rows
                  }
                return Reflect.get(target, key)
              }
            })
          )
        }),
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
    ),
    questionReadSecurity: {
      environment,
      rateLimiter
    }
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

  it.each([
    '/api/auth/sign-up/email',
    '/api/auth/sign-in/email',
    '/api/auth/verify-email',
    '/api/auth/send-verification-email',
    '/api/auth/change-password',
    '/api/auth/request-password-reset',
    '/api/auth/reset-password',
    '/api/auth/set-password'
  ])(
    'retired credential route %s rejects without cookies, mail or writes',
    async (path) => {
      const before = await readWriteCounts()
      const mailCount = emailPort.messages.length
      for (const [pathname, body, cookie] of [
        [
          path,
          { email: 'retired@example.test', password: 'retired-password' },
          undefined
        ],
        [
          `${path}?callbackURL=%2Fadmin`,
          { token: 'retired-token', newPassword: 'retired-password' },
          undefined
        ],
        [
          path,
          { unexpected: true },
          'nihongo.session_token=retired-cookie; nihongo.session_token=duplicate'
        ]
      ] as const) {
        const response = await postAuth(pathname, body, cookie)
        expect(response.status).toBe(404)
        expect(await response.json()).toMatchObject({
          code: 'AUTH_ROUTE_NOT_FOUND'
        })
        expect(response.headers.get('Set-Cookie')).toBeNull()
        expect(await readWriteCounts()).toEqual(before)
        expect(emailPort.messages).toHaveLength(mailCount)
        const logs = apiLogLines.join('\n')
        for (const value of [
          'retired@example.test',
          'retired-password',
          'retired-token',
          'retired-cookie'
        ]) {
          expect(logs).not.toContain(value)
        }
      }
    }
  )

  it('SSO authority captured before issuance cannot create a session after drift', async () => {
    const actor = await createPhase7SsoIdentityFixture({
      owner: ssoOwner,
      role: 'USER'
    })
    verifiedProviderIdentity = actor.identity
    let entered: () => void = () => undefined
    let release: () => void = () => undefined
    const observed = new Promise<void>((resolve) => {
      entered = resolve
    })
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    let callback: Promise<Response> | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    beforeSsoIssue = async () => {
      entered()
      await held
    }
    try {
      const start = await postAuth('/api/auth/sign-in/social', {
        provider: 'google',
        callbackURL: '/'
      })
      expect(start.status).toBe(200)
      const body = (await start.json()) as { url: string }
      const state = new URL(body.url).searchParams.get('state')
      const binding = start.headers
        .getSetCookie()
        .find((cookie) => cookie.startsWith('nihongo.sso_binding='))
        ?.split(';', 1)[0]
      if (!state || !binding)
        throw new Error('SSO callback binding fixture is unavailable.')
      callback = Promise.resolve(
        app.request(
          `/api/auth/callback/google?state=${encodeURIComponent(state)}&code=api-gate-code`,
          { headers: { Cookie: binding } }
        )
      )
      void callback.catch(() => undefined)
      await Promise.race([
        observed,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(new Error('SSO pre-issuance barrier was not observed.')),
            5000
          )
        })
      ])
      await updateAuthorityGenerationWithoutCleanup(actor.userId)
      beforeSsoIssue = undefined
      release()
      const response = await callback
      expect(response.status).toBe(303)
      expect(
        new URL(response.headers.get('Location')!).searchParams.get('sso')
      ).toBe('FAILED')
      expect(
        response.headers
          .getSetCookie()
          .some(
            (cookie) =>
              cookie.startsWith('nihongo.session_token=') ||
              cookie.startsWith('__Secure-nihongo.session_token=')
          )
      ).toBe(false)
      const facts = await adminClient.query<{
        sessions: number
        families: number
      }>(
        `SELECT (SELECT count(*)::int FROM "Session" WHERE "userId"=$1) AS sessions,(SELECT count(*)::int FROM "AuthSessionFamily" WHERE "userId"=$1) AS families`,
        [actor.userId]
      )
      expect(facts.rows).toEqual([{ sessions: 0, families: 0 }])
    } finally {
      beforeSsoIssue = undefined
      release()
      if (timer) clearTimeout(timer)
      await callback?.catch(() => undefined)
      verifiedProviderIdentity = null
    }
  }, 15_000)

  it('SSO authority drift during issuance refuses a cookie and compensates the inserted session', async () => {
    const actor = await createPhase7SsoIdentityFixture({
      owner: ssoOwner,
      role: 'USER'
    })
    verifiedProviderIdentity = actor.identity
    try {
      const start = await postAuth('/api/auth/sign-in/social', {
        provider: 'google',
        callbackURL: '/'
      })
      expect(start.status).toBe(200)
      const body = (await start.json()) as { url: string }
      const state = new URL(body.url).searchParams.get('state')
      const binding = start.headers
        .getSetCookie()
        .find((cookie) => cookie.startsWith('nihongo.sso_binding='))
        ?.split(';', 1)[0]
      if (!state || !binding)
        throw new Error('SSO callback binding fixture is unavailable.')
      const response = await exercisePostIssuerAuthorityDrift({
        userId: actor.userId,
        callback: async () =>
          await app.request(
            `/api/auth/callback/google?state=${encodeURIComponent(state)}&code=api-gate-code`,
            { headers: { Cookie: binding } }
          )
      })
      expect(response.status).toBe(303)
      const destination = new URL(response.headers.get('Location')!)
      expect(destination.pathname).toBe('/login')
      expect(destination.searchParams.get('sso')).toBe('FAILED')
      expect(
        response.headers
          .getSetCookie()
          .some(
            (cookie) =>
              cookie.startsWith('nihongo.session_token=') ||
              cookie.startsWith('__Secure-nihongo.session_token=')
          )
      ).toBe(false)
      const facts = await adminClient.query<{
        sessions: number
        active: number
        revoked: number
      }>(
        `SELECT (SELECT count(*)::int FROM "Session" WHERE "userId"=$1) AS sessions,(SELECT count(*)::int FROM "AuthSessionFamily" WHERE "userId"=$1 AND status='ACTIVE') AS active,(SELECT count(*)::int FROM "AuthSessionFamily" WHERE "userId"=$1 AND status='REVOKED') AS revoked`,
        [actor.userId]
      )
      expect(facts.rows).toEqual([{ sessions: 0, active: 0, revoked: 1 }])
    } finally {
      verifiedProviderIdentity = null
    }
  }, 30_000)

  it('SSO principal is valid and stale authority clears cookies with write0', async () => {
    const session = await createSsoSession()
    const principal = await app.request('/api/v1/me', {
      headers: { Cookie: session.cookie }
    })
    expect(principal.status).toBe(200)
    expect(await principal.json()).toMatchObject({
      kind: 'USER',
      user: { id: session.userId, role: 'USER' }
    })
    await updateAuthorityGenerationWithoutCleanup(session.userId)
    const before = await readWriteCounts()
    const stale = await app.request('/api/v1/me', {
      headers: { Cookie: session.cookie }
    })
    expect(stale.status).toBe(200)
    expect(await stale.json()).toEqual({ kind: 'GUEST' })
    expectExpiredSessionCookies(stale)
    expect(await readWriteCounts()).toEqual(before)
  })

  it('SSO sign-out preserves strict body, duplicate-cookie rejection and revocation', async () => {
    const session = await createSsoSession()
    const alias = await postAuth(
      '/api/auth/sign-out?callbackURL=%2F',
      {},
      session.cookie
    )
    expect(alias.status).toBe(400)
    const unknownBody = await postAuth(
      '/api/auth/sign-out',
      { callbackURL: '/' },
      session.cookie
    )
    expect(unknownBody.status).toBe(400)
    const duplicate = await postAuth(
      '/api/auth/sign-out',
      {},
      `${session.cookie}; ${session.cookie}`
    )
    // Sign-out is idempotent for an invalid cookie: clear the client cookie
    // without using either ambiguous credential to revoke a server session.
    expect(duplicate.status).toBe(200)
    expect(await duplicate.json()).toEqual({ success: true })
    expectExpiredSessionCookies(duplicate)
    const before = await adminClient.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM "Session" WHERE "userId"=$1',
      [session.userId]
    )
    expect(before.rows).toEqual([{ count: 1 }])
    expect(
      (
        await adminClient.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM "AuthSessionFamily" WHERE "userId"=$1 AND status='ACTIVE'`,
          [session.userId]
        )
      ).rows
    ).toEqual([{ count: 1 }])
    const signedOut = await postAuth('/api/auth/sign-out', {}, session.cookie)
    expect(signedOut.status).toBe(200)
    expectExpiredSessionCookies(signedOut)
    const rows = await adminClient.query<{
      sessions: number
      families: number
    }>(
      `SELECT (SELECT count(*)::int FROM "Session" WHERE "userId"=$1) AS sessions,(SELECT count(*)::int FROM "AuthSessionFamily" WHERE "userId"=$1 AND status='ACTIVE') AS families`,
      [session.userId]
    )
    expect(rows.rows).toEqual([{ sessions: 0, families: 0 }])
    const beforeGuest = await readWriteCounts()
    const principal = await app.request('/api/v1/me', {
      headers: { Cookie: session.cookie }
    })
    expect(await principal.json()).toEqual({ kind: 'GUEST' })
    expect(await readWriteCounts()).toEqual(beforeGuest)
  })
})

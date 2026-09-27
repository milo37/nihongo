import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  reauthenticateAdminErrorSchema,
  reauthenticateAdminResponseSchema
} from '@nihongo/contracts/admin/phase7'
import { hashPassword } from 'better-auth/crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Client } from 'pg'
import { createAdminReauthenticationService } from '../admin/adminReauthenticationService.js'
import type { AdminQuestionReader } from '../admin/adminQuestionService.js'
import type { AdminReadRateLimiter } from '../admin/adminReadRateLimiter.js'
import { createApiApp } from '../app/createApp.js'
import { createPhase7ReauthenticationAuthApi } from '../auth/createPhase7ReauthenticationAuth.js'
import { createGuestPrincipalService } from '../auth/guestPrincipalService.js'
import {
  createPhase7PrincipalService,
  type PrincipalService
} from '../auth/principalService.js'
import { createPhase7ReauthenticationContext } from '../auth/phase7ReauthenticationContext.js'
import { createPhase7SessionCookie } from '../auth/phase7SessionCookie.js'
import { parseApiEnvironment } from '../config/env.js'
import { createJsonLogger } from '../observability/logger.js'
import type { PrismaClient } from '../generated/prisma/client.js'
import type { QuestionReader } from '../question/questionService.js'
import { createRoleDatabaseRuntime } from './database.js'
import {
  createPostgresStartupOptions,
  getPostgresSchema
} from './databaseOptions.js'
import { stopOwnedProcesses } from '../e2e/ownedProcessGroup.js'

const password = 'Phase7-real-reauthentication-2026!'
const environment = parseApiEnvironment(process.env)
const schema = getPostgresSchema(environment.DATABASE_URL)
const adminDatabaseUrl = process.env.PHASE7_ADMIN_DATABASE_URL
const authGatewayDatabaseUrl = environment.AUTH_GATEWAY_DATABASE_URL
if (!schema || !adminDatabaseUrl || !authGatewayDatabaseUrl) {
  throw new Error('Phase 7 reauthentication service DB URLs are required.')
}

const adminUrl = new URL(adminDatabaseUrl)
adminUrl.searchParams.delete('schema')
adminUrl.searchParams.delete('options')
const adminClient = new Client({
  connectionString: adminUrl.toString(),
  options: createPostgresStartupOptions(schema)
})
const gatewayRuntime = createRoleDatabaseRuntime(
  authGatewayDatabaseUrl,
  'nihongo_auth_gateway'
)
const applicationRuntime = createRoleDatabaseRuntime(
  environment.DATABASE_URL,
  'nihongo_app'
)
const gatewayUrl = new URL(authGatewayDatabaseUrl)
gatewayUrl.searchParams.delete('schema')
gatewayUrl.searchParams.delete('options')
const createGatewayClient = (): Client =>
  new Client({
    connectionString: gatewayUrl.toString(),
    options: createPostgresStartupOptions(schema, 'nihongo_auth_gateway')
  })
const gatewayClientA = createGatewayClient()
const gatewayClientB = createGatewayClient()

const withRole = async <Result>(
  role: 'nihongo_auth_gateway' | 'nihongo_phase7_migration',
  action: () => Promise<Result>
): Promise<Result> => {
  await adminClient.query(`SET ROLE "${role}"`)
  try {
    return await action()
  } finally {
    await adminClient.query('RESET ROLE')
  }
}

const insertCredentialAdmin = async (
  userId: string,
  accountId: string,
  email: string,
  passwordHash: string
): Promise<void> => {
  await adminClient.query('BEGIN')
  try {
    await adminClient.query(
      `INSERT INTO "User" (
         "id", "name", "email", "emailVerified", "role",
         "accountStatus", "createdAt", "updatedAt"
       ) VALUES (
         $1, 'Phase 7 real reauthentication', $2, true, 'ADMIN',
         'ACTIVE', clock_timestamp(), clock_timestamp()
       )`,
      [userId, email]
    )
    await adminClient.query(
      `INSERT INTO "Account" (
         "id", "accountId", "providerId", "userId", "password",
         "createdAt", "updatedAt"
       ) VALUES (
         $1, $2::uuid::text, 'credential', $2, $3,
         clock_timestamp(), clock_timestamp()
       )`,
      [accountId, userId, passwordHash]
    )
    await adminClient.query('COMMIT')
  } catch (error: unknown) {
    await adminClient.query('ROLLBACK')
    throw error
  }
}

const issueSession = async (
  userId: string,
  sessionId: string,
  token: string
): Promise<{ expiresAt: Date; familyId: string }> => {
  const result = await withRole('nihongo_auth_gateway', () =>
    adminClient.query<{ expiresAt: Date; familyId: string }>(
      `SELECT * FROM "phase7_issue_v1_session"(
        $1, 1, 'ADMIN', 'ACTIVE', $2, $3,
        '127.0.0.1', 'phase7-real-reauthentication', false
      )`,
      [userId, sessionId, token]
    )
  )
  const row = result.rows[0]
  if (!row) throw new Error('Phase 7 real Session was not issued.')
  return row
}

const createFixture = async () => {
  const userId = randomUUID()
  const sessionId = randomUUID()
  const accountId = randomUUID()
  const requestId = randomUUID()
  const token = `phase7-real-old-${randomUUID()}`
  const email = `phase7-real-${randomUUID()}@example.test`
  const passwordHash = await hashPassword(password)
  await insertCredentialAdmin(userId, accountId, email, passwordHash)
  const session = await issueSession(userId, sessionId, token)
  const cookie = createPhase7SessionCookie({
    expiresAt: session.expiresAt,
    isProduction: false,
    rememberMe: false,
    secret: environment.BETTER_AUTH_SECRET,
    token
  })
  const headers = new Headers({
    Cookie: cookie.split(';')[0]!,
    Origin: environment.TRUSTED_ORIGINS[0]!,
    'X-Request-Id': requestId,
    'User-Agent': 'phase7-real-reauthentication'
  })
  return {
    email,
    familyId: session.familyId,
    headers,
    passwordHash,
    requestId,
    sessionId,
    token,
    userId
  }
}

const makeSessionStaleForTesting = async (sessionId: string) => {
  await adminClient.query('BEGIN')
  try {
    await adminClient.query('SET LOCAL session_replication_role = replica')
    const result = await adminClient.query(
      `UPDATE "Session"
       SET "createdAt" = "createdAt" - INTERVAL '10 minutes',
           "updatedAt" = "updatedAt" - INTERVAL '10 minutes',
           "expiresAt" = "expiresAt" - INTERVAL '10 minutes'
       WHERE "id" = $1`,
      [sessionId]
    )
    await adminClient.query('COMMIT')
    return result.rowCount
  } catch (error: unknown) {
    await adminClient.query('ROLLBACK')
    throw error
  }
}

const prepareAndStage = async (
  fixture: Awaited<ReturnType<typeof createFixture>>
) => {
  const intentId = randomUUID()
  const requestId = randomUUID()
  const newSessionId = randomUUID()
  const newToken = `phase7-real-new-${randomUUID()}`
  const prepared = await gatewayClientA.query<{ intentId: string }>(
    `SELECT * FROM "phase7_prepare_reauthentication"(
      $1, $2, $3, 'TEST', $4
    )`,
    [fixture.token, fixture.userId, requestId, intentId]
  )
  expect(prepared.rows).toEqual([expect.objectContaining({ intentId })])
  const staged = await gatewayClientA.query<{ id: string }>(
    `SELECT * FROM "phase7_stage_reauthentication_session"(
      $1, $2, $3, $4, clock_timestamp() + INTERVAL '1 day',
      '127.0.0.1', 'phase7-concurrency'
    )`,
    [intentId, newSessionId, newToken, fixture.userId]
  )
  expect(staged.rows).toEqual([expect.objectContaining({ id: newSessionId })])
  return { intentId, newSessionId, newToken, requestId }
}

const spawnStagedCrashWorker = async (
  fixture: Awaited<ReturnType<typeof createFixture>>
) => {
  const intentId = randomUUID()
  const requestId = randomUUID()
  const newSessionId = randomUUID()
  const newToken = `phase7-crash-new-${randomUUID()}`
  const prepareSql = JSON.stringify(
    `SELECT * FROM "phase7_prepare_reauthentication"($1, $2, $3, 'TEST', $4)`
  )
  const stageSql = JSON.stringify(
    `SELECT * FROM "phase7_stage_reauthentication_session"(
      $1, $2, $3, $4, clock_timestamp() + INTERVAL '1 day',
      '127.0.0.1', 'phase7-crash-worker'
    )`
  )
  const script = `
    import pg from 'pg'
    const { Client } = pg
    process.on('SIGTERM', () => {})
    const url = new URL(process.env.PHASE7_CRASH_DATABASE_URL)
    url.searchParams.delete('schema')
    url.searchParams.delete('options')
    const client = new Client({
      connectionString: url.toString(),
      options: '-c search_path=' + process.env.PHASE7_CRASH_SCHEMA +
        ' -c TimeZone=UTC -c role=nihongo_auth_gateway'
    })
    await client.connect()
    await client.query(
      ${prepareSql},
      [
        process.env.PHASE7_CRASH_OLD_TOKEN,
        process.env.PHASE7_CRASH_USER_ID,
        process.env.PHASE7_CRASH_REQUEST_ID,
        process.env.PHASE7_CRASH_INTENT_ID
      ]
    )
    await client.query(
      ${stageSql},
      [
        process.env.PHASE7_CRASH_INTENT_ID,
        process.env.PHASE7_CRASH_SESSION_ID,
        process.env.PHASE7_CRASH_NEW_TOKEN,
        process.env.PHASE7_CRASH_USER_ID
      ]
    )
    process.stdout.write(JSON.stringify({ event: 'staged' }) + '\\n')
    setInterval(() => {}, 1_000)
  `
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
    cwd: process.cwd(),
    detached: true,
    env: {
      ...process.env,
      PHASE7_CRASH_DATABASE_URL: authGatewayDatabaseUrl,
      PHASE7_CRASH_INTENT_ID: intentId,
      PHASE7_CRASH_NEW_TOKEN: newToken,
      PHASE7_CRASH_OLD_TOKEN: fixture.token,
      PHASE7_CRASH_REQUEST_ID: requestId,
      PHASE7_CRASH_SCHEMA: schema,
      PHASE7_CRASH_SESSION_ID: newSessionId,
      PHASE7_CRASH_USER_ID: fixture.userId
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  try {
    await new Promise<void>((resolve, reject) => {
      let stdout = ''
      let stderr = ''
      const timeout = setTimeout(() => {
        reject(new Error(`Crash worker did not stage in time: ${stderr}`))
      }, 10_000)
      timeout.unref()
      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString()
        if (
          stdout.split('\n').some((line) => line.includes('"event":"staged"'))
        ) {
          clearTimeout(timeout)
          resolve()
        }
      })
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString()
      })
      child.once('error', (error) => {
        clearTimeout(timeout)
        reject(error)
      })
      child.once('exit', (code, signal) => {
        clearTimeout(timeout)
        reject(
          new Error(
            `Crash worker exited before staging: code=${String(code)} signal=${String(signal)} ${stderr}`
          )
        )
      })
    })
  } catch (error: unknown) {
    await stopOwnedProcesses([{ child, label: 'phase7-crash-worker' }], {
      forceKillTimeoutMs: 2_000,
      gracefulTimeoutMs: 50
    }).catch(() => undefined)
    throw error
  }
  return { child, intentId, newSessionId }
}

const runStartupMaintenanceWorker = async (): Promise<void> => {
  const script = `
    import { createRoleDatabaseRuntime } from './src/db/database.ts'
    import { runPhase7ReauthenticationStartupMaintenance } from './src/auth/phase7ReauthenticationStartupMaintenance.ts'
    const databaseUrl = process.env.PHASE7_RESTART_DATABASE_URL
    if (!databaseUrl) throw new Error('Missing restart database URL.')
    const runtime = createRoleDatabaseRuntime(databaseUrl, 'nihongo_auth_gateway')
    try {
      await runPhase7ReauthenticationStartupMaintenance(runtime.client)
      process.stdout.write(JSON.stringify({ event: 'startup-maintenance-complete' }) + '\\n')
    } finally {
      await runtime.disconnect()
    }
  `
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '-e', script],
    {
      cwd: process.cwd(),
      detached: true,
      env: {
        ...process.env,
        PHASE7_RESTART_DATABASE_URL: authGatewayDatabaseUrl
      },
      stdio: ['ignore', 'pipe', 'pipe']
    }
  )
  try {
    await new Promise<void>((resolve, reject) => {
      let stdout = ''
      let stderr = ''
      const timeout = setTimeout(() => {
        reject(new Error(`Startup maintenance worker timed out: ${stderr}`))
      }, 20_000)
      timeout.unref()
      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString()
      })
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString()
      })
      child.once('error', (error) => {
        clearTimeout(timeout)
        reject(error)
      })
      child.once('exit', (code, signal) => {
        clearTimeout(timeout)
        if (
          code === 0 &&
          signal === null &&
          stdout.includes('"event":"startup-maintenance-complete"')
        ) {
          resolve()
          return
        }
        reject(
          new Error(
            `Startup maintenance worker failed: code=${String(code)} signal=${String(signal)} ${stderr}`
          )
        )
      })
    })
  } catch (error: unknown) {
    await stopOwnedProcesses(
      [{ child, label: 'phase7-startup-maintenance-worker' }],
      { forceKillTimeoutMs: 2_000, gracefulTimeoutMs: 250 }
    ).catch(() => undefined)
    throw error
  }
}

const createService = (
  observeBetterAuthCookies?: (cookies: readonly string[]) => void
) => {
  const context = createPhase7ReauthenticationContext()
  const realAuthApi = createPhase7ReauthenticationAuthApi({
    client: gatewayRuntime.client,
    context,
    environment
  })
  return createAdminReauthenticationService({
    auditEnvironment: 'TEST',
    authApi: {
      verifyPassword: async (input) => await realAuthApi.verifyPassword(input),
      signInEmail: async (input) => {
        const result = await realAuthApi.signInEmail(input)
        observeBetterAuthCookies?.(result.headers.getSetCookie())
        return result
      }
    },
    client: gatewayRuntime.client,
    context
  })
}

const createTestHonoApp = ({
  principalService = createPhase7PrincipalService({
    client: applicationRuntime.client,
    isProduction: environment.NODE_ENV === 'production',
    refreshClient: gatewayRuntime.client,
    secret: environment.BETTER_AUTH_SECRET
  }),
  service
}: {
  principalService?: PrincipalService
  service: ReturnType<typeof createService>
}) => {
  const reader: AdminQuestionReader = {
    diffVersion: async () => Promise.reject(new Error('not used')),
    getQuestion: async () => Promise.reject(new Error('not used')),
    listAuditLog: async () => Promise.reject(new Error('not used')),
    listQuestions: async () => Promise.reject(new Error('not used')),
    listReviews: async () => Promise.reject(new Error('not used')),
    listTags: async () => Promise.reject(new Error('not used')),
    listVersions: async () => Promise.reject(new Error('not used')),
    previewVersion: async () => Promise.reject(new Error('not used'))
  }
  const readRateLimiter: AdminReadRateLimiter = {
    consume: async () => undefined
  }
  const questionReader: QuestionReader = {
    getQuestion: async () => Promise.reject(new Error('not used')),
    listQuestions: async () => ({ items: [], page: 1, pageSize: 20, total: 0 })
  }

  return createApiApp({
    admin: {
      assertCapability: () => undefined,
      rateLimiter: readRateLimiter,
      reader,
      reauthentication: {
        rateLimiter: { consume: async () => undefined },
        service
      }
    },
    auth: {
      environment,
      gateway: {
        handle: async () => new Response(null, { status: 404 })
      },
      guestPrincipalService: createGuestPrincipalService({
        client: applicationRuntime.client,
        secret: environment.GUEST_COOKIE_SECRET
      }),
      principalService
    },
    checkReadiness: async () => undefined,
    logger: createJsonLogger('silent'),
    questionReader
  })
}

const readWriteSnapshot = async () =>
  (
    await adminClient.query<{
      auditCount: number
      fenceCount: number
      intentCount: number
      rateLimitCount: number
      sessionCount: number
      trustedExecutionCount: number
    }>(
      `SELECT
         (SELECT COUNT(*)::int FROM "Session") AS "sessionCount",
         (SELECT COUNT(*)::int FROM "Phase7ReauthenticationIntent")
           AS "intentCount",
         (SELECT COUNT(*)::int FROM "AuthSessionRotationFence")
           AS "fenceCount",
         (SELECT COUNT(*)::int FROM "AdminAuditLog") AS "auditCount",
         (SELECT COUNT(*)::int FROM "RateLimit") AS "rateLimitCount",
         (SELECT COUNT(*)::int FROM "Phase7TrustedExecution")
           AS "trustedExecutionCount"`
    )
  ).rows[0]

beforeAll(async () => {
  await adminClient.connect()
  await Promise.all([gatewayClientA.connect(), gatewayClientB.connect()])
  const endpoint = await adminClient.query<{
    databaseName: string
    serverAddress: string
    serverPort: number
  }>(
    `SELECT current_database() AS "databaseName",
       inet_server_addr()::text AS "serverAddress",
       inet_server_port() AS "serverPort"`
  )
  const target = endpoint.rows[0]
  if (!target) throw new Error('Phase 7 DB endpoint is unavailable.')
  await withRole('nihongo_phase7_migration', () =>
    adminClient.query(
      `SELECT "phase7_register_database_capability"(
        $1, $2::inet, $3, 'TEST'
      )`,
      [target.databaseName, target.serverAddress, target.serverPort]
    )
  )
})

afterAll(async () => {
  await Promise.all([gatewayClientA.end(), gatewayClientB.end()])
  await Promise.all([
    applicationRuntime.disconnect(),
    gatewayRuntime.disconnect()
  ])
  await adminClient.end()
})

describe('Phase 7 real Better Auth reauthentication service', () => {
  it('real Hono가 Better Auth cookie bytes/order를 보존해 exact active replacement만 공개한다', async () => {
    const fixture = await createFixture()
    expect(await makeSessionStaleForTesting(fixture.sessionId)).toBe(1)
    let betterAuthCookies: readonly string[] = []
    const app = createTestHonoApp({
      service: createService((cookies) => {
        betterAuthCookies = cookies
      })
    })
    const headers = new Headers(fixture.headers)
    headers.set('Content-Type', 'application/json')
    const response = await app.request(
      'http://localhost:3001/api/v1/admin/reauthentication',
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ password })
      }
    )
    expect(response.status).toBe(200)
    const output = reauthenticateAdminResponseSchema.parse(
      await response.json()
    )
    const responseCookies = response.headers.getSetCookie()

    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(responseCookies).toEqual(betterAuthCookies)
    expect(responseCookies).toHaveLength(2)
    expect(responseCookies[0]).toContain('.session_token=')
    expect(responseCookies[1]).toContain('.dont_remember=')
    expect(new Date(output.assuranceExpiresAt).getTime()).toBe(
      new Date(output.reauthenticatedAt).getTime() + 5 * 60_000
    )

    const proof = await adminClient.query<{
      auditBeforeState: string
      auditCount: number
      fenceCount: number
      intentState: string
      oldSessionCount: number
      replacementCount: number
    }>(
      `SELECT
         (SELECT COUNT(*)::int FROM "Session" WHERE "id" = $1)
           AS "oldSessionCount",
         (SELECT COUNT(*)::int
          FROM "Phase7ReauthenticationIntent" AS intent
          JOIN "Session" AS session ON session."id" = intent."stagedSessionId"
          WHERE intent."requestId" = $2
            AND intent."state" = 'FINALIZED'
            AND session."authorizationState" = 'ACTIVE')
           AS "replacementCount",
         (SELECT "state"::text FROM "Phase7ReauthenticationIntent"
          WHERE "requestId" = $2) AS "intentState",
         (SELECT COUNT(*)::int FROM "AuthSessionRotationFence" AS fence
          JOIN "Phase7ReauthenticationIntent" AS intent
            ON intent."operationId" = fence."operationId"
          WHERE intent."requestId" = $2) AS "fenceCount",
         (SELECT COUNT(*)::int FROM "AdminAuditLog"
          WHERE "requestId" = $2 AND "command" = 'REAUTHENTICATION')
           AS "auditCount",
         (SELECT "beforeState" FROM "AdminAuditLog"
          WHERE "requestId" = $2 AND "command" = 'REAUTHENTICATION')
           AS "auditBeforeState"`,
      [fixture.sessionId, fixture.requestId]
    )
    expect(proof.rows).toEqual([
      {
        auditBeforeState: 'SESSION_STALE',
        auditCount: 1,
        fenceCount: 1,
        intentState: 'FINALIZED',
        oldSessionCount: 0,
        replacementCount: 1
      }
    ])
  })

  it('real invalid password는 pending·audit·fence·cookie 없이 old ACTIVE만 보존한다', async () => {
    const fixture = await createFixture()
    const app = createTestHonoApp({ service: createService() })
    const headers = new Headers(fixture.headers)
    headers.set('Content-Type', 'application/json')
    const response = await app.request(
      'http://localhost:3001/api/v1/admin/reauthentication',
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ password: `${password}-wrong` })
      }
    )
    expect(response.status).toBe(401)
    expect(
      reauthenticateAdminErrorSchema.parse(await response.json())
    ).toMatchObject({
      code: 'REAUTHENTICATION_FAILED',
      retryable: false
    })
    expect(response.headers.getSetCookie()).toHaveLength(0)

    const proof = await adminClient.query<{
      auditCount: number
      fenceCount: number
      intentCount: number
      oldActiveCount: number
    }>(
      `SELECT
         (SELECT COUNT(*)::int FROM "Session"
          WHERE "id" = $1 AND "authorizationState" = 'ACTIVE')
           AS "oldActiveCount",
         (SELECT COUNT(*)::int FROM "Phase7ReauthenticationIntent"
          WHERE "requestId" = $2) AS "intentCount",
         (SELECT COUNT(*)::int FROM "AuthSessionRotationFence" AS fence
          JOIN "Phase7ReauthenticationIntent" AS intent
            ON intent."operationId" = fence."operationId"
          WHERE intent."requestId" = $2) AS "fenceCount",
         (SELECT COUNT(*)::int FROM "AdminAuditLog"
          WHERE "requestId" = $2 AND "command" = 'REAUTHENTICATION')
           AS "auditCount"`,
      [fixture.sessionId, fixture.requestId]
    )
    expect(proof.rows).toEqual([
      {
        auditCount: 0,
        fenceCount: 0,
        intentCount: 0,
        oldActiveCount: 1
      }
    ])
  })

  it('production guard/Hono는 logout·role-loss·classifier fault를 exact 401/403/503과 write 0으로 매핑한다', async () => {
    const post = async (
      fixture: Awaited<ReturnType<typeof createFixture>>,
      principalService?: PrincipalService
    ) => {
      const service = createService()
      const reauthenticate = vi.spyOn(service, 'reauthenticate')
      const app = createTestHonoApp({
        ...(principalService ? { principalService } : {}),
        service
      })
      const headers = new Headers(fixture.headers)
      headers.set('Content-Type', 'application/json')
      const before = await readWriteSnapshot()
      const response = await app.request(
        'http://localhost:3001/api/v1/admin/reauthentication',
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ password })
        }
      )
      const after = await readWriteSnapshot()
      expect(after).toEqual(before)
      expect(reauthenticate).not.toHaveBeenCalled()
      return response
    }

    const logoutTarget = await createFixture()
    await gatewayClientA.query(`SELECT "phase7_owned_sign_out"($1)`, [
      logoutTarget.token
    ])
    const logoutResponse = await post(logoutTarget)
    expect(logoutResponse.status).toBe(401)
    expect(
      reauthenticateAdminErrorSchema.parse(await logoutResponse.json())
    ).toMatchObject({
      code: 'AUTH_SESSION_EXPIRED',
      requestId: logoutTarget.requestId,
      retryable: false
    })
    expect(logoutResponse.headers.getSetCookie()).toHaveLength(2)
    expect(
      logoutResponse.headers
        .getSetCookie()
        .every((cookie) => cookie.includes('Max-Age=0'))
    ).toBe(true)

    const roleTarget = await createFixture()
    const operator = await createFixture()
    await gatewayClientA.query(
      `SELECT "phase7_change_user_authority"(
        $1, $2, 1, 'USER', 'ACTIVE', 'TEST'
      )`,
      [operator.token, roleTarget.userId]
    )
    const roleResponse = await post(roleTarget)
    expect(roleResponse.status).toBe(403)
    expect(
      reauthenticateAdminErrorSchema.parse(await roleResponse.json())
    ).toMatchObject({
      code: 'ADMIN_REQUIRED',
      requestId: roleTarget.requestId,
      retryable: false
    })
    expect(roleResponse.headers.getSetCookie()).toHaveLength(2)
    expect(
      roleResponse.headers
        .getSetCookie()
        .every((cookie) => cookie.includes('Max-Age=0'))
    ).toBe(true)

    const classifierTarget = await createFixture()
    await gatewayClientA.query(`SELECT "phase7_owned_sign_out"($1)`, [
      classifierTarget.token
    ])
    const classifierFailureQuery = async <QueryResult>(
      query: string,
      ...values: unknown[]
    ): Promise<QueryResult> => {
      if (query.includes('phase7_classify_admin_authority')) {
        throw new Error('injected classifier failure')
      }
      return await applicationRuntime.client.$queryRawUnsafe<QueryResult>(
        query,
        ...values
      )
    }
    const classifierFailurePrincipal = createPhase7PrincipalService({
      client: {
        $queryRawUnsafe: classifierFailureQuery
      } as unknown as Pick<PrismaClient, '$queryRawUnsafe'>,
      isProduction: environment.NODE_ENV === 'production',
      refreshClient: gatewayRuntime.client,
      secret: environment.BETTER_AUTH_SECRET
    })
    const classifierResponse = await post(
      classifierTarget,
      classifierFailurePrincipal
    )
    expect(classifierResponse.status).toBe(503)
    expect(
      reauthenticateAdminErrorSchema.parse(await classifierResponse.json())
    ).toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      requestId: classifierTarget.requestId,
      retryable: false
    })
    expect(classifierResponse.headers.get('Retry-After')).toBe('5')
    expect(classifierResponse.headers.getSetCookie()).toHaveLength(0)
  })

  it('finalize와 logout/role-change 경합은 revoked authority 뒤 active Session 0으로 선형화된다', async () => {
    const logoutTarget = await createFixture()
    const logoutStage = await prepareAndStage(logoutTarget)
    const [logoutFinalize, logout] = await Promise.allSettled([
      gatewayClientA.query(
        `SELECT * FROM "phase7_finalize_reauthentication"($1, $2)`,
        [logoutStage.intentId, logoutStage.newToken]
      ),
      gatewayClientB.query(`SELECT "phase7_owned_sign_out"($1) AS result`, [
        logoutTarget.token
      ])
    ])
    expect(logout.status).toBe('fulfilled')
    if (logout.status === 'fulfilled') {
      expect(logout.value.rows).toEqual([{ result: true }])
    }
    if (logoutFinalize.status === 'rejected') {
      expect(['40001', '42501']).toContain(
        (logoutFinalize.reason as { code?: unknown }).code
      )
    }
    expect(
      (
        await adminClient.query<{
          activeCount: number
          familyStatus: string
          sessionCount: number
        }>(
          `SELECT family."status"::text AS "familyStatus",
             (SELECT COUNT(*)::int FROM "Session"
              WHERE "sessionFamilyId" = family."id") AS "sessionCount",
             (SELECT COUNT(*)::int FROM "Session"
              WHERE "sessionFamilyId" = family."id"
                AND "authorizationState" = 'ACTIVE') AS "activeCount"
           FROM "AuthSessionFamily" AS family WHERE family."id" = $1`,
          [logoutTarget.familyId]
        )
      ).rows
    ).toEqual([{ activeCount: 0, familyStatus: 'REVOKED', sessionCount: 0 }])

    const authorityTarget = await createFixture()
    const authorityStage = await prepareAndStage(authorityTarget)
    const operator = await createFixture()
    const [authorityFinalize, authorityChange] = await Promise.allSettled([
      gatewayClientA.query(
        `SELECT * FROM "phase7_finalize_reauthentication"($1, $2)`,
        [authorityStage.intentId, authorityStage.newToken]
      ),
      gatewayClientB.query(
        `SELECT "phase7_change_user_authority"(
          $1, $2, 1, 'USER', 'ACTIVE', 'TEST'
        ) AS generation`,
        [operator.token, authorityTarget.userId]
      )
    ])
    expect(authorityChange.status).toBe('fulfilled')
    if (authorityChange.status === 'fulfilled') {
      expect(authorityChange.value.rows).toEqual([{ generation: 2 }])
    }
    if (authorityFinalize.status === 'rejected') {
      expect(['40001', '42501']).toContain(
        (authorityFinalize.reason as { code?: unknown }).code
      )
    }
    expect(
      (
        await adminClient.query<{
          activeCount: number
          generation: number
          role: string
        }>(
          `SELECT target_user."authorityGeneration" AS generation,
             target_user."role"::text AS role,
             (SELECT COUNT(*)::int FROM "Session"
              WHERE "userId" = target_user."id"
                AND "authorizationState" = 'ACTIVE') AS "activeCount"
           FROM "User" AS target_user WHERE target_user."id" = $1`,
          [authorityTarget.userId]
        )
      ).rows
    ).toEqual([{ activeCount: 0, generation: 2, role: 'USER' }])
  })

  it('password change와 finalize 경합은 성공한 winner에 맞는 단일 안전 상태만 남긴다', async () => {
    const fixture = await createFixture()
    const staged = await prepareAndStage(fixture)
    const nextHash = await hashPassword(`${password}-next`)
    const [finalization, passwordChange] = await Promise.allSettled([
      gatewayClientA.query(
        `SELECT * FROM "phase7_finalize_reauthentication"($1, $2)`,
        [staged.intentId, staged.newToken]
      ),
      gatewayClientB.query<{ changed: boolean }>(
        `SELECT "phase7_change_password_v1"($1, $2, $3) AS changed`,
        [fixture.token, fixture.passwordHash, nextHash]
      )
    ])
    expect(passwordChange.status).toBe('fulfilled')
    if (passwordChange.status !== 'fulfilled') return
    const changed = passwordChange.value.rows[0]?.changed === true
    const state = await adminClient.query<{
      activeCount: number
      familyStatus: string
    }>(
      `SELECT family."status"::text AS "familyStatus",
         (SELECT COUNT(*)::int FROM "Session"
          WHERE "sessionFamilyId" = family."id"
            AND "authorizationState" = 'ACTIVE') AS "activeCount"
       FROM "AuthSessionFamily" AS family WHERE family."id" = $1`,
      [fixture.familyId]
    )
    if (changed) {
      expect(state.rows).toEqual([{ activeCount: 0, familyStatus: 'REVOKED' }])
      expect(finalization.status).toBe('rejected')
    } else {
      expect(finalization.status).toBe('fulfilled')
      expect(state.rows).toEqual([{ activeCount: 1, familyStatus: 'ACTIVE' }])
    }
  })

  it('password reset과 finalize 경합은 reset generation만 남기고 모든 Session을 닫는다', async () => {
    const fixture = await createFixture()
    const staged = await prepareAndStage(fixture)
    const resetToken = `phase7-reset-race-${randomUUID()}`
    const resetVerificationId = randomUUID()
    await expect(
      gatewayClientB.query<{ issued: boolean }>(
        `SELECT "phase7_request_password_reset"($1, $2, $3) AS issued`,
        [fixture.email, resetVerificationId, resetToken]
      )
    ).resolves.toMatchObject({ rows: [{ issued: true }] })
    const nextHash = await hashPassword(`${password}-reset`)
    const adminBackend = await adminClient.query<{ pid: number }>(
      `SELECT pg_backend_pid() AS pid`
    )
    const gatewayBackendA = await gatewayClientA.query<{ pid: number }>(
      `SELECT pg_backend_pid() AS pid`
    )
    const gatewayBackendB = await gatewayClientB.query<{ pid: number }>(
      `SELECT pg_backend_pid() AS pid`
    )
    const adminPid = adminBackend.rows[0]?.pid
    const gatewayPids = [
      gatewayBackendA.rows[0]?.pid,
      gatewayBackendB.rows[0]?.pid
    ]
    if (
      adminPid === undefined ||
      gatewayPids.some((pid) => pid === undefined)
    ) {
      throw new Error('Phase 7 reset race backend pid is unavailable.')
    }

    const finalizationQuery = () =>
      gatewayClientA.query(
        `SELECT * FROM "phase7_finalize_reauthentication"($1, $2)`,
        [staged.intentId, staged.newToken]
      )
    const resetQuery = () =>
      gatewayClientB.query<{
        authorityGeneration: number
        userId: string
      }>(`SELECT * FROM "phase7_consume_password_reset"($1, $2)`, [
        resetToken,
        nextHash
      ])

    const runContendedRace = async () => {
      await adminClient.query('BEGIN')
      let finalizationPromise: ReturnType<typeof finalizationQuery> | undefined
      let resetPromise: ReturnType<typeof resetQuery> | undefined
      try {
        await adminClient.query(
          `SELECT 1 FROM "User" WHERE "id" = $1 FOR UPDATE`,
          [fixture.userId]
        )
        finalizationPromise = finalizationQuery()
        resetPromise = resetQuery()
        let bothBlocked = false
        for (let attempt = 0; attempt < 100; attempt += 1) {
          const waits = await adminClient.query<{
            blockerPids: number[]
            pid: number
            waitEventType: string | null
          }>(
            `SELECT activity.pid,
               pg_blocking_pids(activity.pid) AS "blockerPids",
               activity.wait_event_type AS "waitEventType"
             FROM pg_stat_activity AS activity
             WHERE activity.pid = ANY($1::int[])
             ORDER BY activity.pid`,
            [gatewayPids]
          )
          const allowedBlockers = new Set([adminPid, ...gatewayPids])
          bothBlocked =
            waits.rows.length === 2 &&
            waits.rows.every(
              (row) =>
                row.waitEventType === 'Lock' &&
                row.blockerPids.length > 0 &&
                row.blockerPids.every((pid) => allowedBlockers.has(pid))
            ) &&
            waits.rows.some((row) => row.blockerPids.includes(adminPid))
          if (bothBlocked) break
          await new Promise((resolve) => setTimeout(resolve, 20))
        }
        expect(bothBlocked).toBe(true)
        await adminClient.query('COMMIT')
        if (!finalizationPromise || !resetPromise) {
          throw new Error('Phase 7 reset race queries were not started.')
        }
        return await Promise.allSettled([finalizationPromise, resetPromise])
      } catch (error: unknown) {
        await adminClient.query('ROLLBACK').catch(() => undefined)
        await Promise.allSettled(
          [finalizationPromise, resetPromise].filter(
            (promise): promise is NonNullable<typeof promise> =>
              promise !== undefined
          )
        )
        throw error
      }
    }
    const [finalization, reset] = await runContendedRace()
    expect(reset.status).toBe('fulfilled')
    if (reset.status === 'fulfilled') {
      expect(reset.value.rows).toEqual([
        { authorityGeneration: 2, userId: fixture.userId }
      ])
    }
    if (finalization.status === 'rejected') {
      expect(['40001', '42501']).toContain(
        (finalization.reason as { code?: unknown }).code
      )
    }
    const proof = await adminClient.query<{
      activeFamilyCount: number
      auditCount: number
      authorityGeneration: number
      fenceCount: number
      intentState: string | null
      password: string
      sessionCount: number
      trustedExecutionCount: number
      verificationCount: number
    }>(
      `SELECT target_user."authorityGeneration",
         credential."password",
         (SELECT COUNT(*)::int FROM "Session"
          WHERE "userId" = target_user."id") AS "sessionCount",
         (SELECT COUNT(*)::int FROM "AuthSessionFamily"
          WHERE "userId" = target_user."id" AND "status" = 'ACTIVE')
           AS "activeFamilyCount",
         (SELECT COUNT(*)::int FROM "Verification"
          WHERE "resetUserId" = target_user."id") AS "verificationCount",
         (SELECT "state"::text FROM "Phase7ReauthenticationIntent"
          WHERE "id" = $2) AS "intentState",
         (SELECT COUNT(*)::int FROM "AuthSessionRotationFence"
          WHERE "operationId" = (
            SELECT "operationId" FROM "Phase7ReauthenticationIntent"
            WHERE "id" = $2
          )) AS "fenceCount",
         (SELECT COUNT(*)::int FROM "AdminAuditLog"
          WHERE "operationId" = (
            SELECT "operationId" FROM "Phase7ReauthenticationIntent"
            WHERE "id" = $2
          )) AS "auditCount",
         (SELECT COUNT(*)::int FROM "Phase7TrustedExecution")
           AS "trustedExecutionCount"
       FROM "User" AS target_user
       JOIN "Account" AS credential ON credential."userId" = target_user."id"
        AND credential."providerId" = 'credential'
       WHERE target_user."id" = $1`,
      [fixture.userId, staged.intentId]
    )
    expect(proof.rows).toEqual([
      {
        activeFamilyCount: 0,
        auditCount: finalization.status === 'fulfilled' ? 1 : 0,
        authorityGeneration: 2,
        fenceCount: finalization.status === 'fulfilled' ? 1 : 0,
        intentState:
          finalization.status === 'fulfilled' ? 'FINALIZED' : 'STAGED',
        password: nextHash,
        sessionCount: 0,
        trustedExecutionCount: 0,
        verificationCount: 0
      }
    ])
    if (finalization.status === 'rejected') {
      await expect(
        gatewayClientA.query<{
          aborted: boolean
          outcome: string
        }>(`SELECT * FROM "phase7_abort_reauthentication_classified"($1, $2)`, [
          staged.intentId,
          fixture.token
        ])
      ).resolves.toMatchObject({
        rows: [{ aborted: true, outcome: 'AUTH_SESSION_EXPIRED' }]
      })
    }
  })

  it('staged child process를 SIGKILL한 뒤 새 startup maintenance가 orphan을 제거한다', async () => {
    const fixture = await createFixture()
    const staged = await spawnStagedCrashWorker(fixture)
    let forceKillCount = 0
    await stopOwnedProcesses(
      [{ child: staged.child, label: 'phase7-reauthentication-crash-worker' }],
      {
        forceKillTimeoutMs: 1_000,
        gracefulTimeoutMs: 50,
        onForceKill: () => {
          forceKillCount += 1
        }
      }
    )
    expect(forceKillCount).toBe(1)
    await adminClient.query(`SET session_replication_role = replica`)
    try {
      await adminClient.query(
        `UPDATE "Phase7ReauthenticationIntent"
         SET "createdAt" = clock_timestamp() - INTERVAL '4 minutes',
             "expiresAt" = clock_timestamp() - INTERVAL '1 minute'
         WHERE "id" = $1`,
        [staged.intentId]
      )
    } finally {
      await adminClient.query(`SET session_replication_role = origin`)
    }

    await runStartupMaintenanceWorker()
    expect(
      (
        await adminClient.query<{
          intentCount: number
          oldActiveCount: number
          pendingCount: number
        }>(
          `SELECT
             (SELECT COUNT(*)::int FROM "Phase7ReauthenticationIntent"
              WHERE "id" = $1) AS "intentCount",
             (SELECT COUNT(*)::int FROM "Session"
              WHERE "id" = $2 AND "authorizationState" = 'PENDING_REAUTH')
               AS "pendingCount",
             (SELECT COUNT(*)::int FROM "Session"
              WHERE "id" = $3 AND "authorizationState" = 'ACTIVE')
               AS "oldActiveCount"`,
          [staged.intentId, staged.newSessionId, fixture.sessionId]
        )
      ).rows
    ).toEqual([{ intentCount: 0, oldActiveCount: 1, pendingCount: 0 }])
  })
})

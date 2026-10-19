import { randomBytes, randomUUID } from 'node:crypto'
import { hashPassword } from 'better-auth/crypto'
import { Client } from 'pg'
import { createApiApp } from '../app/createApp.js'
import { createSsoAuthentication } from '../auth/createSsoAuthentication.js'
import { createGuestPrincipalService } from '../auth/guestPrincipalService.js'
import { createOwnedAuthReadiness } from '../auth/ownedAuthReadiness.js'
import { createGoogleSsoProvider } from '../auth/ssoGoogleProvider.js'
import type { SsoProvider } from '../auth/ssoProtocol.js'
import type { ApiEnvironment } from '../config/env.js'
import {
  createDatabaseRuntime,
  createRoleDatabaseRuntime
} from '../db/database.js'
import { assertSafeTestDatabase } from '../db/databaseTargetGuard.js'
import { createPracticeRuntimeGate } from '../lifecycle/practiceRuntimeGate.js'
import { createApplicationRateLimiter } from '../middleware/applicationRateLimiter.js'
import { createJsonLogger } from '../observability/logger.js'
import { createPrismaQuestionRepository } from '../question/questionRepository.js'
import { createQuestionService } from '../question/questionService.js'
import { createPrismaStudyDraftRepository } from '../study/studyDraftRepository.js'
import { createStudyDraftService } from '../study/studyDraftService.js'
import { createPrismaStudySessionRepository } from '../study/studySessionRepository.js'
import { createStudySessionService } from '../study/studySessionService.js'
import {
  createPostgresStartupOptions,
  getPostgresSchema
} from '../db/databaseOptions.js'

export interface Phase7BrowserCredentials {
  readonly email: string
  readonly name: string
  readonly password: string
  readonly userId: string
}

export interface Phase7BrowserFixture {
  readonly author: Phase7BrowserCredentials
  readonly insightsLearner: Phase7BrowserCredentials
  readonly journeyLearner: Phase7BrowserCredentials
  readonly learner: Phase7BrowserCredentials
  readonly reviewer: Phase7BrowserCredentials
}

interface Phase7BrowserDatabaseSnapshot {
  readonly account: number
  readonly audit: number
  readonly operationIntent: number
  readonly option: number
  readonly question: number
  readonly reauthenticationFinalized: number
  readonly reauthenticationIntent: number
  readonly report: number
  readonly review: number
  readonly rotationFence: number
  readonly user: number
  readonly version: number
  readonly versionTag: number
}

export interface Phase7BrowserFixtureDatabase {
  readonly ageFreshAssurance: (userId: string) => Promise<void>
  readonly assertRegisteredUser: (input: {
    readonly email: string
    readonly targetLevel: 'N1' | 'N2' | 'N3' | 'N4' | 'N5'
  }) => Promise<void>
  readonly assertExpectedLifecycleDelta: (
    before: Phase7BrowserDatabaseSnapshot
  ) => Promise<void>
  readonly disconnect: () => Promise<void>
  readonly snapshot: () => Promise<Phase7BrowserDatabaseSnapshot>
}

const createCredentials = (
  schemaName: string,
  actor: 'author' | 'insights' | 'journey' | 'learner' | 'reviewer',
  name: string
): Phase7BrowserCredentials => {
  const suffix = schemaName.slice('phase7_'.length, 'phase7_'.length + 12)
  return {
    email: `phase7-${actor}-${suffix}@example.test`,
    name,
    password: `Phase7-${actor}-${randomBytes(12).toString('base64url')}!9a`,
    userId: randomUUID()
  }
}

const createFixtureClient = (databaseUrl: string): Client => {
  const schemaName = getPostgresSchema(databaseUrl)
  if (!schemaName || !/^phase7_[a-f0-9]{32}_test$/u.test(schemaName)) {
    throw new Error('Phase 7 browser fixture schema is unsafe.')
  }
  const connectionUrl = new URL(databaseUrl)
  connectionUrl.searchParams.delete('schema')
  connectionUrl.searchParams.delete('options')
  return new Client({
    connectionString: connectionUrl.toString(),
    options: createPostgresStartupOptions(schemaName)
  })
}

const readSnapshot = async (
  client: Client
): Promise<Phase7BrowserDatabaseSnapshot> => {
  const result = await client.query<Phase7BrowserDatabaseSnapshot>(
    `SELECT
       (SELECT COUNT(*)::int FROM "User") AS "user",
       (SELECT COUNT(*)::int FROM "Account") AS "account",
       (SELECT COUNT(*)::int FROM "Question") AS "question",
       (SELECT COUNT(*)::int FROM "QuestionVersion") AS "version",
       (SELECT COUNT(*)::int FROM "QuestionOption") AS "option",
       (SELECT COUNT(*)::int FROM "QuestionVersionTag") AS "versionTag",
       (SELECT COUNT(*)::int FROM "ContentReview") AS "review",
       (SELECT COUNT(*)::int FROM "AdminAuditLog") AS "audit",
       (SELECT COUNT(*)::int FROM "AuthSessionRotationFence") AS "rotationFence",
       (SELECT COUNT(*)::int FROM "Phase7ReauthenticationIntent")
         AS "reauthenticationIntent",
       (SELECT COUNT(*)::int FROM "Phase7ReauthenticationIntent"
         WHERE "state" = 'FINALIZED') AS "reauthenticationFinalized",
       (SELECT COUNT(*)::int FROM "Phase7OperationIntent") AS "operationIntent",
       (SELECT COUNT(*)::int FROM "QuestionReport") AS "report"`
  )
  const snapshot = result.rows[0]
  if (!snapshot) {
    throw new Error('Phase 7 browser database snapshot is unavailable.')
  }
  return snapshot
}

const withFixtureClient = async <Result>(
  databaseUrl: string,
  operation: (client: Client) => Promise<Result>
): Promise<Result> => {
  const client = createFixtureClient(databaseUrl)
  await client.connect()
  try {
    return await operation(client)
  } finally {
    await client.end()
  }
}

const assertDelta = (
  before: Phase7BrowserDatabaseSnapshot,
  after: Phase7BrowserDatabaseSnapshot,
  key: keyof Phase7BrowserDatabaseSnapshot,
  expected: number
): void => {
  const actual = after[key] - before[key]
  if (actual !== expected) {
    throw new Error(
      `Phase 7 browser database delta mismatch for ${key}: expected ${expected}, received ${actual}.`
    )
  }
}

export const createPhase7BrowserFixture = async (
  databaseUrl: string
): Promise<{
  readonly database: Phase7BrowserFixtureDatabase
  readonly fixture: Phase7BrowserFixture
}> => {
  const schemaName = getPostgresSchema(databaseUrl)
  if (!schemaName) {
    throw new Error('Phase 7 browser fixture schema is missing.')
  }
  const client = createFixtureClient(databaseUrl)
  await client.connect()

  const fixture: Phase7BrowserFixture = {
    author: createCredentials(schemaName, 'author', 'Phase 7 작성 관리자'),
    insightsLearner: createCredentials(
      schemaName,
      'insights',
      'Phase 8 인사이트 학습자'
    ),
    journeyLearner: createCredentials(
      schemaName,
      'journey',
      'Phase 10 통합 학습자'
    ),
    learner: createCredentials(schemaName, 'learner', 'Phase 7 학습자'),
    reviewer: createCredentials(schemaName, 'reviewer', 'Phase 7 검수 관리자')
  }

  try {
    await client.query('BEGIN')
    for (const [credentials, role, targetLevel] of [
      [fixture.author, 'ADMIN', 'N3'],
      [fixture.reviewer, 'ADMIN', 'N3'],
      [fixture.learner, 'USER', 'N3'],
      [fixture.insightsLearner, 'USER', 'N2'],
      [fixture.journeyLearner, 'USER', 'N5']
    ] as const) {
      await client.query(
        `INSERT INTO "User" (
           "id", "name", "email", "emailVerified", "role", "targetLevel",
           "accountStatus", "authorityGeneration", "createdAt", "updatedAt"
         ) VALUES (
           $1::uuid, $2, $3, TRUE, $4::"UserRole", $5::"JlptLevel", 'ACTIVE', 1,
           clock_timestamp(), clock_timestamp()
         )`,
        [
          credentials.userId,
          credentials.name,
          credentials.email,
          role,
          targetLevel
        ]
      )
      await client.query(
        `INSERT INTO "Account" (
           "id", "accountId", "providerId", "userId", "password",
           "createdAt", "updatedAt"
         ) VALUES (
           $1::uuid, $2, 'credential', $3::uuid, $4,
           clock_timestamp(), clock_timestamp()
         )`,
        [
          randomUUID(),
          credentials.userId,
          credentials.userId,
          await hashPassword(credentials.password)
        ]
      )
    }
    await client.query('COMMIT')
  } catch (error: unknown) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    await client.end()
  }

  let disconnected = false
  const runWithFixtureClient = async <Result>(
    operation: (operationClient: Client) => Promise<Result>
  ): Promise<Result> => {
    if (disconnected) {
      throw new Error('Phase 7 browser fixture database is disconnected.')
    }
    return await withFixtureClient(databaseUrl, operation)
  }

  return {
    fixture,
    database: {
      ageFreshAssurance: async (userId): Promise<void> => {
        await runWithFixtureClient(async (operationClient) => {
          await operationClient.query('BEGIN')
          try {
            await operationClient.query(
              'SET LOCAL session_replication_role = replica'
            )
            const updated = await operationClient.query(
              `UPDATE "Session"
               SET "createdAt" = clock_timestamp() - INTERVAL '6 minutes'
               WHERE "userId" = $1::uuid
                 AND "issuerProtocolVersion" = 'PHASE7_V1'
                 AND "authorizationState" = 'ACTIVE'`,
              [userId]
            )
            if (updated.rowCount !== 1) {
              throw new Error(
                `Phase 7 fresh-assurance fixture expected one active session, received ${updated.rowCount ?? 0}.`
              )
            }
            await operationClient.query(
              'SET LOCAL session_replication_role = origin'
            )
            await operationClient.query('COMMIT')
          } catch (error: unknown) {
            await operationClient.query('ROLLBACK')
            throw error
          }
        })
      },
      assertRegisteredUser: async ({ email, targetLevel }): Promise<void> => {
        const result = await runWithFixtureClient(
          async (operationClient) =>
            await operationClient.query<{
              accountCount: number
              activeSessionCount: number
              emailVerified: boolean
              role: string
              targetLevel: string | null
            }>(
              `SELECT
               target_user."emailVerified",
               target_user."role"::text AS "role",
               target_user."targetLevel"::text AS "targetLevel",
               (SELECT COUNT(*)::int FROM "Account"
                WHERE "userId" = target_user."id"
                  AND "providerId" = 'credential') AS "accountCount",
               (SELECT COUNT(*)::int FROM "Session"
                WHERE "userId" = target_user."id"
                  AND "authorizationState" = 'ACTIVE'
                  AND "expiresAt" > clock_timestamp()) AS "activeSessionCount"
             FROM "User" AS target_user
             WHERE lower(target_user."email") = lower($1)`,
              [email]
            )
        )
        if (
          result.rowCount !== 1 ||
          result.rows[0]?.emailVerified !== true ||
          result.rows[0]?.role !== 'USER' ||
          result.rows[0]?.targetLevel !== targetLevel ||
          result.rows[0]?.accountCount !== 1 ||
          result.rows[0]?.activeSessionCount !== 1
        ) {
          throw new Error(
            'Phase 10 browser registration persistence contract failed.'
          )
        }
      },
      assertExpectedLifecycleDelta: async (before): Promise<void> => {
        const after = await runWithFixtureClient(readSnapshot)
        assertDelta(before, after, 'user', 0)
        assertDelta(before, after, 'account', 0)
        assertDelta(before, after, 'question', 2)
        assertDelta(before, after, 'version', 3)
        assertDelta(before, after, 'option', 12)
        assertDelta(before, after, 'versionTag', 3)
        assertDelta(before, after, 'review', 12)
        assertDelta(before, after, 'audit', 25)
        assertDelta(before, after, 'rotationFence', 1)
        assertDelta(before, after, 'reauthenticationIntent', 1)
        assertDelta(before, after, 'reauthenticationFinalized', 1)
        assertDelta(before, after, 'operationIntent', 0)
        assertDelta(before, after, 'report', 1)
      },
      disconnect: async (): Promise<void> => {
        disconnected = true
      },
      snapshot: async (): Promise<Phase7BrowserDatabaseSnapshot> =>
        await runWithFixtureClient(readSnapshot)
    }
  }
}

/** TEST-only DI; the caller owns provisioning, readiness, listener and browser. */
export const createPhase7SsoBrowserApiFixture = async ({
  databaseUrl,
  authGatewayDatabaseUrl,
  environment
}: {
  databaseUrl: string
  authGatewayDatabaseUrl: string
  environment: ApiEnvironment
}) => {
  if (
    environment.NODE_ENV !== 'test' ||
    environment.DEPLOYMENT_ENVIRONMENT !== 'TEST' ||
    environment.ADMIN_CMS_MODE !== 'disabled' ||
    environment.DATABASE_URL !== databaseUrl ||
    environment.AUTH_GATEWAY_DATABASE_URL !== authGatewayDatabaseUrl ||
    environment.GOOGLE_CLIENT_ID !== undefined ||
    environment.GOOGLE_CLIENT_SECRET !== undefined ||
    environment.APPLE_CLIENT_ID !== undefined ||
    environment.APPLE_CLIENT_SECRET !== undefined
  )
    throw new Error(
      'SSO browser API fixture requires its fixed TEST environment.'
    )

  const applicationTarget = new URL(databaseUrl)
  const gatewayTarget = new URL(authGatewayDatabaseUrl)
  const schema = getPostgresSchema(databaseUrl)
  for (const [value, login] of [
    [databaseUrl, 'nihongo_test_app_login'],
    [authGatewayDatabaseUrl, 'nihongo_test_auth_gateway_login']
  ] as const) {
    assertSafeTestDatabase({ nodeEnvironment: 'test', databaseUrl: value })
    const target = new URL(value)
    if (
      decodeURIComponent(target.username) !== login ||
      target.searchParams.getAll('schema').length !== 1 ||
      [...target.searchParams.keys()].some(
        (key) => key !== 'schema' && key !== 'sslmode'
      ) ||
      !schema ||
      !/^phase7_[a-f0-9]{32}_test$/u.test(schema) ||
      getPostgresSchema(value) !== schema
    )
      throw new Error(
        'SSO browser API fixture requires task-owned TEST roles/schema.'
      )
  }
  if (
    applicationTarget.hostname !== gatewayTarget.hostname ||
    (applicationTarget.port || '5432') !== (gatewayTarget.port || '5432') ||
    applicationTarget.pathname !== gatewayTarget.pathname
  )
    throw new Error(
      'SSO browser API fixture requires one TEST database target.'
    )
  for (const origin of [
    environment.BETTER_AUTH_URL,
    ...environment.TRUSTED_ORIGINS
  ]) {
    const target = new URL(origin)
    if (
      target.protocol !== 'http:' ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) ||
      target.origin !== origin
    )
      throw new Error('SSO browser API fixture requires loopback TEST origins.')
  }

  const expectedIdentity = Object.freeze({
    provider: 'google' as const,
    accountId: 'phase7-sso-browser-google-subject',
    email: 'phase7-sso-browser@example.test',
    name: 'Phase 7 SSO browser learner'
  })
  const authorizationProvider = createGoogleSsoProvider({
    clientId: 'phase7-sso-browser-test-client',
    clientSecret: 'phase7-sso-browser-unused-test-secret',
    callbackURL: new URL(
      '/api/auth/callback/google',
      environment.BETTER_AUTH_URL
    ).href
  })
  const fakeProvider: SsoProvider = {
    // Keep the installed Google URL/state/nonce/PKCE implementation intact.
    authorizationURL: authorizationProvider.authorizationURL,
    exchange: async () => ({ ...expectedIdentity })
  }
  const database = createDatabaseRuntime(databaseUrl, {
    migrationProfile: 'current',
    startupRole: 'nihongo_app'
  })
  const disconnectors = [database.disconnect]
  let disconnectPromise: Promise<void> | undefined
  const disconnect = (): Promise<void> => {
    disconnectPromise ??= Promise.allSettled(
      disconnectors.map(async (close) => close())
    ).then((results) => {
      if (results.some((result) => result.status === 'rejected'))
        throw new Error('SSO browser API fixture database disconnect failed.')
    })
    return disconnectPromise
  }
  try {
    const gateway = createRoleDatabaseRuntime(
      authGatewayDatabaseUrl,
      'nihongo_auth_gateway'
    )
    disconnectors.push(gateway.disconnect)
    const checkDatabaseReadiness = createOwnedAuthReadiness({
      checkDatabaseReadiness: database.checkReadiness,
      applicationClient: database.client,
      gatewayClient: gateway.client,
      applicationUrl: databaseUrl,
      gatewayUrl: authGatewayDatabaseUrl
    })
    const practice = createPracticeRuntimeGate({
      runtime: 'v1-v2',
      checkDatabaseReadiness,
      checkV1Compatibility: database.checkV1Compatibility
    })
    const rateLimiter = createApplicationRateLimiter({
      client: database.client,
      keySecret: environment.GUEST_COOKIE_SECRET
    })
    const auth = createSsoAuthentication({
      environment,
      applicationClient: database.client,
      gatewayClient: gateway.client,
      rateLimiter,
      providers: { google: fakeProvider }
    })
    const app = createApiApp({
      auth: {
        environment,
        ...auth,
        guestPrincipalService: createGuestPrincipalService({
          client: database.client,
          secret: environment.GUEST_COOKIE_SECRET
        })
      },
      assertPracticeRuntimeAuthority: practice.assertRequestAuthority,
      checkReadiness: practice.checkReadiness,
      logger: createJsonLogger('silent'),
      ...(environment.RELEASE_ID === undefined
        ? {}
        : { releaseId: environment.RELEASE_ID }),
      questionReader: createQuestionService(
        createPrismaQuestionRepository(database.client, {
          migrationProfile: 'current'
        })
      ),
      questionReadSecurity: { environment, rateLimiter },
      study: {
        draftService: createStudyDraftService(
          createPrismaStudyDraftRepository(database.client)
        ),
        practiceContractV2Enabled: practice.practiceContractV2Enabled,
        rateLimiter,
        service: createStudySessionService(
          createPrismaStudySessionRepository(database.client)
        )
      }
    })
    return {
      app,
      checkReadiness: practice.checkReadiness,
      expectedIdentity,
      disconnect
    }
  } catch (error: unknown) {
    await disconnect().catch(() => undefined)
    throw error
  }
}

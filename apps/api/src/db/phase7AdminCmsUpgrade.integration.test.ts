import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { apiFailureSchema } from '@nihongo/contracts/common/error'
import { getDashboardInsightsResponseSchema } from '@nihongo/contracts/dashboard/get-dashboard-insights'
import { canonicalDuplicateIdentity } from '@nihongo/domain/content/validators/v1/duplicates'
import type { PersistedQuestionSemanticV1 } from '@nihongo/domain/content/validators/v1/types'
import { hashPassword } from 'better-auth/crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { Client } from 'pg'
import { describe, expect, it } from 'vitest'
import type { QuestionAggregateSeed } from '../../prisma/seed-data/buildQuestionSeed.js'
import { createAdminReauthenticationService } from '../admin/adminReauthenticationService.js'
import type { AdminQuestionReader } from '../admin/adminQuestionService.js'
import type { AdminReadRateLimiter } from '../admin/adminReadRateLimiter.js'
import { createApiApp } from '../app/createApp.js'
import { createPhase7ReauthenticationAuthApi } from '../auth/createPhase7ReauthenticationAuth.js'
import { createGuestPrincipalService } from '../auth/guestPrincipalService.js'
import { createPhase7ReauthenticationContext } from '../auth/phase7ReauthenticationContext.js'
import { createPhase7SessionCookie } from '../auth/sessionCookie.js'
import { createPhase7PrincipalService } from '../auth/principalService.js'
import { parseApiEnvironment } from '../config/env.js'
import { createPrismaDashboardInsightsRepository } from '../dashboard/dashboardInsightsRepository.js'
import { createDashboardInsightsService } from '../dashboard/dashboardInsightsService.js'
import { createRoleDatabaseRuntime } from './database.js'
import { buildPhase6CanonicalSeeds } from './fixtures/phase6CanonicalSeeds.js'
import {
  apiRoot,
  sourceMigrationsDirectory,
  PHASE7_MIGRATIONS,
  CANONICAL_MIGRATION_LOGIN,
  LEGACY_APP_LOGIN,
  MIGRATION_ROLE,
  IDENTIFIER_PATTERN,
  quoteIdentifier,
  withUpgradeSchema,
  createPhase7HistoricalSchemaFixture
} from './fixtures/phase7HistoricalSchema.js'
import type { IsolatedUpgradeSchema } from './fixtures/phase7HistoricalSchema.js'
import { assertSafeAdminCmsDatabase } from './databaseTargetGuard.js'
import type { PrismaClient } from '../generated/prisma/client.js'
import { createJsonLogger } from '../observability/logger.js'
import type { QuestionReader } from '../question/questionService.js'
import {
  assertMigrationCompatibility,
  loadExpectedMigrationManifest,
  selectExpectedMigrationManifest,
  type AppliedMigration
} from './readiness.js'

const execFileAsync = promisify(execFile)
const PHASE6_SEMANTIC_DIGEST =
  'a180a0ea8dac51200b533fbe99624036fc19984be9cfbdd0c972c624e764444c'
const repositoryMigrationNames = readdirSync(sourceMigrationsDirectory, {
  withFileTypes: true
})
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .toSorted()

const environment = parseApiEnvironment(process.env)
assertSafeAdminCmsDatabase({
  adminCmsMode: environment.ADMIN_CMS_MODE,
  nodeEnvironment: environment.NODE_ENV,
  databaseUrl: environment.DATABASE_URL,
  productionDatabaseUrl: process.env.PRODUCTION_DATABASE_URL
})
const authGatewayDatabaseUrl = environment.AUTH_GATEWAY_DATABASE_URL
if (!authGatewayDatabaseUrl) {
  throw new Error('Phase 7 upgrade auth-gateway database URL is required.')
}
const adminDatabaseUrl = process.env.PHASE7_ADMIN_DATABASE_URL
if (!adminDatabaseUrl) {
  throw new Error('Phase 7 upgrade admin database URL is required.')
}
const migrationDatabaseUrl = process.env.PHASE7_MIGRATION_DATABASE_URL
if (!migrationDatabaseUrl) {
  throw new Error('Phase 7 migration wrapper database URL is required.')
}

const createExpectedFingerprint = (seed: QuestionAggregateSeed): string => {
  const correctOption = seed.options.find(
    ({ id }) => id === seed.correctOptionId
  )
  const [first, second, third, fourth] = seed.options
  if (!correctOption || !first || !second || !third || !fourth) {
    throw new Error(`Seed correct option is unavailable: ${seed.legacyId}`)
  }
  const semantic = {
    level: seed.level,
    subject: seed.subject,
    questionType: seed.questionType,
    difficulty: seed.difficulty,
    passage: seed.passage,
    questionText: seed.questionText,
    options: [
      { key: first.label, text: first.text },
      { key: second.label, text: second.text },
      { key: third.label, text: third.text },
      { key: fourth.label, text: fourth.text }
    ],
    correctOptionKey: correctOption.label,
    explanationKo: seed.explanationKo,
    explanationJa: seed.explanationJa,
    tagKeys: seed.tags.map(({ normalizedName }) => normalizedName)
  } satisfies PersistedQuestionSemanticV1
  return createHash('sha256')
    .update(canonicalDuplicateIdentity(semantic), 'utf8')
    .digest('hex')
}

const exerciseUpgradedDashboardInsights = async (
  context: IsolatedUpgradeSchema
): Promise<void> => {
  const userId = randomUUID()
  const sessionId = randomUUID()
  const accountId = randomUUID()
  const sessionToken = `phase8-upgrade-insights-${randomUUID()}`
  await context.adminClient.query('BEGIN')
  try {
    await context.adminClient.query(
      `INSERT INTO "User" (
         "id", "name", "email", "emailVerified", "role",
         "accountStatus", "createdAt", "updatedAt"
       ) VALUES (
         $1, 'Phase 8 upgrade insights', $2, true, 'USER',
         'ACTIVE', clock_timestamp(), clock_timestamp()
       )`,
      [userId, `phase8-upgrade-${randomUUID()}@example.test`]
    )
    await context.adminClient.query(
      `INSERT INTO "Account" (
         "id", "accountId", "providerId", "userId", "password",
         "createdAt", "updatedAt"
       ) VALUES (
         $1, $2::uuid::text, 'credential', $2,
         'phase8-upgrade-password-hash', clock_timestamp(), clock_timestamp()
       )`,
      [accountId, userId]
    )
    await context.adminClient.query('COMMIT')
  } catch (error: unknown) {
    await context.adminClient.query('ROLLBACK')
    throw error
  }
  const readBusinessState = async (): Promise<unknown> =>
    (
      await context.adminClient.query(
        `SELECT
           (SELECT COUNT(*)::int FROM "User" WHERE "id" = $1)
             AS "userCount",
           (SELECT COUNT(*)::int FROM "StudySession" WHERE "userId" = $1)
             AS "sessionCount",
           (SELECT COUNT(*)::int FROM "WrongNote" WHERE "userId" = $1)
             AS "wrongNoteCount",
           (SELECT "updatedAt" FROM "User" WHERE "id" = $1)
             AS "userUpdatedAt"`,
        [userId]
      )
    ).rows
  const before = await readBusinessState()
  const applicationRuntime = createRoleDatabaseRuntime(
    withUpgradeSchema(environment.DATABASE_URL, context.schemaName),
    'nihongo_app'
  )
  const authGatewayRuntime = createRoleDatabaseRuntime(
    withUpgradeSchema(authGatewayDatabaseUrl, context.schemaName),
    'nihongo_auth_gateway'
  )
  try {
    const issued = await authGatewayRuntime.client.$queryRawUnsafe<
      Array<{ familyId: string }>
    >(
      `SELECT * FROM "phase7_issue_v1_session"(
        $1, 1, 'USER', 'ACTIVE', $2, $3,
        '127.0.0.1', 'phase8-upgrade-insights', false
      )`,
      userId,
      sessionId,
      sessionToken
    )
    expect(issued).toHaveLength(1)
    const response = getDashboardInsightsResponseSchema.parse(
      await createDashboardInsightsService(
        createPrismaDashboardInsightsRepository(
          applicationRuntime.client,
          'PHASE7'
        )
      ).getDashboardInsights({
        kind: 'PHASE7',
        sessionToken,
        userId
      })
    )
    expect(response.stats.overall.attemptedCount).toBe(0)
    expect(response.stats.byLevel).toHaveLength(5)
    expect(response.stats.bySubject).toHaveLength(3)
    expect(response.stats.byQuestionType).toHaveLength(12)
    expect(response.recommendations).toEqual([
      {
        rank: 1,
        kind: 'PRACTICE_SETUP',
        reason: { code: 'TARGET_LEVEL_NOT_SET' },
        action: { kind: 'OPEN_PRACTICE_SETUP' }
      }
    ])
    expect(await readBusinessState()).toEqual(before)
  } finally {
    await Promise.all([
      applicationRuntime.disconnect(),
      authGatewayRuntime.disconnect()
    ])
  }
}

const exerciseUpgradedRetiredPasswordBoundary = async (
  context: IsolatedUpgradeSchema,
  migrationClient: Client
): Promise<void> => {
  const endpoint = await context.adminClient.query<{
    databaseName: string
    serverAddress: string
    serverPort: number
  }>(
    `SELECT current_database() AS "databaseName",
       inet_server_addr()::text AS "serverAddress",
       inet_server_port() AS "serverPort"`
  )
  const target = endpoint.rows[0]
  if (!target) throw new Error('Upgrade DB endpoint is unavailable.')
  await migrationClient.query(
    `SELECT "phase7_register_database_capability"(
      $1, $2::inet, $3, 'TEST'
    )`,
    [target.databaseName, target.serverAddress, target.serverPort]
  )

  const userId = randomUUID()
  const accountId = randomUUID()
  const sessionId = randomUUID()
  const requestId = randomUUID()
  const rawOldToken = `phase7-upgrade-old-${randomUUID()}`
  const email = `phase7-upgrade-reauth-${randomUUID()}@example.test`
  const password = 'Phase7-upgrade-real-reauthentication-2026!'
  const passwordHash = await hashPassword(password)
  await context.adminClient.query(
    `INSERT INTO "User" (
       "id", "name", "email", "emailVerified", "role",
       "accountStatus", "createdAt", "updatedAt"
     ) VALUES (
       $1, 'Phase 7 upgrade reauthentication', $2, true, 'ADMIN',
       'ACTIVE', clock_timestamp(), clock_timestamp()
     )`,
    [userId, email]
  )
  await context.adminClient.query(
    `INSERT INTO "Account" (
       "id", "accountId", "providerId", "userId", "password",
       "createdAt", "updatedAt"
     ) VALUES (
       $1, $2::uuid::text, 'credential', $2, $3,
       clock_timestamp(), clock_timestamp()
     )`,
    [accountId, userId, passwordHash]
  )
  await migrationClient.query(`SELECT "phase7_activate_v1_issuer"('TEST')`)

  const applicationRuntime = createRoleDatabaseRuntime(
    withUpgradeSchema(environment.DATABASE_URL, context.schemaName),
    'nihongo_app'
  )
  const authGatewayRuntime = createRoleDatabaseRuntime(
    withUpgradeSchema(authGatewayDatabaseUrl, context.schemaName),
    'nihongo_auth_gateway'
  )
  try {
    const issued = await authGatewayRuntime.client.$queryRawUnsafe<
      Array<{ expiresAt: Date; familyId: string }>
    >(
      `SELECT * FROM "phase7_issue_v1_session"(
        $1, 1, 'ADMIN', 'ACTIVE', $2, $3,
        '127.0.0.1', 'phase7-upgrade-reauthentication', false
      )`,
      userId,
      sessionId,
      rawOldToken
    )
    const issuedSession = issued[0]
    if (!issuedSession || issued.length !== 1) {
      throw new Error('Upgrade DB V1 Session was not issued.')
    }
    const oldSessionCookie = createPhase7SessionCookie({
      expiresAt: issuedSession.expiresAt,
      isProduction: false,
      rememberMe: false,
      secret: environment.BETTER_AUTH_SECRET,
      token: rawOldToken
    })
    const oldCookieHeader = oldSessionCookie.split(';')[0]
    if (!oldCookieHeader) {
      throw new Error('Upgrade DB old Session cookie is unavailable.')
    }

    let finalizerCallCount = 0
    const observedQuery = async <QueryResult>(
      query: string,
      ...values: unknown[]
    ): Promise<QueryResult> => {
      if (query.includes('phase7_finalize_reauthentication')) {
        finalizerCallCount += 1
      }
      return await authGatewayRuntime.client.$queryRawUnsafe<QueryResult>(
        query,
        ...values
      )
    }
    const observedClient = {
      $queryRawUnsafe: observedQuery
    } as unknown as Pick<PrismaClient, '$queryRawUnsafe'>
    const reauthenticationContext = createPhase7ReauthenticationContext()
    const realAuthApi = createPhase7ReauthenticationAuthApi({
      client: authGatewayRuntime.client,
      context: reauthenticationContext,
      environment
    })
    const service = createAdminReauthenticationService({
      auditEnvironment: 'TEST',
      authApi: realAuthApi,
      client: observedClient,
      context: reauthenticationContext
    })
    const principalService = createPhase7PrincipalService({
      client: applicationRuntime.client,
      isProduction: false,
      refreshClient: authGatewayRuntime.client,
      secret: environment.BETTER_AUTH_SECRET
    })
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
      listQuestions: async () => ({
        items: [],
        page: 1,
        pageSize: 20,
        total: 0
      })
    }
    const app = createApiApp({
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

    const readAuthWriteDigest = async () =>
      (
        await context.adminClient.query<{ digest: string }>(
          `SELECT encode(public.digest(convert_to(jsonb_build_object(
          'Session', (SELECT COALESCE(jsonb_agg(to_jsonb(row)
            ORDER BY to_jsonb(row)::text), '[]'::jsonb) FROM "Session" AS row),
          'Phase7ReauthenticationIntent', (SELECT COALESCE(jsonb_agg(to_jsonb(row)
            ORDER BY to_jsonb(row)::text), '[]'::jsonb) FROM "Phase7ReauthenticationIntent" AS row),
          'AdminAuditLog', (SELECT COALESCE(jsonb_agg(to_jsonb(row)
            ORDER BY to_jsonb(row)::text), '[]'::jsonb) FROM "AdminAuditLog" AS row),
          'AuthSessionRotationFence', (SELECT COALESCE(jsonb_agg(to_jsonb(row)
            ORDER BY to_jsonb(row)::text), '[]'::jsonb) FROM "AuthSessionRotationFence" AS row),
          'RateLimit', (SELECT COALESCE(jsonb_agg(to_jsonb(row)
            ORDER BY to_jsonb(row)::text), '[]'::jsonb) FROM "RateLimit" AS row),
          'Phase7TrustedExecution', (SELECT COALESCE(jsonb_agg(to_jsonb(row)
            ORDER BY to_jsonb(row)::text), '[]'::jsonb) FROM "Phase7TrustedExecution" AS row)
          )::text, 'UTF8'), 'sha256'), 'hex') AS digest`
        )
      ).rows
    const beforeAuthWrites = await readAuthWriteDigest()

    const response = await app.request(
      'http://localhost:3001/api/v1/admin/reauthentication',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: oldCookieHeader,
          Origin: environment.TRUSTED_ORIGINS[0]!,
          'Sec-Fetch-Site': 'same-origin',
          'User-Agent': 'phase7-upgrade-reauthentication',
          'X-Request-Id': requestId
        },
        body: JSON.stringify({ password })
      }
    )
    expect(response.status).toBe(404)
    expect(apiFailureSchema.parse(await response.json())).toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
      requestId,
      retryable: false
    })
    expect(response.headers.get('X-Request-Id')).toBe(requestId)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(response.headers.getSetCookie()).toHaveLength(0)
    expect(finalizerCallCount).toBe(0)
    expect(await readAuthWriteDigest()).toEqual(beforeAuthWrites)

    const proof = await context.adminClient.query<{
      auditCount: number
      fenceCount: number
      intentCount: number
      oldActiveCount: number
      replacementCount: number
      trustedExecutionCount: number
    }>(
      `SELECT
         (SELECT COUNT(*)::int FROM "Session"
          WHERE "id" = $1 AND "authorizationState" = 'ACTIVE')
           AS "oldActiveCount",
         (SELECT COUNT(*)::int
          FROM "Phase7ReauthenticationIntent" AS intent
          JOIN "Session" AS session ON session."id" = intent."stagedSessionId"
          WHERE intent."requestId" = $2
            AND session."authorizationState" = 'ACTIVE')
           AS "replacementCount",
         (SELECT COUNT(*)::int FROM "Phase7ReauthenticationIntent"
          WHERE "requestId" = $2) AS "intentCount",
         (SELECT COUNT(*)::int FROM "AuthSessionRotationFence" AS fence
          JOIN "Phase7ReauthenticationIntent" AS intent
            ON intent."operationId" = fence."operationId"
          WHERE intent."requestId" = $2) AS "fenceCount",
         (SELECT COUNT(*)::int FROM "AdminAuditLog"
          WHERE "requestId" = $2 AND "command" = 'REAUTHENTICATION')
           AS "auditCount",
         (SELECT COUNT(*)::int FROM "Phase7TrustedExecution")
           AS "trustedExecutionCount"`,
      [sessionId, requestId]
    )
    expect(proof.rows).toEqual([
      {
        auditCount: 0,
        fenceCount: 0,
        intentCount: 0,
        oldActiveCount: 1,
        replacementCount: 0,
        trustedExecutionCount: 0
      }
    ])
  } finally {
    await Promise.all([
      applicationRuntime.disconnect(),
      authGatewayRuntime.disconnect()
    ])
  }
}

const legacyDatabaseUrl = process.env.PHASE7_LEGACY_DATABASE_URL
if (!legacyDatabaseUrl) {
  throw new Error('Phase 7 legacy compatibility database URL is required.')
}
const legacyCredentials = new URL(legacyDatabaseUrl)

const {
  copyMigration,
  createIsolatedUpgradeSchema,
  deploy,
  dispose,
  readHistoricalMigrationProfile,
  readLedger,
  readNonCanonicalTargetOwnerCount,
  seedPhase6Catalog,
  transferPhase6TargetOwnership
} = createPhase7HistoricalSchemaFixture({
  adminDatabaseUrl,
  legacyDatabaseUrl,
  migrationDatabaseUrl,
  expect
})

const exercisePhase6LegacyCompatibility = async (
  context: IsolatedUpgradeSchema
): Promise<{
  client: Client
  outOfCapCreatedAt: Date
  outOfCapSessionId: string
  userId: string
}> => {
  await context.serverClient.query(
    `GRANT CONNECT ON DATABASE ${quoteIdentifier(context.databaseName)}
     TO ${quoteIdentifier(LEGACY_APP_LOGIN)}`
  )
  await context.adminClient.query(
    `GRANT USAGE ON SCHEMA ${context.quotedSchemaName}
     TO ${quoteIdentifier(LEGACY_APP_LOGIN)}`
  )
  await context.adminClient.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES
     IN SCHEMA ${context.quotedSchemaName}
     TO ${quoteIdentifier(LEGACY_APP_LOGIN)}`
  )
  await context.adminClient.query(
    `GRANT USAGE, SELECT ON ALL SEQUENCES
     IN SCHEMA ${context.quotedSchemaName}
     TO ${quoteIdentifier(LEGACY_APP_LOGIN)}`
  )
  const legacyEnumTypes = await context.adminClient.query<{ typeName: string }>(
    `SELECT type_value.typname AS "typeName"
     FROM pg_catalog.pg_type AS type_value
     JOIN pg_catalog.pg_namespace AS namespace
       ON namespace.oid = type_value.typnamespace
     WHERE namespace.nspname = $1
       AND type_value.typtype = 'e'
       AND type_value.typrelid = 0
     ORDER BY type_value.typname COLLATE "C"`,
    [context.schemaName]
  )
  for (const { typeName } of legacyEnumTypes.rows) {
    await context.adminClient.query(
      `GRANT USAGE ON TYPE ${context.quotedSchemaName}.${quoteIdentifier(typeName)}
       TO ${quoteIdentifier(LEGACY_APP_LOGIN)}`
    )
  }

  const legacyUrl = new URL(context.databaseUrl)
  legacyUrl.username = LEGACY_APP_LOGIN
  legacyUrl.password = decodeURIComponent(legacyCredentials.password)
  legacyUrl.searchParams.delete('schema')
  legacyUrl.searchParams.delete('options')
  const legacyClient = new Client({
    connectionString: legacyUrl.toString(),
    options: `-c search_path=${context.schemaName} -c TimeZone=UTC`
  })
  await legacyClient.connect()
  try {
    expect(
      (
        await legacyClient.query<{ migrationCount: number }>(
          `SELECT COUNT(*)::int AS "migrationCount"
           FROM "_prisma_migrations"
           WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`
        )
      ).rows
    ).toEqual([{ migrationCount: 27 }])
    const question = await legacyClient.query<{ id: string }>(
      `SELECT "id" FROM "Question" ORDER BY "id" LIMIT 1`
    )
    const questionId = question.rows[0]?.id
    if (!questionId) {
      throw new Error('Phase 6 legacy learner question is unavailable.')
    }
    const userId = randomUUID()
    const sessionId = randomUUID()
    const sessionToken = `phase6-legacy-session-${randomUUID()}`
    const outOfCapSessionId = randomUUID()
    const outOfCapCreatedAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
    const outOfCapSessionToken = `phase6-out-of-cap-${randomUUID()}`
    await legacyClient.query('BEGIN')
    try {
      await legacyClient.query(
        `INSERT INTO "User" (
          "id", "name", "email", "emailVerified", "role", "targetLevel",
          "createdAt", "updatedAt"
        ) VALUES (
          $1, 'Phase 6 legacy learner', $2, true, 'USER', 'N5',
          clock_timestamp(), clock_timestamp()
        )`,
        [userId, `phase6-legacy-${randomUUID()}@example.test`]
      )
      await legacyClient.query(
        `INSERT INTO "Account" (
          "id", "accountId", "providerId", "userId", "password",
          "createdAt", "updatedAt"
        ) VALUES (
          $1, $2::uuid::text, 'credential', $2,
          'phase6-legacy-password-hash', clock_timestamp(), clock_timestamp()
        )`,
        [randomUUID(), userId]
      )
      await legacyClient.query(
        `UPDATE "User" SET "targetLevel" = 'N4', "updatedAt" = clock_timestamp()
         WHERE "id" = $1`,
        [userId]
      )
      await legacyClient.query(
        `INSERT INTO "Bookmark" ("id", "userId", "questionId", "createdAt")
         VALUES ($1, $2, $3, clock_timestamp())`,
        [randomUUID(), userId, questionId]
      )
      await legacyClient.query(
        `DELETE FROM "Bookmark" WHERE "userId" = $1 AND "questionId" = $2`,
        [userId, questionId]
      )
      await legacyClient.query(
        `INSERT INTO "Session" (
          "id", "expiresAt", "token", "createdAt", "updatedAt", "userId"
        ) VALUES (
          $1, clock_timestamp() + INTERVAL '1 day', $2,
          clock_timestamp(), clock_timestamp(), $3
        )`,
        [sessionId, sessionToken, userId]
      )
      expect(
        (
          await legacyClient.query<{ id: string }>(
            `DELETE FROM "Session" WHERE "token" = $1 RETURNING "id"`,
            [sessionToken]
          )
        ).rows
      ).toEqual([{ id: sessionId }])
      await legacyClient.query(
        `INSERT INTO "Session" (
          "id", "expiresAt", "token", "createdAt", "updatedAt", "userId"
        ) VALUES (
          $1, $2::timestamptz + INTERVAL '45 days', $3, $2, $2, $4
        )`,
        [outOfCapSessionId, outOfCapCreatedAt, outOfCapSessionToken, userId]
      )
      await legacyClient.query('COMMIT')
    } catch (error: unknown) {
      await legacyClient.query('ROLLBACK')
      throw error
    }
    return {
      client: legacyClient,
      outOfCapCreatedAt,
      outOfCapSessionId,
      userId
    }
  } catch (error: unknown) {
    await legacyClient.end().catch(() => undefined)
    throw error
  }
}

interface OperationManifestVerifierCatalog {
  readonly acl: string | null
  readonly appCanExecute: boolean
  readonly argumentCount: number
  readonly argumentTypes: string
  readonly authCanExecute: boolean
  readonly config: string[] | null
  readonly erasureCanExecute: boolean
  readonly identityArguments: string
  readonly isSecurityDefiner: boolean
  readonly languageName: string
  readonly migrationCanExecute: boolean
  readonly objectId: string
  readonly ownerCanExecute: boolean
  readonly ownerName: string
  readonly publicCanExecute: boolean
  readonly resultType: string
}

const readOperationManifestVerifierCatalog = async (
  context: IsolatedUpgradeSchema
): Promise<OperationManifestVerifierCatalog> => {
  const result =
    await context.adminClient.query<OperationManifestVerifierCatalog>(
      `SELECT procedure_record.oid::text AS "objectId",
         owner_role.rolname AS "ownerName",
         language_record.lanname AS "languageName",
         procedure_record.pronargs::int AS "argumentCount",
         procedure_record.proargtypes::text AS "argumentTypes",
         pg_catalog.pg_get_function_identity_arguments(procedure_record.oid)
           AS "identityArguments",
         pg_catalog.pg_get_function_result(procedure_record.oid) AS "resultType",
         procedure_record.prosecdef AS "isSecurityDefiner",
         procedure_record.proconfig::text[] AS config,
         procedure_record.proacl::text AS acl,
         pg_catalog.has_function_privilege(
           'nihongo_phase7_owner', procedure_record.oid, 'EXECUTE'
         ) AS "ownerCanExecute",
         pg_catalog.has_function_privilege(
           'nihongo_phase7_migration', procedure_record.oid, 'EXECUTE'
         ) AS "migrationCanExecute",
         pg_catalog.has_function_privilege(
           'nihongo_app', procedure_record.oid, 'EXECUTE'
         ) AS "appCanExecute",
         pg_catalog.has_function_privilege(
           'nihongo_auth_gateway', procedure_record.oid, 'EXECUTE'
         ) AS "authCanExecute",
         pg_catalog.has_function_privilege(
           'nihongo_erasure_worker', procedure_record.oid, 'EXECUTE'
         ) AS "erasureCanExecute",
         EXISTS (
           SELECT 1
           FROM pg_catalog.aclexplode(COALESCE(
             procedure_record.proacl,
             pg_catalog.acldefault('f', procedure_record.proowner)
           )) AS permission
           WHERE permission.grantee = 0
             AND permission.privilege_type = 'EXECUTE'
         ) AS "publicCanExecute"
       FROM pg_catalog.pg_proc AS procedure_record
       JOIN pg_catalog.pg_namespace AS namespace_record
         ON namespace_record.oid = procedure_record.pronamespace
       JOIN pg_catalog.pg_roles AS owner_role
         ON owner_role.oid = procedure_record.proowner
       JOIN pg_catalog.pg_language AS language_record
         ON language_record.oid = procedure_record.prolang
       WHERE namespace_record.nspname = $1
         AND procedure_record.proname = 'phase7_verify_operation_manifest'
         AND procedure_record.proargtypes = '2950'::pg_catalog.oidvector`,
      [context.schemaName]
    )
  const catalog = result.rows[0]
  if (!catalog || result.rows.length !== 1) {
    throw new Error('Phase 7 operation manifest verifier catalog is not exact.')
  }
  return catalog
}

const expectArchiveEmptyManifestVerifier = async (
  context: IsolatedUpgradeSchema,
  expectation: 'accept' | 'reject'
): Promise<void> => {
  const operationId = randomUUID()
  const questionId = randomUUID()
  await context.adminClient.query('BEGIN')
  try {
    await context.adminClient.query(
      `SET LOCAL session_replication_role = replica`
    )
    await context.adminClient.query(
      `INSERT INTO ${context.quotedSchemaName}."Phase7OperationIntent" (
         "operationId", "requestId", "command", "referencedUserIds",
         "targetManifest", "requiresFresh", "environment", "occurredAt",
         "backendPid", "transactionId"
       ) VALUES (
         $1, $2, 'QUESTION_ARCHIVE', ARRAY[]::uuid[], $3::jsonb,
         false, 'TEST', clock_timestamp(), pg_backend_pid(), txid_current()
       )`,
      [
        operationId,
        randomUUID(),
        JSON.stringify({
          questions: [{ id: questionId, rowVersion: 1, state: 'ACTIVE' }],
          reports: [],
          tags: [],
          versions: []
        })
      ]
    )
    await context.adminClient.query(
      `INSERT INTO ${context.quotedSchemaName}."Phase7OperationDelta" (
         "operationId", "entityType", "targetId", "questionId", "mutation",
         "fromState", "toState", "beforeRowVersion", "afterRowVersion"
       ) VALUES ($1, 'QUESTION', $2, $2, 'UPDATE', 'ACTIVE', 'ARCHIVED', 1, 2)`,
      [operationId, questionId]
    )
    await context.adminClient.query(
      `SET LOCAL session_replication_role = origin`
    )
    const verification = context.adminClient.query(
      `SELECT ${context.quotedSchemaName}."phase7_verify_operation_manifest"($1)`,
      [operationId]
    )
    if (expectation === 'accept') {
      await expect(verification).resolves.toMatchObject({ rowCount: 1 })
    } else {
      await expect(verification).rejects.toMatchObject({ code: '23514' })
    }
  } finally {
    await context.adminClient.query('ROLLBACK').catch(() => undefined)
  }
}

const applyMigrationOnCurrentBackend = async ({
  client,
  migrationName,
  migrationSql
}: {
  client: Client
  migrationName: string
  migrationSql: string
}): Promise<void> => {
  const migrationId = randomUUID()
  const checksum = createHash('sha256')
    .update(migrationSql, 'utf8')
    .digest('hex')
  await client.query(
    `INSERT INTO "_prisma_migrations" (
       id, checksum, migration_name, started_at, applied_steps_count
     ) VALUES ($1, $2, $3, clock_timestamp(), 0)`,
    [migrationId, checksum, migrationName]
  )
  await client.query(migrationSql)
  const finalized = await client.query<{ id: string }>(
    `UPDATE "_prisma_migrations"
     SET finished_at = clock_timestamp(), applied_steps_count = 1
     WHERE id = $1 AND finished_at IS NULL AND rolled_back_at IS NULL
     RETURNING id`,
    [migrationId]
  )
  expect(finalized.rows).toEqual([{ id: migrationId }])
}

const verifyCanonicalMigrationLedgerAccess = async (
  context: IsolatedUpgradeSchema,
  expectedCount: number
): Promise<void> => {
  const canonicalUrl = new URL(context.databaseUrl)
  canonicalUrl.searchParams.delete('schema')
  canonicalUrl.searchParams.delete('options')
  const canonicalClient = new Client({
    connectionString: canonicalUrl.toString(),
    options:
      `-c search_path=${context.schemaName} -c TimeZone=UTC ` +
      `-c role=${MIGRATION_ROLE}`
  })
  await canonicalClient.connect()
  try {
    const backendBefore = await canonicalClient.query<{
      currentRole: string
      pid: number
      sessionUser: string
    }>(
      `SELECT pg_backend_pid() AS pid, current_user AS "currentRole",
         session_user AS "sessionUser"`
    )
    expect(backendBefore.rows).toEqual([
      {
        currentRole: MIGRATION_ROLE,
        pid: expect.any(Number),
        sessionUser: CANONICAL_MIGRATION_LOGIN
      }
    ])
    expect(
      (
        await canonicalClient.query<{
          canDelete: boolean
          canInsert: boolean
          canSelect: boolean
          canUpdate: boolean
          currentRole: string
          migrationCount: number
          sessionUser: string
        }>(
          `SELECT session_user AS "sessionUser", current_user AS "currentRole",
             has_table_privilege(
               current_user, format('%I.%I', current_schema(),
               '_prisma_migrations'), 'SELECT'
             ) AS "canSelect",
             has_table_privilege(
               current_user, format('%I.%I', current_schema(),
               '_prisma_migrations'), 'INSERT'
             ) AS "canInsert",
             has_table_privilege(
               current_user, format('%I.%I', current_schema(),
               '_prisma_migrations'), 'UPDATE'
             ) AS "canUpdate",
             has_table_privilege(
               current_user, format('%I.%I', current_schema(),
               '_prisma_migrations'), 'DELETE'
             ) AS "canDelete",
             (SELECT COUNT(*)::int FROM "_prisma_migrations"
              WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)
                AS "migrationCount"`
        )
      ).rows
    ).toEqual([
      {
        canDelete: false,
        canInsert: true,
        canSelect: true,
        canUpdate: true,
        currentRole: MIGRATION_ROLE,
        migrationCount: expectedCount,
        sessionUser: CANONICAL_MIGRATION_LOGIN
      }
    ])
    await canonicalClient.query('BEGIN')
    try {
      expect(
        (
          await canonicalClient.query<{ migrationName: string }>(
            `UPDATE "_prisma_migrations"
             SET logs = logs
             WHERE migration_name = (
               SELECT migration_name FROM "_prisma_migrations"
               WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
               ORDER BY started_at DESC LIMIT 1
             )
             RETURNING migration_name AS "migrationName"`
          )
        ).rows
      ).toHaveLength(1)
      await canonicalClient.query('COMMIT')
    } catch (error: unknown) {
      await canonicalClient.query('ROLLBACK')
      throw error
    }
    await canonicalClient.query('BEGIN')
    try {
      expect(
        (
          await canonicalClient.query<{ migrationCount: number }>(
            `SELECT COUNT(*)::int AS "migrationCount"
           FROM "_prisma_migrations"
           WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`
          )
        ).rows
      ).toEqual([{ migrationCount: expectedCount }])
      await canonicalClient.query('COMMIT')
    } catch (error: unknown) {
      await canonicalClient.query('ROLLBACK')
      throw error
    }
    const backendAfter = await canonicalClient.query<{
      currentRole: string
      pid: number
      sessionUser: string
    }>(
      `SELECT pg_backend_pid() AS pid, current_user AS "currentRole",
         session_user AS "sessionUser"`
    )
    expect(backendAfter.rows).toEqual(backendBefore.rows)

    const reconnectedClient = new Client({
      connectionString: canonicalUrl.toString(),
      options:
        `-c search_path=${context.schemaName} -c TimeZone=UTC ` +
        `-c role=${MIGRATION_ROLE}`
    })
    await reconnectedClient.connect()
    try {
      const reconnected = await reconnectedClient.query<{
        currentRole: string
        migrationCount: number
        pid: number
        sessionUser: string
      }>(
        `SELECT pg_backend_pid() AS pid, current_user AS "currentRole",
           session_user AS "sessionUser",
           (SELECT COUNT(*)::int FROM "_prisma_migrations"
            WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)
             AS "migrationCount"`
      )
      expect(reconnected.rows).toEqual([
        {
          currentRole: MIGRATION_ROLE,
          migrationCount: expectedCount,
          pid: expect.any(Number),
          sessionUser: CANONICAL_MIGRATION_LOGIN
        }
      ])
      expect(reconnected.rows[0]?.pid).not.toBe(backendBefore.rows[0]?.pid)
    } finally {
      await reconnectedClient.end()
    }
  } finally {
    await canonicalClient.end()
  }
}

const expectTempSearchPathMigrationRejected = async ({
  context,
  expectedLedgerCount,
  migrationSql
}: {
  context: IsolatedUpgradeSchema
  expectedLedgerCount: number
  migrationSql: string
}): Promise<void> => {
  const canonicalUrl = new URL(context.databaseUrl)
  canonicalUrl.searchParams.delete('schema')
  canonicalUrl.searchParams.delete('options')
  const canonicalClient = new Client({
    connectionString: canonicalUrl.toString(),
    options:
      `-c search_path=${context.schemaName} -c TimeZone=UTC ` +
      `-c role=${MIGRATION_ROLE}`
  })
  await canonicalClient.connect()
  try {
    await canonicalClient.query(
      `CREATE TEMP TABLE phase7_search_path_probe (id integer)`
    )
    expect(
      (
        await canonicalClient.query<{
          isActualTempNamespace: boolean
          tempSchema: string
        }>(
          `SELECT namespace.nspname AS "tempSchema",
             namespace.oid = pg_my_temp_schema()
               AND namespace.nspname ~ '^pg_temp_[0-9]+$'
               AS "isActualTempNamespace"
           FROM pg_namespace AS namespace
           WHERE namespace.oid = pg_my_temp_schema()`
        )
      ).rows
    ).toEqual([
      {
        isActualTempNamespace: true,
        tempSchema: expect.stringMatching(/^pg_temp_[0-9]+$/u)
      }
    ])
    await canonicalClient.query(`SET search_path TO pg_temp, public`)
    let errorCode: unknown
    try {
      await canonicalClient.query(migrationSql)
    } catch (error: unknown) {
      errorCode = (error as { code?: unknown }).code
    }
    expect(['42501', '55000']).toContain(errorCode)
    await canonicalClient.query('ROLLBACK')
    await canonicalClient.query(
      `SET search_path TO ${context.quotedSchemaName}`
    )
    expect(await readLedger(context)).toHaveLength(expectedLedgerCount)
  } finally {
    await canonicalClient.query('ROLLBACK').catch(() => undefined)
    await canonicalClient.end()
  }
}

const expectExternalTargetDependencyRejected = async ({
  client: migrationClient,
  context,
  expectedLedgerCount,
  migrationSql
}: {
  client: Client
  context: IsolatedUpgradeSchema
  expectedLedgerCount: number
  migrationSql: string
}): Promise<void> => {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 20)
  const externalSchema = `phase7_external_${suffix}`
  const triggerFunction = `phase7_external_trigger_${suffix}`
  const scalarFunction = `phase7_external_scalar_${suffix}`

  const expectRejected = async (): Promise<void> => {
    await expect(migrationClient.query(migrationSql)).rejects.toMatchObject({
      code: '42501'
    })
    await migrationClient.query('ROLLBACK')
    expect(await readLedger(context)).toHaveLength(expectedLedgerCount)
  }

  await context.adminClient.query(
    `CREATE SCHEMA ${quoteIdentifier(externalSchema)}`
  )
  try {
    await context.adminClient.query(
      `CREATE TABLE ${quoteIdentifier(externalSchema)}.probe (id integer)`
    )
    await context.adminClient.query(
      `CREATE FUNCTION ${context.quotedSchemaName}.${quoteIdentifier(triggerFunction)}()
       RETURNS trigger LANGUAGE plpgsql
       SET search_path = pg_catalog
       AS $function$ BEGIN RETURN NEW; END; $function$`
    )
    await context.adminClient.query(
      `ALTER FUNCTION ${context.quotedSchemaName}.${quoteIdentifier(triggerFunction)}()
       OWNER TO ${quoteIdentifier(MIGRATION_ROLE)}`
    )
    try {
      await context.adminClient.query(
        `CREATE TRIGGER ${quoteIdentifier(`phase7_external_${suffix}`)}
         BEFORE INSERT ON ${quoteIdentifier(externalSchema)}.probe
         FOR EACH ROW EXECUTE FUNCTION
         ${context.quotedSchemaName}.${quoteIdentifier(triggerFunction)}()`
      )
      await expectRejected()
    } finally {
      await context.adminClient.query(
        `DROP SCHEMA ${quoteIdentifier(externalSchema)} CASCADE`
      )
      await context.adminClient.query(
        `DROP FUNCTION ${context.quotedSchemaName}.${quoteIdentifier(triggerFunction)}()`
      )
    }

    await context.adminClient.query(
      `CREATE SCHEMA ${quoteIdentifier(externalSchema)}`
    )
    await context.adminClient.query(
      `CREATE FUNCTION ${context.quotedSchemaName}.${quoteIdentifier(scalarFunction)}()
       RETURNS integer LANGUAGE sql IMMUTABLE
       SET search_path = pg_catalog
       AS $function$ SELECT 1 $function$`
    )
    await context.adminClient.query(
      `ALTER FUNCTION ${context.quotedSchemaName}.${quoteIdentifier(scalarFunction)}()
       OWNER TO ${quoteIdentifier(MIGRATION_ROLE)}`
    )
    try {
      await context.adminClient.query(
        `CREATE VIEW ${quoteIdentifier(externalSchema)}.probe_view AS
         SELECT ${context.quotedSchemaName}.${quoteIdentifier(scalarFunction)}()
           AS value`
      )
      await expectRejected()
    } finally {
      await context.adminClient.query(
        `DROP SCHEMA ${quoteIdentifier(externalSchema)} CASCADE`
      )
      await context.adminClient.query(
        `DROP FUNCTION ${context.quotedSchemaName}.${quoteIdentifier(scalarFunction)}()`
      )
    }
  } finally {
    await context.adminClient
      .query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(externalSchema)} CASCADE`)
      .catch(() => undefined)
    await context.adminClient
      .query(
        `DROP FUNCTION IF EXISTS ${context.quotedSchemaName}.${quoteIdentifier(triggerFunction)}()`
      )
      .catch(() => undefined)
    await context.adminClient
      .query(
        `DROP FUNCTION IF EXISTS ${context.quotedSchemaName}.${quoteIdentifier(scalarFunction)}()`
      )
      .catch(() => undefined)
  }
}

const expectEventTriggerBoundaryRejected = async ({
  client: migrationClient,
  context,
  expectedLedgerCount,
  migrationSql
}: {
  client: Client
  context: IsolatedUpgradeSchema
  expectedLedgerCount: number
  migrationSql: string
}): Promise<void> => {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 20)
  const eventTriggerName = `phase7_event_${suffix}`
  const eventFunctionName = `phase7_event_fn_${suffix}`
  const sentinelSequence = `phase7_event_seq_${suffix}`

  await context.adminClient.query(
    `CREATE SEQUENCE ${context.quotedSchemaName}.${quoteIdentifier(sentinelSequence)}`
  )
  await context.adminClient.query(
    `CREATE FUNCTION ${context.quotedSchemaName}.${quoteIdentifier(eventFunctionName)}()
     RETURNS event_trigger LANGUAGE plpgsql
     SET search_path = pg_catalog
     AS $function$
     BEGIN
       IF TG_TAG = 'CREATE FUNCTION' THEN
         PERFORM pg_catalog.nextval(
           '${context.schemaName}.${sentinelSequence}'::pg_catalog.regclass
         );
       END IF;
     END;
     $function$`
  )
  try {
    await context.adminClient.query(
      `CREATE EVENT TRIGGER ${quoteIdentifier(eventTriggerName)}
       ON ddl_command_end EXECUTE FUNCTION
       ${context.quotedSchemaName}.${quoteIdentifier(eventFunctionName)}()`
    )
    try {
      await expect(migrationClient.query(migrationSql)).rejects.toMatchObject({
        code: '42501'
      })
      await migrationClient.query('ROLLBACK')
      expect(await readLedger(context)).toHaveLength(expectedLedgerCount)
      expect(
        (
          await context.adminClient.query<{
            isCalled: boolean
            lastValue: string
          }>(
            `SELECT last_value::text AS "lastValue", is_called AS "isCalled"
             FROM ${context.quotedSchemaName}.${quoteIdentifier(sentinelSequence)}`
          )
        ).rows
      ).toEqual([{ isCalled: false, lastValue: '1' }])
    } finally {
      await context.adminClient.query(
        `DROP EVENT TRIGGER ${quoteIdentifier(eventTriggerName)}`
      )
    }
  } finally {
    await context.adminClient
      .query(
        `DROP FUNCTION IF EXISTS ${context.quotedSchemaName}.${quoteIdentifier(eventFunctionName)}()`
      )
      .catch(() => undefined)
    await context.adminClient
      .query(
        `DROP SEQUENCE IF EXISTS ${context.quotedSchemaName}.${quoteIdentifier(sentinelSequence)}`
      )
      .catch(() => undefined)
  }
}

const expectPublicReplicationParameterGrantAbsent = async (
  context: IsolatedUpgradeSchema
): Promise<void> => {
  expect(
    (
      await context.serverClient.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count
         FROM pg_catalog.pg_parameter_acl AS parameter_acl
         CROSS JOIN LATERAL pg_catalog.aclexplode(parameter_acl.paracl)
           AS acl_entry
         WHERE parameter_acl.parname = 'session_replication_role'
           AND acl_entry.grantee = 0
           AND acl_entry.privilege_type = 'SET'`
      )
    ).rows
  ).toEqual([{ count: 0 }])
}

const readDirectUserForeignKeyActions = async (
  client: Client
): Promise<
  Array<{
    constraintName: string
    deleteAction: string
    tableName: string
    updateAction: string
  }>
> => {
  const constraints = await client.query<{
    constraintName: string
    deleteAction: string
    tableName: string
    updateAction: string
  }>(
    `SELECT constraint_record.conname AS "constraintName",
       child.relname AS "tableName",
       constraint_record.confdeltype::text AS "deleteAction",
       constraint_record.confupdtype::text AS "updateAction"
     FROM pg_constraint AS constraint_record
     JOIN pg_class AS child ON child.oid = constraint_record.conrelid
     JOIN pg_namespace AS namespace ON namespace.oid = child.relnamespace
     JOIN pg_class AS parent ON parent.oid = constraint_record.confrelid
     WHERE namespace.nspname = current_schema()
       AND parent.relname = 'User'
       AND constraint_record.conname = ANY($1::text[])
     ORDER BY child.relname`,
    [
      [
        'StudySession_userId_fkey',
        'Bookmark_userId_fkey',
        'WrongNote_userId_fkey',
        'IdempotencyRecord_userId_fkey'
      ]
    ]
  )
  return constraints.rows
}

const readPhase6ProjectionDigest = async (client: Client): Promise<string> => {
  const questions = await client.query(
    `SELECT "id", "lifecycleStatus"::text, "currentPublishedVersionId",
       "createdByUserId", "createdByLabelSnapshot"::text,
       "createdAt", "updatedAt", "archivedAt"
     FROM "Question" ORDER BY "id"`
  )
  const versions = await client.query(
    `SELECT "id", "questionId", "versionNumber", "status"::text,
       "level"::text, "subject"::text, "questionType"::text, "passage",
       "questionText", "correctOptionId", "explanationKo", "explanationJa",
       "difficulty"::text, "sourceType"::text, "rowVersion",
       "createdByUserId", "createdByLabelSnapshot"::text,
       "createdAt", "updatedAt", "publishedAt", "retiredAt"
     FROM "QuestionVersion" ORDER BY "id"`
  )
  const options = await client.query(
    `SELECT "id", "questionVersionId", "label", "text", "ordinal"
     FROM "QuestionOption" ORDER BY "id"`
  )
  const tags = await client.query(
    `SELECT "id", "label", "normalizedName", "createdAt", "updatedAt"
     FROM "Tag" ORDER BY "id"`
  )
  const assignments = await client.query(
    `SELECT "id", "questionVersionId", "tagId", "labelSnapshot"
     FROM "QuestionVersionTag" ORDER BY "id"`
  )
  return createHash('sha256')
    .update(
      JSON.stringify({
        assignments: assignments.rows,
        options: options.rows,
        questions: questions.rows,
        tags: tags.rows,
        versions: versions.rows
      })
    )
    .digest('hex')
}

const readPhase6SemanticDigest = async (client: Client): Promise<string> => {
  const result = await client.query<{ digest: string }>(
    `SELECT encode(public.digest(convert_to(jsonb_build_object(
      'questions', (
        SELECT jsonb_agg(jsonb_build_object(
          'id', question."id",
          'lifecycle', question."lifecycleStatus",
          'pointer', question."currentPublishedVersionId",
          'creator', question."createdByLabelSnapshot"
        ) ORDER BY question."id")
        FROM "Question" AS question
      ),
      'versions', (
        SELECT jsonb_agg(jsonb_build_object(
          'id', version."id",
          'questionId', version."questionId",
          'versionNumber', version."versionNumber",
          'status', version."status",
          'level', version."level",
          'subject', version."subject",
          'questionType', version."questionType",
          'passage', version."passage",
          'questionText', version."questionText",
          'correctOptionId', version."correctOptionId",
          'explanationKo', version."explanationKo",
          'explanationJa', version."explanationJa",
          'difficulty', version."difficulty",
          'sourceType', version."sourceType",
          'rowVersion', version."rowVersion",
          'creator', version."createdByLabelSnapshot"
        ) ORDER BY version."id")
        FROM "QuestionVersion" AS version
      ),
      'options', (
        SELECT jsonb_agg(to_jsonb(option_row) ORDER BY option_row."id")
        FROM (
          SELECT "id", "questionVersionId", "label", "text", "ordinal"
          FROM "QuestionOption"
        ) AS option_row
      ),
      'tags', (
        SELECT jsonb_agg(to_jsonb(tag_row) ORDER BY tag_row."id")
        FROM (
          SELECT "id", "label", "normalizedName" FROM "Tag"
        ) AS tag_row
      ),
      'assignments', (
        SELECT jsonb_agg(to_jsonb(assignment_row)
          ORDER BY assignment_row."id")
        FROM (
          SELECT "id", "questionVersionId", "tagId", "labelSnapshot"
          FROM "QuestionVersionTag"
        ) AS assignment_row
      )
    )::text, 'UTF8'), 'sha256'), 'hex') AS digest`
  )
  const digest = result.rows[0]?.digest
  if (!digest) throw new Error('Phase 6 semantic digest is unavailable.')
  return digest
}

const bootstrapFreshCanonicalCatalog = async (
  context: IsolatedUpgradeSchema
): Promise<void> => {
  const runtimeDatabaseUrl = new URL(environment.DATABASE_URL)
  runtimeDatabaseUrl.searchParams.set('schema', context.schemaName)
  const seeded = await execFileAsync(
    process.execPath,
    ['--import', 'tsx', join(apiRoot, 'prisma', 'seed.ts')],
    {
      cwd: apiRoot,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        ADMIN_CMS_MODE: 'technical',
        SEED_TARGET: 'test',
        DATABASE_URL: runtimeDatabaseUrl.toString(),
        PHASE7_MIGRATION_DATABASE_URL: context.databaseUrl,
        PRISMA_TEST_DATABASE_URL: context.databaseUrl
      },
      timeout: 60_000
    }
  )
  expect(seeded.stdout).toContain(
    'Question catalog seed completed: 65 inserted, 0 verified.'
  )
  const counts = await context.adminClient.query<{
    questionCount: number
    versionCount: number
    optionCount: number
    tagCount: number
    versionTagCount: number
    applicabilityCount: number
  }>(
    `SELECT
      (SELECT COUNT(*)::int FROM ${context.quotedSchemaName}."Question") AS "questionCount",
      (SELECT COUNT(*)::int FROM ${context.quotedSchemaName}."QuestionVersion") AS "versionCount",
      (SELECT COUNT(*)::int FROM ${context.quotedSchemaName}."QuestionOption") AS "optionCount",
      (SELECT COUNT(*)::int FROM ${context.quotedSchemaName}."Tag") AS "tagCount",
      (SELECT COUNT(*)::int FROM ${context.quotedSchemaName}."QuestionVersionTag") AS "versionTagCount",
      (SELECT COUNT(*)::int FROM ${context.quotedSchemaName}."TagApplicability") AS "applicabilityCount"`
  )
  expect(counts.rows).toEqual([
    {
      questionCount: 65,
      versionCount: 65,
      optionCount: 260,
      tagCount: 107,
      versionTagCount: 130,
      applicabilityCount: 126
    }
  ])
}

describe('Phase 7 Slice 1 Phase 6 forward upgrade', () => {
  it('canonical non-super migration wrapper로 prefix37→canonical65→current53를 deploy하고 ledger를 finalize한다', async () => {
    const context = await createIsolatedUpgradeSchema()
    const legacyConnectInitiallyGranted =
      (
        await context.serverClient.query<{ granted: boolean }>(
          `SELECT EXISTS (
           SELECT 1 FROM pg_database AS db,
             LATERAL aclexplode(COALESCE(db.datacl, acldefault('d', db.datdba))) AS acl
           WHERE db.datname = $1 AND acl.grantee = to_regrole($2)
             AND acl.privilege_type = 'CONNECT'
         ) AS granted`,
          [context.databaseName, LEGACY_APP_LOGIN]
        )
      ).rows[0]?.granted === true
    try {
      // The preceding activation coverage intentionally removes the legacy
      // wrapper's cluster-global CONNECT grant. A pristine pre-Phase-7 deploy
      // requires the canonical seven-entry migration ACL, so this isolated
      // fixture adds that entry if missing, then restores the prior ACL state.
      await context.serverClient.query(
        `GRANT CONNECT ON DATABASE ${quoteIdentifier(context.databaseName)}
         TO ${quoteIdentifier(LEGACY_APP_LOGIN)}`
      )
      const lastBootstrapMigration =
        '20261009092000_phase7_n4_n2_revision2_digest_fix'
      const prefix = repositoryMigrationNames.filter(
        (name) => name <= lastBootstrapMigration
      )
      expect(repositoryMigrationNames).toHaveLength(53)
      expect(prefix).toHaveLength(37)
      expect(prefix.at(-1)).toBe(lastBootstrapMigration)
      for (const migrationName of prefix) {
        copyMigration(migrationName, context.migrationsPath)
      }
      await deploy(context)
      const prefixLedger = await readLedger(context)
      expect(prefixLedger).toHaveLength(37)
      expect(() =>
        assertMigrationCompatibility(
          loadExpectedMigrationManifest(sourceMigrationsDirectory).slice(0, 37),
          prefixLedger
        )
      ).not.toThrow()
      await bootstrapFreshCanonicalCatalog(context)
      const remainder = repositoryMigrationNames.slice(37)
      expect(remainder).toHaveLength(16)
      expect(remainder[0]).toBe(
        '20261009120000_phase7_approved_n4_reading_batch7_tags'
      )
      for (const migrationName of remainder) {
        copyMigration(migrationName, context.migrationsPath)
      }
      await deploy(context)
      const ledger = await readLedger(context)
      expect(ledger).toHaveLength(53)
      expect(ledger.map(({ migrationName }) => migrationName)).toEqual(
        repositoryMigrationNames
      )
      expect(
        ledger.slice(42, 50).map(({ migrationName }) => migrationName)
      ).toEqual([
        '20261019103000_sso_admin_fresh',
        '20261019110000_sso_admin_fresh_erasure_ownership',
        '20261019113000_sso_admin_fresh_column_qualification',
        '20261020230000_sso_account_lifecycle',
        '20261020233000_sso_first_admin_bootstrap',
        '20261028090000_sso_account_erasure_worker_queue',
        '20261028120000_sso_account_erasure_claim_lease',
        '20261028150000_sso_provider_cleanup_fencing'
      ])
      expect(
        ledger.slice(50).map(({ migrationName }) => migrationName)
      ).toEqual([
        '20261028160000_study_contract_v2_default',
        '20261028170000_study_v1_retirement_authority',
        '20261030100000_guest_expired_draft_retention'
      ])
      expect(
        ledger.every(
          ({ finishedAt, logs, rolledBackAt }) =>
            finishedAt !== null && logs === null && rolledBackAt === null
        )
      ).toBe(true)
      expect(
        ledger
          .slice(44, 50)
          .every(
            ({ finishedAt, rolledBackAt }) =>
              finishedAt !== null && rolledBackAt === null
          )
      ).toBe(true)
      expect(() =>
        assertMigrationCompatibility(
          loadExpectedMigrationManifest(sourceMigrationsDirectory),
          ledger
        )
      ).not.toThrow()
      await verifyCanonicalMigrationLedgerAccess(context, 53)
      expect(
        (
          await context.adminClient.query<{
            databaseOwner: string
            ledgerOwner: string
            schemaOwner: string
          }>(
            `SELECT database_owner.rolname AS "databaseOwner",
               schema_owner.rolname AS "schemaOwner",
               ledger_owner.rolname AS "ledgerOwner"
             FROM pg_database AS database_record
             JOIN pg_roles AS database_owner
               ON database_owner.oid = database_record.datdba
             JOIN pg_namespace AS namespace
               ON namespace.nspname = $1
             JOIN pg_roles AS schema_owner
               ON schema_owner.oid = namespace.nspowner
             JOIN pg_class AS ledger
               ON ledger.relnamespace = namespace.oid
              AND ledger.relname = '_prisma_migrations'
             JOIN pg_roles AS ledger_owner ON ledger_owner.oid = ledger.relowner
             WHERE database_record.datname = current_database()`,
            [context.schemaName]
          )
        ).rows
      ).toEqual([
        {
          databaseOwner: MIGRATION_ROLE,
          ledgerOwner: 'nihongo_phase7_owner',
          schemaOwner: 'nihongo_phase7_owner'
        }
      ])
    } finally {
      if (!legacyConnectInitiallyGranted) {
        await context.serverClient
          .query(
            `REVOKE CONNECT ON DATABASE ${quoteIdentifier(context.databaseName)}
             FROM ${quoteIdentifier(LEGACY_APP_LOGIN)}`
          )
          .catch(() => undefined)
      }
      await dispose(context)
    }
  }, 180_000)

  it('canonical non-super wrapper로 65문항 upgrade를 27→31 byte/row parity로 배포한다', async () => {
    const context = await createIsolatedUpgradeSchema()
    const columnAclRogueRole = `phase7_column_acl_${randomUUID().replaceAll('-', '')}`
    let columnAclRogueCreated = false
    let phase6Legacy:
      | Awaited<ReturnType<typeof exercisePhase6LegacyCompatibility>>
      | undefined
    let sequentialMigrationClient: Client | undefined
    let sequentialMigrationBackend:
      | Array<{ currentRole: string; pid: number; sessionUser: string }>
      | undefined
    try {
      const { historicalManifest, phase6MigrationNames } =
        readHistoricalMigrationProfile()

      for (const migrationName of phase6MigrationNames) {
        copyMigration(migrationName, context.migrationsPath)
      }
      await deploy(context, context.legacyOwnerDatabaseUrl)
      expect(await readLedger(context)).toHaveLength(27)
      await context.adminClient.query(
        `SET search_path TO ${context.quotedSchemaName}`
      )
      await expect(seedPhase6Catalog(context.adminClient)).resolves.toEqual({
        insertedCount: 65,
        verifiedCount: 0
      })
      phase6Legacy = await exercisePhase6LegacyCompatibility(context)
      const beforeDigest = await readPhase6ProjectionDigest(context.adminClient)
      const semanticDigest = await readPhase6SemanticDigest(context.adminClient)
      expect(semanticDigest).toBe(PHASE6_SEMANTIC_DIGEST)
      process.stdout.write(
        `${JSON.stringify({
          event: 'phase7.db.upgrade.phase6_semantic_digest',
          digest: semanticDigest
        })}\n`
      )

      const enumSql = readFileSync(
        join(sourceMigrationsDirectory, PHASE7_MIGRATIONS[0], 'migration.sql'),
        'utf8'
      )
      const dirtyShapeUrl = new URL(context.databaseUrl)
      dirtyShapeUrl.searchParams.delete('schema')
      dirtyShapeUrl.searchParams.delete('options')
      const dirtyShapeClient = new Client({
        connectionString: dirtyShapeUrl.toString(),
        options:
          `-c search_path=${context.schemaName} -c TimeZone=UTC ` +
          `-c role=${MIGRATION_ROLE}`
      })
      await dirtyShapeClient.connect()
      try {
        expect(await readNonCanonicalTargetOwnerCount(context)).toBeGreaterThan(
          0
        )
        await expect(dirtyShapeClient.query(enumSql)).rejects.toMatchObject({
          code: '42501'
        })
        await dirtyShapeClient.query('ROLLBACK')
        expect(await readLedger(context)).toHaveLength(27)
        expect(
          (
            await context.adminClient.query<{ labels: string[] }>(
              `SELECT array_agg(enum_row.enumlabel
                 ORDER BY enum_row.enumsortorder)::text[] AS labels
               FROM pg_catalog.pg_type AS type_record
               JOIN pg_catalog.pg_namespace AS namespace
                 ON namespace.oid = type_record.typnamespace
               JOIN pg_catalog.pg_enum AS enum_row
                 ON enum_row.enumtypid = type_record.oid
               WHERE namespace.nspname = current_schema()
                 AND type_record.typname = 'QuestionVersionStatus'`
            )
          ).rows
        ).toEqual([{ labels: ['DRAFT', 'PUBLISHED', 'RETIRED'] }])

        await transferPhase6TargetOwnership(context)

        const expectEnumPrewriteRejected = async (
          expectedCodes: readonly string[] = ['42501']
        ): Promise<void> => {
          let errorCode: unknown
          try {
            await dirtyShapeClient.query(enumSql)
          } catch (error: unknown) {
            errorCode = (error as { code?: unknown }).code
          }
          expect(expectedCodes).toContain(errorCode)
          await dirtyShapeClient.query('ROLLBACK')
          expect(await readLedger(context)).toHaveLength(27)
          expect(
            (
              await context.adminClient.query<{ labels: string[] }>(
                `SELECT array_agg(enum_row.enumlabel
                   ORDER BY enum_row.enumsortorder)::text[] AS labels
                 FROM pg_catalog.pg_type AS type_record
                 JOIN pg_catalog.pg_namespace AS namespace
                   ON namespace.oid = type_record.typnamespace
                 JOIN pg_catalog.pg_enum AS enum_row
                   ON enum_row.enumtypid = type_record.oid
                 WHERE namespace.nspname = current_schema()
                   AND type_record.typname = 'QuestionVersionStatus'`
              )
            ).rows
          ).toEqual([{ labels: ['DRAFT', 'PUBLISHED', 'RETIRED'] }])
        }

        const inboundWrapperRogue = `phase7_inbound_${randomUUID().replaceAll('-', '')}`
        await context.serverClient.query(
          `CREATE ROLE ${quoteIdentifier(inboundWrapperRogue)}
           LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
           NOREPLICATION NOBYPASSRLS`
        )
        try {
          await context.serverClient.query(
            `GRANT ${quoteIdentifier(CANONICAL_MIGRATION_LOGIN)}
             TO ${quoteIdentifier(inboundWrapperRogue)}
             WITH ADMIN FALSE, INHERIT FALSE, SET TRUE`
          )
          await expectEnumPrewriteRejected()
        } finally {
          await context.serverClient.query(
            `REVOKE ${quoteIdentifier(CANONICAL_MIGRATION_LOGIN)}
             FROM ${quoteIdentifier(inboundWrapperRogue)}`
          )
          await context.serverClient.query(
            `DROP ROLE ${quoteIdentifier(inboundWrapperRogue)}`
          )
        }

        await context.serverClient.query(
          `GRANT "nihongo_auth_gateway"
           TO "nihongo_development_app_login"
           WITH ADMIN FALSE, INHERIT FALSE, SET TRUE`
        )
        try {
          await expectEnumPrewriteRejected()
        } finally {
          await context.serverClient.query(
            `REVOKE "nihongo_auth_gateway"
             FROM "nihongo_development_app_login"`
          )
        }

        await context.serverClient.query(
          `ALTER ROLE ${quoteIdentifier(CANONICAL_MIGRATION_LOGIN)}
           SET session_replication_role = replica`
        )
        try {
          const replicaClient = new Client({
            connectionString: dirtyShapeUrl.toString(),
            options:
              `-c search_path=${context.schemaName} -c TimeZone=UTC ` +
              `-c role=${MIGRATION_ROLE}`
          })
          await replicaClient.connect()
          try {
            let replicaErrorCode: unknown
            try {
              await replicaClient.query(enumSql)
            } catch (error: unknown) {
              replicaErrorCode = (error as { code?: unknown }).code
            }
            expect(replicaErrorCode).toBe('42501')
            await replicaClient.query('ROLLBACK')
          } finally {
            await replicaClient.end()
          }
          expect(await readLedger(context)).toHaveLength(27)
        } finally {
          await context.serverClient.query(
            `ALTER ROLE ${quoteIdentifier(CANONICAL_MIGRATION_LOGIN)}
             RESET session_replication_role`
          )
        }

        await expectPublicReplicationParameterGrantAbsent(context)
        await context.serverClient.query(
          `GRANT SET ON PARAMETER session_replication_role TO PUBLIC`
        )
        try {
          await expectEnumPrewriteRejected()
        } finally {
          await context.serverClient.query(
            `REVOKE SET ON PARAMETER session_replication_role FROM PUBLIC`
          )
          await expectPublicReplicationParameterGrantAbsent(context)
        }

        await expectExternalTargetDependencyRejected({
          client: dirtyShapeClient,
          context,
          expectedLedgerCount: 27,
          migrationSql: enumSql
        })

        await expectEventTriggerBoundaryRejected({
          client: dirtyShapeClient,
          context,
          expectedLedgerCount: 27,
          migrationSql: enumSql
        })

        const inheritedTableName = `phase7_inherit_${randomUUID().replaceAll('-', '')}`
        await context.adminClient.query(
          `CREATE TABLE ${quoteIdentifier(inheritedTableName)} ()
           INHERITS ("User")`
        )
        try {
          await expectEnumPrewriteRejected()
        } finally {
          await context.adminClient.query(
            `DROP TABLE ${quoteIdentifier(inheritedTableName)}`
          )
        }

        const publicationName = `phase7_pub_${randomUUID().replaceAll('-', '')}`
        await context.adminClient.query(
          `CREATE PUBLICATION ${quoteIdentifier(publicationName)}
           FOR TABLE "User"`
        )
        try {
          await expectEnumPrewriteRejected()
        } finally {
          await context.adminClient.query(
            `DROP PUBLICATION ${quoteIdentifier(publicationName)}`
          )
        }

        const internalTrigger = await context.adminClient.query<{
          name: string
          tableName: string
        }>(
          `SELECT trigger_row.tgname AS name,
             relation.relname AS "tableName"
           FROM pg_catalog.pg_trigger AS trigger_row
           JOIN pg_catalog.pg_class AS relation
             ON relation.oid = trigger_row.tgrelid
           JOIN pg_catalog.pg_namespace AS namespace
             ON namespace.oid = relation.relnamespace
           WHERE namespace.nspname = current_schema()
             AND trigger_row.tgisinternal
             AND trigger_row.tgconstraint <> 0
             AND trigger_row.tgenabled = 'O'
           ORDER BY relation.relname, trigger_row.tgname LIMIT 1`
        )
        const internalTriggerRow = internalTrigger.rows[0]
        if (!internalTriggerRow) {
          throw new Error('Phase 6 internal FK trigger fixture is unavailable.')
        }
        await context.adminClient.query(
          `ALTER TABLE ${quoteIdentifier(internalTriggerRow.tableName)}
           DISABLE TRIGGER ${quoteIdentifier(internalTriggerRow.name)}`
        )
        try {
          await expectEnumPrewriteRejected()
        } finally {
          await context.adminClient.query(
            `ALTER TABLE ${quoteIdentifier(internalTriggerRow.tableName)}
             ENABLE TRIGGER ${quoteIdentifier(internalTriggerRow.name)}`
          )
        }

        await context.adminClient.query(
          `ALTER TABLE "User" ADD COLUMN "phase7UnexpectedShape" text`
        )
        let dirtyShapeCode: unknown
        try {
          await dirtyShapeClient.query(enumSql)
        } catch (error: unknown) {
          dirtyShapeCode = (error as { code?: unknown }).code
        }
        expect(['42501', '55000']).toContain(dirtyShapeCode)
        await dirtyShapeClient.query('ROLLBACK')
      } finally {
        await dirtyShapeClient.query('ROLLBACK').catch(() => undefined)
        await dirtyShapeClient.end()
      }
      expect(await readLedger(context)).toHaveLength(27)
      expect(
        (
          await context.adminClient.query<{ labels: string[] }>(
            `SELECT array_agg(enum_row.enumlabel ORDER BY enum_row.enumsortorder)::text[]
               AS labels
             FROM pg_type AS type_record
             JOIN pg_namespace AS namespace
               ON namespace.oid = type_record.typnamespace
             JOIN pg_enum AS enum_row ON enum_row.enumtypid = type_record.oid
             WHERE namespace.nspname = current_schema()
               AND type_record.typname = 'QuestionVersionStatus'`
          )
        ).rows
      ).toEqual([{ labels: ['DRAFT', 'PUBLISHED', 'RETIRED'] }])
      await context.adminClient.query(
        `ALTER TABLE "User" DROP COLUMN "phase7UnexpectedShape"`
      )
      await expectTempSearchPathMigrationRejected({
        context,
        expectedLedgerCount: 27,
        migrationSql: enumSql
      })
      expect(
        (
          await context.adminClient.query<{ labels: string[] }>(
            `SELECT array_agg(enum_row.enumlabel ORDER BY enum_row.enumsortorder)::text[]
               AS labels
             FROM pg_type AS type_record
             JOIN pg_namespace AS namespace
               ON namespace.oid = type_record.typnamespace
             JOIN pg_enum AS enum_row ON enum_row.enumtypid = type_record.oid
             WHERE namespace.nspname = current_schema()
               AND type_record.typname = 'QuestionVersionStatus'`
          )
        ).rows
      ).toEqual([{ labels: ['DRAFT', 'PUBLISHED', 'RETIRED'] }])

      copyMigration(PHASE7_MIGRATIONS[0], context.migrationsPath)
      const sequentialMigrationUrl = new URL(context.databaseUrl)
      sequentialMigrationUrl.searchParams.delete('schema')
      sequentialMigrationUrl.searchParams.delete('options')
      const connectedSequentialMigrationClient = new Client({
        connectionString: sequentialMigrationUrl.toString(),
        options:
          `-c search_path=${context.schemaName} -c TimeZone=UTC ` +
          `-c role=${MIGRATION_ROLE}`
      })
      sequentialMigrationClient = connectedSequentialMigrationClient
      await connectedSequentialMigrationClient.connect()
      sequentialMigrationBackend = (
        await connectedSequentialMigrationClient.query<{
          currentRole: string
          pid: number
          sessionUser: string
        }>(
          `SELECT pg_backend_pid() AS pid, current_user AS "currentRole",
             session_user AS "sessionUser"`
        )
      ).rows
      expect(sequentialMigrationBackend).toEqual([
        {
          currentRole: MIGRATION_ROLE,
          pid: expect.any(Number),
          sessionUser: CANONICAL_MIGRATION_LOGIN
        }
      ])
      await applyMigrationOnCurrentBackend({
        client: connectedSequentialMigrationClient,
        migrationName: PHASE7_MIGRATIONS[0],
        migrationSql: enumSql
      })
      const enumLedger = await readLedger(context)
      expect(enumLedger).toHaveLength(28)
      expect(enumLedger.at(-1)).toMatchObject({
        finishedAt: expect.any(Date),
        migrationName: PHASE7_MIGRATIONS[0],
        rolledBackAt: null
      })
      expect(
        (
          await context.adminClient.query<{ labels: string[] }>(
            `SELECT array_agg(enum_row.enumlabel ORDER BY enum_row.enumsortorder)::text[]
               AS labels
             FROM pg_type AS type_record
             JOIN pg_namespace AS namespace
               ON namespace.oid = type_record.typnamespace
             JOIN pg_enum AS enum_row ON enum_row.enumtypid = type_record.oid
             WHERE namespace.nspname = current_schema()
               AND type_record.typname = 'QuestionVersionStatus'`
          )
        ).rows
      ).toEqual([
        {
          labels: [
            'DRAFT',
            'IN_REVIEW',
            'CHANGES_REQUESTED',
            'APPROVED',
            'PUBLISHED',
            'RETIRED'
          ]
        }
      ])

      const foundationSql = readFileSync(
        join(sourceMigrationsDirectory, PHASE7_MIGRATIONS[1], 'migration.sql'),
        'utf8'
      )
      await expectTempSearchPathMigrationRejected({
        context,
        expectedLedgerCount: 28,
        migrationSql: foundationSql
      })
      expect(
        (
          await context.adminClient.query<{
            contentReview: string | null
            operationIntent: string | null
          }>(
            `SELECT to_regclass('"ContentReview"')::text AS "contentReview",
               to_regclass('"Phase7OperationIntent"')::text
                 AS "operationIntent"`
          )
        ).rows
      ).toEqual([{ contentReview: null, operationIntent: null }])

      const expectFoundationPreflightRollback = async (
        expectedCode: '42501' | '55000' = '42501'
      ): Promise<void> => {
        await expect(
          connectedSequentialMigrationClient.query(foundationSql)
        ).rejects.toMatchObject({ code: expectedCode })
        await connectedSequentialMigrationClient.query('ROLLBACK')
        expect(await readLedger(context)).toHaveLength(28)
        expect(
          (
            await context.adminClient.query<{
              contentReview: string | null
              operationIntent: string | null
            }>(
              `SELECT to_regclass('"ContentReview"')::text
                   AS "contentReview",
                 to_regclass('"Phase7OperationIntent"')::text
                   AS "operationIntent"`
            )
          ).rows
        ).toEqual([{ contentReview: null, operationIntent: null }])
      }

      await context.serverClient.query(
        `GRANT "nihongo_auth_gateway"
         TO "nihongo_development_app_login"
         WITH ADMIN FALSE, INHERIT FALSE, SET TRUE`
      )
      try {
        await expectFoundationPreflightRollback()
      } finally {
        await context.serverClient.query(
          `REVOKE "nihongo_auth_gateway"
           FROM "nihongo_development_app_login"`
        )
      }

      await expectPublicReplicationParameterGrantAbsent(context)
      await context.serverClient.query(
        `GRANT SET ON PARAMETER session_replication_role TO PUBLIC`
      )
      try {
        await expectFoundationPreflightRollback()
      } finally {
        await context.serverClient.query(
          `REVOKE SET ON PARAMETER session_replication_role FROM PUBLIC`
        )
        await expectPublicReplicationParameterGrantAbsent(context)
      }

      await expectExternalTargetDependencyRejected({
        client: connectedSequentialMigrationClient,
        context,
        expectedLedgerCount: 28,
        migrationSql: foundationSql
      })
      await expectEventTriggerBoundaryRejected({
        client: connectedSequentialMigrationClient,
        context,
        expectedLedgerCount: 28,
        migrationSql: foundationSql
      })

      await context.adminClient.query(
        `CREATE VIEW "Phase7RogueAuthView" AS
           SELECT "id", "email" FROM "User"`
      )
      await context.adminClient.query(
        `GRANT SELECT ON "Phase7RogueAuthView" TO PUBLIC, "nihongo_app"`
      )
      await expectFoundationPreflightRollback()
      await context.adminClient.query(`DROP VIEW "Phase7RogueAuthView"`)
      expect(
        (
          await context.adminClient.query<{ objectName: string | null }>(
            `SELECT to_regclass('"Phase7RogueAuthView"')::text
               AS "objectName"`
          )
        ).rows
      ).toEqual([{ objectName: null }])

      await context.adminClient.query(
        `CREATE MATERIALIZED VIEW "Phase7RogueAuthMaterializedView" AS
           SELECT "id", "email" FROM "User" WITH NO DATA`
      )
      await context.adminClient.query(
        `GRANT SELECT ON "Phase7RogueAuthMaterializedView"
         TO PUBLIC, "nihongo_app"`
      )
      await expectFoundationPreflightRollback()
      await context.adminClient.query(
        `DROP MATERIALIZED VIEW "Phase7RogueAuthMaterializedView"`
      )
      expect(
        (
          await context.adminClient.query<{ objectName: string | null }>(
            `SELECT to_regclass('"Phase7RogueAuthMaterializedView"')::text
               AS "objectName"`
          )
        ).rows
      ).toEqual([{ objectName: null }])

      await context.adminClient.query(
        `CREATE PROCEDURE "phase7_rogue_auth_procedure"()
         LANGUAGE plpgsql SECURITY DEFINER
         SET search_path = pg_catalog
         AS $$ BEGIN NULL; END; $$`
      )
      await context.adminClient.query(
        `GRANT EXECUTE ON PROCEDURE "phase7_rogue_auth_procedure"()
         TO PUBLIC, "nihongo_app"`
      )
      await expectFoundationPreflightRollback()
      await context.adminClient.query(
        `DROP PROCEDURE "phase7_rogue_auth_procedure"()`
      )
      expect(
        (
          await context.adminClient.query<{ objectName: string | null }>(
            `SELECT to_regprocedure('"phase7_rogue_auth_procedure"()')::text
               AS "objectName"`
          )
        ).rows
      ).toEqual([{ objectName: null }])

      await context.adminClient.query(
        `CREATE TRIGGER "Phase7RogueStudySessionTrigger"
         BEFORE UPDATE ON "StudySession" FOR EACH ROW
         EXECUTE FUNCTION "protect_study_session_created_at"()`
      )
      await expectFoundationPreflightRollback('55000')
      await context.adminClient.query(
        `DROP TRIGGER "Phase7RogueStudySessionTrigger" ON "StudySession"`
      )
      expect(
        (
          await context.adminClient.query<{ count: number }>(
            `SELECT COUNT(*)::int AS count FROM pg_trigger AS trigger_record
             JOIN pg_class AS relation
               ON relation.oid = trigger_record.tgrelid
             JOIN pg_namespace AS namespace
               ON namespace.oid = relation.relnamespace
             WHERE namespace.nspname = current_schema()
               AND trigger_record.tgname = 'Phase7RogueStudySessionTrigger'`
          )
        ).rows
      ).toEqual([{ count: 0 }])

      await context.adminClient.query(
        `CREATE RULE "Phase7RogueUserRule" AS
         ON UPDATE TO "User" DO ALSO NOTHING`
      )
      await expectFoundationPreflightRollback('55000')
      await context.adminClient.query(
        `DROP RULE "Phase7RogueUserRule" ON "User"`
      )
      expect(
        (
          await context.adminClient.query<{ count: number }>(
            `SELECT COUNT(*)::int AS count FROM pg_rewrite AS rewrite
             JOIN pg_class AS relation ON relation.oid = rewrite.ev_class
             JOIN pg_namespace AS namespace
               ON namespace.oid = relation.relnamespace
             WHERE namespace.nspname = current_schema()
               AND rewrite.rulename = 'Phase7RogueUserRule'`
          )
        ).rows
      ).toEqual([{ count: 0 }])

      if (!IDENTIFIER_PATTERN.test(columnAclRogueRole)) {
        throw new Error('Phase 7 column ACL rogue role is unsafe.')
      }
      await context.serverClient.query(
        `CREATE ROLE ${quoteIdentifier(columnAclRogueRole)}
         NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
         NOREPLICATION NOBYPASSRLS`
      )
      columnAclRogueCreated = true
      const columnAclPrincipals = [
        'PUBLIC',
        'nihongo_app',
        'nihongo_auth_gateway',
        'nihongo_erasure_worker',
        CANONICAL_MIGRATION_LOGIN,
        LEGACY_APP_LOGIN,
        columnAclRogueRole
      ]
        .map((roleName) =>
          roleName === 'PUBLIC' ? roleName : quoteIdentifier(roleName)
        )
        .join(', ')
      const columnAclTargets = [
        ['User', 'email'],
        ['Account', 'password'],
        ['Session', 'token'],
        ['Verification', 'value']
      ] as const
      try {
        for (const [tableName, columnName] of columnAclTargets) {
          await context.adminClient.query(
            `GRANT SELECT (${quoteIdentifier(columnName)}),
               UPDATE (${quoteIdentifier(columnName)})
             ON TABLE ${quoteIdentifier(tableName)} TO ${columnAclPrincipals}`
          )
        }
        await context.adminClient.query(
          `ALTER TABLE "_prisma_migrations" ENABLE ROW LEVEL SECURITY`
        )
        await context.adminClient.query(
          `CREATE POLICY phase7_rogue_ledger_policy
           ON "_prisma_migrations" USING (true) WITH CHECK (true)`
        )
        await expectFoundationPreflightRollback('55000')
      } finally {
        await context.adminClient
          .query(
            `DROP POLICY IF EXISTS phase7_rogue_ledger_policy
             ON "_prisma_migrations"`
          )
          .catch(() => undefined)
        await context.adminClient
          .query(`ALTER TABLE "_prisma_migrations" DISABLE ROW LEVEL SECURITY`)
          .catch(() => undefined)
        for (const [tableName, columnName] of columnAclTargets) {
          await context.adminClient
            .query(
              `REVOKE SELECT (${quoteIdentifier(columnName)}),
                 UPDATE (${quoteIdentifier(columnName)})
               ON TABLE ${quoteIdentifier(tableName)}
               FROM ${columnAclPrincipals}`
            )
            .catch(() => undefined)
        }
      }
      expect(
        (
          await context.adminClient.query<{
            columnAclCount: number
            policyCount: number
            rowSecurity: boolean
          }>(
            `SELECT ledger.relrowsecurity AS "rowSecurity",
               (SELECT COUNT(*)::int FROM pg_catalog.pg_policy AS policy
                WHERE policy.polrelid = ledger.oid) AS "policyCount",
               (SELECT COUNT(*)::int
                FROM pg_catalog.pg_attribute AS attribute_record
                JOIN pg_catalog.pg_class AS auth_table
                  ON auth_table.oid = attribute_record.attrelid
                JOIN pg_catalog.pg_namespace AS auth_namespace
                  ON auth_namespace.oid = auth_table.relnamespace
                WHERE auth_namespace.nspname = current_schema()
                  AND auth_table.relname = ANY($1::text[])
                  AND attribute_record.attnum > 0
                  AND attribute_record.attacl IS NOT NULL
                  AND cardinality(attribute_record.attacl) > 0)
                 AS "columnAclCount"
             FROM pg_catalog.pg_class AS ledger
             JOIN pg_catalog.pg_namespace AS namespace
               ON namespace.oid = ledger.relnamespace
             WHERE namespace.nspname = current_schema()
               AND ledger.relname = '_prisma_migrations'`,
            [['User', 'Account', 'Session', 'Verification']]
          )
        ).rows
      ).toEqual([{ columnAclCount: 0, policyCount: 0, rowSecurity: false }])
      for (const protectedWrapper of [
        CANONICAL_MIGRATION_LOGIN,
        LEGACY_APP_LOGIN
      ]) {
        const inboundRogueRole = `phase7_inbound_${randomUUID().replaceAll('-', '')}`
        if (!IDENTIFIER_PATTERN.test(inboundRogueRole)) {
          throw new Error('Inbound wrapper membership fixture is unsafe.')
        }
        await context.serverClient.query(
          `CREATE ROLE ${quoteIdentifier(inboundRogueRole)}
           LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
           NOREPLICATION NOBYPASSRLS`
        )
        try {
          await context.serverClient.query(
            `GRANT ${quoteIdentifier(protectedWrapper)}
             TO ${quoteIdentifier(inboundRogueRole)}
             WITH ADMIN FALSE, INHERIT FALSE, SET TRUE`
          )
          await expect(
            connectedSequentialMigrationClient.query(foundationSql)
          ).rejects.toMatchObject({ code: '42501' })
          await connectedSequentialMigrationClient.query('ROLLBACK')
          expect(await readLedger(context)).toHaveLength(28)
          expect(
            (
              await context.adminClient.query<{
                contentReview: string | null
              }>(
                `SELECT to_regclass('"ContentReview"')::text
                   AS "contentReview"`
              )
            ).rows
          ).toEqual([{ contentReview: null }])
        } finally {
          await context.adminClient.query('ROLLBACK').catch(() => undefined)
          await context.serverClient
            .query(
              `REVOKE ${quoteIdentifier(protectedWrapper)}
               FROM ${quoteIdentifier(inboundRogueRole)}`
            )
            .catch(() => undefined)
          await context.serverClient
            .query(`DROP ROLE IF EXISTS ${quoteIdentifier(inboundRogueRole)}`)
            .catch(() => undefined)
        }
      }
      const arbitraryCreatorRole = `phase7_creator_${randomUUID().replaceAll('-', '')}`
      const arbitraryCreatorPassword = randomUUID().replaceAll('-', '')
      if (
        !IDENTIFIER_PATTERN.test(arbitraryCreatorRole) ||
        !/^[a-f0-9]{32}$/u.test(arbitraryCreatorPassword)
      ) {
        throw new Error('Arbitrary CREATEROLE fixture is unsafe.')
      }
      await context.serverClient.query(
        `CREATE ROLE ${quoteIdentifier(arbitraryCreatorRole)}
         LOGIN NOINHERIT NOSUPERUSER NOCREATEDB CREATEROLE
         NOREPLICATION NOBYPASSRLS PASSWORD '${arbitraryCreatorPassword}'`
      )
      const arbitraryUrl = new URL(context.databaseUrl)
      arbitraryUrl.username = arbitraryCreatorRole
      arbitraryUrl.password = arbitraryCreatorPassword
      arbitraryUrl.searchParams.delete('schema')
      arbitraryUrl.searchParams.delete('options')
      const arbitraryClient = new Client({
        connectionString: arbitraryUrl.toString(),
        options:
          `-c search_path=${context.schemaName} -c TimeZone=UTC ` +
          `-c role=${MIGRATION_ROLE}`
      })
      try {
        await context.serverClient.query(
          `GRANT ${quoteIdentifier(MIGRATION_ROLE)}
           TO ${quoteIdentifier(arbitraryCreatorRole)}
           WITH ADMIN FALSE, INHERIT FALSE, SET TRUE`
        )
        await context.serverClient.query(
          `GRANT CONNECT ON DATABASE ${quoteIdentifier(context.databaseName)}
           TO ${quoteIdentifier(arbitraryCreatorRole)}`
        )
        await arbitraryClient.connect()
        await expect(
          arbitraryClient.query(foundationSql)
        ).rejects.toMatchObject({ code: '42501' })
        await arbitraryClient.query('ROLLBACK')
        expect(await readLedger(context)).toHaveLength(28)
        expect(
          (
            await context.adminClient.query<{
              contentReview: string | null
              operationIntent: string | null
            }>(
              `SELECT to_regclass('"ContentReview"')::text AS "contentReview",
                 to_regclass('"Phase7OperationIntent"')::text
                   AS "operationIntent"`
            )
          ).rows
        ).toEqual([{ contentReview: null, operationIntent: null }])
      } finally {
        await arbitraryClient.end().catch(() => undefined)
        await context.serverClient
          .query(
            `REVOKE CONNECT ON DATABASE ${quoteIdentifier(context.databaseName)}
             FROM ${quoteIdentifier(arbitraryCreatorRole)}`
          )
          .catch(() => undefined)
        await context.serverClient
          .query(
            `REVOKE ${quoteIdentifier(MIGRATION_ROLE)}
             FROM ${quoteIdentifier(arbitraryCreatorRole)}`
          )
          .catch(() => undefined)
        await context.serverClient
          .query(`DROP ROLE IF EXISTS ${quoteIdentifier(arbitraryCreatorRole)}`)
          .catch(() => undefined)
      }

      const rogueRoleName = `phase7_rogue_${randomUUID().replaceAll('-', '')}`
      if (!/^phase7_rogue_[a-f0-9]{32}$/u.test(rogueRoleName)) {
        throw new Error('Rogue membership fixture role is unsafe.')
      }
      await context.adminClient.query(`CREATE ROLE "${rogueRoleName}" NOLOGIN`)
      try {
        await context.adminClient.query(
          `GRANT "nihongo_app" TO "${rogueRoleName}"`
        )
        await expect(
          connectedSequentialMigrationClient.query(foundationSql)
        ).rejects.toMatchObject({ code: '42501' })
        await connectedSequentialMigrationClient.query('ROLLBACK')
        expect(await readLedger(context)).toHaveLength(28)
        expect(
          (
            await context.adminClient.query<{ contentReview: string | null }>(
              `SELECT to_regclass('"ContentReview"')::text AS "contentReview"`
            )
          ).rows
        ).toEqual([{ contentReview: null }])
      } finally {
        await context.adminClient.query('ROLLBACK').catch(() => undefined)
        await context.adminClient
          .query(`REVOKE "nihongo_app" FROM "${rogueRoleName}"`)
          .catch(() => undefined)
        await context.adminClient
          .query(`DROP ROLE IF EXISTS "${rogueRoleName}"`)
          .catch(() => undefined)
      }

      const firstTag = buildPhase6CanonicalSeeds()[0]?.tags[0]
      if (!firstTag) {
        throw new Error('Phase 7 upgrade drift fixture is unavailable.')
      }
      await context.adminClient.query(
        `UPDATE "Tag"
         SET "normalizedName" = "normalizedName" || '-upgrade-drift'
         WHERE "id" = $1`,
        [firstTag.id]
      )

      await expect(
        connectedSequentialMigrationClient.query(foundationSql)
      ).rejects.toMatchObject({ code: '23514' })
      await connectedSequentialMigrationClient.query('ROLLBACK')
      expect(await readLedger(context)).toHaveLength(28)
      expect(
        (
          await context.adminClient.query<{
            contentReviewTable: string | null
            fingerprintColumn: string | null
          }>(
            `SELECT
              to_regclass('"ContentReview"')::text AS "contentReviewTable",
              (
                SELECT column_name
                FROM information_schema.columns
                WHERE table_schema = current_schema()
                  AND table_name = 'QuestionVersion'
                  AND column_name = 'contentFingerprint'
              ) AS "fingerprintColumn"`
          )
        ).rows
      ).toEqual([{ contentReviewTable: null, fingerprintColumn: null }])

      await context.adminClient.query(
        `UPDATE "Tag" SET "normalizedName" = $1 WHERE "id" = $2`,
        [firstTag.normalizedName, firstTag.id]
      )
      expect(await readPhase6ProjectionDigest(context.adminClient)).toBe(
        beforeDigest
      )

      copyMigration(PHASE7_MIGRATIONS[1], context.migrationsPath)
      await applyMigrationOnCurrentBackend({
        client: connectedSequentialMigrationClient,
        migrationName: PHASE7_MIGRATIONS[1],
        migrationSql: foundationSql
      })
      await connectedSequentialMigrationClient.query('BEGIN')
      try {
        expect(
          (
            await connectedSequentialMigrationClient.query<{
              migrationCount: number
            }>(
              `SELECT COUNT(*)::int AS "migrationCount"
               FROM "_prisma_migrations"
               WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`
            )
          ).rows
        ).toEqual([{ migrationCount: 29 }])
        await connectedSequentialMigrationClient.query('COMMIT')
      } catch (error: unknown) {
        await connectedSequentialMigrationClient.query('ROLLBACK')
        throw error
      }
      expect(
        (
          await connectedSequentialMigrationClient.query<{
            currentRole: string
            pid: number
            sessionUser: string
          }>(
            `SELECT pg_backend_pid() AS pid, current_user AS "currentRole",
               session_user AS "sessionUser"`
          )
        ).rows
      ).toEqual(sequentialMigrationBackend)
      const phase7FoundationLedger = await readLedger(context)
      expect(phase7FoundationLedger).toHaveLength(29)
      expect(
        phase7FoundationLedger
          .slice(-2)
          .every(
            ({ finishedAt, rolledBackAt }) =>
              finishedAt !== null && rolledBackAt === null
          )
      ).toBe(true)
      const verifierCatalogBefore =
        await readOperationManifestVerifierCatalog(context)
      expect(verifierCatalogBefore).toMatchObject({
        acl: expect.any(String),
        appCanExecute: false,
        argumentCount: 1,
        argumentTypes: '2950',
        authCanExecute: false,
        config: [`search_path=pg_catalog, ${context.schemaName}, pg_temp`],
        erasureCanExecute: false,
        identityArguments: 'operation_id uuid',
        isSecurityDefiner: true,
        languageName: 'plpgsql',
        migrationCanExecute: false,
        objectId: expect.stringMatching(/^[1-9][0-9]*$/u),
        ownerCanExecute: true,
        ownerName: 'nihongo_phase7_owner',
        publicCanExecute: false,
        resultType: 'void'
      })
      await expectArchiveEmptyManifestVerifier(context, 'reject')
      const beforeSlice4fDigest = await readPhase6ProjectionDigest(
        context.adminClient
      )
      const archiveVerifierSql = readFileSync(
        join(sourceMigrationsDirectory, PHASE7_MIGRATIONS[2], 'migration.sql'),
        'utf8'
      )
      await expectTempSearchPathMigrationRejected({
        context,
        expectedLedgerCount: 29,
        migrationSql: archiveVerifierSql
      })
      expect(await readLedger(context)).toEqual(phase7FoundationLedger)

      copyMigration(PHASE7_MIGRATIONS[2], context.migrationsPath)
      await applyMigrationOnCurrentBackend({
        client: connectedSequentialMigrationClient,
        migrationName: PHASE7_MIGRATIONS[2],
        migrationSql: archiveVerifierSql
      })
      expect(
        (
          await connectedSequentialMigrationClient.query<{
            currentRole: string
            pid: number
            sessionUser: string
          }>(
            `SELECT pg_backend_pid() AS pid, current_user AS "currentRole",
               session_user AS "sessionUser"`
          )
        ).rows
      ).toEqual(sequentialMigrationBackend)
      const archiveVerifierLedger = await readLedger(context)
      expect(archiveVerifierLedger).toHaveLength(30)
      expect(archiveVerifierLedger.slice(0, 29)).toEqual(phase7FoundationLedger)
      expect(archiveVerifierLedger.at(-1)).toMatchObject({
        finishedAt: expect.any(Date),
        migrationName: PHASE7_MIGRATIONS[2],
        rolledBackAt: null
      })
      expect(
        archiveVerifierLedger
          .slice(-3)
          .every(
            ({ finishedAt, rolledBackAt }) =>
              finishedAt !== null && rolledBackAt === null
          )
      ).toBe(true)

      const reauthenticationSql = readFileSync(
        join(sourceMigrationsDirectory, PHASE7_MIGRATIONS[3], 'migration.sql'),
        'utf8'
      )
      await expectTempSearchPathMigrationRejected({
        context,
        expectedLedgerCount: 30,
        migrationSql: reauthenticationSql
      })
      expect(await readLedger(context)).toEqual(archiveVerifierLedger)

      await context.adminClient.query(
        `GRANT SELECT ("token") ON TABLE "Session"
         TO "nihongo_auth_gateway"`
      )
      try {
        await expect(
          connectedSequentialMigrationClient.query(reauthenticationSql)
        ).rejects.toMatchObject({ code: '42501' })
        await connectedSequentialMigrationClient.query('ROLLBACK')
        expect(await readLedger(context)).toEqual(archiveVerifierLedger)
        expect(
          (
            await context.adminClient.query<{
              authorizationState: string | null
              intentTable: string | null
            }>(
              `SELECT
                 (SELECT column_name
                  FROM information_schema.columns
                  WHERE table_schema = current_schema()
                    AND table_name = 'Session'
                    AND column_name = 'authorizationState')
                   AS "authorizationState",
                 to_regclass('"Phase7ReauthenticationIntent"')::text
                   AS "intentTable"`
            )
          ).rows
        ).toEqual([{ authorizationState: null, intentTable: null }])
      } finally {
        await context.adminClient.query(
          `REVOKE SELECT ("token") ON TABLE "Session"
           FROM "nihongo_auth_gateway"`
        )
      }

      copyMigration(PHASE7_MIGRATIONS[3], context.migrationsPath)
      await applyMigrationOnCurrentBackend({
        client: connectedSequentialMigrationClient,
        migrationName: PHASE7_MIGRATIONS[3],
        migrationSql: reauthenticationSql
      })
      expect(
        (
          await connectedSequentialMigrationClient.query<{
            currentRole: string
            pid: number
            sessionUser: string
          }>(
            `SELECT pg_backend_pid() AS pid, current_user AS "currentRole",
               session_user AS "sessionUser"`
          )
        ).rows
      ).toEqual(sequentialMigrationBackend)
      const finalLedger = await readLedger(context)
      expect(finalLedger).toHaveLength(31)
      expect(finalLedger.slice(0, 30)).toEqual(archiveVerifierLedger)
      expect(finalLedger.at(-1)).toMatchObject({
        finishedAt: expect.any(Date),
        migrationName: PHASE7_MIGRATIONS[3],
        rolledBackAt: null
      })
      expect(
        finalLedger
          .slice(-4)
          .every(
            ({ finishedAt, rolledBackAt }) =>
              finishedAt !== null && rolledBackAt === null
          )
      ).toBe(true)
      expect(() =>
        assertMigrationCompatibility(historicalManifest, finalLedger)
      ).not.toThrow()
      expect(await readOperationManifestVerifierCatalog(context)).toEqual(
        verifierCatalogBefore
      )
      await expectArchiveEmptyManifestVerifier(context, 'accept')
      expect(await readPhase6ProjectionDigest(context.adminClient)).toBe(
        beforeSlice4fDigest
      )
      await verifyCanonicalMigrationLedgerAccess(context, 31)
      expect(
        await readDirectUserForeignKeyActions(context.adminClient)
      ).toEqual([
        {
          constraintName: 'Bookmark_userId_fkey',
          deleteAction: 'c',
          tableName: 'Bookmark',
          updateAction: 'a'
        },
        {
          constraintName: 'IdempotencyRecord_userId_fkey',
          deleteAction: 'c',
          tableName: 'IdempotencyRecord',
          updateAction: 'a'
        },
        {
          constraintName: 'StudySession_userId_fkey',
          deleteAction: 'c',
          tableName: 'StudySession',
          updateAction: 'a'
        },
        {
          constraintName: 'WrongNote_userId_fkey',
          deleteAction: 'c',
          tableName: 'WrongNote',
          updateAction: 'a'
        }
      ])
      expect(
        (
          await context.adminClient.query<{
            command: string
            name: string
            roles: string[]
          }>(
            `SELECT policyname AS name, cmd AS command, roles::text[] AS roles
             FROM pg_policies
             WHERE schemaname = current_schema()
               AND tablename = '_prisma_migrations'
             ORDER BY policyname`
          )
        ).rows
      ).toEqual([
        {
          command: 'SELECT',
          name: 'phase7_ledger_app_read',
          roles: ['nihongo_app']
        },
        {
          command: 'ALL',
          name: 'phase7_ledger_full_access',
          roles: ['nihongo_phase7_migration']
        },
        {
          command: 'SELECT',
          name: 'phase7_ledger_legacy_read',
          roles: [LEGACY_APP_LOGIN]
        }
      ])
      expect(
        (
          await context.adminClient.query<{
            columnAclCount: number
            forceRowSecurity: boolean
            rowSecurity: boolean
          }>(
            `SELECT ledger.relrowsecurity AS "rowSecurity",
               ledger.relforcerowsecurity AS "forceRowSecurity",
               (SELECT COUNT(*)::int
                FROM pg_attribute AS attribute_record
                JOIN pg_class AS auth_table
                  ON auth_table.oid = attribute_record.attrelid
                JOIN pg_namespace AS auth_namespace
                  ON auth_namespace.oid = auth_table.relnamespace
                WHERE auth_namespace.nspname = current_schema()
                  AND auth_table.relname = ANY($1::text[])
                  AND attribute_record.attnum > 0
                  AND attribute_record.attacl IS NOT NULL
                  AND cardinality(attribute_record.attacl) > 0)
                 AS "columnAclCount"
             FROM pg_class AS ledger
             JOIN pg_namespace AS namespace ON namespace.oid = ledger.relnamespace
             WHERE namespace.nspname = current_schema()
               AND ledger.relname = '_prisma_migrations'`,
            [['User', 'Account', 'Session', 'Verification']]
          )
        ).rows
      ).toEqual([
        { columnAclCount: 0, forceRowSecurity: false, rowSecurity: true }
      ])
      for (const deniedRole of [
        'nihongo_app',
        'nihongo_auth_gateway',
        'nihongo_erasure_worker',
        CANONICAL_MIGRATION_LOGIN,
        columnAclRogueRole
      ]) {
        await context.adminClient.query('BEGIN')
        try {
          await context.adminClient.query(
            `SET LOCAL ROLE ${quoteIdentifier(deniedRole)}`
          )
          await expect(
            context.adminClient.query(
              `SELECT "email" FROM ${context.quotedSchemaName}."User" LIMIT 1`
            )
          ).rejects.toMatchObject({ code: '42501' })
        } finally {
          await context.adminClient.query('ROLLBACK')
        }
        await context.adminClient.query('BEGIN')
        try {
          await context.adminClient.query(
            `SET LOCAL ROLE ${quoteIdentifier(deniedRole)}`
          )
          await expect(
            context.adminClient.query(
              `UPDATE ${context.quotedSchemaName}."User"
               SET "email" = "email" WHERE false`
            )
          ).rejects.toMatchObject({ code: '42501' })
        } finally {
          await context.adminClient.query('ROLLBACK')
        }
      }
      const legacyLedger = await phase6Legacy.client.query<AppliedMigration>(
        `SELECT migration_name AS "migrationName", checksum,
           finished_at AS "finishedAt", rolled_back_at AS "rolledBackAt", logs
         FROM "_prisma_migrations"
         ORDER BY started_at`
      )
      expect(legacyLedger.rows).toHaveLength(27)
      expect(() =>
        assertMigrationCompatibility(
          selectExpectedMigrationManifest(
            loadExpectedMigrationManifest(sourceMigrationsDirectory),
            'pre-phase7'
          ),
          legacyLedger.rows
        )
      ).not.toThrow()
      const absoluteLegacyExpiry = new Date(
        phase6Legacy.outOfCapCreatedAt.getTime() + 30 * 24 * 60 * 60 * 1000
      )
      expect(
        (
          await phase6Legacy.client.query<{
            createdAt: Date
            expiresAt: Date
            issuerProtocolVersion: string
          }>(
            `SELECT "createdAt", "expiresAt",
               "issuerProtocolVersion"::text AS "issuerProtocolVersion"
             FROM "Session" WHERE "id" = $1`,
            [phase6Legacy.outOfCapSessionId]
          )
        ).rows
      ).toEqual([
        {
          createdAt: phase6Legacy.outOfCapCreatedAt,
          expiresAt: absoluteLegacyExpiry,
          issuerProtocolVersion: 'LEGACY'
        }
      ])
      expect(
        (
          await phase6Legacy.client.query<{ expiresAt: Date }>(
            `UPDATE "Session"
             SET "expiresAt" = "createdAt" + INTERVAL '60 days',
                 "updatedAt" = clock_timestamp()
             WHERE "id" = $1 RETURNING "expiresAt"`,
            [phase6Legacy.outOfCapSessionId]
          )
        ).rows
      ).toEqual([{ expiresAt: absoluteLegacyExpiry }])
      await context.serverClient.query(
        `DROP ROLE ${quoteIdentifier(columnAclRogueRole)}`
      )
      columnAclRogueCreated = false
      const legacySessionId = randomUUID()
      const legacySessionToken = `phase7-upgraded-legacy-${randomUUID()}`
      await phase6Legacy.client.query(
        `INSERT INTO "Session" (
          "id", "expiresAt", "token", "createdAt", "updatedAt", "userId"
        ) VALUES (
          $1, clock_timestamp() + INTERVAL '1 day', $2,
          clock_timestamp(), clock_timestamp(), $3
        )`,
        [legacySessionId, legacySessionToken, phase6Legacy.userId]
      )
      expect(
        (
          await phase6Legacy.client.query<{ id: string }>(
            `DELETE FROM "Session" WHERE "token" = $1 RETURNING "id"`,
            [legacySessionToken]
          )
        ).rows
      ).toEqual([{ id: legacySessionId }])
      const retainedBookmarkId = randomUUID()
      const rejectedUserId = randomUUID()
      const retainedQuestionId = buildPhase6CanonicalSeeds()[0]?.questionId
      if (!retainedQuestionId) {
        throw new Error('Phase 7 FK update fixture question is unavailable.')
      }
      await phase6Legacy.client.query('BEGIN')
      try {
        await phase6Legacy.client.query(
          `INSERT INTO "Bookmark" ("id", "userId", "questionId", "createdAt")
           VALUES ($1, $2, $3, clock_timestamp())`,
          [retainedBookmarkId, phase6Legacy.userId, retainedQuestionId]
        )
        await phase6Legacy.client.query('SAVEPOINT phase7_user_id_update')
        let userUpdateErrorCode: unknown
        try {
          await phase6Legacy.client.query(
            `UPDATE "User" SET "id" = $1 WHERE "id" = $2`,
            [rejectedUserId, phase6Legacy.userId]
          )
        } catch (error: unknown) {
          userUpdateErrorCode = (error as { code?: unknown }).code
        }
        expect(['23503', '23514']).toContain(userUpdateErrorCode)
        await phase6Legacy.client.query(
          'ROLLBACK TO SAVEPOINT phase7_user_id_update'
        )
        expect(
          (
            await phase6Legacy.client.query<{
              bookmarkUserId: string
              rejectedUserCount: number
              retainedUserCount: number
            }>(
              `SELECT bookmark."userId" AS "bookmarkUserId",
                 (SELECT COUNT(*)::int FROM "User" WHERE "id" = $2)
                   AS "retainedUserCount",
                 (SELECT COUNT(*)::int FROM "User" WHERE "id" = $3)
                   AS "rejectedUserCount"
               FROM "Bookmark" AS bookmark WHERE bookmark."id" = $1`,
              [retainedBookmarkId, phase6Legacy.userId, rejectedUserId]
            )
          ).rows
        ).toEqual([
          {
            bookmarkUserId: phase6Legacy.userId,
            rejectedUserCount: 0,
            retainedUserCount: 1
          }
        ])
        await phase6Legacy.client.query('ROLLBACK')
      } catch (error: unknown) {
        await phase6Legacy.client.query('ROLLBACK')
        throw error
      }
      expect(await readPhase6ProjectionDigest(context.adminClient)).toBe(
        beforeDigest
      )

      const parity = await context.adminClient.query<{
        applicabilityCount: number
        auditCount: number
        fingerprintMismatchCount: number
        optionCount: number
        questionCount: number
        reportCount: number
        reviewCount: number
        snapshotMismatchCount: number
        tagCount: number
        versionCount: number
        versionTagCount: number
      }>(
        `SELECT
          (SELECT COUNT(*)::int FROM "Question") AS "questionCount",
          (SELECT COUNT(*)::int FROM "QuestionVersion") AS "versionCount",
          (SELECT COUNT(*)::int FROM "QuestionOption") AS "optionCount",
          (SELECT COUNT(*)::int FROM "Tag") AS "tagCount",
          (SELECT COUNT(*)::int FROM "QuestionVersionTag") AS "versionTagCount",
          (SELECT COUNT(*)::int FROM "TagApplicability") AS "applicabilityCount",
          (SELECT COUNT(*)::int FROM "ContentReview") AS "reviewCount",
          (SELECT COUNT(*)::int FROM "AdminAuditLog") AS "auditCount",
          (SELECT COUNT(*)::int FROM "QuestionReport") AS "reportCount",
          (SELECT COUNT(*)::int FROM "QuestionVersion"
            WHERE "contentFingerprint" IS DISTINCT FROM
              "phase7_question_version_fingerprint"("id"))
            AS "fingerprintMismatchCount",
          (SELECT COUNT(*)::int
            FROM "QuestionVersionTag" AS assignment
            JOIN "Tag" AS tag ON tag."id" = assignment."tagId"
            WHERE assignment."labelSnapshot" <> tag."label"
               OR assignment."normalizedNameSnapshot" <> tag."normalizedName")
            AS "snapshotMismatchCount"`
      )
      expect(parity.rows).toEqual([
        {
          applicabilityCount: 127,
          auditCount: 0,
          fingerprintMismatchCount: 0,
          optionCount: 260,
          questionCount: 65,
          reportCount: 0,
          reviewCount: 0,
          snapshotMismatchCount: 0,
          tagCount: 108,
          versionCount: 65,
          versionTagCount: 130
        }
      ])
      const expectedFingerprints = buildPhase6CanonicalSeeds()
        .map((seed) => ({
          contentFingerprint: createExpectedFingerprint(seed),
          id: seed.versionId
        }))
        .toSorted((left, right) => left.id.localeCompare(right.id))
      expect(
        (
          await context.adminClient.query<{
            contentFingerprint: string
            id: string
          }>(
            `SELECT "id", "contentFingerprint"
             FROM "QuestionVersion" ORDER BY "id"`
          )
        ).rows
      ).toEqual(expectedFingerprints)
      expect(
        (
          await context.adminClient.query<{ digest: string }>(
            `SELECT encode(public.digest(convert_to(string_agg(
               "id"::text || '|' || "contentFingerprint", E'\\n'
               ORDER BY "id"::text COLLATE "C"
             ), 'UTF8'), 'sha256'), 'hex') AS digest
             FROM "QuestionVersion"`
          )
        ).rows
      ).toEqual([
        {
          digest: createHash('sha256')
            .update(
              expectedFingerprints
                .map(
                  ({ contentFingerprint, id }) => `${id}|${contentFingerprint}`
                )
                .join('\n'),
              'utf8'
            )
            .digest('hex')
        }
      ])
      await phase6Legacy.client.end()
      phase6Legacy = undefined
      await exerciseUpgradedRetiredPasswordBoundary(
        context,
        connectedSequentialMigrationClient
      )
      await exerciseUpgradedDashboardInsights(context)
    } finally {
      await sequentialMigrationClient?.end().catch(() => undefined)
      await phase6Legacy?.client.end().catch(() => undefined)
      await context.adminClient.query('ROLLBACK').catch(() => undefined)
      await context.serverClient
        .query(
          `REVOKE CONNECT ON DATABASE ${quoteIdentifier(context.databaseName)}
           FROM ${quoteIdentifier(LEGACY_APP_LOGIN)}`
        )
        .catch(() => undefined)
      await dispose(context, columnAclRogueCreated ? [columnAclRogueRole] : [])
    }
  }, 180_000)
})

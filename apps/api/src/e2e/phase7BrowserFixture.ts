import { randomBytes, randomUUID } from 'node:crypto'
import { hashPassword } from 'better-auth/crypto'
import { Client } from 'pg'
import { createApiApp } from '../app/createApp.js'
import { createSsoAuthentication } from '../auth/createSsoAuthentication.js'
import { createGuestPrincipalService } from '../auth/guestPrincipalService.js'
import { createOwnedAuthReadiness } from '../auth/ownedAuthReadiness.js'
import { createGoogleSsoProvider } from '../auth/ssoGoogleProvider.js'
import type { SsoProvider } from '../auth/ssoProtocol.js'
import { createPrismaBookmarkRepository } from '../bookmark/bookmarkRepository.js'
import { createBookmarkService } from '../bookmark/bookmarkService.js'
import type { ApiEnvironment } from '../config/env.js'
import {
  createDatabaseRuntime,
  createRoleDatabaseRuntime
} from '../db/database.js'
import { assertSafeTestDatabase } from '../db/databaseTargetGuard.js'
import { createPracticeRuntimeGate } from '../lifecycle/practiceRuntimeGate.js'
import { createApplicationRateLimiter } from '../middleware/applicationRateLimiter.js'
import { createJsonLogger } from '../observability/logger.js'
import { createBookmarkRoutes } from '../routes/bookmarks.js'
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
  environment,
  adminDatabaseUrl
}: {
  databaseUrl: string
  authGatewayDatabaseUrl: string
  environment: ApiEnvironment
  /** TEST admin-only/private harness URL; never delivered to the app or browser. */
  adminDatabaseUrl?: string
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

  if (adminDatabaseUrl !== undefined) {
    try {
      assertSafeTestDatabase({
        nodeEnvironment: 'test',
        databaseUrl: adminDatabaseUrl
      })
      const target = new URL(adminDatabaseUrl)
      decodeURIComponent(target.username)
      decodeURIComponent(target.password)
      decodeURIComponent(target.pathname)
      if (
        target.protocol !== applicationTarget.protocol ||
        target.hostname !== applicationTarget.hostname ||
        (target.port || '5432') !== (applicationTarget.port || '5432') ||
        target.pathname !== applicationTarget.pathname ||
        target.hash ||
        !target.username ||
        [applicationTarget.username, gatewayTarget.username].includes(
          target.username
        ) ||
        getPostgresSchema(adminDatabaseUrl) !== schema ||
        target.searchParams.getAll('schema').length !== 1 ||
        [...target.searchParams.keys()].some(
          (key) => key !== 'schema' && key !== 'sslmode'
        )
      )
        throw new Error()
    } catch {
      throw new Error(
        'SSO browser TTL owner requires the same isolated TEST target.'
      )
    }
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
  type ExpiryReceipt = {
    readonly armed: true
    readonly expired: true
    readonly sessionCount: 1
  }
  type OwnedSession = Readonly<{ id: string; userId: string; token: string }>
  type ReconciliationCounts = {
    userCount: number
    accountCount: number
    bookmarkCount: number
    sessionCount: number
    familyCount: number
  }
  type SaveBookmarkRow = ReconciliationCounts & {
    studyId: string
    sessionQuestionId: string
    questionId: string
    versionId: string
    optionId: string
    bookmarkId: string
    userDigest: string
    accountDigest: string
    familyDigest: string
    studyDigest: string
    questionsDigest: string
    bookmarkDigest: string
    revision: number
    elapsedSec: number
    saveAnswerABeforeBookmarkB: boolean
  }
  type SaveBookmarkCheckpoint = Readonly<
    SaveBookmarkRow & {
      userId: string
      sessionId: string
      familyId: string
      sessionDigest: string
    }
  >
  type ExpiryCheckpoint = Readonly<ReconciliationCounts & { expiresAt: string }>
  type FinalReconciliationRow = ReconciliationCounts & {
    userUnchanged: boolean
    accountUnchanged: boolean
    oldL0Expired: boolean
    oldF0Active: boolean
    login2SessionValid: boolean
    samePracticeRetained: boolean
    answerARetained: boolean
    bookmarkBRetained: boolean
  }
  type ReconciliationReceipt = Readonly<{
    baselineOwnedUserAccountCaptured: boolean
    baselineOwnedSessionFamilyCaptured: boolean
    saveAnswerABeforeBookmarkB: boolean
    saveBookmarkUserDelta: number
    saveBookmarkAccountDelta: number
    saveBookmarkBookmarkDelta: number
    ownedSessionExpiryArmedOnce: number
    oldL0Expired: boolean
    oldF0Active: boolean
    login2SameInternalUserU: boolean
    login2UserDeltaFromSaveBookmark: number
    login2AccountDeltaFromSaveBookmark: number
    login2BookmarkDeltaFromSaveBookmark: number
    login2SessionDeltaFromSaveBookmark: number
    login2FamilyDeltaFromSaveBookmark: number
    samePracticeRetained: boolean
    answerARetained: boolean
    bookmarkBRetained: boolean
  }>
  // Constant projections only; no caller-provided SQL or identifiers.
  const reconciliationCountsSql = `
    (SELECT count(*)::int FROM "User") AS "userCount",
    (SELECT count(*)::int FROM "Account") AS "accountCount",
    (SELECT count(*)::int FROM "Bookmark") AS "bookmarkCount",
    (SELECT count(*)::int FROM "Session") AS "sessionCount",
    (SELECT count(*)::int FROM "AuthSessionFamily") AS "familyCount"`
  const countsAreSafe = (counts: ReconciliationCounts): boolean =>
    [
      counts.userCount,
      counts.accountCount,
      counts.bookmarkCount,
      counts.sessionCount,
      counts.familyCount
    ].every((value) => Number.isSafeInteger(value) && value >= 0)
  const projectReconciliation = (
    first: OwnedSession,
    saved: SaveBookmarkCheckpoint,
    expired: ExpiryCheckpoint,
    login2: OwnedSession,
    current: FinalReconciliationRow,
    mutationCount: number
  ): ReconciliationReceipt =>
    Object.freeze({
      baselineOwnedUserAccountCaptured:
        saved.userId === first.userId &&
        saved.userDigest !== '' &&
        saved.accountDigest !== '',
      baselineOwnedSessionFamilyCaptured:
        saved.sessionId === first.id &&
        saved.familyId !== '' &&
        saved.sessionDigest !== '',
      saveAnswerABeforeBookmarkB: saved.saveAnswerABeforeBookmarkB,
      // SAVE+B deltas end at the frozen expiry checkpoint, not at login2.
      saveBookmarkUserDelta: expired.userCount - saved.userCount,
      saveBookmarkAccountDelta: expired.accountCount - saved.accountCount,
      saveBookmarkBookmarkDelta: expired.bookmarkCount - saved.bookmarkCount,
      ownedSessionExpiryArmedOnce: mutationCount,
      oldL0Expired: current.oldL0Expired,
      oldF0Active: current.oldF0Active,
      login2SameInternalUserU:
        login2.userId === saved.userId &&
        current.login2SessionValid &&
        current.userUnchanged &&
        current.accountUnchanged,
      // Legacy field names are fixed by QA; their anchor is frozen expiry.
      login2UserDeltaFromSaveBookmark: current.userCount - expired.userCount,
      login2AccountDeltaFromSaveBookmark:
        current.accountCount - expired.accountCount,
      login2BookmarkDeltaFromSaveBookmark:
        current.bookmarkCount - expired.bookmarkCount,
      login2SessionDeltaFromSaveBookmark:
        current.sessionCount - expired.sessionCount,
      login2FamilyDeltaFromSaveBookmark:
        current.familyCount - expired.familyCount,
      samePracticeRetained: current.samePracticeRetained,
      answerARetained: current.answerARetained,
      bookmarkBRetained: current.bookmarkBRetained
    })
  let ownedSession: OwnedSession | undefined
  let login2Session: OwnedSession | undefined
  let saveBookmarkCheckpoint: SaveBookmarkCheckpoint | undefined
  let expiryCheckpoint: ExpiryCheckpoint | undefined
  let expiryMutationCount = 0
  let reconciliationAttempted = false
  let reconciliationOperation: Promise<ReconciliationReceipt> | undefined
  let expiryAttempted = false
  let expiryOperation: Promise<ExpiryReceipt> | undefined
  disconnectors.push(async () => {
    await expiryOperation?.then(
      () => undefined,
      () => undefined
    )
    await reconciliationOperation?.then(
      () => undefined,
      () => undefined
    )
  })
  const armOwnedSessionExpiry = (): Promise<ExpiryReceipt> => {
    const failure = () => new Error('SSO browser TTL fixture failed.')
    if (expiryAttempted) return Promise.reject(failure())
    // An unsuccessful attempt is consumed too. Never retry/rearm a partial commit.
    expiryAttempted = true
    const session = ownedSession
    if (!adminDatabaseUrl || !session || disconnectPromise)
      return Promise.reject(failure())
    expiryOperation = (async (): Promise<ExpiryReceipt> => {
      const target = new URL(adminDatabaseUrl)
      target.searchParams.delete('schema')
      const owner = new Client({
        connectionString: target.toString(),
        options: createPostgresStartupOptions(schema),
        connectionTimeoutMillis: 2_000,
        query_timeout: 2_000,
        statement_timeout: 1_000
      })
      let inTransaction = false
      let ownerFailed = false
      owner.on('error', () => {
        ownerFailed = true
      })
      try {
        await owner.connect()
        await owner.query('BEGIN')
        inTransaction = true
        await owner.query("SET LOCAL lock_timeout = '1s'")
        const authority = await owner.query<{ safe: boolean }>(
          `SELECT current_user = session_user
            AND current_setting('role') = 'none'
            AND current_setting('session_replication_role') = 'origin'
            AND EXISTS (SELECT 1 FROM pg_catalog.pg_roles
              WHERE rolname = current_user AND rolsuper)
            AND EXISTS (SELECT 1 FROM pg_catalog.pg_namespace namespace
              JOIN pg_catalog.pg_roles role ON role.oid = namespace.nspowner
              WHERE namespace.nspname = $1 AND role.rolname = 'nihongo_phase7_owner')
            AND current_schema() = $1 AS safe`,
          [schema]
        )
        if (authority.rows.length !== 1 || authority.rows[0]?.safe !== true)
          throw failure()
        // Lock the fixed provider mapping/User before issuance can add a session.
        const user = await owner.query(
          `SELECT target.id FROM "User" target
            JOIN "Account" account ON account."userId" = target.id
            WHERE target.id = $1::uuid AND target.role = 'USER'
              AND target."accountStatus" = 'ACTIVE' AND target."deletedAt" IS NULL
              AND account."providerId" = $2 AND account."accountId" = $3
            FOR UPDATE OF target, account`,
          [
            session.userId,
            expectedIdentity.provider,
            expectedIdentity.accountId
          ]
        )
        if (user.rowCount !== 1) throw failure()
        const selected = await owner.query<{
          id: string
          familyId: string
          expiresAt: Date
          matchesToken: boolean
          immutableDigest: string
        }>(
          `SELECT session.id, family.id AS "familyId", session."expiresAt",
              session.token = $2 AS "matchesToken",
              md5((to_jsonb(session) - 'expiresAt')::text) AS "immutableDigest"
            FROM "Session" session
            JOIN "User" target ON target.id = session."userId"
            JOIN "AuthSessionFamily" family ON family.id = session."sessionFamilyId"
              AND family."userId" = target.id
            WHERE target.id = $1::uuid AND target.role = 'USER'
              AND target."accountStatus" = 'ACTIVE'
              AND session."authorityGeneration" = target."authorityGeneration"
              AND session."issuerProtocolVersion" = 'PHASE7_V1'
              AND session."authorizationState" = 'ACTIVE' AND family.status = 'ACTIVE'
              AND session."expiresAt" > clock_timestamp()
              AND session."expiresAt" > session."createdAt" + INTERVAL '1 day'
              AND session."createdAt" + INTERVAL '30 days' > clock_timestamp()
            FOR UPDATE OF session, family`,
          [session.userId, session.token]
        )
        const original = selected.rows[0]
        if (
          selected.rowCount !== 1 ||
          !original ||
          original.id !== session.id ||
          !original.matchesToken ||
          ownerFailed ||
          disconnectPromise
        )
          throw failure()
        // T1: successful SAVE and Bookmark B are committed; the HTTP201 is held.
        const saved = await owner.query<SaveBookmarkRow>(
          `SELECT study.id AS "studyId", question.id AS "sessionQuestionId",
              question."questionId", question."questionVersionId" AS "versionId",
              answer."selectedOptionId" AS "optionId", bookmark.id AS "bookmarkId",
              md5(to_jsonb(target)::text) AS "userDigest",
              md5(to_jsonb(account)::text) AS "accountDigest",
              md5(to_jsonb(family)::text) AS "familyDigest",
              md5(to_jsonb(study)::text) AS "studyDigest",
              (SELECT md5(coalesce(string_agg(to_jsonb(pin)::text, E'\\n' ORDER BY pin.ordinal), ''))
                FROM "StudySessionQuestion" pin WHERE pin."studySessionId" = study.id) AS "questionsDigest",
              md5(to_jsonb(bookmark)::text) AS "bookmarkDigest",
              draft.revision, answer."elapsedSec",
              EXISTS (SELECT 1 FROM "IdempotencyRecord" record
                WHERE record."userId" = target.id AND record."principalType" = 'USER'
                  AND record."studySessionId" = study.id AND record.operation = 'STUDY_DRAFT_SAVE'
                  AND record."contractVersion" = 2 AND record.state = 'SUCCEEDED'
                  AND record."responseStatus" = 200
                  AND record."completedAt" >= session."createdAt"
                  AND record."completedAt" <= bookmark."createdAt"
                  AND record."responseBody"->>'studySessionId' = study.id::text
                  AND record."responseBody"->>'currentOrdinal' = '1'
                  AND record."responseBody"->'answers' @> jsonb_build_array(jsonb_build_object(
                    'studySessionQuestionId', question.id::text,
                    'selectedOptionId', answer."selectedOptionId"::text))) AS "saveAnswerABeforeBookmarkB",
              ${reconciliationCountsSql}
            FROM "StudySession" study JOIN "User" target ON target.id = study."userId"
            JOIN "Account" account ON account."userId" = target.id
              AND account."providerId" = $2 AND account."accountId" = $3
            JOIN "Session" session ON session.id = $4::uuid AND session."userId" = target.id
            JOIN "AuthSessionFamily" family ON family.id = $5::uuid AND family."userId" = target.id
            JOIN "StudySessionQuestion" question ON question."studySessionId" = study.id AND question.ordinal = 1
            JOIN "StudyDraft" draft ON draft."studySessionId" = study.id
            JOIN "StudyDraftAnswer" answer ON answer."studySessionId" = study.id
              AND answer."studySessionQuestionId" = question.id
              AND answer."questionVersionId" = question."questionVersionId"
            JOIN "QuestionOption" option ON option.id = answer."selectedOptionId"
              AND option."questionVersionId" = question."questionVersionId" AND option.ordinal = 1
            JOIN "Bookmark" bookmark ON bookmark."userId" = target.id AND bookmark."questionId" = question."questionId"
            WHERE target.id = $1::uuid AND study."practiceContractVersion" = 2
              AND study.level = 'N3' AND study.subject = 'GRAMMAR' AND study.mode = 'RANDOM'
              AND study.status = 'IN_PROGRESS' AND study."expiresAt" > clock_timestamp()
              AND study."requestedCount" = 5 AND study."actualCount" = 5
              AND study."startedAt" >= session."createdAt" AND draft."savedAt" IS NOT NULL
              AND draft.revision >= 1 AND draft."currentOrdinal" = 1
              AND bookmark."createdAt" >= study."startedAt"
              AND (SELECT count(*) FROM "StudySessionQuestion" pin WHERE pin."studySessionId" = study.id) = 5
              AND (SELECT count(*) FROM "StudyDraftAnswer" answered WHERE answered."studySessionId" = study.id
                AND answered."selectedOptionId" IS NOT NULL) = 1`,
          [
            session.userId,
            expectedIdentity.provider,
            expectedIdentity.accountId,
            session.id,
            original.familyId
          ]
        )
        const checkpoint = saved.rows[0]
        if (
          saved.rowCount !== 1 ||
          !checkpoint ||
          !countsAreSafe(checkpoint) ||
          checkpoint.saveAnswerABeforeBookmarkB !== true
        )
          throw failure()
        saveBookmarkCheckpoint = Object.freeze({
          ...checkpoint,
          userId: session.userId,
          sessionId: session.id,
          familyId: original.familyId,
          sessionDigest: original.immutableDigest
        })
        await owner.query('SET LOCAL session_replication_role = replica')
        const changed = await owner.query<{
          expiresAt: Date
          preserved: boolean
        }>(
          `WITH deadline AS (SELECT clock_timestamp() + INTERVAL '2 seconds' AS value)
            UPDATE "Session" session SET "expiresAt" = deadline.value
            FROM deadline
            WHERE session.id = $1::uuid AND session."userId" = $2::uuid
              AND session."sessionFamilyId" = $3::uuid
              AND session."expiresAt" = $4::timestamptz
              AND session."createdAt" < deadline.value
              AND deadline.value < session."expiresAt"
              AND deadline.value > clock_timestamp()
            RETURNING session."expiresAt",
              md5((to_jsonb(session) - 'expiresAt')::text) = $5 AS preserved`,
          [
            session.id,
            session.userId,
            original.familyId,
            original.expiresAt,
            original.immutableDigest
          ]
        )
        const armed = changed.rows[0]
        if (changed.rowCount !== 1 || !armed || armed.preserved !== true)
          throw failure()
        expiryMutationCount += 1
        await owner.query('SET LOCAL session_replication_role = origin')
        if (ownerFailed || disconnectPromise) throw failure()
        await owner.query('COMMIT')
        inTransaction = false
        // Monotonic time bounds the wait; only DB time proves the crossing.
        const waitDeadline = performance.now() + 5_000
        for (
          let attempt = 0;
          attempt < 40 && performance.now() < waitDeadline;
          attempt += 1
        ) {
          if (ownerFailed || disconnectPromise) throw failure()
          const crossed = await owner.query<{ expired: boolean }>(
            `SELECT session."expiresAt" <= clock_timestamp() AS expired
              FROM "Session" session JOIN "AuthSessionFamily" family
                ON family.id = session."sessionFamilyId" AND family."userId" = session."userId"
              WHERE session.id = $1::uuid AND session."userId" = $2::uuid
                AND session."sessionFamilyId" = $3::uuid
                AND session."expiresAt" = $4::timestamptz
                AND session."authorizationState" = 'ACTIVE' AND family.status = 'ACTIVE'
                AND md5((to_jsonb(session) - 'expiresAt')::text) = $5`,
            [
              session.id,
              session.userId,
              original.familyId,
              armed.expiresAt,
              original.immutableDigest
            ]
          )
          if (crossed.rowCount !== 1 || ownerFailed || disconnectPromise)
            throw failure()
          if (crossed.rows[0]?.expired === true) {
            // T2: independent frozen counts after the actual DB-clock crossing.
            const expired = await owner.query<ReconciliationCounts>(
              `SELECT ${reconciliationCountsSql}`
            )
            const counts = expired.rows[0]
            if (
              expired.rowCount !== 1 ||
              !counts ||
              !countsAreSafe(counts) ||
              ownerFailed ||
              disconnectPromise
            )
              throw failure()
            expiryCheckpoint = Object.freeze({
              ...counts,
              expiresAt: armed.expiresAt.toISOString()
            })
            return { armed: true, expired: true, sessionCount: 1 }
          }
          await new Promise<void>((resolve) => setTimeout(resolve, 100))
        }
        throw failure()
      } catch {
        if (inTransaction) await owner.query('ROLLBACK').catch(() => undefined)
        throw failure()
      } finally {
        await owner.end().catch(() => {
          throw failure()
        })
      }
    })().catch(() => {
      throw failure()
    })
    return expiryOperation
  }
  const reconcileOwnedSessionExpiry = (): Promise<ReconciliationReceipt> => {
    const failure = () => new Error('SSO browser TTL reconciliation failed.')
    if (reconciliationAttempted) return Promise.reject(failure())
    reconciliationAttempted = true
    const first = ownedSession
    const saved = saveBookmarkCheckpoint
    const expired = expiryCheckpoint
    const login2 = login2Session
    if (
      !adminDatabaseUrl ||
      !first ||
      !saved ||
      !expired ||
      !login2 ||
      !expiryOperation ||
      disconnectPromise
    )
      return Promise.reject(failure())
    reconciliationOperation = (async (): Promise<ReconciliationReceipt> => {
      await expiryOperation
      const target = new URL(adminDatabaseUrl)
      target.searchParams.delete('schema')
      const owner = new Client({
        connectionString: target.toString(),
        options: createPostgresStartupOptions(schema),
        connectionTimeoutMillis: 2_000,
        query_timeout: 2_000,
        statement_timeout: 1_000
      })
      let inTransaction = false
      let ownerFailed = false
      owner.on('error', () => {
        ownerFailed = true
      })
      try {
        await owner.connect()
        await owner.query('BEGIN')
        inTransaction = true
        await owner.query(
          'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY'
        )
        const authority = await owner.query<{ safe: boolean }>(
          `SELECT current_user = session_user AND current_setting('role') = 'none'
            AND current_setting('session_replication_role') = 'origin'
            AND EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = current_user AND rolsuper)
            AND EXISTS (SELECT 1 FROM pg_catalog.pg_namespace namespace
              JOIN pg_catalog.pg_roles role ON role.oid = namespace.nspowner
              WHERE namespace.nspname = $1 AND role.rolname = 'nihongo_phase7_owner')
            AND current_schema() = $1 AS safe`,
          [schema]
        )
        if (
          authority.rows.length !== 1 ||
          authority.rows[0]?.safe !== true ||
          ownerFailed ||
          disconnectPromise
        )
          throw failure()
        const rows = await owner.query<FinalReconciliationRow>(
          `SELECT ${reconciliationCountsSql},
            EXISTS (SELECT 1 FROM "User" target WHERE target.id = $1::uuid
              AND md5(to_jsonb(target)::text) = $9) AS "userUnchanged",
            EXISTS (SELECT 1 FROM "Account" account WHERE account."userId" = $1::uuid
              AND md5(to_jsonb(account)::text) = $10) AS "accountUnchanged",
            EXISTS (SELECT 1 FROM "Session" session WHERE session.id = $2::uuid
              AND session."userId" = $1::uuid AND session."sessionFamilyId" = $3::uuid
              AND session."expiresAt" = $4::timestamptz AND session."expiresAt" <= clock_timestamp()
              AND md5((to_jsonb(session) - 'expiresAt')::text) = $5) AS "oldL0Expired",
            EXISTS (SELECT 1 FROM "AuthSessionFamily" family WHERE family.id = $3::uuid
              AND family."userId" = $1::uuid AND family.status = 'ACTIVE'
              AND family."revokedAt" IS NULL AND md5(to_jsonb(family)::text) = $22) AS "oldF0Active",
            EXISTS (SELECT 1 FROM "Session" session
              JOIN "User" target ON target.id = session."userId"
              JOIN "AuthSessionFamily" family ON family.id = session."sessionFamilyId" AND family."userId" = target.id
              WHERE session.id = $6::uuid AND session."userId" = $7::uuid AND session.token = $8
                AND session.id <> $2::uuid AND family.id <> $3::uuid
                AND session."issuerProtocolVersion" = 'PHASE7_V1' AND session."authorizationState" = 'ACTIVE'
                AND session."authorityGeneration" = target."authorityGeneration"
                AND target.role = 'USER' AND target."accountStatus" = 'ACTIVE' AND target."deletedAt" IS NULL
                AND family.status = 'ACTIVE' AND family."revokedAt" IS NULL
                AND session."createdAt" >= $4::timestamptz AND session."expiresAt" > clock_timestamp()
                AND session."createdAt" + INTERVAL '30 days' > clock_timestamp()) AS "login2SessionValid",
            EXISTS (SELECT 1 FROM "StudySession" study WHERE study.id = $11::uuid
              AND study."userId" = $1::uuid AND study.status = 'IN_PROGRESS' AND study."expiresAt" > clock_timestamp()
              AND md5(to_jsonb(study)::text) = $12
              AND (SELECT md5(coalesce(string_agg(to_jsonb(pin)::text, E'\\n' ORDER BY pin.ordinal), ''))
                FROM "StudySessionQuestion" pin WHERE pin."studySessionId" = study.id) = $13) AS "samePracticeRetained",
            EXISTS (SELECT 1 FROM "StudyDraft" draft
              JOIN "StudyDraftAnswer" answer ON answer."studySessionId" = draft."studySessionId"
              JOIN "StudySessionQuestion" question ON question.id = answer."studySessionQuestionId"
                AND question."studySessionId" = draft."studySessionId"
              WHERE draft."studySessionId" = $11::uuid AND question.id = $14::uuid
                AND question."questionId" = $15::uuid AND question."questionVersionId" = $16::uuid
                AND answer."questionVersionId" = $16::uuid AND answer."selectedOptionId" = $17::uuid
                AND draft.revision >= $18 AND draft."currentOrdinal" = 1 AND answer."elapsedSec" >= $19
                AND (SELECT count(*) FROM "StudyDraftAnswer" answered WHERE answered."studySessionId" = draft."studySessionId"
                  AND answered."selectedOptionId" IS NOT NULL) = 1) AS "answerARetained",
            EXISTS (SELECT 1 FROM "Bookmark" bookmark WHERE bookmark.id = $20::uuid
              AND bookmark."userId" = $1::uuid AND bookmark."questionId" = $15::uuid
              AND md5(to_jsonb(bookmark)::text) = $21) AS "bookmarkBRetained"`,
          [
            saved.userId,
            saved.sessionId,
            saved.familyId,
            expired.expiresAt,
            saved.sessionDigest,
            login2.id,
            login2.userId,
            login2.token,
            saved.userDigest,
            saved.accountDigest,
            saved.studyId,
            saved.studyDigest,
            saved.questionsDigest,
            saved.sessionQuestionId,
            saved.questionId,
            saved.versionId,
            saved.optionId,
            saved.revision,
            saved.elapsedSec,
            saved.bookmarkId,
            saved.bookmarkDigest,
            saved.familyDigest
          ]
        )
        const current = rows.rows[0]
        if (
          rows.rowCount !== 1 ||
          !current ||
          !countsAreSafe(current) ||
          ownerFailed ||
          disconnectPromise
        )
          throw failure()
        const receipt = projectReconciliation(
          first,
          saved,
          expired,
          login2,
          current,
          expiryMutationCount
        )
        await owner.query('COMMIT')
        inTransaction = false
        if (ownerFailed || disconnectPromise) throw failure()
        return receipt
      } catch {
        if (inTransaction) await owner.query('ROLLBACK').catch(() => undefined)
        throw failure()
      } finally {
        await owner.end().catch(() => {
          throw failure()
        })
      }
    })().catch(() => {
      throw failure()
    })
    return reconciliationOperation
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
    const principalService =
      adminDatabaseUrl === undefined
        ? auth.principalService
        : {
            ...auth.principalService,
            resolveAuthenticatedUser: async (
              ...args: Parameters<
                typeof auth.principalService.resolveAuthenticatedUser
              >
            ) => {
              const resolution =
                await auth.principalService.resolveAuthenticatedUser(...args)
              if (
                !ownedSession &&
                resolution.user?.role === 'USER' &&
                resolution.phase7Session
              ) {
                ownedSession = Object.freeze({
                  id: resolution.phase7Session.id,
                  userId: resolution.user.id,
                  token: resolution.phase7Session.token
                })
              } else if (
                expiryCheckpoint &&
                !login2Session &&
                resolution.user &&
                resolution.phase7Session &&
                resolution.phase7Session.id !== ownedSession?.id
              ) {
                login2Session = Object.freeze({
                  id: resolution.phase7Session.id,
                  userId: resolution.user.id,
                  token: resolution.phase7Session.token
                })
              }
              return resolution
            }
          }
    const app = createApiApp({
      auth: {
        environment,
        ...auth,
        principalService,
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
    app.route(
      '/api/v1/bookmarks',
      createBookmarkRoutes({
        bookmarkService: createBookmarkService(
          createPrismaBookmarkRepository(database.client)
        ),
        environment,
        principalService,
        rateLimiter
      })
    )
    return {
      app,
      checkReadiness: practice.checkReadiness,
      expectedIdentity,
      disconnect,
      armOwnedSessionExpiry,
      reconcileOwnedSessionExpiry
    }
  } catch (error: unknown) {
    await disconnect().catch(() => undefined)
    throw error
  }
}

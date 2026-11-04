import { createHash, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ownedSessionSql } from './fixtures/ownedSessionSql.js'
import { Client, type QueryResult } from 'pg'
import {
  beginAdminOperation,
  finishAdminOperation
} from '../admin/adminOperationAuthority.js'
import { parseApiEnvironment } from '../config/env.js'
import type { Prisma } from '../generated/prisma/client.js'
import {
  createPostgresStartupOptions,
  getPostgresSchema
} from './databaseOptions.js'
import { assertSafeAdminCmsDatabase } from './databaseTargetGuard.js'

const EXECUTION_ROLES = [
  'nihongo_app',
  'nihongo_auth_gateway',
  'nihongo_phase7_migration'
] as const
type ExecutionRole = (typeof EXECUTION_ROLES)[number]

interface PreparedIntentRow {
  readonly email: string
  readonly expiresAt: Date
  readonly intentId: string
  readonly operationId: string
  readonly requestId: string
}

interface FinalizedSessionRow {
  readonly authorityGeneration: number
  readonly createdAt: Date
  readonly expiresAt: Date
  readonly familyId: string
  readonly id: string
}

const routineManifest = [
  ['phase7_abort_reauthentication', 'intent_id_value uuid', false, true],
  ['phase7_active_authorization_session', 'raw_token text', false, false],
  [
    'phase7_change_user_authority',
    'raw_actor_token text, target_user_id uuid, expected_target_generation integer, new_role "UserRole", new_status "UserAccountStatus", environment_value "AdminAuditEnvironment"',
    false,
    true
  ],
  [
    'phase7_change_user_authority_pre_reauthentication',
    'raw_actor_token text, target_user_id uuid, expected_target_generation integer, new_role "UserRole", new_status "UserAccountStatus", environment_value "AdminAuditEnvironment"',
    false,
    false
  ],
  ['phase7_classify_admin_authority', 'raw_token text', true, false],
  ['phase7_cleanup_reauthentication', 'maximum_rows integer', false, true],
  [
    'phase7_confirm_v1_session_issuance',
    'raw_token text, expected_session_id uuid, expected_user_id uuid, captured_generation_value integer, captured_role_value "UserRole", captured_status_value "UserAccountStatus"',
    false,
    true
  ],
  [
    'phase7_confirm_v1_session_issuance_pre_reauthentication',
    'raw_token text, expected_session_id uuid, expected_user_id uuid, captured_generation_value integer, captured_role_value "UserRole", captured_status_value "UserAccountStatus"',
    false,
    false
  ],
  [
    'phase7_create_question_report',
    'raw_session_token text, report_id uuid, question_id_value uuid, question_version_id_value uuid, reason_value "QuestionReportReason", description_value text',
    true,
    false
  ],
  [
    'phase7_create_question_report_pre_reauthentication',
    'raw_session_token text, report_id uuid, question_id_value uuid, question_version_id_value uuid, reason_value "QuestionReportReason", description_value text',
    false,
    false
  ],
  [
    'phase7_finalize_reauthentication',
    'intent_id_value uuid, raw_new_token text',
    false,
    true
  ],
  ['phase7_finish_admin_operation', 'operation_id uuid', true, false],
  [
    'phase7_finish_admin_operation_pre_reauthentication',
    'operation_id uuid',
    false,
    false
  ],
  [
    'phase7_prepare_reauthentication',
    'raw_old_token text, expected_actor_id uuid, request_id_value uuid, environment_value "AdminAuditEnvironment", intent_id_value uuid',
    false,
    true
  ],
  ['phase7_reauthentication_token_digest', 'raw_token text', false, false],
  [
    'phase7_reconcile_reauthentication',
    'intent_id_value uuid, raw_new_token text',
    false,
    true
  ],
  [
    'phase7_record_authority_revocation',
    'target_user_id uuid, reason_value "Phase7AuthorityRevocationReason"',
    false,
    false
  ],
  ['phase7_rotation_fence_token_digest', 'raw_token text', false, false],
  [
    'phase7_stage_reauthentication_session',
    'intent_id_value uuid, session_id_value uuid, raw_new_token text, user_id_value uuid, expires_at_value timestamp with time zone, ip_address_value text, user_agent_value text',
    false,
    true
  ],
  ['protect_phase7_account', '', false, false],
  ['validate_phase7_session_write', '', false, false],
  ['validate_phase7_user_change', '', false, false]
] as const

const environment = parseApiEnvironment(process.env)
assertSafeAdminCmsDatabase({
  adminCmsMode: environment.ADMIN_CMS_MODE,
  nodeEnvironment: environment.NODE_ENV,
  databaseUrl: environment.DATABASE_URL,
  productionDatabaseUrl: process.env.PRODUCTION_DATABASE_URL
})

const schema = getPostgresSchema(environment.DATABASE_URL)
const adminDatabaseUrl = process.env.PHASE7_ADMIN_DATABASE_URL
const authGatewayDatabaseUrl =
  process.env.PHASE7_AUTH_GATEWAY_FIXTURE_DATABASE_URL
if (!schema || !adminDatabaseUrl || !authGatewayDatabaseUrl) {
  throw new Error('Reauthentication DB test URLs are required.')
}
if (
  getPostgresSchema(adminDatabaseUrl) !== schema ||
  getPostgresSchema(authGatewayDatabaseUrl) !== schema
) {
  throw new Error('Reauthentication DB schemas must match exactly.')
}

const runtimeClient = (
  connectionString: string,
  role: 'nihongo_app' | 'nihongo_auth_gateway'
): Client => {
  const url = new URL(connectionString)
  url.searchParams.delete('schema')
  url.searchParams.delete('options')
  return new Client({
    connectionString: url.toString(),
    options: createPostgresStartupOptions(schema, role)
  })
}

const adminUrl = new URL(adminDatabaseUrl)
adminUrl.searchParams.delete('schema')
adminUrl.searchParams.delete('options')
const adminClient = new Client({
  connectionString: adminUrl.toString(),
  options: createPostgresStartupOptions(schema)
})
const appClient = runtimeClient(environment.DATABASE_URL, 'nihongo_app')
const gatewayClient = runtimeClient(
  authGatewayDatabaseUrl,
  'nihongo_auth_gateway'
)

const withExecutionRole = async <Result>(
  role: ExecutionRole,
  action: () => Promise<Result>
): Promise<Result> => {
  if (!EXECUTION_ROLES.includes(role)) {
    throw new Error(`Unexpected Phase 7 execution role: ${role}`)
  }
  await adminClient.query(`SET ROLE "${role}"`)
  let actionError: unknown
  let actionFailed = false
  let resetError: unknown
  let resetFailed = false
  let result: Result | undefined
  try {
    result = await action()
  } catch (error: unknown) {
    actionFailed = true
    actionError = error
  }
  try {
    await adminClient.query('RESET ROLE')
  } catch (error: unknown) {
    resetFailed = true
    resetError = error
  }
  if (actionFailed) throw actionError
  if (resetFailed) throw resetError
  return result as Result
}

const withinRollback = async (action: () => Promise<void>): Promise<void> => {
  await adminClient.query('BEGIN')
  try {
    await action()
  } finally {
    await adminClient.query('ROLLBACK')
  }
}

let savepointSequence = 0
const expectRoleFailure = async (
  role: 'nihongo_app' | 'nihongo_auth_gateway',
  statement: string,
  values: readonly unknown[],
  expectedCode: string
): Promise<void> => {
  savepointSequence += 1
  const savepoint = `phase7_reauth_expected_${savepointSequence}`
  await adminClient.query(`SAVEPOINT ${savepoint}`)
  let actualCode: unknown
  try {
    await adminClient.query(`SET LOCAL ROLE "${role}"`)
    await adminClient.query(statement, [...values])
  } catch (error: unknown) {
    actualCode = (error as { code?: unknown }).code
  } finally {
    await adminClient.query(`ROLLBACK TO SAVEPOINT ${savepoint}`)
    await adminClient.query(`RELEASE SAVEPOINT ${savepoint}`)
  }
  expect(actualCode).toBe(expectedCode)
}

const insertCredentialUser = async (
  id: string,
  role: 'ADMIN' | 'USER'
): Promise<string> => {
  const email = `phase7-reauth-${randomUUID()}@example.test`
  await adminClient.query(
    `INSERT INTO "User" (
      "id", "name", "email", "emailVerified", "role",
      "accountStatus", "createdAt", "updatedAt"
    ) VALUES (
      $1, 'Reauthentication integration', $2, true, $3,
      'ACTIVE', clock_timestamp(), clock_timestamp()
    )`,
    [id, email, role]
  )
  await adminClient.query(
    `INSERT INTO "Account" (
      "id", "accountId", "providerId", "userId", "password",
      "createdAt", "updatedAt"
    ) VALUES (
      $1, $2::uuid::text, 'credential', $2,
      'integration-password-hash', clock_timestamp(), clock_timestamp()
    )`,
    [randomUUID(), id]
  )
  await adminClient.query('SET CONSTRAINTS ALL IMMEDIATE')
  await adminClient.query('SET CONSTRAINTS ALL DEFERRED')
  return email
}

const issueSession = async (
  userId: string,
  sessionId: string,
  token: string
): Promise<string> => {
  const issued = await withExecutionRole('nihongo_app', () =>
    ownedSessionSql(
      adminClient,
      `SELECT * FROM "phase7_issue_v1_session"(
        $1, 1, 'ADMIN', 'ACTIVE', $2, $3,
        '127.0.0.1', 'phase7-reauth-integration', false
      )`,
      [userId, sessionId, token]
    )
  )
  const familyId = issued.rows[0]?.familyId
  if (!familyId) throw new Error('Session family was not issued.')
  return familyId
}

const prepare = async (
  userId: string,
  oldToken: string,
  requestId = randomUUID(),
  intentId = randomUUID()
): Promise<PreparedIntentRow> => {
  const prepared = await withExecutionRole('nihongo_auth_gateway', () =>
    adminClient.query<PreparedIntentRow>(
      `SELECT * FROM "phase7_prepare_reauthentication"(
        $1, $2, $3, 'TEST', $4
      )`,
      [oldToken, userId, requestId, intentId]
    )
  )
  const row = prepared.rows[0]
  if (!row || prepared.rows.length !== 1) {
    throw new Error('Reauthentication intent was not prepared.')
  }
  return row
}

const stage = async (
  intentId: string,
  sessionId: string,
  token: string,
  userId: string
): Promise<QueryResult<{ id: string }>> =>
  await withExecutionRole('nihongo_auth_gateway', () =>
    adminClient.query<{ id: string }>(
      `SELECT * FROM "phase7_stage_reauthentication_session"(
        $1, $2, $3, $4, clock_timestamp() + INTERVAL '1 day',
        '127.0.0.1', 'phase7-reauth-integration'
      )`,
      [intentId, sessionId, token, userId]
    )
  )

const finalize = async (
  intentId: string,
  token: string
): Promise<FinalizedSessionRow> => {
  const finalized = await withExecutionRole('nihongo_auth_gateway', () =>
    adminClient.query<FinalizedSessionRow>(
      `SELECT * FROM "phase7_finalize_reauthentication"($1, $2)`,
      [intentId, token]
    )
  )
  const row = finalized.rows[0]
  if (!row || finalized.rows.length !== 1) {
    throw new Error('Reauthentication was not finalized.')
  }
  return row
}

interface StagedFixture {
  readonly familyId: string
  readonly newSessionId: string
  readonly newToken: string
  readonly oldSessionId: string
  readonly oldToken: string
  readonly prepared: PreparedIntentRow
  readonly userId: string
}

const createStagedFixture = async (): Promise<StagedFixture> => {
  const userId = randomUUID()
  const oldSessionId = randomUUID()
  const oldToken = `phase7-reauth-old-${randomUUID()}`
  const newSessionId = randomUUID()
  const newToken = `phase7-reauth-new-${randomUUID()}`
  await insertCredentialUser(userId, 'ADMIN')
  const familyId = await issueSession(userId, oldSessionId, oldToken)
  const prepared = await prepare(userId, oldToken)
  const staged = await stage(prepared.intentId, newSessionId, newToken, userId)
  expect(staged.rows).toHaveLength(1)
  expect(staged.rows[0]).toMatchObject({ id: newSessionId })
  return {
    familyId,
    newSessionId,
    newToken,
    oldSessionId,
    oldToken,
    prepared,
    userId
  }
}

const rotationFenceDigest = (token: string): string =>
  createHash('sha256')
    .update('nihongo-auth-session-rotation-fence-v1', 'utf8')
    .update(Buffer.from([0]))
    .update(token, 'utf8')
    .digest('hex')

beforeAll(async () => {
  await adminClient.connect()
  await appClient.connect()
  await gatewayClient.connect()
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
  if (!target) throw new Error('DB endpoint is unavailable.')
  await withExecutionRole('nihongo_phase7_migration', () =>
    adminClient.query(
      `SELECT "phase7_register_database_capability"(
        $1, $2::inet, $3, 'TEST'
      )`,
      [target.databaseName, target.serverAddress, target.serverPort]
    )
  )
})

afterAll(async () => {
  await gatewayClient.end()
  await appClient.end()
  await adminClient.end()
})

const asTransaction = (client: Client): Prisma.TransactionClient =>
  ({
    $queryRawUnsafe: async (sql: string, ...values: unknown[]) =>
      (await client.query(sql, values)).rows,
    $executeRawUnsafe: async (sql: string, ...values: unknown[]) =>
      (await client.query(sql, values)).rowCount ?? 0
  }) as unknown as Prisma.TransactionClient

const sqlStateOf = async (action: () => Promise<unknown>) => {
  try {
    await action()
    return 'ok'
  } catch (error: unknown) {
    return (error as { code?: unknown }).code
  }
}

describe('Reauthentication DB foundation', () => {
  it('canonical flow는 PENDING을 non-authoritative로 유지하고 exact fence/audit 뒤에만 활성화한다', async () => {
    await withinRollback(async () => {
      const actorId = randomUUID()
      const targetUserId = randomUUID()
      const oldSessionId = randomUUID()
      const oldToken = `phase7-reauth-old-${randomUUID()}`
      const newSessionId = randomUUID()
      const newToken = `phase7-reauth-new-${randomUUID()}`
      const requestId = randomUUID()
      const actorEmail = await insertCredentialUser(actorId, 'ADMIN')
      await insertCredentialUser(targetUserId, 'USER')
      const familyId = await issueSession(actorId, oldSessionId, oldToken)
      const prepared = await prepare(actorId, oldToken, requestId)

      expect(prepared).toMatchObject({
        email: actorEmail,
        requestId
      })
      expect(prepared.expiresAt.getTime()).toBeGreaterThan(Date.now())
      await expectRoleFailure(
        'nihongo_auth_gateway',
        `SELECT * FROM "phase7_prepare_reauthentication"(
          $1, $2, $3, 'TEST', $4
        )`,
        [oldToken, actorId, randomUUID(), randomUUID()],
        '40001'
      )

      const staged = await stage(
        prepared.intentId,
        newSessionId,
        newToken,
        actorId
      )
      expect(staged.rows).toHaveLength(1)
      expect(staged.rows[0]).toMatchObject({ id: newSessionId })

      const pendingProof = await adminClient.query<{
        authorizationState: string
        familyStatus: string
        intentState: string
      }>(
        `SELECT session."authorizationState"::text AS "authorizationState",
           family."status"::text AS "familyStatus",
           intent."state"::text AS "intentState"
         FROM "Session" AS session
         JOIN "AuthSessionFamily" AS family
           ON family."id" = session."sessionFamilyId"
         JOIN "Phase7ReauthenticationIntent" AS intent
           ON intent."stagedSessionId" = session."id"
         WHERE session."id" = $1`,
        [newSessionId]
      )
      expect(pendingProof.rows).toEqual([
        {
          authorizationState: 'PENDING_REAUTH',
          familyStatus: 'ACTIVE',
          intentState: 'STAGED'
        }
      ])

      const pendingSignOut = await withExecutionRole('nihongo_app', () =>
        ownedSessionSql(
          adminClient,
          `SELECT "phase7_owned_sign_out"($1) AS "signedOut"`,
          [newToken]
        )
      )
      expect(pendingSignOut.rows).toEqual([{ signedOut: true }])
      expect(
        (
          await adminClient.query<{ count: number }>(
            `SELECT COUNT(*)::int AS count FROM "Session"
             WHERE "sessionFamilyId" = $1`,
            [familyId]
          )
        ).rows
      ).toEqual([{ count: 2 }])

      const pendingReconciliation = await withExecutionRole(
        'nihongo_auth_gateway',
        () =>
          adminClient.query(
            `SELECT * FROM "phase7_reconcile_reauthentication"($1, $2)`,
            [prepared.intentId, newToken]
          )
      )
      expect(pendingReconciliation.rows).toEqual([])

      const beforeWrites = await adminClient.query<{
        auditCount: number
        generation: number
        operationCount: number
        password: string
        reportCount: number
        role: string
      }>(
        `SELECT target_user."authorityGeneration" AS generation,
           target_user."role"::text AS role, credential."password",
           (SELECT COUNT(*)::int FROM "QuestionReport") AS "reportCount",
           (SELECT COUNT(*)::int FROM "Phase7OperationIntent")
             AS "operationCount",
           (SELECT COUNT(*)::int FROM "AdminAuditLog") AS "auditCount"
         FROM "User" AS target_user
         JOIN "Account" AS credential
           ON credential."userId" = target_user."id"
          AND credential."providerId" = 'credential'
         WHERE target_user."id" = $1`,
        [actorId]
      )

      const appPrincipal = await withExecutionRole('nihongo_app', () =>
        ownedSessionSql(
          adminClient,
          `SELECT * FROM "phase7_resolve_v1_principal"($1)`,
          [newToken]
        )
      )
      expect(appPrincipal.rows).toEqual([])
      const refresh = await withExecutionRole('nihongo_app', () =>
        ownedSessionSql(
          adminClient,
          `SELECT * FROM "phase7_refresh_current_remembered_session"($1)`,
          [newToken]
        )
      )
      expect(refresh.rows).toEqual([])
      const issuance = await withExecutionRole('nihongo_auth_gateway', () =>
        adminClient.query<{ confirmed: boolean }>(
          `SELECT "phase7_confirm_v1_session_issuance"(
            $1, $2, $3, 1, 'ADMIN', 'ACTIVE'
          ) AS confirmed`,
          [newToken, newSessionId, actorId]
        )
      )
      expect(issuance.rows).toEqual([{ confirmed: false }])
      // #504 P7 PR2: the API admin operation refuses the PENDING session.
      await adminClient.query('SAVEPOINT phase7_pending_admin_operation')
      await adminClient.query('SET LOCAL ROLE "nihongo_app"')
      expect(
        await sqlStateOf(() =>
          beginAdminOperation(asTransaction(adminClient), {
            auditEnvironment: 'TEST',
            command: 'REVIEW_REQUEST',
            rawSessionToken: newToken,
            referencedUserIds: [actorId]
          })
        )
      ).toBe('42501')
      await adminClient.query(
        'ROLLBACK TO SAVEPOINT phase7_pending_admin_operation'
      )
      await adminClient.query('RESET ROLE')
      await expectRoleFailure(
        'nihongo_auth_gateway',
        `SELECT "phase7_change_user_authority"(
          $1, $2, 1, 'ADMIN', 'ACTIVE', 'TEST'
        )`,
        [newToken, targetUserId],
        '42501'
      )
      const reportTarget = await adminClient.query<{
        questionId: string
        versionId: string
      }>(
        `SELECT question."id" AS "questionId",
           question."currentPublishedVersionId" AS "versionId"
         FROM "Question" AS question
         WHERE question."currentPublishedVersionId" IS NOT NULL
         ORDER BY question."id" LIMIT 1`
      )
      const target = reportTarget.rows[0]
      if (!target) throw new Error('Published report target is unavailable.')
      await expectRoleFailure(
        'nihongo_app',
        `SELECT * FROM "phase7_create_question_report"(
          $1, $2, $3, $4, 'ANSWER_ERROR', 'pending must not write'
        )`,
        [newToken, randomUUID(), target.questionId, target.versionId],
        '42501'
      )
      const afterWrites = await adminClient.query(
        `SELECT target_user."authorityGeneration" AS generation,
           target_user."role"::text AS role, credential."password",
           (SELECT COUNT(*)::int FROM "QuestionReport") AS "reportCount",
           (SELECT COUNT(*)::int FROM "Phase7OperationIntent")
             AS "operationCount",
           (SELECT COUNT(*)::int FROM "AdminAuditLog") AS "auditCount"
         FROM "User" AS target_user
         JOIN "Account" AS credential
           ON credential."userId" = target_user."id"
          AND credential."providerId" = 'credential'
         WHERE target_user."id" = $1`,
        [actorId]
      )
      expect(afterWrites.rows).toEqual(beforeWrites.rows)

      const finalized = await finalize(prepared.intentId, newToken)
      expect(finalized).toMatchObject({
        authorityGeneration: 1,
        familyId,
        id: newSessionId
      })
      await adminClient.query('SET CONSTRAINTS ALL IMMEDIATE')
      await adminClient.query('SET CONSTRAINTS ALL DEFERRED')
      const durableProof = await adminClient.query<{
        auditCount: number
        fenceCount: number
        intentState: string
        newSessionCount: number
        oldSessionCount: number
        operationCount: number
        trustedCount: number
      }>(
        `SELECT
           (SELECT COUNT(*)::int FROM "Session" WHERE "id" = $1)
             AS "oldSessionCount",
           (SELECT COUNT(*)::int FROM "Session"
            WHERE "id" = $2 AND "authorizationState" = 'ACTIVE')
             AS "newSessionCount",
           (SELECT "state"::text FROM "Phase7ReauthenticationIntent"
            WHERE "id" = $3) AS "intentState",
           (SELECT COUNT(*)::int FROM "AuthSessionRotationFence"
            WHERE "operationId" = $4 AND "oldTokenDigest" = $5)
             AS "fenceCount",
           (SELECT COUNT(*)::int FROM "AdminAuditLog"
            WHERE "operationId" = $4 AND "command" = 'REAUTHENTICATION'
              AND "metadata" =
                '{"kind":"REAUTHENTICATION_V1","rotation":"OLD_REVOKED_NEW_ISSUED"}'::jsonb)
             AS "auditCount",
           (SELECT COUNT(*)::int FROM "Phase7OperationIntent")
             AS "operationCount",
           (SELECT COUNT(*)::int FROM "Phase7TrustedExecution")
             AS "trustedCount"`,
        [
          oldSessionId,
          newSessionId,
          prepared.intentId,
          prepared.operationId,
          rotationFenceDigest(oldToken)
        ]
      )
      expect(durableProof.rows).toEqual([
        {
          auditCount: 1,
          fenceCount: 1,
          intentState: 'FINALIZED',
          newSessionCount: 1,
          oldSessionCount: 0,
          operationCount: 0,
          trustedCount: 0
        }
      ])

      const reconciled = await withExecutionRole('nihongo_auth_gateway', () =>
        adminClient.query(
          `SELECT * FROM "phase7_reconcile_reauthentication"($1, $2)`,
          [prepared.intentId, newToken]
        )
      )
      expect(reconciled.rows).toHaveLength(1)
      expect(reconciled.rows[0]).toMatchObject({
        familyId,
        id: newSessionId,
        state: 'FINALIZED'
      })

      await withExecutionRole('nihongo_auth_gateway', () =>
        adminClient.query(
          `SELECT * FROM "phase7_cleanup_reauthentication"(100)`
        )
      )
      expect(
        (
          await adminClient.query<{ count: number }>(
            `SELECT COUNT(*)::int AS count
             FROM "Phase7ReauthenticationIntent"
             WHERE "id" = $1 AND "state" = 'FINALIZED'`,
            [prepared.intentId]
          )
        ).rows
      ).toEqual([{ count: 1 }])

      // #504 P7 PR3a: nihongo_app may lock a rotation fence for sign-out but
      // never change it.
      await expectRoleFailure(
        'nihongo_app',
        `UPDATE "AuthSessionRotationFence" SET "expiresAt" = clock_timestamp()
         WHERE "userId" = $1`,
        [actorId],
        '23514'
      )
      const delayedOldCookieLogout = await withExecutionRole(
        'nihongo_app',
        () =>
          ownedSessionSql(
            adminClient,
            `SELECT "phase7_owned_sign_out"($1) AS "signedOut"`,
            [oldToken]
          )
      )
      expect(delayedOldCookieLogout.rows).toEqual([{ signedOut: true }])
      expect(
        (
          await adminClient.query<{
            familyStatus: string
            sessionCount: number
          }>(
            `SELECT family."status"::text AS "familyStatus",
               (SELECT COUNT(*)::int FROM "Session"
                WHERE "sessionFamilyId" = family."id") AS "sessionCount"
             FROM "AuthSessionFamily" AS family WHERE family."id" = $1`,
            [familyId]
          )
        ).rows
      ).toEqual([{ familyStatus: 'REVOKED', sessionCount: 0 }])
    })
  }, 60_000)

  it('admin authority classifier는 unknown·expiry·logout·role/account-loss를 cardinality 1과 write 0으로 분류한다', async () => {
    await withinRollback(async () => {
      const createAdminSession = async (label: string) => {
        const userId = randomUUID()
        const sessionId = randomUUID()
        const token = `phase7-classifier-${label}-${randomUUID()}`
        const email = await insertCredentialUser(userId, 'ADMIN')
        await issueSession(userId, sessionId, token)
        return { email, sessionId, token, userId }
      }
      const operator = await createAdminSession('operator')
      const expired = await createAdminSession('expired')
      await adminClient.query('SET LOCAL session_replication_role = replica')
      try {
        await adminClient.query(
          `UPDATE "Session"
           SET "createdAt" = clock_timestamp() - INTERVAL '2 days',
               "updatedAt" = clock_timestamp() - INTERVAL '2 days',
               "expiresAt" = clock_timestamp() - INTERVAL '1 minute'
           WHERE "id" = $1`,
          [expired.sessionId]
        )
      } finally {
        await adminClient.query('SET LOCAL session_replication_role = origin')
      }

      const loggedOut = await createAdminSession('logout')
      await withExecutionRole('nihongo_app', () =>
        ownedSessionSql(adminClient, `SELECT "phase7_owned_sign_out"($1)`, [
          loggedOut.token
        ])
      )

      const roleLost = await createAdminSession('role-loss')
      await withExecutionRole('nihongo_auth_gateway', () =>
        adminClient.query(
          `SELECT "phase7_change_user_authority"(
            $1, $2, 1, 'USER', 'ACTIVE', 'TEST'
          )`,
          [operator.token, roleLost.userId]
        )
      )

      const accountLost = await createAdminSession('account-loss')
      await withExecutionRole('nihongo_auth_gateway', () =>
        adminClient.query(
          `SELECT "phase7_change_user_authority"(
            $1, $2, 1, 'ADMIN', 'DELETION_PENDING', 'TEST'
          )`,
          [operator.token, accountLost.userId]
        )
      )

      const readWriteSnapshot = async () =>
        (
          await adminClient.query<{
            auditCount: number
            evidenceCount: number
            familyCount: number
            fenceCount: number
            intentCount: number
            sessionCount: number
            trustedExecutionCount: number
          }>(
            `SELECT
               (SELECT COUNT(*)::int FROM "Session") AS "sessionCount",
               (SELECT COUNT(*)::int FROM "AuthSessionFamily")
                 AS "familyCount",
               (SELECT COUNT(*)::int FROM "AuthSessionRotationFence")
                 AS "fenceCount",
               (SELECT COUNT(*)::int FROM "Phase7ReauthenticationIntent")
                 AS "intentCount",
               (SELECT COUNT(*)::int
                FROM "Phase7AuthorityRevocationEvidence")
                 AS "evidenceCount",
               (SELECT COUNT(*)::int FROM "AdminAuditLog") AS "auditCount",
               (SELECT COUNT(*)::int FROM "Phase7TrustedExecution")
                 AS "trustedExecutionCount"`
          )
        ).rows[0]

      const cases = [
        {
          expected: 'AUTH_SESSION_EXPIRED',
          label: 'unknown',
          token: `phase7-classifier-unknown-${randomUUID()}`
        },
        {
          expected: 'AUTH_SESSION_EXPIRED',
          label: 'expired',
          token: expired.token
        },
        {
          expected: 'AUTH_SESSION_EXPIRED',
          label: 'logout',
          token: loggedOut.token
        },
        {
          expected: 'ADMIN_REQUIRED',
          label: 'role-loss',
          token: roleLost.token
        },
        {
          expected: 'ADMIN_REQUIRED',
          label: 'account-loss',
          token: accountLost.token
        }
      ] as const

      for (const classifierCase of cases) {
        const before = await readWriteSnapshot()
        const appOutcome = await withExecutionRole('nihongo_app', () =>
          adminClient.query<{ outcome: string }>(
            `SELECT * FROM "phase7_classify_admin_authority"($1)`,
            [classifierCase.token]
          )
        )
        expect(appOutcome.rows, classifierCase.label).toEqual([
          { outcome: classifierCase.expected }
        ])
        expect(await readWriteSnapshot(), classifierCase.label).toEqual(before)
      }
    })
  })

  it('만료된 STAGED intent는 같은 old Session의 다음 prepare와 startup cleanup으로 복구된다', async () => {
    await withinRollback(async () => {
      const first = await createStagedFixture()
      await adminClient.query(`SET LOCAL session_replication_role = replica`)
      await adminClient.query(
        `UPDATE "Phase7ReauthenticationIntent"
         SET "createdAt" = clock_timestamp() - INTERVAL '4 minutes',
             "expiresAt" = clock_timestamp() - INTERVAL '1 minute'
         WHERE "id" = $1`,
        [first.prepared.intentId]
      )
      await adminClient.query(`SET LOCAL session_replication_role = origin`)

      const recovered = await prepare(first.userId, first.oldToken)
      expect(recovered.intentId).not.toBe(first.prepared.intentId)
      const recoveredProof = await adminClient.query<{
        freshIntentCount: number
        oldActiveCount: number
        staleIntentCount: number
        stalePendingCount: number
        trustedCount: number
      }>(
        `SELECT
           (SELECT COUNT(*)::int FROM "Session"
            WHERE "id" = $1 AND "authorizationState" = 'ACTIVE')
             AS "oldActiveCount",
           (SELECT COUNT(*)::int FROM "Session" WHERE "id" = $2)
             AS "stalePendingCount",
           (SELECT COUNT(*)::int FROM "Phase7ReauthenticationIntent"
            WHERE "id" = $3) AS "staleIntentCount",
           (SELECT COUNT(*)::int FROM "Phase7ReauthenticationIntent"
            WHERE "id" = $4 AND "state" = 'PREPARED')
             AS "freshIntentCount",
           (SELECT COUNT(*)::int FROM "Phase7TrustedExecution")
             AS "trustedCount"`,
        [
          first.oldSessionId,
          first.newSessionId,
          first.prepared.intentId,
          recovered.intentId
        ]
      )
      expect(recoveredProof.rows).toEqual([
        {
          freshIntentCount: 1,
          oldActiveCount: 1,
          staleIntentCount: 0,
          stalePendingCount: 0,
          trustedCount: 0
        }
      ])
      const aborted = await withExecutionRole('nihongo_auth_gateway', () =>
        adminClient.query<{ aborted: boolean }>(
          `SELECT "phase7_abort_reauthentication"($1) AS aborted`,
          [recovered.intentId]
        )
      )
      expect(aborted.rows).toEqual([{ aborted: true }])

      const cleanupTarget = await createStagedFixture()
      await adminClient.query(`SET LOCAL session_replication_role = replica`)
      await adminClient.query(
        `UPDATE "Phase7ReauthenticationIntent"
         SET "createdAt" = clock_timestamp() - INTERVAL '4 minutes',
             "expiresAt" = clock_timestamp() - INTERVAL '1 minute'
         WHERE "id" = $1`,
        [cleanupTarget.prepared.intentId]
      )
      await adminClient.query(`SET LOCAL session_replication_role = origin`)
      const cleanup = await withExecutionRole('nihongo_auth_gateway', () =>
        adminClient.query<{
          evidenceDeleted: number
          intentsDeleted: number
          pendingSessionsDeleted: number
        }>(`SELECT * FROM "phase7_cleanup_reauthentication"(100)`)
      )
      expect(cleanup.rows[0]).toMatchObject({
        intentsDeleted: expect.any(Number),
        pendingSessionsDeleted: expect.any(Number)
      })
      expect(cleanup.rows[0]?.intentsDeleted).toBeGreaterThanOrEqual(1)
      expect(cleanup.rows[0]?.pendingSessionsDeleted).toBeGreaterThanOrEqual(1)
      expect(
        (
          await adminClient.query<{ count: number }>(
            `SELECT COUNT(*)::int AS count FROM "Session"
             WHERE "id" = $1 AND "authorizationState" = 'ACTIVE'`,
            [cleanupTarget.oldSessionId]
          )
        ).rows
      ).toEqual([{ count: 1 }])
      expect(
        (
          await adminClient.query<{ count: number }>(
            `SELECT COUNT(*)::int AS count
             FROM "Phase7ReauthenticationIntent" WHERE "id" = $1`,
            [cleanupTarget.prepared.intentId]
          )
        ).rows
      ).toEqual([{ count: 0 }])
    })
  })

  it('실제 app/gateway wrapper와 catalog가 auth-core raw table·column ACL 0을 증명한다', async () => {
    const appIdentity = await appClient.query<{
      currentRole: string
      currentSchema: string
      sessionUser: string
    }>(
      `SELECT session_user AS "sessionUser", current_user AS "currentRole",
         current_schema() AS "currentSchema"`
    )
    const gatewayIdentity = await gatewayClient.query<{
      currentRole: string
      currentSchema: string
      sessionUser: string
    }>(
      `SELECT session_user AS "sessionUser", current_user AS "currentRole",
         current_schema() AS "currentSchema"`
    )
    expect(appIdentity.rows).toEqual([
      {
        currentRole: 'nihongo_app',
        currentSchema: schema,
        sessionUser: 'nihongo_test_app_login'
      }
    ])
    expect(gatewayIdentity.rows).toEqual([
      {
        currentRole: 'nihongo_auth_gateway',
        currentSchema: schema,
        sessionUser: 'nihongo_test_auth_gateway_login'
      }
    ])

    for (const client of [appClient, gatewayClient]) {
      for (const statement of [
        // #504 P7 PR3a: nihongo_app reads Session.token; the metadata stays closed.
        client === appClient
          ? `SELECT "ipAddress" FROM "Session" LIMIT 1`
          : `SELECT "token" FROM "Session" LIMIT 1`,
        `SELECT * FROM "AuthSessionRotationFence" LIMIT 1`,
        `SELECT * FROM "Phase7ReauthenticationIntent" LIMIT 1`,
        `SELECT * FROM "Phase7AuthorityRevocationEvidence" LIMIT 1`,
        `UPDATE "Session" SET "token" = "token" WHERE false`
      ]) {
        let code: unknown
        try {
          await client.query(statement)
        } catch (error: unknown) {
          code = (error as { code?: unknown }).code
        }
        expect(code).toBe('42501')
      }
    }

    const catalog = await adminClient.query<{
      sensitiveColumnAclCount: number
      sensitiveTableAclCount: number
    }>(
      `WITH runtime_roles(role_name) AS (
         VALUES ('nihongo_app'::name), ('nihongo_auth_gateway'::name),
           ('nihongo_erasure_worker'::name)
       ), sensitive_relations(relation_name) AS (
         VALUES ('User'::name), ('Account'::name), ('Session'::name),
           ('AuthSessionFamily'::name), ('AuthSessionRotationFence'::name),
           ('Phase7ReauthenticationIntent'::name),
           ('Phase7AuthorityRevocationEvidence'::name)
       )
       SELECT
         (SELECT COUNT(*)::int
          FROM runtime_roles AS runtime_role
          CROSS JOIN sensitive_relations AS sensitive_relation
          WHERE has_table_privilege(
            runtime_role.role_name,
            format('%I.%I', current_schema(), sensitive_relation.relation_name),
            'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
          )) AS "sensitiveTableAclCount",
         (SELECT COUNT(*)::int
          FROM runtime_roles AS runtime_role
          CROSS JOIN pg_class AS relation
          JOIN pg_namespace AS namespace
            ON namespace.oid = relation.relnamespace
          JOIN pg_attribute AS attribute
            ON attribute.attrelid = relation.oid
          WHERE namespace.nspname = current_schema()
            AND relation.relname IN (
              'User', 'Account', 'Session', 'AuthSessionFamily',
              'AuthSessionRotationFence', 'Phase7ReauthenticationIntent',
              'Phase7AuthorityRevocationEvidence'
            )
            AND attribute.attnum > 0
            AND NOT attribute.attisdropped
            AND has_column_privilege(
              runtime_role.role_name, relation.oid, attribute.attnum,
              'SELECT,INSERT,UPDATE,REFERENCES'
            )) AS "sensitiveColumnAclCount"`
    )
    // #504 P2: nihongo_app reads six User columns for the member console.
    // #504 P7 PR2: plus the admin operation authority columns (User 1,
    // Session 8, AuthSessionFamily 3). #504 P7 PR3a: owned Session issuance
    // adds User 2, Session 4 (token and updatedAt read, ipAddress and
    // userAgent insert only) and AuthSessionRotationFence 5, and Session DELETE.
    expect(catalog.rows).toEqual([
      { sensitiveColumnAclCount: 29, sensitiveTableAclCount: 1 }
    ])
  })

  it('모든 #31 routine identity·owner·SECURITY DEFINER·fixed path·role ACL이 exact다', async () => {
    const catalog = await adminClient.query<{
      appCanExecute: boolean
      config: string[] | null
      erasureCanExecute: boolean
      gatewayCanExecute: boolean
      identityArguments: string
      isSecurityDefiner: boolean
      name: string
      ownerCanExecute: boolean
      ownerName: string
      publicCanExecute: boolean
    }>(
      `SELECT procedure_record.proname AS name,
         pg_get_function_identity_arguments(procedure_record.oid)
           AS "identityArguments",
         owner_role.rolname AS "ownerName",
         procedure_record.prosecdef AS "isSecurityDefiner",
         procedure_record.proconfig::text[] AS config,
         has_function_privilege(
           'nihongo_phase7_owner', procedure_record.oid, 'EXECUTE'
         ) AS "ownerCanExecute",
         has_function_privilege(
           'nihongo_app', procedure_record.oid, 'EXECUTE'
         ) AS "appCanExecute",
         has_function_privilege(
           'nihongo_auth_gateway', procedure_record.oid, 'EXECUTE'
         ) AS "gatewayCanExecute",
         has_function_privilege(
           'nihongo_erasure_worker', procedure_record.oid, 'EXECUTE'
         ) AS "erasureCanExecute",
         EXISTS (
           SELECT 1
           FROM aclexplode(COALESCE(
             procedure_record.proacl,
             acldefault('f', procedure_record.proowner)
           )) AS permission
           WHERE permission.grantee = 0
             AND permission.privilege_type = 'EXECUTE'
         ) AS "publicCanExecute"
       FROM pg_proc AS procedure_record
       JOIN pg_namespace AS namespace_record
         ON namespace_record.oid = procedure_record.pronamespace
       JOIN pg_roles AS owner_role
         ON owner_role.oid = procedure_record.proowner
       WHERE namespace_record.nspname = current_schema()
         AND procedure_record.proname = ANY($1::text[])
       ORDER BY procedure_record.proname,
         pg_get_function_identity_arguments(procedure_record.oid)`,
      [routineManifest.map(([name]) => name)]
    )
    expect(catalog.rows).toHaveLength(routineManifest.length)
    for (const [
      name,
      identityArguments,
      appCanExecute,
      gatewayCanExecute
    ] of routineManifest) {
      const row = catalog.rows.find((candidate) => candidate.name === name)
      expect(row).toMatchObject({
        // #504 P7 PR1: nihongo_app also executes every gateway facade.
        appCanExecute: appCanExecute || gatewayCanExecute,
        erasureCanExecute: false,
        gatewayCanExecute,
        identityArguments,
        isSecurityDefiner: true,
        name,
        ownerCanExecute: true,
        ownerName: 'nihongo_phase7_owner',
        publicCanExecute: false
      })
      expect(row?.config).toEqual([
        `search_path=pg_catalog, ${schema}, pg_temp`
      ])
    }

    const legacy = await adminClient.query<{
      appCanExecute: boolean
      gatewayCanExecute: boolean
      identityArguments: string
      publicCanExecute: boolean
    }>(
      `SELECT
         pg_get_function_identity_arguments(procedure_record.oid)
           AS "identityArguments",
         has_function_privilege(
           'nihongo_app', procedure_record.oid, 'EXECUTE'
         ) AS "appCanExecute",
         has_function_privilege(
           'nihongo_auth_gateway', procedure_record.oid, 'EXECUTE'
         ) AS "gatewayCanExecute",
         EXISTS (
           SELECT 1
           FROM aclexplode(COALESCE(
             procedure_record.proacl,
             acldefault('f', procedure_record.proowner)
           )) AS permission
           WHERE permission.grantee = 0
             AND permission.privilege_type = 'EXECUTE'
         ) AS "publicCanExecute"
       FROM pg_proc AS procedure_record
       JOIN pg_namespace AS namespace_record
         ON namespace_record.oid = procedure_record.pronamespace
       WHERE namespace_record.nspname = current_schema()
         AND procedure_record.proname = 'phase7_reauthenticate_v1_session'`
    )
    // The legacy password reauthentication function was dropped in #504 P6b-1.
    expect(legacy.rows).toEqual([])
  })

  it('#504 P7 PR1: require_caller_role는 gateway·erasure_worker 요구에만 nihongo_app을 더 허용한다', async () => {
    const outcome = async (
      caller: 'nihongo_app' | 'nihongo_auth_gateway' | 'nihongo_erasure_worker',
      required: string
    ) => {
      await adminClient.query('SAVEPOINT phase7_caller_role_probe')
      try {
        await adminClient.query(`SET LOCAL ROLE "${caller}"`)
        await adminClient.query('SELECT "phase7_require_caller_role"($1)', [
          required
        ])
        return 'allowed'
      } catch (error: unknown) {
        return (error as { code?: unknown }).code
      } finally {
        await adminClient.query(
          'ROLLBACK TO SAVEPOINT phase7_caller_role_probe'
        )
        await adminClient.query('RELEASE SAVEPOINT phase7_caller_role_probe')
      }
    }
    await withinRollback(async () => {
      // Callers reach the check through facades; grant it directly only inside
      // this rolled-back transaction so the probe can call it.
      await adminClient.query(
        `GRANT EXECUTE ON FUNCTION "phase7_require_caller_role"(TEXT)
         TO "nihongo_app", "nihongo_auth_gateway", "nihongo_erasure_worker"`
      )
      const cases = [
        ['nihongo_app', 'nihongo_app', 'allowed'],
        ['nihongo_app', 'nihongo_auth_gateway', 'allowed'],
        ['nihongo_app', 'nihongo_erasure_worker', 'allowed'],
        ['nihongo_app', 'nihongo_phase7_migration', '42501'],
        ['nihongo_auth_gateway', 'nihongo_auth_gateway', 'allowed'],
        ['nihongo_auth_gateway', 'nihongo_app', '42501'],
        ['nihongo_auth_gateway', 'nihongo_erasure_worker', '42501'],
        ['nihongo_erasure_worker', 'nihongo_erasure_worker', 'allowed'],
        ['nihongo_erasure_worker', 'nihongo_app', '42501'],
        ['nihongo_erasure_worker', 'nihongo_auth_gateway', '42501']
      ] as const
      for (const [caller, required, expected] of cases) {
        expect(
          await outcome(caller, required),
          `${caller} -> ${required}`
        ).toBe(expected)
      }
    })
  })

  it('#504 P7 PR1: nihongo_app EXECUTE는 기존 app facade와 gateway·erasure_worker facade의 합집합이다', async () => {
    const rows = (
      await adminClient.query<{
        app: boolean
        erasure: boolean
        gateway: boolean
        name: string
      }>(
        `SELECT procedure_record.proname AS name,
           has_function_privilege('nihongo_app', procedure_record.oid, 'EXECUTE') AS app,
           has_function_privilege('nihongo_auth_gateway', procedure_record.oid, 'EXECUTE') AS gateway,
           has_function_privilege('nihongo_erasure_worker', procedure_record.oid, 'EXECUTE') AS erasure
         FROM pg_proc AS procedure_record
         JOIN pg_namespace AS namespace_record
           ON namespace_record.oid = procedure_record.pronamespace
         WHERE namespace_record.nspname = current_schema()
           AND NOT EXISTS (
             SELECT 1
             FROM aclexplode(COALESCE(
               procedure_record.proacl,
               acldefault('f', procedure_record.proowner)
             )) AS permission
             WHERE permission.grantee = 0
               AND permission.privilege_type = 'EXECUTE'
           )
         ORDER BY procedure_record.proname`
      )
    ).rows
    expect(
      rows.filter((row) => (row.gateway || row.erasure) && !row.app)
    ).toEqual([])
    expect(
      rows
        .filter((row) => row.app && !row.gateway && !row.erasure)
        .map((row) => row.name)
    ).toEqual([
      'phase7_classify_admin_authority',
      'phase7_create_question_report',
      'phase7_finish_admin_operation',
      'phase7_require_database_capability',
      'phase7_sso_admin_session_is_fresh'
    ])
    expect(rows.filter((row) => row.gateway).length).toBe(30)
    expect(rows.filter((row) => row.erasure).length).toBe(8)
  })

  const createCommittedAdmin = async () => {
    const userId = randomUUID()
    const sessionId = randomUUID()
    const token = `phase7-admin-operation-${randomUUID()}`
    // The deferred credential totality check needs User and Account together.
    await adminClient.query('BEGIN')
    try {
      await insertCredentialUser(userId, 'ADMIN')
      await adminClient.query('COMMIT')
    } catch (error: unknown) {
      await adminClient.query('ROLLBACK')
      throw error
    }
    await issueSession(userId, sessionId, token)
    return { sessionId, token, userId }
  }

  it('#504 P7 PR2·PR3a: nihongo_app은 허용 열만 읽고 잠금용 UPDATE 열을 직접 바꾸면 guard 트리거가 막는다', async () => {
    const admin = await createCommittedAdmin()
    await withinRollback(async () => {
      // PR3a reads Session.token to find the Session; the network metadata stays closed.
      await expectRoleFailure(
        'nihongo_app',
        'SELECT "ipAddress", "userAgent" FROM "Session" WHERE "id" = $1',
        [admin.sessionId],
        '42501'
      )
      await expectRoleFailure(
        'nihongo_app',
        'SELECT * FROM "Session" WHERE "id" = $1',
        [admin.sessionId],
        '42501'
      )
      await expectRoleFailure(
        'nihongo_app',
        `UPDATE "User" SET "authorityGeneration" = "authorityGeneration" + 1
         WHERE "id" = $1`,
        [admin.userId],
        '42501'
      )
      await expectRoleFailure(
        'nihongo_app',
        `UPDATE "Session" SET "authorizationState" = 'ACTIVE'
         WHERE "id" = $1`,
        [admin.sessionId],
        '42501'
      )
      // PR3a lets nihongo_app revoke a family, so a no-op ACTIVE write now
      // reaches the ACTIVE to REVOKED rule.
      await expectRoleFailure(
        'nihongo_app',
        `UPDATE "AuthSessionFamily" SET "status" = 'ACTIVE'
         WHERE "userId" = $1`,
        [admin.userId],
        '23514'
      )
    })
  })

  it('#504 P7 PR3a: Session·family 트리거는 nihongo_app 직접 쓰기를 발급·갱신·로그아웃 조건일 때만 허용한다', async () => {
    const admin = await createCommittedAdmin()
    const family = (
      await adminClient.query<{ id: string }>(
        `SELECT "sessionFamilyId" AS id FROM "Session" WHERE "id" = $1`,
        [admin.sessionId]
      )
    ).rows[0]!.id
    const insertSession = (
      overrides: { generation?: number; issuer?: string; state?: string } = {}
    ) =>
      [
        `INSERT INTO "Session" (
         "id", "expiresAt", "token", "createdAt", "updatedAt", "userId",
         "sessionFamilyId", "authorityGeneration", "issuerProtocolVersion"
       ) VALUES (
         $1, clock_timestamp() + INTERVAL '1 day', $2, clock_timestamp(),
         clock_timestamp(), $3, $4, $5, $6::"AuthSessionIssuerProtocolVersion"
       )`,
        [
          randomUUID(),
          `phase7-pr3a-${randomUUID()}`,
          admin.userId,
          family,
          overrides.generation ?? 1,
          overrides.issuer ?? 'PHASE7_V1'
        ]
      ] as const
    await withinRollback(async () => {
      // Issuance: a LEGACY Session stays refused. A V1 Session always takes
      // the User's current generation and the server clock, whatever the
      // writer sent; the API checks the captured generation under its lock.
      await expectRoleFailure(
        'nihongo_app',
        ...insertSession({ issuer: 'LEGACY' }),
        '42501'
      )
      const [normalizedSql, normalizedValues] = insertSession({ generation: 2 })
      await adminClient.query('SET LOCAL ROLE "nihongo_app"')
      await adminClient.query(normalizedSql, [...normalizedValues])
      await adminClient.query('RESET ROLE')
      expect(
        (
          await adminClient.query<{ generation: number; oneDay: boolean }>(
            `SELECT "authorityGeneration" AS generation,
               "expiresAt" = "createdAt" + INTERVAL '1 day' AS "oneDay"
             FROM "Session" WHERE "id" = $1`,
            [normalizedValues[0]]
          )
        ).rows
      ).toEqual([{ generation: 1, oneDay: true }])
      // A family for a missing User is refused before its foreign key.
      await expectRoleFailure(
        'nihongo_app',
        'INSERT INTO "AuthSessionFamily" ("userId") VALUES ($1)',
        [randomUUID()],
        '42501'
      )
      // Refresh: a 1 day Session never extends.
      await expectRoleFailure(
        'nihongo_app',
        `UPDATE "Session" SET "expiresAt" = "expiresAt" WHERE "id" = $1`,
        [admin.sessionId],
        '42501'
      )
      // Sign-out: a Session of an ACTIVE family cannot be deleted.
      await expectRoleFailure(
        'nihongo_app',
        'DELETE FROM "Session" WHERE "id" = $1',
        [admin.sessionId],
        '42501'
      )
      // Families are never deleted.
      await expectRoleFailure(
        'nihongo_app',
        'DELETE FROM "AuthSessionFamily" WHERE "id" = $1',
        [family],
        '42501'
      )
      // After a revoke, the family takes no new Session.
      await adminClient.query('SET LOCAL ROLE "nihongo_app"')
      await adminClient.query(
        `UPDATE "AuthSessionFamily" SET "status" = 'REVOKED' WHERE "id" = $1`,
        [family]
      )
      await adminClient.query('RESET ROLE')
      await expectRoleFailure('nihongo_app', ...insertSession(), '42501')
    })
  })

  it('#504 P7 PR3a: 세션 발급이 중간에 실패하면 family와 Session이 함께 rollback된다', async () => {
    const admin = await createCommittedAdmin()
    const familiesOf = async () =>
      (
        await adminClient.query<{ count: number }>(
          `SELECT COUNT(*)::int AS count FROM "AuthSessionFamily"
           WHERE "userId" = $1`,
          [admin.userId]
        )
      ).rows[0]?.count
    const before = await familiesOf()
    // The family insert succeeds; the Session insert then fails on the
    // existing Session id, so the whole issuance rolls back.
    await expect(
      issueSession(admin.userId, admin.sessionId, `phase7-pr3a-${randomUUID()}`)
    ).rejects.toMatchObject({ code: '23505' })
    expect(await familiesOf()).toBe(before)
    expect(
      (
        await adminClient.query<{ count: number }>(
          `SELECT COUNT(*)::int AS count FROM "Session" WHERE "userId" = $1`,
          [admin.userId]
        )
      ).rows[0]?.count
    ).toBe(1)
  })

  it('#504 P7 PR2: API 관리자 실행은 권한 회수가 먼저면 거절하고, 실행 중 회수는 잠금으로 commit 뒤에 선형화한다', async () => {
    const revokeFirst = await createCommittedAdmin()
    const revokeLater = await createCommittedAdmin()
    const bumpGeneration = async (client: Client, userId: string) => {
      await client.query('BEGIN')
      await client.query('SET LOCAL session_replication_role = replica')
      await client.query(
        `UPDATE "User" SET "authorityGeneration" = "authorityGeneration" + 1
         WHERE "id" = $1`,
        [userId]
      )
      await client.query('COMMIT')
    }
    const begin = (admin: { token: string; userId: string }) =>
      beginAdminOperation(asTransaction(appClient), {
        auditEnvironment: 'TEST',
        command: 'REVIEW_REQUEST',
        rawSessionToken: admin.token,
        referencedUserIds: [admin.userId]
      })

    // Revoked before the operation: begin fails with the same SQLSTATE.
    await bumpGeneration(adminClient, revokeFirst.userId)
    await appClient.query('BEGIN ISOLATION LEVEL READ COMMITTED')
    try {
      expect(await sqlStateOf(() => begin(revokeFirst))).toBe('42501')
    } finally {
      await appClient.query('ROLLBACK')
    }

    // Revoked while the operation holds its locks: the revocation waits for
    // the admin commit, so the operation commits with the authority it checked.
    const observer = new Client({
      connectionString: adminUrl.toString(),
      options: createPostgresStartupOptions(schema)
    })
    await observer.connect()
    try {
      await appClient.query('BEGIN ISOLATION LEVEL READ COMMITTED')
      const operation = await begin(revokeLater)
      expect(operation.actorUserId).toBe(revokeLater.userId)
      const revokerPid = (
        await adminClient.query<{ pid: number }>(
          'SELECT pg_backend_pid() AS pid'
        )
      ).rows[0]!.pid
      const revocation = bumpGeneration(adminClient, revokeLater.userId)
      let waited = false
      for (let attempt = 0; attempt < 200 && !waited; attempt += 1) {
        const activity = await observer.query<{ waitEventType: string | null }>(
          `SELECT wait_event_type AS "waitEventType"
           FROM pg_stat_activity WHERE pid = $1`,
          [revokerPid]
        )
        waited = activity.rows[0]?.waitEventType === 'Lock'
        if (!waited) await new Promise((resolve) => setTimeout(resolve, 10))
      }
      expect(waited).toBe(true)
      await finishAdminOperation(
        asTransaction(appClient),
        operation.operationId
      )
      await appClient.query('COMMIT')
      await revocation
    } finally {
      await appClient.query('ROLLBACK').catch(() => undefined)
      await observer.end()
    }

    // After the revocation commits, the next operation is refused.
    await appClient.query('BEGIN ISOLATION LEVEL READ COMMITTED')
    try {
      expect(await sqlStateOf(() => begin(revokeLater))).toBe('42501')
    } finally {
      await appClient.query('ROLLBACK')
    }
  })

  it('#504 P7 PR2: finish는 같은 트랜잭션에서 begin한 operation만 받고 아니면 42501로 거절한다', async () => {
    const admin = await createCommittedAdmin()
    await appClient.query('BEGIN ISOLATION LEVEL READ COMMITTED')
    let operationId = ''
    try {
      operationId = (
        await beginAdminOperation(asTransaction(appClient), {
          auditEnvironment: 'TEST',
          command: 'REVIEW_REQUEST',
          rawSessionToken: admin.token,
          referencedUserIds: [admin.userId]
        })
      ).operationId
    } finally {
      await appClient.query('ROLLBACK')
    }
    for (const candidate of [operationId, randomUUID()]) {
      await appClient.query('BEGIN ISOLATION LEVEL READ COMMITTED')
      try {
        expect(
          await sqlStateOf(() =>
            finishAdminOperation(asTransaction(appClient), candidate)
          )
        ).toBe('42501')
      } finally {
        await appClient.query('ROLLBACK')
      }
    }
  })
})

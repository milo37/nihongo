import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  bridgedQuery,
  isOwnedSessionSql,
  ownedSessionSql
} from './fixtures/ownedSessionSql.js'
import { Client } from 'pg'
import {
  beginAdminOperation,
  finishAdminOperation
} from '../admin/adminOperationAuthority.js'
import { v1PrincipalQuery } from '../auth/ownedSessionAuthority.js'
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
  readonly id: string
}

const routineManifest = [
  ['phase7_active_authorization_session', 'raw_token text', false, false],
  ['phase7_classify_admin_authority', 'raw_token text', true, false],
  ['phase7_reauthentication_token_digest', 'raw_token text', false, false],
  [
    'phase7_record_authority_revocation',
    'target_user_id uuid, reason_value "Phase7AuthorityRevocationReason"',
    false,
    false
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
  role: 'nihongo_app' | 'nihongo_auth_gateway' | 'nihongo_phase7_migration',
  statement: string,
  values: readonly unknown[],
  expectedCode: string
): Promise<void> => {
  savepointSequence += 1
  const savepoint = `phase7_reauth_expected_${savepointSequence}`
  await adminClient.query(`SAVEPOINT ${savepoint}`)
  let actualCode: unknown
  try {
    // #504 P7 PR3b-1: calls to the dropped functions run the API steps; the
    // gateway facade caller is nihongo_app since PR1.
    const bridged = isOwnedSessionSql(statement)
    await adminClient.query(
      `SET LOCAL ROLE "${bridged && role === 'nihongo_auth_gateway' ? 'nihongo_app' : role}"`
    )
    await bridgedQuery(adminClient, statement, [...values])
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
  const issuedId = issued.rows[0]?.id
  if (issuedId !== sessionId) throw new Error('Session was not issued.')
  return issuedId
}

const prepare = async (
  userId: string,
  oldToken: string,
  requestId = randomUUID(),
  intentId = randomUUID()
): Promise<PreparedIntentRow> => {
  const prepared = await withExecutionRole('nihongo_app', () =>
    ownedSessionSql<PreparedIntentRow>(
      adminClient,
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
): Promise<{ rows: Array<{ id: string }>; rowCount: number }> =>
  await withExecutionRole('nihongo_app', () =>
    ownedSessionSql<{ id: string }>(
      adminClient,
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
  const finalized = await withExecutionRole('nihongo_app', () =>
    ownedSessionSql<FinalizedSessionRow>(
      adminClient,
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
  await issueSession(userId, oldSessionId, oldToken)
  const prepared = await prepare(userId, oldToken)
  const staged = await stage(prepared.intentId, newSessionId, newToken, userId)
  expect(staged.rows).toHaveLength(1)
  expect(staged.rows[0]).toMatchObject({ id: newSessionId })
  return {
    newSessionId,
    newToken,
    oldSessionId,
    oldToken,
    prepared,
    userId
  }
}

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
      await issueSession(actorId, oldSessionId, oldToken)
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
        intentState: string
      }>(
        `SELECT session."authorizationState"::text AS "authorizationState",
           intent."state"::text AS "intentState"
         FROM "Session" AS session
         JOIN "Phase7ReauthenticationIntent" AS intent
           ON intent."stagedSessionId" = session."id"
         WHERE session."id" = $1`,
        [newSessionId]
      )
      expect(pendingProof.rows).toEqual([
        {
          authorizationState: 'PENDING_REAUTH',
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
             WHERE "userId" = $1`,
            [actorId]
          )
        ).rows
      ).toEqual([{ count: 2 }])

      const pendingReconciliation = await withExecutionRole('nihongo_app', () =>
        ownedSessionSql(
          adminClient,
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
      const issuance = await withExecutionRole('nihongo_app', () =>
        ownedSessionSql(
          adminClient,
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
        id: newSessionId
      })
      await adminClient.query('SET CONSTRAINTS ALL IMMEDIATE')
      await adminClient.query('SET CONSTRAINTS ALL DEFERRED')
      const durableProof = await adminClient.query<{
        auditCount: number
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
           (SELECT COUNT(*)::int FROM "AdminAuditLog"
            WHERE "operationId" = $4 AND "command" = 'REAUTHENTICATION'
              AND "metadata" =
                '{"kind":"REAUTHENTICATION_V1","rotation":"OLD_REVOKED_NEW_ISSUED"}'::jsonb)
             AS "auditCount",
           (SELECT COUNT(*)::int FROM "Phase7OperationIntent")
             AS "operationCount",
           (SELECT COUNT(*)::int FROM "Phase7TrustedExecution")
             AS "trustedCount"`,
        [oldSessionId, newSessionId, prepared.intentId, prepared.operationId]
      )
      expect(durableProof.rows).toEqual([
        {
          auditCount: 1,
          intentState: 'FINALIZED',
          newSessionCount: 1,
          oldSessionCount: 0,
          operationCount: 0,
          trustedCount: 0
        }
      ])

      const reconciled = await withExecutionRole('nihongo_app', () =>
        ownedSessionSql(
          adminClient,
          `SELECT * FROM "phase7_reconcile_reauthentication"($1, $2)`,
          [prepared.intentId, newToken]
        )
      )
      expect(reconciled.rows).toHaveLength(1)
      expect(reconciled.rows[0]).toMatchObject({
        id: newSessionId,
        state: 'FINALIZED'
      })

      await withExecutionRole('nihongo_app', () =>
        ownedSessionSql(
          adminClient,
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

      // #504 P7 PR4b-1 (fence option A): the old tab's cookie finds no
      // Session, so its sign-out ends nothing and the replacement stays.
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
      const principalCount = async (token: string) =>
        (
          await withExecutionRole('nihongo_app', () =>
            adminClient.query<{ count: number }>(
              `SELECT COUNT(*)::int AS count FROM (${v1PrincipalQuery('$1')}) AS principal`,
              [token]
            )
          )
        ).rows[0]?.count
      expect(await principalCount(oldToken)).toBe(0)
      expect(await principalCount(newToken)).toBe(1)
      expect(
        (
          await adminClient.query<{
            newActive: number
            oldSessions: number
          }>(
            `SELECT
               (SELECT COUNT(*)::int FROM "Session" WHERE "id" = $1)
                 AS "oldSessions",
               (SELECT COUNT(*)::int FROM "Session"
                WHERE "id" = $2 AND "authorizationState" = 'ACTIVE')
                 AS "newActive"`,
            [oldSessionId, newSessionId]
          )
        ).rows
      ).toEqual([{ newActive: 1, oldSessions: 0 }])
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
      await withExecutionRole('nihongo_app', () =>
        bridgedQuery(
          adminClient,
          `SELECT "phase7_change_user_authority"(
            $1, $2, 1, 'USER', 'ACTIVE', 'TEST'
          )`,
          [operator.token, roleLost.userId]
        )
      )

      const accountLost = await createAdminSession('account-loss')
      await withExecutionRole('nihongo_app', () =>
        bridgedQuery(
          adminClient,
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
            intentCount: number
            sessionCount: number
            trustedExecutionCount: number
          }>(
            `SELECT
               (SELECT COUNT(*)::int FROM "Session") AS "sessionCount",
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
      const aborted = await withExecutionRole('nihongo_app', () =>
        ownedSessionSql(
          adminClient,
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
      const cleanup = await withExecutionRole('nihongo_app', () =>
        ownedSessionSql(
          adminClient,
          `SELECT * FROM "phase7_cleanup_reauthentication"(100)`
        )
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
              'User', 'Account', 'Session', 'Phase7ReauthenticationIntent',
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
    // #504 P7 PR3b-1: ADMIN_FRESH re-authentication adds User 1, Account 3,
    // AuthSessionRotationFence 4, Phase7ReauthenticationIntent 18 and
    // Phase7AuthorityRevocationEvidence 2, and DELETE on the last two.
    // #504 P7 PR4a: account erasure adds Account 2 (id read, createdAt lock
    // only) and DELETE on User, AuthSessionFamily and AuthSessionRotationFence.
    // #504 P7 PR4b-1 drops the family and fence tables and the family columns
    // of Session and Phase7ReauthenticationIntent with their grants.
    // #504 P7 PR5a: the API SSO link adds Account 1 (updatedAt insert only)
    // and the unlink DELETE on Account.
    expect(catalog.rows).toEqual([
      { sensitiveColumnAclCount: 45, sensitiveTableAclCount: 5 }
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
      'phase7_require_database_capability',
      'phase7_user_erasure_confirmed'
    ])
    // #504 P7 PR4a: the erasure worker queue, direct erasure, report redaction
    // and the receipt status moved to the API.
    // #504 P7 PR4b-2 dropped phase7_request_sso_account_erasure.
    // #504 P7 PR5a moved SSO account fresh, link, unlink and provider cleanup
    // to the API and dropped phase7_change_user_authority.
    expect(rows.filter((row) => row.gateway).length).toBe(4)
    // #504 P7 PR4b-1 dropped phase7_cleanup_expired_auth_state.
    expect(rows.filter((row) => row.erasure).length).toBe(0)
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
    })
  })

  it('#504 P7 PR3a·PR4b-1: Session 트리거는 nihongo_app 직접 쓰기를 발급·갱신·V1 로그아웃일 때만 허용한다', async () => {
    const admin = await createCommittedAdmin()
    const insertSession = (
      overrides: { generation?: number; issuer?: string; state?: string } = {}
    ) =>
      [
        `INSERT INTO "Session" (
         "id", "expiresAt", "token", "createdAt", "updatedAt", "userId",
         "authorityGeneration", "issuerProtocolVersion"
       ) VALUES (
         $1, clock_timestamp() + INTERVAL '1 day', $2, clock_timestamp(),
         clock_timestamp(), $3, $4, $5::"AuthSessionIssuerProtocolVersion"
       )`,
        [
          randomUUID(),
          `phase7-pr3a-${randomUUID()}`,
          admin.userId,
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
      // Refresh: a 1 day Session never extends.
      await expectRoleFailure(
        'nihongo_app',
        `UPDATE "Session" SET "expiresAt" = "expiresAt" WHERE "id" = $1`,
        [admin.sessionId],
        '42501'
      )
      // Identity columns stay closed to every runtime write.
      await expectRoleFailure(
        'nihongo_app',
        `UPDATE "Session" SET "userId" = "userId" WHERE "id" = $1`,
        [admin.sessionId],
        '42501'
      )
      // #504 P7 PR4b-1: a non-V1 Session cannot be deleted by nihongo_app,
      // and no other runtime role may delete a V1 Session.
      const legacySessionId = randomUUID()
      await adminClient.query('SET LOCAL session_replication_role = replica')
      try {
        await adminClient.query(
          `INSERT INTO "Session" (
             "id", "expiresAt", "token", "createdAt", "updatedAt", "userId",
             "authorityGeneration", "issuerProtocolVersion"
           ) VALUES (
             $1, clock_timestamp() + INTERVAL '1 day', $2, clock_timestamp(),
             clock_timestamp(), $3, 1, 'LEGACY'
           )`,
          [legacySessionId, `phase7-pr4b1-legacy-${randomUUID()}`, admin.userId]
        )
      } finally {
        await adminClient.query('SET LOCAL session_replication_role = origin')
      }
      await expectRoleFailure(
        'nihongo_app',
        'DELETE FROM "Session" WHERE "id" = $1',
        [legacySessionId],
        '42501'
      )
      await expectRoleFailure(
        'nihongo_auth_gateway',
        'DELETE FROM "Session" WHERE "id" = $1',
        [admin.sessionId],
        '42501'
      )
      // Sign-out: nihongo_app deletes the V1 Session itself.
      await adminClient.query('SET LOCAL ROLE "nihongo_app"')
      const deleted = await adminClient.query(
        'DELETE FROM "Session" WHERE "id" = $1',
        [admin.sessionId]
      )
      await adminClient.query('RESET ROLE')
      expect(deleted.rowCount).toBe(1)
    })
  })

  it('#504 P7 PR3b-1: 재인증 세션 쓰기와 삭제 제한 트리거는 그 조건 밖의 nihongo_app 쓰기를 거절한다', async () => {
    await withinRollback(async () => {
      const staged = await createStagedFixture()
      const intentId = staged.prepared.intentId
      // PENDING_REAUTH only for a live PREPARED intent: this one is STAGED.
      await expectRoleFailure(
        'nihongo_app',
        `INSERT INTO "Session" (
           "id", "expiresAt", "token", "createdAt", "updatedAt", "userId",
           "authorityGeneration", "issuerProtocolVersion", "authorizationState"
         ) VALUES (
           $1, clock_timestamp() + INTERVAL '1 day', $2, clock_timestamp(),
           clock_timestamp(), $3, 1, 'PHASE7_V1', 'PENDING_REAUTH'
         )`,
        [randomUUID(), `phase7-pr3b1-${randomUUID()}`, staged.userId],
        '42501'
      )
      // PENDING to ACTIVE only for the staged Session of a live STAGED
      // intent: this one has expired.
      await adminClient.query(
        `UPDATE "Phase7ReauthenticationIntent"
         SET "createdAt" = clock_timestamp() - INTERVAL '3 minutes',
             "expiresAt" = clock_timestamp() - INTERVAL '1 second'
         WHERE "id" = $1`,
        [intentId]
      )
      await expectRoleFailure(
        'nihongo_app',
        `UPDATE "Session" SET "authorizationState" = 'ACTIVE' WHERE "id" = $1`,
        [staged.newSessionId],
        '42501'
      )
      // Delete limits: a recently FINALIZED intent, a completed live proof and
      // unexpired revocation evidence stay.
      await adminClient.query(
        `UPDATE "Phase7ReauthenticationIntent"
         SET "state" = 'FINALIZED', "finalizedAt" = clock_timestamp()
         WHERE "id" = $1`,
        [intentId]
      )
      await expectRoleFailure(
        'nihongo_app',
        'DELETE FROM "Phase7ReauthenticationIntent" WHERE "id" = $1',
        [intentId],
        '42501'
      )
      const proofDigest = 'b'.repeat(64)
      await adminClient.query(
        `INSERT INTO "SsoAdminFreshProof" (
           "userId", "proofDigest", "context", "callbackURL", "createdAt",
           "expiresAt", "completedSessionId", "completedAt"
         ) VALUES (
           $1::uuid, $2, jsonb_build_object('userId', $1::uuid), '/login',
           clock_timestamp(),
           clock_timestamp() + INTERVAL '5 minutes', $3, clock_timestamp()
         )`,
        [staged.userId, proofDigest, staged.newSessionId]
      )
      await expectRoleFailure(
        'nihongo_app',
        'DELETE FROM "SsoAdminFreshProof" WHERE "proofDigest" = $1',
        [proofDigest],
        '42501'
      )
      const evidenceDigest = 'c'.repeat(64)
      await adminClient.query(
        `INSERT INTO "Phase7AuthorityRevocationEvidence" (
           "tokenDigest", "sessionId", "reason", "expiresAt"
         ) VALUES ($1, $2, 'SESSION_INVALIDATED',
           clock_timestamp() + INTERVAL '10 minutes')`,
        [evidenceDigest, staged.oldSessionId]
      )
      await expectRoleFailure(
        'nihongo_app',
        `DELETE FROM "Phase7AuthorityRevocationEvidence"
         WHERE "tokenDigest" = $1`,
        [evidenceDigest],
        '42501'
      )
      // SsoAdminFreshTransaction rows are one-time: consume is itself a
      // delete, so only roles without the grant are refused.
      await expectRoleFailure(
        'nihongo_auth_gateway',
        'DELETE FROM "SsoAdminFreshTransaction"',
        [],
        '42501'
      )
    })
  })

  it('#504 P7 PR3b-1: finalize는 intent의 staged token digest가 token과 다르면 42501로 거절한다', async () => {
    await withinRollback(async () => {
      const staged = await createStagedFixture()
      const intentId = staged.prepared.intentId
      const recorded = await adminClient.query<{ digest: string }>(
        `SELECT "stagedTokenDigest" AS digest
         FROM "Phase7ReauthenticationIntent" WHERE "id" = $1`,
        [intentId]
      )
      const digest = recorded.rows[0]?.digest
      if (!digest) throw new Error('Staged token digest is unavailable.')
      // The Session row still matches the token, so only the intent digest
      // comparison can refuse this finalize.
      await adminClient.query(
        `UPDATE "Phase7ReauthenticationIntent"
         SET "stagedTokenDigest" = $2 WHERE "id" = $1`,
        [intentId, 'd'.repeat(64)]
      )
      await expectRoleFailure(
        'nihongo_app',
        `SELECT * FROM "phase7_finalize_reauthentication"($1, $2)`,
        [intentId, staged.newToken],
        '42501'
      )
      const pending = await adminClient.query<{ state: string }>(
        `SELECT "authorizationState"::text AS state FROM "Session"
         WHERE "id" = $1`,
        [staged.newSessionId]
      )
      expect(pending.rows).toEqual([{ state: 'PENDING_REAUTH' }])
      await adminClient.query(
        `UPDATE "Phase7ReauthenticationIntent"
         SET "stagedTokenDigest" = $2 WHERE "id" = $1`,
        [intentId, digest]
      )
      const finalized = await finalize(intentId, staged.newToken)
      expect(finalized).toMatchObject({ authorityGeneration: 1 })
    })
  })

  it('#504 P7 PR4a: User 삭제와 erasure 정리 쓰기는 확정된 erasure의 nihongo_app만 허용한다', async () => {
    await withinRollback(async () => {
      const userId = randomUUID()
      const otherUserId = randomUUID()
      await insertCredentialUser(userId, 'ADMIN')
      await insertCredentialUser(otherUserId, 'USER')
      await issueSession(userId, randomUUID(), `phase7-pr4a-${randomUUID()}`)
      const deleteUser = 'DELETE FROM "User" WHERE "id" = $1'
      // No confirmed erasure: the User and its request stay.
      await expectRoleFailure('nihongo_app', deleteUser, [userId], '42501')
      const receipt = 'e'.repeat(64)
      await adminClient.query(
        `INSERT INTO "SsoAccountErasureRequest" (
           "userId", "receiptDigest", "providerCleanup", "receiptExpiresAt"
         ) VALUES (
           $1, $2, '[{"provider":"google","status":"COMPLETED"}]',
           clock_timestamp() + INTERVAL '1 day'
         )`,
        [userId, receipt]
      )
      await expectRoleFailure(
        'nihongo_app',
        `UPDATE "SsoAccountErasureRequest"
         SET "appStatus" = 'DELETED', "completedAt" = clock_timestamp()
         WHERE "receiptDigest" = $1`,
        [receipt],
        '42501'
      )
      // The lock-only Account column never changes.
      await expectRoleFailure(
        'nihongo_app',
        `UPDATE "Account" SET "createdAt" = clock_timestamp()
         WHERE "userId" = $1`,
        [userId],
        '23514'
      )
      // The TEST marker confirms only the User it names.
      await adminClient.query(
        `SELECT set_config('nihongo.phase7_test_erasure_user', $1, true)`,
        [otherUserId]
      )
      await expectRoleFailure('nihongo_app', deleteUser, [userId], '42501')
      await adminClient.query(
        `SELECT set_config('nihongo.phase7_test_erasure_user', $1, true)`,
        [userId]
      )
      await expectRoleFailure(
        'nihongo_auth_gateway',
        deleteUser,
        [userId],
        '42501'
      )
      // Confirmed, but the Session is not cleaned up first.
      await expectRoleFailure('nihongo_app', deleteUser, [userId], '23514')
      const erased = await withExecutionRole('nihongo_app', () =>
        bridgedQuery<{ erased: boolean }>(
          adminClient,
          `SELECT "phase7_erase_user"($1, 'TEST') AS erased`,
          [userId]
        )
      )
      expect(erased.rows).toEqual([{ erased: true }])
      const remaining = await adminClient.query(
        `SELECT
           (SELECT count(*)::int FROM "User" WHERE "id" = $1) AS users,
           (SELECT count(*)::int FROM "Account" WHERE "userId" = $1) AS accounts,
           (SELECT count(*)::int FROM "Session" WHERE "userId" = $1) AS sessions`,
        [userId]
      )
      expect(remaining.rows).toEqual([{ users: 0, accounts: 0, sessions: 0 }])
    })
  })

  it('#504 P7 PR4b-2: nihongo_app의 User 상태 변경은 방금 만든 erasure 요청의 ACTIVE→DELETION_PENDING만 허용한다', async () => {
    await withinRollback(async () => {
      const userId = randomUUID()
      await insertCredentialUser(userId, 'USER')
      const setStatus = (status: string) =>
        [
          `UPDATE "User" SET "accountStatus" = $2::"UserAccountStatus"
           WHERE "id" = $1`,
          [userId, status]
        ] as const
      // No erasure request: every status change is refused.
      await expectRoleFailure(
        'nihongo_app',
        ...setStatus('DELETION_PENDING'),
        '42501'
      )
      // #504 P7 PR5a: the API deletes its own fresh state (one-time use,
      // expiry, unlink, erasure) without an erasure request; deleting fresh
      // state only removes authority.
      await adminClient.query(
        `INSERT INTO "SsoAccountFreshProof" (
           "proofDigest", "context", "userId", "callbackURL", "expiresAt"
         ) VALUES ($1, '{}'::jsonb, $2, '/', clock_timestamp() + INTERVAL '5 minutes')`,
        ['a'.repeat(64), userId]
      )
      await adminClient.query('SET LOCAL ROLE "nihongo_app"')
      expect(
        (
          await adminClient.query(
            'DELETE FROM "SsoAccountFreshProof" WHERE "userId" = $1',
            [userId]
          )
        ).rowCount
      ).toBe(1)
      await adminClient.query('RESET ROLE')
      // The request trigger owns the cleanup list, expiry and state: a
      // claimed COMPLETED cleanup and a far expiry are replaced.
      await adminClient.query('SET LOCAL ROLE "nihongo_app"')
      await adminClient.query(
        `INSERT INTO "SsoAccountErasureRequest" (
           "userId", "receiptDigest", "providerCleanup", "receiptExpiresAt"
         ) VALUES (
           $1, $2, '[{"provider":"google","status":"COMPLETED"}]'::jsonb,
           clock_timestamp() + INTERVAL '30 days'
         )`,
        [userId, 'b'.repeat(64)]
      )
      await adminClient.query('RESET ROLE')
      expect(
        (
          await adminClient.query<{
            appStatus: string
            cleanup: unknown
            oneDay: boolean
          }>(
            `SELECT "appStatus", "providerCleanup" AS cleanup,
               "receiptExpiresAt" <= clock_timestamp() + INTERVAL '1 day' AS "oneDay"
             FROM "SsoAccountErasureRequest" WHERE "userId" = $1`,
            [userId]
          )
        ).rows
      ).toEqual([{ appStatus: 'DELETION_PENDING', cleanup: [], oneDay: true }])
      // With the request: only ACTIVE to DELETION_PENDING.
      await expectRoleFailure('nihongo_app', ...setStatus('DELETED'), '42501')
      await expectRoleFailure(
        'nihongo_app',
        `UPDATE "User" SET "role" = 'ADMIN' WHERE "id" = $1`,
        [userId],
        '42501'
      )
      await adminClient.query('SET LOCAL ROLE "nihongo_app"')
      {
        const [pendingSql, pendingValues] = setStatus('DELETION_PENDING')
        await adminClient.query(pendingSql, [...pendingValues])
      }
      await adminClient.query('RESET ROLE')
      await expectRoleFailure('nihongo_app', ...setStatus('ACTIVE'), '42501')
      // A second request for a non-ACTIVE User is refused.
      const otherUserId = randomUUID()
      await insertCredentialUser(otherUserId, 'USER')
      await adminClient.query('SET LOCAL session_replication_role = replica')
      try {
        await adminClient.query(
          `UPDATE "User" SET "accountStatus" = 'DELETION_PENDING' WHERE "id" = $1`,
          [otherUserId]
        )
      } finally {
        await adminClient.query('SET LOCAL session_replication_role = origin')
      }
      await expectRoleFailure(
        'nihongo_app',
        `INSERT INTO "SsoAccountErasureRequest" (
           "userId", "receiptDigest", "providerCleanup", "receiptExpiresAt"
         ) VALUES ($1, $2, '[]'::jsonb, clock_timestamp())`,
        [otherUserId, 'c'.repeat(64)],
        '42501'
      )
    })
  })

  it('#504 P7 PR4a: provider 정리가 일부만 COMPLETED면 erasure 확정이 아니다', async () => {
    await withinRollback(async () => {
      const userId = randomUUID()
      await insertCredentialUser(userId, 'USER')
      await adminClient.query('SET LOCAL session_replication_role = replica')
      try {
        await adminClient.query(
          `UPDATE "User" SET "accountStatus" = 'DELETION_PENDING'
           WHERE "id" = $1`,
          [userId]
        )
      } finally {
        await adminClient.query('SET LOCAL session_replication_role = origin')
      }
      const receipt = 'f'.repeat(64)
      await adminClient.query(
        `INSERT INTO "SsoAccountErasureRequest" (
           "userId", "receiptDigest", "providerCleanup", "receiptExpiresAt"
         ) VALUES (
           $1, $2,
           '[{"provider":"apple","status":"PENDING"},{"provider":"google","status":"COMPLETED"}]',
           clock_timestamp() + INTERVAL '1 day'
         )`,
        [userId, receipt]
      )
      const confirmed = async () =>
        (
          await withExecutionRole('nihongo_app', () =>
            adminClient.query<{ confirmed: boolean }>(
              `SELECT "phase7_user_erasure_confirmed"($1) AS confirmed`,
              [userId]
            )
          )
        ).rows[0]?.confirmed
      expect(await confirmed()).toBe(false)
      await expectRoleFailure(
        'nihongo_app',
        'DELETE FROM "User" WHERE "id" = $1',
        [userId],
        '42501'
      )
      // Positive control: every provider cleanup COMPLETED confirms it.
      await adminClient.query(
        `UPDATE "SsoAccountErasureRequest"
         SET "providerCleanup" =
           '[{"provider":"apple","status":"COMPLETED"},{"provider":"google","status":"COMPLETED"}]'
         WHERE "receiptDigest" = $1`,
        [receipt]
      )
      expect(await confirmed()).toBe(true)
    })
  })

  it('#504 P7 PR3a: 세션 발급이 중간에 실패하면 Session을 남기지 않는다', async () => {
    const admin = await createCommittedAdmin()
    // The Session insert fails on the existing Session id, so the whole
    // issuance rolls back.
    await expect(
      issueSession(admin.userId, admin.sessionId, `phase7-pr3a-${randomUUID()}`)
    ).rejects.toMatchObject({ code: '23505' })
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

  it('#504 P7 PR4c-2: 첫 관리자 변경은 ACTIVE ADMIN이 없을 때 migration 운영자의 USER→ADMIN만 허용한다', async () => {
    await withinRollback(async () => {
      // Close every other ACTIVE ADMIN for this check only.
      await adminClient.query('SET LOCAL session_replication_role = replica')
      try {
        await adminClient.query(
          `UPDATE "User" SET "accountStatus" = 'DELETION_PENDING'
           WHERE "role" = 'ADMIN' AND "accountStatus" = 'ACTIVE'`
        )
      } finally {
        await adminClient.query('SET LOCAL session_replication_role = origin')
      }
      const firstId = randomUUID()
      const secondId = randomUUID()
      await insertCredentialUser(firstId, 'USER')
      await insertCredentialUser(secondId, 'USER')
      // Owner-rights writers, like phase7_bootstrap_first_google_admin, so the
      // User trigger sees the calling role. They roll back with the test.
      await adminClient.query('SET LOCAL ROLE "nihongo_phase7_owner"')
      for (const [name, statement] of [
        ['promote', `UPDATE "User" SET "role" = 'ADMIN' WHERE "id" = target`],
        [
          'promote_named',
          `UPDATE "User" SET "role" = 'ADMIN', "name" = 'changed' WHERE "id" = target`
        ],
        ['demote', `UPDATE "User" SET "role" = 'USER' WHERE "id" = target`]
      ] as const)
        await adminClient.query(
          `CREATE FUNCTION "phase7_pr4c2_${name}"(target UUID) RETURNS VOID
           LANGUAGE sql SECURITY DEFINER SET search_path FROM CURRENT
           AS $body$ ${statement} $body$`
        )
      await adminClient.query('RESET ROLE')
      const call = (name: string, id: string) =>
        [`SELECT "phase7_pr4c2_${name}"($1)`, [id]] as const
      // Not the migration operator.
      await expectRoleFailure(
        'nihongo_app',
        ...call('promote', firstId),
        '42501'
      )
      // The operator may not change another column with the role.
      await expectRoleFailure(
        'nihongo_phase7_migration',
        ...call('promote_named', firstId),
        '42501'
      )
      // The first ADMIN is accepted once.
      await adminClient.query('SET LOCAL ROLE "nihongo_phase7_migration"')
      {
        const [promoteSql, promoteValues] = call('promote', firstId)
        await adminClient.query(promoteSql, [...promoteValues])
      }
      await adminClient.query('RESET ROLE')
      expect(
        (
          await adminClient.query<{ generation: number; role: string }>(
            `SELECT "role"::text AS role, "authorityGeneration" AS generation
             FROM "User" WHERE "id" = $1`,
            [firstId]
          )
        ).rows
      ).toEqual([{ generation: 2, role: 'ADMIN' }])
      // An ACTIVE ADMIN now exists: no second first admin, no demotion.
      await expectRoleFailure(
        'nihongo_phase7_migration',
        ...call('promote', secondId),
        '42501'
      )
      await expectRoleFailure(
        'nihongo_phase7_migration',
        ...call('demote', firstId),
        '42501'
      )
    })
  })

  it('#504 P7 PR4c-2: QuestionReport 직접 insert는 nihongo_app만, 서버 소유 열은 트리거가 채운다', async () => {
    await withinRollback(async () => {
      const userId = randomUUID()
      await insertCredentialUser(userId, 'USER')
      const target = (
        await adminClient.query<{ questionId: string; versionId: string }>(
          `SELECT "id" AS "questionId", "currentPublishedVersionId" AS "versionId"
           FROM "Question"
           WHERE "lifecycleStatus" = 'ACTIVE'
             AND "currentPublishedVersionId" IS NOT NULL
           ORDER BY "id" LIMIT 1`
        )
      ).rows[0]
      if (!target) throw new Error('Published report target is unavailable.')
      const insertReport = (id: string) =>
        [
          `INSERT INTO "QuestionReport" (
             "id", "questionId", "questionVersionId", "reason", "description",
             "reporterUserId"
           ) VALUES ($1, $2, $3, 'ANSWER_ERROR', 'server owned columns', $4)`,
          [id, target.questionId, target.versionId, userId]
        ] as const
      await expectRoleFailure(
        'nihongo_auth_gateway',
        ...insertReport(randomUUID()),
        '42501'
      )
      const reportId = randomUUID()
      await adminClient.query('SET LOCAL ROLE "nihongo_app"')
      {
        const [reportSql, reportValues] = insertReport(reportId)
        await adminClient.query(reportSql, [...reportValues])
      }
      await adminClient.query('RESET ROLE')
      expect(
        (
          await adminClient.query<{
            actor: boolean
            digest: boolean
            label: string
            rowVersion: number
            status: string
          }>(
            `SELECT "status"::text AS status, "rowVersion",
               "reporterLabel"::text AS label,
               "reporterActorId" = "reporterUserId" AS actor,
               "descriptionDigest" =
                 "phase7_question_report_description_digest"("description")
                 AS digest
             FROM "QuestionReport" WHERE "id" = $1`,
            [reportId]
          )
        ).rows
      ).toEqual([
        {
          actor: true,
          digest: true,
          label: 'ACTIVE_USER',
          rowVersion: 1,
          status: 'OPEN'
        }
      ])
    })
  })

  it('#504 P7 PR4c-1: finish 없이 commit하면 23514이고 intent는 자기 transaction 것만 지우며 backend·transaction 열은 쓸 수 없다', async () => {
    const admin = await createCommittedAdmin()
    // A command that begins but never finishes cannot commit.
    await appClient.query('BEGIN ISOLATION LEVEL READ COMMITTED')
    let committed: unknown = 'not-run'
    try {
      await beginAdminOperation(asTransaction(appClient), {
        auditEnvironment: 'TEST',
        command: 'REVIEW_REQUEST',
        rawSessionToken: admin.token,
        referencedUserIds: [admin.userId]
      })
      committed = await sqlStateOf(() => appClient.query('COMMIT'))
    } finally {
      await appClient.query('ROLLBACK').catch(() => undefined)
    }
    expect(committed).toBe('23514')
    expect(
      (
        await adminClient.query<{ count: number }>(
          `SELECT COUNT(*)::int AS count FROM "Phase7OperationIntent"`
        )
      ).rows
    ).toEqual([{ count: 0 }])
    await withinRollback(async () => {
      // An intent of another backend and transaction stays.
      const foreignId = randomUUID()
      await adminClient.query(
        `INSERT INTO "Phase7OperationIntent" (
           "operationId", "command", "environment", "backendPid", "transactionId"
         ) VALUES ($1, 'REVIEW_REQUEST', 'TEST', 0, 0)`,
        [foreignId]
      )
      await expectRoleFailure(
        'nihongo_app',
        'DELETE FROM "Phase7OperationIntent" WHERE "operationId" = $1',
        [foreignId],
        '42501'
      )
      // The API names only operationId, command and environment.
      await expectRoleFailure(
        'nihongo_app',
        `INSERT INTO "Phase7OperationIntent" (
           "operationId", "command", "environment", "backendPid", "transactionId"
         ) VALUES ($1, 'REVIEW_REQUEST', 'TEST', 0, 0)`,
        [randomUUID()],
        '42501'
      )
      await adminClient.query(
        `DELETE FROM "Phase7OperationIntent" WHERE "operationId" = $1`,
        [foreignId]
      )
    })
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

import { randomBytes, randomUUID } from 'node:crypto'
import { registerDatabaseCapability } from './databaseCapability.js'
import { installAuditDigestSql } from '../../test/fixtures/db/auditDigestSql.js'
import { Client } from 'pg'
import type { QueryResult, QueryResultRow } from 'pg'
import { expect } from 'vitest'
import {
  bridgedRole,
  isOwnedSessionSql,
  ownedSessionSql,
  pgOwnedSessionClient
} from '../../test/fixtures/db/ownedSessionSql.js'
import type { PrismaClient } from '../generated/prisma/client.js'
import { parseApiEnvironment } from '../config/env.js'
import { assertSafeAdminCmsDatabase } from './databaseTargetGuard.js'
import {
  createPostgresStartupOptions,
  getPostgresSchema
} from './databaseOptions.js'
import { adminFreshContextSchema } from '../auth/ssoAdminFreshRepository.js'
import type { AdminFreshContext } from '../auth/ssoAdminFreshRepository.js'

export const digest = () => randomBytes(32).toString('hex')
type TestRole =
  | 'nihongo_app'
  | 'nihongo_guest_cleanup_worker'
  | 'nihongo_migration'
export interface SsoFixture {
  userId: string
  sessionId: string
  token: string
  provider: 'apple' | 'google'
  subject: string
}
export const createSsoDbHarness = () => {
  const environment = parseApiEnvironment(process.env)
  assertSafeAdminCmsDatabase({
    nodeEnvironment: environment.NODE_ENV,
    databaseUrl: environment.DATABASE_URL,
    productionDatabaseUrl: process.env.PRODUCTION_DATABASE_URL
  })
  const schema = getPostgresSchema(environment.DATABASE_URL)
  const adminUrl = process.env.ADMIN_DATABASE_URL
  const gatewayUrl = process.env.TEST_APP_FIXTURE_DATABASE_URL
  if (
    environment.NODE_ENV !== 'test' ||
    !schema?.match(/^nihongo_[a-z0-9_]+_test$/u) ||
    !adminUrl ||
    !gatewayUrl ||
    [adminUrl, gatewayUrl].some((url) => getPostgresSchema(url) !== schema)
  )
    throw new Error(
      'SSO integration requires the existing isolated TEST harness.'
    )
  const connection = (value: string, role?: TestRole) => {
    const url = new URL(value)
    url.searchParams.delete('schema')
    url.searchParams.delete('options')
    return new Client({
      connectionString: url.toString(),
      options: createPostgresStartupOptions(schema, role),
      connectionTimeoutMillis: 5000,
      query_timeout: 10000,
      statement_timeout: 8000
    })
  }
  const owner = connection(adminUrl)
  const gatewayA = connection(gatewayUrl, 'nihongo_app')
  const gatewayB = connection(gatewayUrl, 'nihongo_app')
  const app = connection(environment.DATABASE_URL, 'nihongo_app')
  // #504 P7 PR3a/PR3b-1: the API runs Session and ADMIN_FRESH writes as
  // nihongo_app; concurrency probes need two such connections.
  const appA = connection(environment.DATABASE_URL, 'nihongo_app')
  const appB = connection(environment.DATABASE_URL, 'nihongo_app')
  const roleQuery = async <Row extends QueryResultRow = QueryResultRow>(
    role: TestRole,
    sql: string,
    values: readonly unknown[] = []
  ) => {
    // #504 P7 PR3a/PR3b-1: calls to the dropped Session functions run the API
    // implementation. Gateway facade callers are nihongo_app since PR1.
    const bridged = isOwnedSessionSql(sql)
    const executionRole = bridgedRole(sql, role)
    await owner.query(`SET ROLE "${executionRole}"`)
    try {
      const result = bridged
        ? ((await ownedSessionSql<Row>(owner, sql, [
            ...values
          ])) as unknown as QueryResult<Row>)
        : await owner.query<Row>(sql, [...values])
      await owner.query('RESET ROLE')
      return result
    } catch (error: unknown) {
      // A failed transaction rejects RESET with25P02. Preserve the original
      // SQLSTATE; the caller rolls back before restoring role after failure.
      try {
        await owner.query('RESET ROLE')
      } catch {
        /* original error wins */
      }
      throw error
    }
  }
  // Issues an owned V1 Session through the API implementation as nihongo_app.
  const issueSession = async (sql: string, values: unknown[]) => {
    await owner.query('SET ROLE "nihongo_app"')
    try {
      return await ownedSessionSql<{ id: string }>(owner, sql, values)
    } finally {
      await owner.query('RESET ROLE').catch(() => undefined)
    }
  }
  const rollback = async (action: () => Promise<void>) => {
    await owner.query('BEGIN')
    try {
      await action()
    } finally {
      await owner.query('ROLLBACK')
    }
  }
  let sequence = 0
  // #504 P7 PR4a: a Prisma-shaped nihongo_app client for the erasure worker.
  const appClient = {
    $queryRawUnsafe: async (sql: string, ...args: unknown[]) =>
      (await roleQuery('nihongo_app', sql, args)).rows,
    $executeRawUnsafe: async (sql: string, ...args: unknown[]) =>
      (await roleQuery('nihongo_app', sql, args)).rowCount ?? 0,
    $transaction: async (operation: (transaction: never) => unknown) => {
      await owner.query('SET ROLE "nihongo_app"')
      try {
        return await pgOwnedSessionClient(owner).$transaction(
          operation as never
        )
      } finally {
        await owner.query('RESET ROLE')
      }
    }
  } as unknown as Pick<
    PrismaClient,
    '$queryRawUnsafe' | '$executeRawUnsafe' | '$transaction'
  >
  const rejects = async (
    role: TestRole,
    sql: string,
    values: readonly unknown[],
    code: string
  ) => {
    const savepoint = `sso_expected_${++sequence}`
    await owner.query(`SAVEPOINT ${savepoint}`)
    let actual: unknown
    try {
      await roleQuery(role, sql, values)
    } catch (error: unknown) {
      actual = (error as { code?: unknown }).code
    } finally {
      await owner.query(`ROLLBACK TO SAVEPOINT ${savepoint}`)
      await owner.query('RESET ROLE')
      await owner.query(`RELEASE SAVEPOINT ${savepoint}`)
    }
    expect(actual).toBe(code)
  }
  // Owner-only, transaction-local timing/authority fixtures. Every facade is
  // invoked after origin is restored; no global clocks or runtime guard changes.
  const fixtureMutation = async (
    sql: string,
    values: readonly unknown[] = []
  ) => {
    await owner.query('SET LOCAL session_replication_role = replica')
    try {
      await owner.query(sql, [...values])
    } finally {
      await owner.query('SET LOCAL session_replication_role = origin')
    }
  }
  const fixture = async (
    provider: 'apple' | 'google' = 'google',
    role: 'ADMIN' | 'USER' = 'ADMIN'
  ): Promise<SsoFixture> => {
    const userId = randomUUID()
    const sessionId = randomUUID()
    const token = randomBytes(32).toString('base64url')
    const subject = `sso-fixture-${randomUUID()}`
    await owner.query(
      `INSERT INTO "User" ("id","name","email","emailVerified","role","accountStatus","createdAt","updatedAt") VALUES ($1,'SSO DB fixture',$2,true,$3,'ACTIVE',clock_timestamp(),clock_timestamp())`,
      [userId, `${randomUUID()}@example.test`, role]
    )
    await owner.query(
      `INSERT INTO "Account" ("id","accountId","providerId","userId","createdAt","updatedAt") VALUES ($1,$2,$3,$4,clock_timestamp(),clock_timestamp())`,
      [randomUUID(), subject, provider, userId]
    )
    const result = await issueSession(
      `SELECT * FROM "issue_v1_session"($1,1,$2::"UserRole",'ACTIVE',$3,$4,'127.0.0.1','sso-db-fixture',false)`,
      [userId, role, sessionId, token]
    )
    if (result.rows[0]?.id !== sessionId)
      throw new Error('SSO fixture session issuance failed.')
    return { userId, sessionId, token, provider, subject }
  }
  const prepare = async (f: SsoFixture): Promise<AdminFreshContext> => {
    const rows = await roleQuery<{ context: unknown }>(
      'nihongo_app',
      'SELECT "prepare_sso_admin_fresh"($1,$2) AS context',
      [f.token, f.provider]
    )
    return adminFreshContextSchema.parse(rows.rows[0]?.context)
  }
  const stage = async (
    context: AdminFreshContext,
    proof = digest(),
    provider = context.provider,
    subject = context.accountId
  ) => {
    const rows = await roleQuery<{ accepted: boolean }>(
      'nihongo_app',
      'SELECT "stage_sso_admin_fresh_proof"($1::jsonb,$2,$3,$4,$5) AS accepted',
      [JSON.stringify(context), provider, subject, proof, '/login']
    )
    return { proof, accepted: rows.rows[0]?.accepted }
  }
  const completeSql =
    'SELECT * FROM "complete_sso_admin_fresh"($1,$2,$3,$4,$5,$6)'
  const completeValues = (
    f: SsoFixture,
    proof: string,
    id = randomUUID(),
    token = randomBytes(32).toString('base64url')
  ) => ({
    id,
    token,
    values: [proof, f.token, id, token, '127.0.0.1', 'sso-db-fixture']
  })
  const rotate = async (f: SsoFixture, proof: string) => {
    const next = completeValues(f, proof)
    const result = await roleQuery('nihongo_app', completeSql, next.values)
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toMatchObject({
      id: next.id,
      userId: f.userId,
      authorityGeneration: 1,
      callbackURL: '/login'
    })
    return next
  }
  const facts = async (f: SsoFixture) =>
    (
      await owner.query(
        `SELECT
    (SELECT count(*)::int FROM "Session" WHERE "id"=$1) AS "oldSessions",
    (SELECT count(*)::int FROM "Session" WHERE "userId"=$2 AND "authorizationState"='ACTIVE') AS "activeSessions",
    (SELECT count(*)::int FROM "Session" WHERE "userId"=$2 AND "authorizationState"='PENDING_REAUTH') AS "pendingSessions",
    (SELECT count(*)::int FROM "AdminAuditLog" WHERE "actorId"=$2 AND command='REAUTHENTICATION') AS audits,
    (SELECT count(*)::int FROM "ReauthenticationIntent" WHERE "userId"=$2 AND state='FINALIZED') AS finalized`,
        [f.sessionId, f.userId]
      )
    ).rows[0]
  const stableTables = [
    'User',
    'Account',
    'Verification',
    'StudySession',
    'StudySessionQuestion',
    'StudyDraft',
    'StudyDraftAnswer',
    'StudyAnswer',
    'StudyResult',
    'WrongNote',
    'ReviewSchedule',
    'ReviewEvent',
    'UserMemo',
    'Bookmark',
    'IdempotencyRecord',
    'Question',
    'QuestionVersion',
    'QuestionOption',
    'QuestionVersionTag',
    'Tag'
  ] as const
  const snapshot = async () => {
    const result: Record<string, { count: number; fingerprint: string }> = {}
    for (const table of stableTables) {
      const rows = await owner.query<{ count: number; fingerprint: string }>(
        `SELECT count(*)::int AS count, md5(coalesce(string_agg(to_jsonb(t)::text, E'\n' ORDER BY to_jsonb(t)::text),'')) AS fingerprint FROM "${table}" AS t`
      )
      const row = rows.rows[0]
      if (!row) throw new Error('SSO data snapshot unavailable.')
      result[table] = row
    }
    return result
  }
  const learningFixture = async (userId: string) => {
    const q = (
      await owner.query<{
        questionId: string
        versionId: string
        level: string
        subject: string
      }>(
        `SELECT q.id AS "questionId",v.id AS "versionId",v.level::text,v.subject::text FROM "Question" q JOIN "QuestionVersion" v ON v.id=q."currentPublishedVersionId" AND v."questionId"=q.id WHERE q."lifecycleStatus"='ACTIVE' ORDER BY q.id LIMIT 1`
      )
    ).rows[0]
    if (!q) throw new Error('Canonical published question fixture unavailable.')
    const sessionId = randomUUID(),
      sqId = randomUUID(),
      answerId = randomUUID(),
      noteId = randomUUID(),
      liveId = randomUUID(),
      liveSqId = randomUUID()
    // Valid submitted v1 facts plus an independent editable v2 draft. Domain
    // triggers/FKs/deferred aggregates remain enabled during fixture creation.
    await owner.query(
      `INSERT INTO "StudySession" (id,"userId",level,subject,mode,status,"requestedCount","actualCount","usedFallback","practiceContractVersion","startedAt","expiresAt","submittedAt","durationSec","submissionHash","createdAt","updatedAt") VALUES ($1,$2,$3::"JlptLevel",$4::"QuestionSubject",'RANDOM','IN_PROGRESS',1,1,false,1,transaction_timestamp(),transaction_timestamp()+interval '1 day',NULL,NULL,NULL,transaction_timestamp(),transaction_timestamp())`,
      [sessionId, userId, q.level, q.subject]
    )
    await owner.query(
      `INSERT INTO "StudySessionQuestion" (id,"studySessionId","questionId","questionVersionId",ordinal) VALUES ($1,$2,$3,$4,1)`,
      [sqId, sessionId, q.questionId, q.versionId]
    )
    await owner.query(
      `INSERT INTO "StudyAnswer" (id,"studySessionQuestionId","questionVersionId","selectedOptionId","isCorrect","elapsedSec","gradingVersion","answeredAt","gradedAt") VALUES ($1,$2,$3,NULL,false,0,'server-grading-v1',transaction_timestamp(),transaction_timestamp())`,
      [answerId, sqId, q.versionId]
    )
    await owner.query(
      `INSERT INTO "StudyResult" (id,"studySessionId","totalCount","correctCount","incorrectCount","correctRateBasisPoints","durationSec","gradingVersion","createdAt") VALUES ($1,$2,1,0,1,0,0,'server-grading-v1',transaction_timestamp())`,
      [randomUUID(), sessionId]
    )
    await owner.query(
      `INSERT INTO "WrongNote" (id,"userId","questionId","lastWrongQuestionVersionId","wrongCount","correctStreak",status,"lastWrongAt","createdAt","updatedAt") VALUES ($1,$2,$3,$4,1,0,'NEW',transaction_timestamp(),transaction_timestamp(),transaction_timestamp())`,
      [noteId, userId, q.questionId, q.versionId]
    )
    await owner.query(
      `INSERT INTO "ReviewSchedule" (id,"wrongNoteId","nextReviewAt","intervalDays","algorithmVersion","updatedAt") VALUES ($1,$2,transaction_timestamp()+interval '1 day',1,1,transaction_timestamp())`,
      [randomUUID(), noteId]
    )
    await owner.query(
      `INSERT INTO "ReviewEvent" (id,"wrongNoteId","userId","questionId","questionVersionId",source,"studySessionId","studyAnswerId","isCorrect","nextStatus","nextCorrectStreak","wrongCountAfter","algorithmVersion","occurredAt") VALUES ($1,$2,$3,$4,$5,'STUDY_SUBMIT',$6,$7,false,'NEW',0,1,1,transaction_timestamp())`,
      [
        randomUUID(),
        noteId,
        userId,
        q.questionId,
        q.versionId,
        sessionId,
        answerId
      ]
    )
    await owner.query(
      `UPDATE "StudySession" SET status='SUBMITTED',"submittedAt"=transaction_timestamp(),"durationSec"=0,"submissionHash"=repeat('a',64) WHERE id=$1`,
      [sessionId]
    )
    await owner.query(
      `INSERT INTO "Bookmark" (id,"userId","questionId") VALUES ($1,$2,$3)`,
      [randomUUID(), userId, q.questionId]
    )
    await owner.query(
      `INSERT INTO "StudySession" (id,"userId",level,subject,mode,status,"requestedCount","actualCount","usedFallback","practiceContractVersion","startedAt","expiresAt","createdAt","updatedAt") VALUES ($1,$2,$3::"JlptLevel",$4::"QuestionSubject",'RANDOM','IN_PROGRESS',1,1,false,2,transaction_timestamp(),transaction_timestamp()+interval '1 day',transaction_timestamp(),transaction_timestamp())`,
      [liveId, userId, q.level, q.subject]
    )
    await owner.query(
      `INSERT INTO "StudySessionQuestion" (id,"studySessionId","questionId","questionVersionId",ordinal) VALUES ($1,$2,$3,$4,1)`,
      [liveSqId, liveId, q.questionId, q.versionId]
    )
    await owner.query(
      `INSERT INTO "StudyDraft" ("studySessionId","createdAt","updatedAt") VALUES ($1,transaction_timestamp(),transaction_timestamp())`,
      [liveId]
    )
    await owner.query(
      `INSERT INTO "StudyDraftAnswer" ("studySessionId","studySessionQuestionId","questionVersionId","elapsedSec","updatedAt") VALUES ($1,$2,$3,0,transaction_timestamp())`,
      [liveId, liveSqId, q.versionId]
    )
    const idempotencyId = randomUUID()
    await owner.query(
      `INSERT INTO "IdempotencyRecord" (id,"principalType","userId",operation,"idempotencyKey","studySessionId","requestHash","contractVersion",state,"createdAt") VALUES ($1,'USER',$2,'STUDY_SUBMIT',$3,$4,repeat('a',64),1,'PROCESSING',transaction_timestamp())`,
      [idempotencyId, userId, randomUUID(), sessionId]
    )
    await owner.query(
      `UPDATE "IdempotencyRecord" SET state='SUCCEEDED',"responseStatus"=201,"responseBody"=jsonb_build_object('sessionId',$2::text),"completedAt"=transaction_timestamp(),"expiresAt"=transaction_timestamp()+interval '24 hours' WHERE id=$1`,
      [idempotencyId, sessionId]
    )
    await owner.query('SET CONSTRAINTS ALL IMMEDIATE')
    await owner.query('SET CONSTRAINTS ALL DEFERRED')
  }
  return {
    owner,
    createOwnerPeer: () => connection(adminUrl),
    gatewayA,
    gatewayB,
    appA,
    appB,
    app,
    schema,
    environment,
    roleQuery,
    appClient,
    issueSession,
    rollback,
    rejects,
    fixtureMutation,
    fixture,
    prepare,
    stage,
    completeSql,
    completeValues,
    rotate,
    facts,
    snapshot,
    learningFixture,
    connect: async () => {
      await owner.connect()
      // #504 P7 PR5b: the SQL audit digest is a test fixture now.
      await installAuditDigestSql(owner)
      await gatewayA.connect()
      await gatewayB.connect()
      await appA.connect()
      await appB.connect()
      await app.connect()
      // #504 P8-1: the baseline starts with V1 issuance active.
      await owner.query('SET ROLE "nihongo_migration"')
      try {
        await registerDatabaseCapability(owner, 'TEST')
      } finally {
        await owner.query('RESET ROLE')
      }
    },
    close: async () => {
      await Promise.allSettled([
        owner.end(),
        gatewayA.end(),
        gatewayB.end(),
        appA.end(),
        appB.end(),
        app.end()
      ])
    }
  }
}

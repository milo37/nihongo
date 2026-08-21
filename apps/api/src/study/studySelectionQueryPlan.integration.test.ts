import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseApiEnvironment } from '../config/env.js'
import { createDatabaseRuntime } from '../db/database.js'
import { assertSafeTestDatabase } from '../db/databaseTargetGuard.js'
import { Prisma } from '../generated/prisma/client.js'

interface ExplainRow {
  'QUERY PLAN': unknown
}

interface PlanNode extends Record<string, unknown> {
  'Node Type': string
}

interface QueryPlans {
  readonly bookmarkList: ExplainRow[]
  readonly bookmarkMode: ExplainRow[]
  readonly bookmarkModeOwnerScan: ExplainRow[]
  readonly bookmarkQuestionCleanup: ExplainRow[]
  readonly dailyReview: ExplainRow[]
  readonly dailyReviewOwnerScan: ExplainRow[]
  readonly dashboard: ExplainRow[]
  readonly guestWeakness: ExplainRow[]
  readonly userWeakness: ExplainRow[]
  readonly wrongNote: ExplainRow[]
  readonly wrongNoteOwnerScan: ExplainRow[]
}

const HISTORY_OWNER_CARDINALITY = 10
const DECOY_HISTORY_CARDINALITY = 512
const DECOY_NOTE_CARDINALITY = 512
const BOOKMARK_DECOY_OWNER_CARDINALITY = 16
const FILTER_DECOY_CARDINALITY = 256
const RANKING_TARGET_CARDINALITY = 512
const PAGE_SIZE = 5

const environment = parseApiEnvironment(process.env)
assertSafeTestDatabase({
  nodeEnvironment: environment.NODE_ENV,
  databaseUrl: environment.DATABASE_URL,
  productionDatabaseUrl: process.env.PRODUCTION_DATABASE_URL
})

const database = createDatabaseRuntime(environment.DATABASE_URL)

const collectPlanNodes = (value: unknown, nodes: PlanNode[]): void => {
  if (Array.isArray(value)) {
    value.forEach((item) => collectPlanNodes(item, nodes))
    return
  }
  if (typeof value !== 'object' || value === null) {
    return
  }
  const record = value as Record<string, unknown>
  if (typeof record['Node Type'] === 'string') {
    nodes.push(record as PlanNode)
  }
  Object.values(record).forEach((item) => collectPlanNodes(item, nodes))
}

const readPlanNodes = (rows: ExplainRow[]): PlanNode[] => {
  const nodes: PlanNode[] = []
  rows.forEach((row) => collectPlanNodes(row['QUERY PLAN'], nodes))
  return nodes
}

const readIndexNames = (rows: ExplainRow[]): Set<string> =>
  new Set(
    readPlanNodes(rows).flatMap((node) =>
      typeof node['Index Name'] === 'string' ? [node['Index Name']] : []
    )
  )

const readRootPlan = (rows: ExplainRow[]): PlanNode => {
  const document = rows[0]?.['QUERY PLAN']
  if (!Array.isArray(document)) {
    throw new Error('EXPLAIN JSON document가 필요합니다.')
  }
  const root = document[0]
  if (typeof root !== 'object' || root === null) {
    throw new Error('EXPLAIN JSON root가 필요합니다.')
  }
  const plan = (root as Record<string, unknown>).Plan
  if (
    typeof plan !== 'object' ||
    plan === null ||
    typeof (plan as Record<string, unknown>)['Node Type'] !== 'string'
  ) {
    throw new Error('EXPLAIN JSON Plan이 필요합니다.')
  }
  return plan as PlanNode
}

const readNumericPlanField = (node: PlanNode, field: string): number => {
  const value = node[field]
  return typeof value === 'number' ? value : 0
}

const readEffectiveRows = (node: PlanNode): number =>
  readNumericPlanField(node, 'Actual Rows') *
  Math.max(1, readNumericPlanField(node, 'Actual Loops'))

const assertCommonPlanEvidence = (rows: ExplainRow[]): void => {
  const nodes = readPlanNodes(rows)
  const root = readRootPlan(rows)
  const bufferAccess =
    readNumericPlanField(root, 'Shared Hit Blocks') +
    readNumericPlanField(root, 'Shared Read Blocks')

  expect(nodes.length).toBeGreaterThan(0)
  expect(bufferAccess).toBeGreaterThan(0)
  nodes
    .filter(({ 'Node Type': nodeType }) =>
      ['Incremental Sort', 'Sort'].includes(nodeType)
    )
    .forEach((node) => expect(node['Sort Space Type']).not.toBe('Disk'))
}

const expectNoSequentialScan = (
  rows: ExplainRow[],
  relationName: string
): void => {
  expect(
    readPlanNodes(rows).filter(
      (node) =>
        node['Node Type'] === 'Seq Scan' &&
        node['Relation Name'] === relationName
    )
  ).toHaveLength(0)
}

const expectBoundedRelationRows = (
  rows: ExplainRow[],
  relationName: string,
  maximumRows: number
): void => {
  const relationNodes = readPlanNodes(rows).filter(
    (node) => node['Relation Name'] === relationName
  )
  expect(relationNodes.length).toBeGreaterThan(0)
  relationNodes.forEach((node) =>
    expect(readEffectiveRows(node)).toBeLessThanOrEqual(maximumRows)
  )
}

const analyzeSelectionTables = async (): Promise<void> => {
  await database.client.$executeRaw`ANALYZE "StudySession"`
  await database.client.$executeRaw`ANALYZE "StudySessionQuestion"`
  await database.client.$executeRaw`ANALYZE "StudyAnswer"`
  await database.client.$executeRaw`ANALYZE "StudyResult"`
  await database.client.$executeRaw`ANALYZE "WrongNote"`
  await database.client.$executeRaw`ANALYZE "ReviewSchedule"`
  await database.client.$executeRaw`ANALYZE "Bookmark"`
}

beforeAll(async () => {
  await database.checkReadiness()
})

afterAll(async () => {
  await analyzeSelectionTables()
  await database.disconnect()
})

describe('Phase 4 Slice 3 representative PostgreSQL query plans', () => {
  it('기본 planner가 owner-bounded selection과 all-mode dashboard index를 선택한다', async () => {
    const now = new Date()
    const targetUserId = randomUUID()
    const historyDecoyUserId = randomUUID()
    const targetGuestId = randomUUID()
    const historyDecoyGuestId = randomUUID()
    const question = await database.client.question.findFirstOrThrow({
      where: {
        lifecycleStatus: 'ACTIVE',
        currentPublishedVersionId: { not: null },
        currentPublishedVersion: {
          is: {
            status: 'PUBLISHED',
            level: 'N5',
            subject: 'VOCABULARY'
          }
        }
      },
      select: { id: true, currentPublishedVersionId: true }
    })
    if (!question.currentPublishedVersionId) {
      throw new Error('Published question fixture가 필요합니다.')
    }
    const eligibleReviewQuestionCount = await database.client.question.count({
      where: {
        lifecycleStatus: 'ACTIVE',
        currentPublishedVersion: {
          is: {
            status: 'PUBLISHED',
            level: 'N5',
            subject: 'VOCABULARY'
          }
        }
      }
    })

    const rollbackSentinel = new Error('ROLLBACK_SLICE3_QUERY_PLAN_FIXTURE')
    let plans: QueryPlans | undefined
    try {
      await database.client.$transaction(async (transaction) => {
        await transaction.$executeRaw`
          CREATE TEMP TABLE "slice3_plan_session" (
            "kind" TEXT NOT NULL,
            "sequence" INTEGER NOT NULL,
            "sessionId" UUID PRIMARY KEY,
            "sessionQuestionId" UUID NOT NULL,
            "userId" UUID,
            "guestPrincipalId" UUID,
            "startedAt" TIMESTAMPTZ(3) NOT NULL,
            "submittedAt" TIMESTAMPTZ(3) NOT NULL
          ) ON COMMIT DROP`
        await transaction.$executeRaw`
          CREATE TEMP TABLE "slice3_plan_note_owner" (
            "sequence" INTEGER NOT NULL,
            "userId" UUID PRIMARY KEY,
            "wrongNoteId" UUID NOT NULL,
            "scheduleId" UUID NOT NULL
          ) ON COMMIT DROP`
        await transaction.$executeRaw`
          CREATE TEMP TABLE "slice3_plan_target_note" (
            "questionId" UUID PRIMARY KEY,
            "questionVersionId" UUID NOT NULL,
            "correctOptionId" UUID NOT NULL,
            "wrongNoteId" UUID NOT NULL,
            "scheduleId" UUID NOT NULL,
            "isSynthetic" BOOLEAN NOT NULL
          ) ON COMMIT DROP`
        await transaction.$executeRaw`
          INSERT INTO "slice3_plan_session" (
            "kind", "sequence", "sessionId", "sessionQuestionId",
            "userId", "guestPrincipalId", "startedAt", "submittedAt"
          )
          SELECT
            fixture.kind,
            fixture.sequence,
            gen_random_uuid(),
            gen_random_uuid(),
            CASE
              WHEN fixture.kind = 'TARGET_USER' THEN ${targetUserId}::uuid
              WHEN fixture.kind = 'DECOY_USER' THEN
                ${historyDecoyUserId}::uuid
              ELSE NULL
            END,
            CASE
              WHEN fixture.kind = 'TARGET_GUEST' THEN ${targetGuestId}::uuid
              WHEN fixture.kind = 'DECOY_GUEST' THEN
                ${historyDecoyGuestId}::uuid
              ELSE NULL
            END,
            ${now}::timestamptz - INTERVAL '72 hours'
              - fixture.sequence * INTERVAL '2 milliseconds',
            ${now}::timestamptz - INTERVAL '1 hour'
              - fixture.sequence * INTERVAL '2 milliseconds'
          FROM (
            SELECT 'TARGET_USER'::text AS kind,
              generate_series(1, ${HISTORY_OWNER_CARDINALITY}) AS sequence
            UNION ALL
            SELECT 'TARGET_GUEST',
              generate_series(1, ${HISTORY_OWNER_CARDINALITY})
            UNION ALL
            SELECT 'DECOY_USER',
              generate_series(1, ${DECOY_HISTORY_CARDINALITY})
            UNION ALL
            SELECT 'DECOY_GUEST',
              generate_series(1, ${DECOY_HISTORY_CARDINALITY})
            UNION ALL
            SELECT 'TARGET_USER_FILTER_DECOY',
              generate_series(1, ${FILTER_DECOY_CARDINALITY})
            UNION ALL
            SELECT 'TARGET_GUEST_FILTER_DECOY',
              generate_series(1, ${FILTER_DECOY_CARDINALITY})
          ) AS fixture`
        await transaction.$executeRaw`
          INSERT INTO "slice3_plan_note_owner" (
            "sequence", "userId", "wrongNoteId", "scheduleId"
          )
          SELECT
            sequence,
            gen_random_uuid(),
            gen_random_uuid(),
            gen_random_uuid()
          FROM generate_series(1, ${DECOY_NOTE_CARDINALITY}) AS sequence`
        await transaction.$executeRaw`
          INSERT INTO "slice3_plan_target_note" (
            "questionId", "questionVersionId", "correctOptionId",
            "wrongNoteId", "scheduleId", "isSynthetic"
          )
          SELECT
            question."id",
            version."id",
            version."correctOptionId",
            gen_random_uuid(),
            gen_random_uuid(),
            false
          FROM "Question" AS question
          JOIN "QuestionVersion" AS version
            ON version."questionId" = question."id"
            AND version."id" = question."currentPublishedVersionId"
          WHERE question."lifecycleStatus" = 'ACTIVE'
            AND version."status" = 'PUBLISHED'
            AND version."correctOptionId" IS NOT NULL
          ORDER BY question."id" ASC`
        await transaction.$executeRaw`
          INSERT INTO "slice3_plan_target_note" (
            "questionId", "questionVersionId", "correctOptionId",
            "wrongNoteId", "scheduleId", "isSynthetic"
          )
          SELECT
            gen_random_uuid(),
            gen_random_uuid(),
            gen_random_uuid(),
            gen_random_uuid(),
            gen_random_uuid(),
            true
          FROM generate_series(1, ${RANKING_TARGET_CARDINALITY})`
        await transaction.$executeRaw`
          INSERT INTO "Question" (
            "id", "lifecycleStatus", "createdByLabelSnapshot",
            "createdAt", "updatedAt"
          )
          SELECT
            target."questionId",
            'ACTIVE',
            'SYSTEM_SEED',
            ${now},
            ${now}
          FROM "slice3_plan_target_note" AS target
          WHERE target."isSynthetic"`
        await transaction.$executeRaw`
          INSERT INTO "QuestionVersion" (
            "id", "questionId", "versionNumber", "status", "level",
            "subject", "questionType", "questionText", "explanationKo",
            "difficulty", "createdByLabelSnapshot", "createdAt", "updatedAt"
          )
          SELECT
            target."questionVersionId",
            target."questionId",
            1,
            'DRAFT',
            'N5',
            'VOCABULARY',
            'KANJI_READING',
            'Slice 3 query plan synthetic question',
            '실행 계획 전용 원문 설명입니다.',
            'EASY',
            'SYSTEM_SEED',
            ${now},
            ${now}
          FROM "slice3_plan_target_note" AS target
          WHERE target."isSynthetic"`
        await transaction.$executeRaw`
          INSERT INTO "QuestionOption" (
            "id", "questionVersionId", "label", "text", "ordinal"
          )
          SELECT
            target."correctOptionId",
            target."questionVersionId",
            '1',
            '실행 계획 정답',
            1
          FROM "slice3_plan_target_note" AS target
          WHERE target."isSynthetic"`
        await transaction.$executeRaw`
          ALTER TABLE "QuestionVersion" DISABLE TRIGGER USER`
        await transaction.$executeRaw`
          UPDATE "QuestionVersion" AS version
          SET
            "status" = 'PUBLISHED',
            "correctOptionId" = target."correctOptionId",
            "publishedAt" = ${now},
            "updatedAt" = ${now}
          FROM "slice3_plan_target_note" AS target
          WHERE target."isSynthetic"
            AND version."id" = target."questionVersionId"`
        await transaction.$executeRaw`
          ALTER TABLE "QuestionVersion" ENABLE TRIGGER USER`
        await transaction.$executeRaw`
          UPDATE "Question" AS question
          SET
            "currentPublishedVersionId" = target."questionVersionId",
            "updatedAt" = ${now}
          FROM "slice3_plan_target_note" AS target
          WHERE target."isSynthetic"
            AND question."id" = target."questionId"`
        await transaction.$executeRaw`
          INSERT INTO "User" (
            "id", "name", "email", "emailVerified", "role",
            "accountStatus", "createdAt", "updatedAt"
          ) VALUES
          (
            ${targetUserId}::uuid,
            'Slice 3 query plan target',
            ${`slice3-plan-target-${targetUserId}@example.test`},
            true,
            'USER',
            'ACTIVE',
            ${now},
            ${now}
          ),
          (
            ${historyDecoyUserId}::uuid,
            'Slice 3 query plan history decoy',
            ${`slice3-plan-history-${historyDecoyUserId}@example.test`},
            true,
            'USER',
            'ACTIVE',
            ${now},
            ${now}
          )`
        await transaction.$executeRaw`
          INSERT INTO "User" (
            "id", "name", "email", "emailVerified", "role",
            "accountStatus", "createdAt", "updatedAt"
          )
          SELECT
            owner."userId",
            'Slice 3 query plan note decoy',
            'slice3-plan-note-' || owner."userId"::text || '@example.test',
            true,
            'USER',
            'ACTIVE',
            ${now},
            ${now}
          FROM "slice3_plan_note_owner" AS owner`
        await transaction.$executeRaw`
          INSERT INTO "GuestPrincipal" (
            "id", "tokenDigest", "expiresAt", "createdAt", "lastSeenAt"
          ) VALUES
          (
            ${targetGuestId}::uuid,
            repeat(md5(${targetGuestId}), 2),
            ${new Date(now.getTime() + 7 * 24 * 60 * 60 * 1_000)},
            ${now},
            ${now}
          ),
          (
            ${historyDecoyGuestId}::uuid,
            repeat(md5(${historyDecoyGuestId}), 2),
            ${new Date(now.getTime() + 7 * 24 * 60 * 60 * 1_000)},
            ${now},
            ${now}
          )`
        await transaction.$executeRaw`
          INSERT INTO "StudySession" (
            "id", "userId", "guestPrincipalId", "level", "subject",
            "mode", "status", "requestedCount", "actualCount",
            "usedFallback", "startedAt", "expiresAt",
            "practiceContractVersion", "createdAt", "updatedAt"
          )
          SELECT
            fixture."sessionId",
            CASE
              WHEN fixture."kind" = 'TARGET_USER_FILTER_DECOY' THEN
                ${targetUserId}::uuid
              ELSE fixture."userId"
            END,
            CASE
              WHEN fixture."kind" = 'TARGET_GUEST_FILTER_DECOY' THEN
                ${targetGuestId}::uuid
              ELSE fixture."guestPrincipalId"
            END,
            CASE
              WHEN fixture."kind" IN (
                'TARGET_USER_FILTER_DECOY',
                'TARGET_GUEST_FILTER_DECOY'
              ) THEN 'N4'::"JlptLevel"
              ELSE 'N5'::"JlptLevel"
            END,
            CASE
              WHEN fixture."kind" IN (
                'TARGET_USER_FILTER_DECOY',
                'TARGET_GUEST_FILTER_DECOY'
              ) THEN 'GRAMMAR'::"QuestionSubject"
              ELSE 'VOCABULARY'::"QuestionSubject"
            END,
            CASE
              WHEN fixture."kind" = 'TARGET_USER'
                AND fixture."sequence" % 4 = 0 THEN
                'WRONG_NOTE'::"StudyMode"
              WHEN fixture."kind" = 'TARGET_USER'
                AND fixture."sequence" % 4 = 1 THEN
                'WEAKNESS'::"StudyMode"
              WHEN fixture."kind" = 'TARGET_USER'
                AND fixture."sequence" % 4 = 2 THEN
                'DAILY_REVIEW'::"StudyMode"
              ELSE 'RANDOM'::"StudyMode"
            END,
            'IN_PROGRESS',
            1,
            1,
            false,
            fixture."startedAt",
            fixture."startedAt" + INTERVAL '24 hours',
            1,
            fixture."startedAt",
            fixture."startedAt"
          FROM "slice3_plan_session" AS fixture`
        await transaction.$executeRaw`
          INSERT INTO "StudySessionQuestion" (
            "id", "studySessionId", "questionId", "questionVersionId",
            "ordinal", "createdAt"
          )
          SELECT
            fixture."sessionQuestionId",
            fixture."sessionId",
            ${question.id}::uuid,
            ${question.currentPublishedVersionId}::uuid,
            1,
            fixture."startedAt"
          FROM "slice3_plan_session" AS fixture`
        await transaction.$executeRaw`
          INSERT INTO "StudyAnswer" (
            "id", "studySessionQuestionId", "questionVersionId",
            "selectedOptionId", "isCorrect", "elapsedSec",
            "gradingVersion", "answeredAt", "gradedAt"
          )
          SELECT
            gen_random_uuid(),
            fixture."sessionQuestionId",
            ${question.currentPublishedVersionId}::uuid,
            NULL,
            false,
            1,
            'server-grading-v1',
            fixture."submittedAt",
            fixture."submittedAt"
          FROM "slice3_plan_session" AS fixture`
        await transaction.$executeRaw`
          INSERT INTO "StudyResult" (
            "id", "studySessionId", "totalCount", "correctCount",
            "incorrectCount", "correctRateBasisPoints", "durationSec",
            "gradingVersion", "createdAt"
          )
          SELECT
            gen_random_uuid(),
            fixture."sessionId",
            1,
            0,
            1,
            0,
            1,
            'server-grading-v1',
            fixture."submittedAt"
          FROM "slice3_plan_session" AS fixture`
        await transaction.$executeRaw`
          UPDATE "StudySession" AS session
          SET
            "status" = 'SUBMITTED',
            "submittedAt" = fixture."submittedAt",
            "durationSec" = 1,
            "submissionHash" = repeat('a', 64),
            "updatedAt" = fixture."submittedAt"
          FROM "slice3_plan_session" AS fixture
          WHERE session."id" = fixture."sessionId"`

        await transaction.$executeRaw`
          INSERT INTO "WrongNote" (
            "id", "userId", "questionId", "lastWrongQuestionVersionId",
            "currentReviewQuestionVersionId", "wrongCount", "correctStreak",
            "status", "lastWrongAt", "lastReviewedAt", "createdAt",
            "updatedAt"
          )
          SELECT
            target."wrongNoteId",
            ${targetUserId}::uuid,
            target."questionId",
            target."questionVersionId",
            NULL,
            1,
            0,
            'NEW',
            ${new Date(now.getTime() - 2 * 60 * 60 * 1_000)},
            NULL,
            ${new Date(now.getTime() - 2 * 60 * 60 * 1_000)},
            ${new Date(now.getTime() - 2 * 60 * 60 * 1_000)}
          FROM "slice3_plan_target_note" AS target`
        await transaction.$executeRaw`
          INSERT INTO "WrongNote" (
            "id", "userId", "questionId", "lastWrongQuestionVersionId",
            "currentReviewQuestionVersionId", "wrongCount", "correctStreak",
            "status", "lastWrongAt", "lastReviewedAt", "createdAt",
            "updatedAt"
          )
          SELECT
            owner."wrongNoteId",
            owner."userId",
            ${question.id}::uuid,
            ${question.currentPublishedVersionId}::uuid,
            NULL,
            1,
            0,
            'NEW',
            ${now}::timestamptz - INTERVAL '3 hours'
              - owner."sequence" * INTERVAL '1 millisecond',
            NULL,
            ${now}::timestamptz - INTERVAL '3 hours'
              - owner."sequence" * INTERVAL '1 millisecond',
            ${now}::timestamptz - INTERVAL '3 hours'
              - owner."sequence" * INTERVAL '1 millisecond'
          FROM "slice3_plan_note_owner" AS owner`
        await transaction.$executeRaw`
          INSERT INTO "ReviewSchedule" (
            "id", "wrongNoteId", "nextReviewAt", "intervalDays",
            "algorithmVersion", "updatedAt"
          )
          SELECT
            target."scheduleId",
            target."wrongNoteId",
            ${new Date(now.getTime() - 60 * 60 * 1_000)},
            1,
            1,
            ${new Date(now.getTime() - 2 * 60 * 60 * 1_000)}
          FROM "slice3_plan_target_note" AS target`
        await transaction.$executeRaw`
          INSERT INTO "ReviewSchedule" (
            "id", "wrongNoteId", "nextReviewAt", "intervalDays",
            "algorithmVersion", "updatedAt"
          )
          SELECT
            owner."scheduleId",
            owner."wrongNoteId",
            ${now}::timestamptz - INTERVAL '30 minutes'
              + owner."sequence" * INTERVAL '1 millisecond',
            1,
            1,
            ${now}::timestamptz - INTERVAL '3 hours'
              - owner."sequence" * INTERVAL '1 millisecond'
          FROM "slice3_plan_note_owner" AS owner`
        await transaction.$executeRaw`
          INSERT INTO "Bookmark" (
            "id", "userId", "questionId", "createdAt"
          )
          SELECT
            gen_random_uuid(),
            owner."userId",
            target."questionId",
            ${now}::timestamptz
          FROM "slice3_plan_target_note" AS target
          CROSS JOIN (
            SELECT ${targetUserId}::uuid AS "userId"
            UNION ALL
            SELECT note_owner."userId"
            FROM "slice3_plan_note_owner" AS note_owner
            WHERE note_owner."sequence" <= ${BOOKMARK_DECOY_OWNER_CARDINALITY}
          ) AS owner`

        await transaction.$executeRaw`ANALYZE "StudySession"`
        await transaction.$executeRaw`ANALYZE "StudySessionQuestion"`
        await transaction.$executeRaw`ANALYZE "StudyAnswer"`
        await transaction.$executeRaw`ANALYZE "StudyResult"`
        await transaction.$executeRaw`ANALYZE "WrongNote"`
        await transaction.$executeRaw`ANALYZE "ReviewSchedule"`
        await transaction.$executeRaw`ANALYZE "Bookmark"`

        const plannerSettings = await transaction.$queryRaw<
          { enableSeqscan: string; enableSort: string }[]
        >`
          SELECT
            current_setting('enable_seqscan') AS "enableSeqscan",
            current_setting('enable_sort') AS "enableSort"`
        expect(plannerSettings).toEqual([
          { enableSeqscan: 'on', enableSort: 'on' }
        ])

        const bookmarkList = await transaction.$queryRaw<ExplainRow[]>(
          Prisma.sql`
            EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
            SELECT
              bookmark."id",
              bookmark."questionId",
              bookmark."createdAt"
            FROM "Bookmark" AS bookmark
            WHERE bookmark."userId" = ${targetUserId}::uuid
            ORDER BY bookmark."createdAt" DESC, bookmark."id" ASC
            LIMIT 20`
        )
        const bookmarkMode = await transaction.$queryRaw<ExplainRow[]>(
          Prisma.sql`
            EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
            SELECT
              bookmark."questionId",
              version."id" AS "questionVersionId",
              bookmark."createdAt"
            FROM "Bookmark" AS bookmark
            JOIN "Question" AS question
              ON question."id" = bookmark."questionId"
            JOIN "QuestionVersion" AS version
              ON version."questionId" = question."id"
              AND version."id" = question."currentPublishedVersionId"
            WHERE bookmark."userId" = ${targetUserId}::uuid
              AND question."lifecycleStatus" = 'ACTIVE'
              AND version."status" = 'PUBLISHED'
              AND version."level" = 'N5'::"JlptLevel"
              AND version."subject" = 'VOCABULARY'::"QuestionSubject"
            ORDER BY bookmark."createdAt" DESC, bookmark."questionId" ASC
            LIMIT 20`
        )
        const bookmarkModeOwnerScan = await transaction.$queryRaw<ExplainRow[]>(
          Prisma.sql`
            EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
            SELECT bookmark."questionId", bookmark."createdAt"
            FROM "Bookmark" AS bookmark
            WHERE bookmark."userId" = ${targetUserId}::uuid
            ORDER BY bookmark."createdAt" DESC, bookmark."questionId" ASC
            LIMIT 20`
        )
        const bookmarkQuestionCleanup = await transaction.$queryRaw<
          ExplainRow[]
        >(
          Prisma.sql`
            EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
            DELETE FROM "Bookmark" AS bookmark
            WHERE bookmark."questionId" = ${question.id}::uuid`
        )

        const userWeakness = await transaction.$queryRaw<ExplainRow[]>(
          Prisma.sql`
            EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
            WITH recent_sessions AS MATERIALIZED (
              SELECT session."id"
              FROM "StudySession" AS session
              WHERE session."userId" = ${targetUserId}::uuid
                AND session."level" = 'N5'::"JlptLevel"
                AND session."subject" = 'VOCABULARY'::"QuestionSubject"
                AND session."status" = 'SUBMITTED'
                AND session."submittedAt" IS NOT NULL
              ORDER BY session."submittedAt" DESC, session."id" ASC
              LIMIT 10
            )
            SELECT
              item."questionId",
              version."id" AS "questionVersionId",
              COUNT(*)::INTEGER AS "answeredCount",
              COUNT(*) FILTER (WHERE answer."isCorrect" = false)::INTEGER
                AS "incorrectCount",
              MAX(answer."answeredAt") AS "lastAnsweredAt"
            FROM recent_sessions AS recent
            JOIN "StudySessionQuestion" AS item
              ON item."studySessionId" = recent."id"
            JOIN "StudyAnswer" AS answer
              ON answer."studySessionQuestionId" = item."id"
              AND answer."questionVersionId" = item."questionVersionId"
            JOIN "Question" AS question
              ON question."id" = item."questionId"
            JOIN "QuestionVersion" AS version
              ON version."questionId" = question."id"
              AND version."id" = question."currentPublishedVersionId"
            WHERE question."lifecycleStatus" = 'ACTIVE'
              AND version."status" = 'PUBLISHED'
              AND version."level" = 'N5'::"JlptLevel"
              AND version."subject" = 'VOCABULARY'::"QuestionSubject"
            GROUP BY item."questionId", version."id"
            HAVING COUNT(*) >= 3
              AND COUNT(*) FILTER (WHERE answer."isCorrect" = false) >= 1
            ORDER BY item."questionId" ASC`
        )
        const guestWeakness = await transaction.$queryRaw<ExplainRow[]>(
          Prisma.sql`
            EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
            WITH recent_sessions AS MATERIALIZED (
              SELECT session."id"
              FROM "StudySession" AS session
              WHERE session."guestPrincipalId" = ${targetGuestId}::uuid
                AND session."level" = 'N5'::"JlptLevel"
                AND session."subject" = 'VOCABULARY'::"QuestionSubject"
                AND session."status" = 'SUBMITTED'
                AND session."submittedAt" IS NOT NULL
              ORDER BY session."submittedAt" DESC, session."id" ASC
              LIMIT 10
            )
            SELECT
              item."questionId",
              version."id" AS "questionVersionId",
              COUNT(*)::INTEGER AS "answeredCount",
              COUNT(*) FILTER (WHERE answer."isCorrect" = false)::INTEGER
                AS "incorrectCount",
              MAX(answer."answeredAt") AS "lastAnsweredAt"
            FROM recent_sessions AS recent
            JOIN "StudySessionQuestion" AS item
              ON item."studySessionId" = recent."id"
            JOIN "StudyAnswer" AS answer
              ON answer."studySessionQuestionId" = item."id"
              AND answer."questionVersionId" = item."questionVersionId"
            JOIN "Question" AS question
              ON question."id" = item."questionId"
            JOIN "QuestionVersion" AS version
              ON version."questionId" = question."id"
              AND version."id" = question."currentPublishedVersionId"
            WHERE question."lifecycleStatus" = 'ACTIVE'
              AND version."status" = 'PUBLISHED'
              AND version."level" = 'N5'::"JlptLevel"
              AND version."subject" = 'VOCABULARY'::"QuestionSubject"
            GROUP BY item."questionId", version."id"
            HAVING COUNT(*) >= 3
              AND COUNT(*) FILTER (WHERE answer."isCorrect" = false) >= 1
            ORDER BY item."questionId" ASC`
        )
        const wrongNote = await transaction.$queryRaw<ExplainRow[]>(Prisma.sql`
          EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
          SELECT
            note."id" AS "wrongNoteId",
            note."questionId",
            version."id" AS "questionVersionId",
            note."lastWrongAt",
            note."wrongCount"
          FROM "WrongNote" AS note
          JOIN "Question" AS question
            ON question."id" = note."questionId"
          JOIN "QuestionVersion" AS version
            ON version."questionId" = question."id"
            AND version."id" = question."currentPublishedVersionId"
          WHERE note."userId" = ${targetUserId}::uuid
            AND note."status" IN ('NEW', 'REVIEWING', 'AGAIN')
            AND question."lifecycleStatus" = 'ACTIVE'
            AND version."status" = 'PUBLISHED'
            AND version."level" = 'N5'::"JlptLevel"
            AND version."subject" = 'VOCABULARY'::"QuestionSubject"
          ORDER BY
            note."lastWrongAt" DESC,
            note."wrongCount" DESC,
            note."questionId" ASC
          LIMIT 20`)
        const wrongNoteOwnerScan = await transaction.$queryRaw<ExplainRow[]>(
          Prisma.sql`
            EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
            SELECT
              note."id",
              note."questionId",
              note."lastWrongAt",
              note."wrongCount"
            FROM "WrongNote" AS note
            WHERE note."userId" = ${targetUserId}::uuid
              AND note."status" = 'NEW'
            ORDER BY
              note."lastWrongAt" DESC,
              note."wrongCount" DESC,
              note."questionId" ASC
            LIMIT 20`
        )
        const dailyReview = await transaction.$queryRaw<ExplainRow[]>(
          Prisma.sql`
            EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
            SELECT
              note."id" AS "wrongNoteId",
              note."questionId",
              version."id" AS "questionVersionId",
              schedule."nextReviewAt",
              note."status"
            FROM "ReviewSchedule" AS schedule
            JOIN "WrongNote" AS note
              ON note."id" = schedule."wrongNoteId"
            JOIN "Question" AS question
              ON question."id" = note."questionId"
            JOIN "QuestionVersion" AS version
              ON version."questionId" = question."id"
              AND version."id" = question."currentPublishedVersionId"
            WHERE note."userId" = ${targetUserId}::uuid
              AND note."status" IN ('NEW', 'REVIEWING', 'AGAIN', 'SOLVED')
              AND schedule."nextReviewAt" <= ${now}
              AND question."lifecycleStatus" = 'ACTIVE'
              AND version."status" = 'PUBLISHED'
              AND version."level" = 'N5'::"JlptLevel"
              AND version."subject" = 'VOCABULARY'::"QuestionSubject"
            ORDER BY
              schedule."nextReviewAt" ASC,
              CASE note."status"
                WHEN 'AGAIN'::"WrongNoteStatus" THEN 1
                WHEN 'NEW'::"WrongNoteStatus" THEN 2
                WHEN 'REVIEWING'::"WrongNoteStatus" THEN 3
                WHEN 'SOLVED'::"WrongNoteStatus" THEN 4
              END,
              note."questionId" ASC
            LIMIT 20`
        )
        const dailyReviewOwnerScan = await transaction.$queryRaw<ExplainRow[]>(
          Prisma.sql`
            EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
            SELECT note."id", note."questionId"
            FROM "WrongNote" AS note
            WHERE note."userId" = ${targetUserId}::uuid
              AND note."status" = 'NEW'
            ORDER BY note."id" ASC, note."questionId" ASC
            LIMIT 20`
        )
        const dashboard = await transaction.$queryRaw<ExplainRow[]>(Prisma.sql`
          EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
          SELECT
            session."id",
            session."level",
            session."subject",
            session."mode",
            result."totalCount",
            result."correctCount",
            result."correctRateBasisPoints",
            result."durationSec",
            session."submittedAt"
          FROM "StudySession" AS session
          JOIN "StudyResult" AS result
            ON result."studySessionId" = session."id"
          WHERE session."userId" = ${targetUserId}::uuid
            AND session."status" = 'SUBMITTED'::"StudySessionStatus"
            AND session."submittedAt" IS NOT NULL
          ORDER BY session."submittedAt" DESC, session."id" ASC
          LIMIT ${PAGE_SIZE}`)

        plans = {
          bookmarkList,
          bookmarkMode,
          bookmarkModeOwnerScan,
          bookmarkQuestionCleanup,
          dailyReview,
          dailyReviewOwnerScan,
          dashboard,
          guestWeakness,
          userWeakness,
          wrongNote,
          wrongNoteOwnerScan
        }
        throw rollbackSentinel
      })
    } catch (error) {
      if (error !== rollbackSentinel) {
        throw error
      }
    }

    if (!plans) {
      throw new Error('Slice 3 query plan capture가 필요합니다.')
    }

    Object.values(plans).forEach(assertCommonPlanEvidence)
    expect(readRootPlan(plans.bookmarkList)['Actual Rows']).toBe(20)
    expect(readRootPlan(plans.bookmarkMode)['Actual Rows']).toBe(20)
    expect(readRootPlan(plans.bookmarkModeOwnerScan)['Actual Rows']).toBe(20)
    expect(readRootPlan(plans.userWeakness)['Actual Rows']).toBe(1)
    expect(readRootPlan(plans.guestWeakness)['Actual Rows']).toBe(1)
    expect(readRootPlan(plans.wrongNote)['Actual Rows']).toBe(
      Math.min(eligibleReviewQuestionCount + RANKING_TARGET_CARDINALITY, 20)
    )
    expect(readRootPlan(plans.dailyReview)['Actual Rows']).toBe(
      Math.min(eligibleReviewQuestionCount + RANKING_TARGET_CARDINALITY, 20)
    )
    expect(readRootPlan(plans.wrongNoteOwnerScan)['Actual Rows']).toBe(20)
    expect(readRootPlan(plans.dailyReviewOwnerScan)['Actual Rows']).toBe(20)
    expect(readRootPlan(plans.dashboard)['Actual Rows']).toBe(PAGE_SIZE)

    expect(readIndexNames(plans.userWeakness)).toContain(
      'StudySession_userId_level_subject_submittedAt_id_weakness_idx'
    )
    expect(readIndexNames(plans.guestWeakness)).toContain(
      'StudySession_guest_level_subject_submittedAt_id_weakness_idx'
    )
    const wrongNoteIndexes = readIndexNames(plans.wrongNoteOwnerScan)
    expect(
      wrongNoteIndexes,
      `wrong-note owner indexes: ${[...wrongNoteIndexes].join(', ')}`
    ).toContain('WrongNote_user_status_lastWrongAt_wrongCount_questionId_idx')
    const dailyReviewIndexes = readIndexNames(plans.dailyReviewOwnerScan)
    expect(
      dailyReviewIndexes,
      `daily owner indexes: ${[...dailyReviewIndexes].join(', ')}`
    ).toContain('WrongNote_userId_status_id_questionId_daily_idx')
    expect(readIndexNames(plans.dashboard)).toContain(
      'StudySession_userId_submittedAt_id_dashboard_idx'
    )
    expect(readIndexNames(plans.bookmarkList)).toContain(
      'Bookmark_userId_createdAt_id_idx'
    )
    const bookmarkModeIndexes = readIndexNames(plans.bookmarkModeOwnerScan)
    expect(
      bookmarkModeIndexes,
      `bookmark mode indexes: ${[...bookmarkModeIndexes].join(', ')}`
    ).toContain('Bookmark_userId_createdAt_questionId_idx')
    expect(readIndexNames(plans.bookmarkQuestionCleanup)).toContain(
      'Bookmark_questionId_id_idx'
    )
    ;[plans.userWeakness, plans.guestWeakness, plans.dashboard].forEach(
      (plan) => expectNoSequentialScan(plan, 'StudySession')
    )
    ;[plans.wrongNote, plans.dailyReview].forEach((plan) =>
      expectNoSequentialScan(plan, 'WrongNote')
    )
    expectNoSequentialScan(plans.bookmarkList, 'Bookmark')
    expectNoSequentialScan(plans.bookmarkMode, 'Bookmark')
    expectNoSequentialScan(plans.bookmarkModeOwnerScan, 'Bookmark')
    expectNoSequentialScan(plans.bookmarkQuestionCleanup, 'Bookmark')
    expectBoundedRelationRows(
      plans.userWeakness,
      'StudySession',
      HISTORY_OWNER_CARDINALITY
    )
    expectBoundedRelationRows(
      plans.guestWeakness,
      'StudySession',
      HISTORY_OWNER_CARDINALITY
    )
    expectBoundedRelationRows(
      plans.dashboard,
      'StudySession',
      HISTORY_OWNER_CARDINALITY
    )
    expectBoundedRelationRows(
      plans.wrongNote,
      'WrongNote',
      RANKING_TARGET_CARDINALITY + 65
    )
    expectBoundedRelationRows(
      plans.dailyReview,
      'WrongNote',
      RANKING_TARGET_CARDINALITY + 65
    )
    expectBoundedRelationRows(
      plans.bookmarkList,
      'Bookmark',
      RANKING_TARGET_CARDINALITY + 65
    )
    expectBoundedRelationRows(
      plans.bookmarkMode,
      'Bookmark',
      RANKING_TARGET_CARDINALITY + 65
    )
    expectBoundedRelationRows(
      plans.bookmarkModeOwnerScan,
      'Bookmark',
      RANKING_TARGET_CARDINALITY + 65
    )
    expectBoundedRelationRows(
      plans.bookmarkQuestionCleanup,
      'Bookmark',
      BOOKMARK_DECOY_OWNER_CARDINALITY + 1
    )
  }, 60_000)
})

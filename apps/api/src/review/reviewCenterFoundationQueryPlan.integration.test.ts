import { randomUUID } from 'node:crypto'
import type { QuestionType } from '@nihongo/contracts/common/enum'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseApiEnvironment } from '../config/env.js'
import { createDatabaseRuntime } from '../db/database.js'
import { assertSafeTestDatabase } from '../db/databaseTargetGuard.js'
import { Prisma } from '../generated/prisma/client.js'
import {
  createOwnedMemoLockQuery,
  createOwnedMemoReadQuery,
  createOwnedWrongNoteLockQuery,
  createOwnedWrongNoteReadQuery,
  createReviewEventHistoryBatchQuery
} from '../wrong-note/wrongNoteReviewCenterRepository.js'
import {
  createReviewQueueAvailableTagsQuery,
  createReviewQueueCountsQuery,
  createReviewQueueItemsQuery
} from '../wrong-note/wrongNoteReviewQueueRepository.js'
import {
  createTargetedReviewExistingRecordQuery,
  createTargetedReviewQuestionLockQuery,
  createTargetedReviewWrongNoteLockQuery
} from '../wrong-note/wrongNoteTargetedReviewRepository.js'
import {
  createReviewReconciliationEventBatchQuery,
  createReviewReconciliationNoteBatchQuery,
  createPrismaReviewReconciliationRepository
} from './reviewReconciliationRepository.js'

interface ExplainRow {
  'QUERY PLAN': unknown
}

interface PlanNode extends Record<string, unknown> {
  'Node Type': string
}

interface ReviewCenterPlanFixture {
  readonly historyCursorId: string
  readonly historyCursorOccurredAt: Date
  readonly questionId: string
  readonly questionType: QuestionType
  readonly sessionId: string
  readonly tag: string
  readonly targetedIdempotencyKey: string
  readonly targetUserId: string
  readonly wrongNoteId: string
}

interface ReviewCenterPlans {
  readonly historyCursor: ExplainRow[]
  readonly historyInitial: ExplainRow[]
  readonly historyOwnerRead: ExplainRow[]
  readonly memoLookup: ExplainRow[]
  readonly memoOwnerLock: ExplainRow[]
  readonly memoRead: ExplainRow[]
  readonly reconciliationEvents: ExplainRow[]
  readonly reconciliationNotes: ExplainRow[]
  readonly reviewQueueAvailableTags: ExplainRow[]
  readonly reviewQueueCounts: ExplainRow[]
  readonly reviewQueueItems: ExplainRow[]
  readonly targetedCleanup: ExplainRow[]
  readonly targetedExistingRecord: ExplainRow[]
  readonly targetedQuestionLock: ExplainRow[]
  readonly targetedWrongNoteLock: ExplainRow[]
}

const PLAN_NOW = new Date('2026-08-21T12:00:00.000Z')
const RECONCILIATION_DECOY_USER_COUNT = 128
const FOREIGN_OWNER_DECOY_USER_COUNT = 8
const DECOY_QUESTION_COUNT = 64
const HISTORY_CARDINALITY = 205
const HISTORY_LIMIT = 101
const TARGETED_CARDINALITY = 512
const TARGETED_CATALOG_DECOY_CARDINALITY = 512
const IDEMPOTENCY_DECOY_CARDINALITY = 4_096
const CLEANUP_LIMIT = 500
const RECONCILIATION_LIMIT = 500

const environment = parseApiEnvironment(process.env)
assertSafeTestDatabase({
  nodeEnvironment: environment.NODE_ENV,
  databaseUrl: environment.DATABASE_URL,
  productionDatabaseUrl: process.env.PRODUCTION_DATABASE_URL
})

const database = createDatabaseRuntime(environment.DATABASE_URL)
const createdDraftVersionIds = new Set<string>()
const createdTagPrefixes = new Set<string>()
const createdUserIds = new Set<string>()

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

const readRootPlan = (rows: ExplainRow[]): PlanNode => {
  const document = rows[0]?.['QUERY PLAN']
  if (!Array.isArray(document)) {
    throw new Error('Review-center EXPLAIN JSON document가 필요합니다.')
  }
  const root = document[0]
  if (typeof root !== 'object' || root === null) {
    throw new Error('Review-center EXPLAIN JSON root가 필요합니다.')
  }
  const plan = (root as Record<string, unknown>).Plan
  if (
    typeof plan !== 'object' ||
    plan === null ||
    typeof (plan as Record<string, unknown>)['Node Type'] !== 'string'
  ) {
    throw new Error('Review-center EXPLAIN JSON plan이 필요합니다.')
  }
  return plan as PlanNode
}

const readNumericPlanField = (node: PlanNode, field: string): number => {
  const value = node[field]
  return typeof value === 'number' ? value : 0
}

const readIndexNames = (rows: ExplainRow[]): Set<string> =>
  new Set(
    readPlanNodes(rows).flatMap((node) =>
      typeof node['Index Name'] === 'string' ? [node['Index Name']] : []
    )
  )

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
  relationNodes.forEach((node) => {
    const loops = Math.max(1, readNumericPlanField(node, 'Actual Loops'))
    const effectiveRows =
      (readNumericPlanField(node, 'Actual Rows') +
        readNumericPlanField(node, 'Rows Removed by Filter') +
        readNumericPlanField(node, 'Rows Removed by Index Recheck')) *
      loops
    expect(effectiveRows).toBeLessThanOrEqual(maximumRows)
  })
}

const expectPlanBuffersAtMost = (
  rows: ExplainRow[],
  maximumBuffers: number
): void => {
  const root = readRootPlan(rows)
  const buffers =
    readNumericPlanField(root, 'Shared Hit Blocks') +
    readNumericPlanField(root, 'Shared Read Blocks')
  expect(buffers).toBeLessThanOrEqual(maximumBuffers)
}

const expectRelationExecuted = (
  rows: ExplainRow[],
  relationName: string
): void => {
  const executedRows = readPlanNodes(rows)
    .filter((node) => node['Relation Name'] === relationName)
    .reduce(
      (total, node) =>
        total +
        readNumericPlanField(node, 'Actual Rows') *
          Math.max(1, readNumericPlanField(node, 'Actual Loops')),
      0
    )
  expect(executedRows).toBeGreaterThan(0)
}

const expectCommonPlanEvidence = (
  rows: ExplainRow[],
  planName: keyof ReviewCenterPlans
): void => {
  const nodes = readPlanNodes(rows)
  const root = readRootPlan(rows)
  const buffers =
    readNumericPlanField(root, 'Shared Hit Blocks') +
    readNumericPlanField(root, 'Shared Read Blocks')

  expect(nodes.length).toBeGreaterThan(0)
  expect(buffers, `${planName} buffer count`).toBeGreaterThan(0)
  expect(buffers, `${planName} buffer count`).toBeLessThanOrEqual(4_096)
  nodes
    .filter(({ 'Node Type': nodeType }) =>
      ['Incremental Sort', 'Sort'].includes(nodeType)
    )
    .forEach((node) => expect(node['Sort Space Type']).not.toBe('Disk'))
}

const createTargetWrongNote = async (userId: string) => {
  const startedAt = new Date(PLAN_NOW.getTime() - 60 * 60 * 1_000)
  const question = await database.client.question.findFirstOrThrow({
    where: {
      lifecycleStatus: 'ACTIVE',
      currentPublishedVersionId: { not: null },
      currentPublishedVersion: {
        status: 'PUBLISHED',
        level: 'N5',
        subject: 'VOCABULARY'
      }
    },
    select: { id: true, currentPublishedVersionId: true }
  })
  if (question.currentPublishedVersionId === null) {
    throw new Error(
      'Phase 5 query-plan fixture에 published version이 필요합니다.'
    )
  }
  const sessionId = randomUUID()
  const sessionQuestionId = randomUUID()
  const answerId = randomUUID()
  const idempotencyRecordId = randomUUID()
  const wrongNoteId = randomUUID()
  const submissionHash = 'a'.repeat(64)

  await database.client.$transaction(async (transaction) => {
    await transaction.$executeRaw`
      INSERT INTO "StudySession" (
        "id", "userId", "level", "subject", "mode", "status",
        "requestedCount", "actualCount", "usedFallback", "startedAt",
        "expiresAt", "practiceContractVersion", "createdAt", "updatedAt"
      ) VALUES (
        ${sessionId}::uuid, ${userId}::uuid, 'N5', 'VOCABULARY', 'RANDOM',
        'IN_PROGRESS', 1, 1, false, ${startedAt},
        ${new Date(startedAt.getTime() + 24 * 60 * 60 * 1_000)}, 1,
        ${startedAt}, ${startedAt}
      )
    `
    await transaction.$executeRaw`
      INSERT INTO "StudySessionQuestion" (
        "id", "studySessionId", "questionId", "questionVersionId",
        "ordinal", "createdAt"
      ) VALUES (
        ${sessionQuestionId}::uuid, ${sessionId}::uuid, ${question.id}::uuid,
        ${question.currentPublishedVersionId}::uuid, 1, ${startedAt}
      )
    `
    await transaction.$executeRaw`
      INSERT INTO "IdempotencyRecord" (
        "id", "principalType", "userId", "guestPrincipalId",
        "operation", "idempotencyKey", "studySessionId", "requestHash",
        "contractVersion", "state", "createdAt"
      ) VALUES (
        ${idempotencyRecordId}::uuid, 'USER', ${userId}::uuid, NULL,
        'STUDY_SUBMIT', ${randomUUID()}::uuid, ${sessionId}::uuid,
        ${submissionHash}, 1, 'PROCESSING', ${startedAt}
      )
    `
    await transaction.$executeRaw`
      INSERT INTO "StudyAnswer" (
        "id", "studySessionQuestionId", "questionVersionId",
        "selectedOptionId", "isCorrect", "elapsedSec", "gradingVersion",
        "answeredAt", "gradedAt"
      ) VALUES (
        ${answerId}::uuid, ${sessionQuestionId}::uuid,
        ${question.currentPublishedVersionId}::uuid, NULL, false, 0,
        'server-grading-v1', ${PLAN_NOW}, ${PLAN_NOW}
      )
    `
    await transaction.$executeRaw`
      INSERT INTO "WrongNote" (
        "id", "userId", "questionId", "lastWrongQuestionVersionId",
        "currentReviewQuestionVersionId", "wrongCount", "correctStreak",
        "status", "lastWrongAt", "lastReviewedAt", "createdAt", "updatedAt"
      ) VALUES (
        ${wrongNoteId}::uuid, ${userId}::uuid, ${question.id}::uuid,
        ${question.currentPublishedVersionId}::uuid, NULL, 1, 0, 'NEW',
        ${PLAN_NOW}, NULL, ${PLAN_NOW}, ${PLAN_NOW}
      )
    `
    await transaction.$executeRaw`
      INSERT INTO "ReviewSchedule" (
        "id", "wrongNoteId", "nextReviewAt", "intervalDays",
        "algorithmVersion", "updatedAt"
      ) VALUES (
        ${randomUUID()}::uuid, ${wrongNoteId}::uuid,
        ${new Date(PLAN_NOW.getTime() + 24 * 60 * 60 * 1_000)}, 1, 1,
        ${PLAN_NOW}
      )
    `
    await transaction.$executeRaw`
      INSERT INTO "ReviewEvent" (
        "id", "wrongNoteId", "userId", "questionId", "questionVersionId",
        "source", "studySessionId", "studyAnswerId", "selectedOptionId",
        "isCorrect", "previousStatus", "nextStatus",
        "previousCorrectStreak", "nextCorrectStreak", "previousWrongCount",
        "wrongCountAfter", "algorithmVersion", "occurredAt"
      ) VALUES (
        ${randomUUID()}::uuid, ${wrongNoteId}::uuid, ${userId}::uuid,
        ${question.id}::uuid, ${question.currentPublishedVersionId}::uuid,
        'STUDY_SUBMIT', ${sessionId}::uuid, ${answerId}::uuid, NULL, false,
        NULL, 'NEW', NULL, 0, NULL, 1, 1, ${PLAN_NOW}
      )
    `
    await transaction.$executeRaw`
      INSERT INTO "StudyResult" (
        "id", "studySessionId", "totalCount", "correctCount",
        "incorrectCount", "correctRateBasisPoints", "durationSec",
        "gradingVersion", "createdAt"
      ) VALUES (
        ${randomUUID()}::uuid, ${sessionId}::uuid, 1, 0, 1, 0, 0,
        'server-grading-v1', ${PLAN_NOW}
      )
    `
    await transaction.$executeRaw`
      UPDATE "StudySession"
      SET "status" = 'SUBMITTED', "submittedAt" = ${PLAN_NOW},
          "durationSec" = 0, "submissionHash" = ${submissionHash},
          "updatedAt" = ${PLAN_NOW}
      WHERE "id" = ${sessionId}::uuid
    `
    await transaction.$executeRaw`
      UPDATE "IdempotencyRecord"
      SET "state" = 'SUCCEEDED', "responseStatus" = 201,
          "responseBody" = JSONB_BUILD_OBJECT('sessionId', ${sessionId}::text),
          "completedAt" = ${PLAN_NOW},
          "expiresAt" = ${new Date(PLAN_NOW.getTime() + 24 * 60 * 60 * 1_000)}
      WHERE "id" = ${idempotencyRecordId}::uuid
    `
    await transaction.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`
  })
  const wrongNote = await database.client.wrongNote.findFirstOrThrow({
    where: { id: wrongNoteId },
    select: {
      id: true,
      questionId: true,
      lastWrongQuestionVersionId: true
    }
  })
  return { sessionId, wrongNote }
}

const createPlanFixture = async (): Promise<ReviewCenterPlanFixture> => {
  const targetUserId = randomUUID()
  const targetedIdempotencyKey = randomUUID()
  const decoyUserIds = Array.from(
    { length: RECONCILIATION_DECOY_USER_COUNT },
    () => randomUUID()
  )
  const foreignOwnerDecoyUserIds = decoyUserIds.slice(
    0,
    FOREIGN_OWNER_DECOY_USER_COUNT
  )
  const memoOwnerIds = [targetUserId, ...foreignOwnerDecoyUserIds]
  const userIds = [targetUserId, ...decoyUserIds]
  createdUserIds.clear()
  userIds.forEach((userId) => createdUserIds.add(userId))
  await database.client.user.createMany({
    data: userIds.map((id, index) => ({
      id,
      name: `Phase 5 query-plan user ${index}`,
      email: `phase5-query-plan-${id}@example.test`,
      emailVerified: true
    }))
  })

  const { sessionId, wrongNote } = await createTargetWrongNote(targetUserId)
  const currentVersion =
    await database.client.questionVersion.findUniqueOrThrow({
      where: { id: wrongNote.lastWrongQuestionVersionId },
      select: {
        questionType: true,
        tags: {
          orderBy: { labelSnapshot: 'asc' },
          take: 1,
          select: { labelSnapshot: true }
        }
      }
    })
  const tag = currentVersion.tags[0]?.labelSnapshot
  if (!tag) {
    throw new Error('Review queue query-plan fixture tag가 필요합니다.')
  }
  const tagPrefix = `phase5-plan-${randomUUID()}`
  const draftVersionId = randomUUID()
  createdDraftVersionIds.add(draftVersionId)
  createdTagPrefixes.add(tagPrefix)
  await database.client.$executeRaw(Prisma.sql`
    INSERT INTO "QuestionVersion" (
      "id", "questionId", "versionNumber", "status", "level",
      "subject", "questionType", "passage", "questionText",
      "correctOptionId", "explanationKo", "explanationJa",
      "difficulty", "sourceType", "rowVersion", "createdByUserId",
      "createdByLabelSnapshot", "createdAt", "updatedAt"
    )
    SELECT
      ${draftVersionId}::uuid,
      ${wrongNote.questionId}::uuid,
      COALESCE(MAX(version."versionNumber"), 0) + 1,
      'DRAFT', 'N5', 'VOCABULARY', ${currentVersion.questionType}::"QuestionType",
      NULL, 'query-plan tag decoy', NULL, 'query-plan tag decoy', NULL,
      'NORMAL', 'ORIGINAL', 1, NULL, 'SYSTEM_SEED', ${PLAN_NOW}, ${PLAN_NOW}
    FROM "QuestionVersion" AS version
    WHERE version."questionId" = ${wrongNote.questionId}::uuid
  `)
  await database.client.$executeRaw(Prisma.sql`
    WITH inserted_tag AS (
      INSERT INTO "Tag" (
        "id", "label", "normalizedName", "createdAt", "updatedAt"
      )
      SELECT
        gen_random_uuid(),
        ${tagPrefix} || '-label-' || fixture.position::text,
        ${tagPrefix} || '-normalized-' || fixture.position::text,
        ${PLAN_NOW},
        ${PLAN_NOW}
      FROM generate_series(1, 512) AS fixture(position)
      RETURNING "id", "label"
    )
    INSERT INTO "QuestionVersionTag" (
      "id", "questionVersionId", "tagId", "labelSnapshot"
    )
    SELECT
      gen_random_uuid(),
      ${draftVersionId}::uuid,
      tag."id",
      tag."label"
    FROM inserted_tag AS tag
  `)
  await database.client.$executeRawUnsafe(
    'ALTER TABLE "WrongNote" DISABLE TRIGGER USER'
  )
  await database.client.$executeRawUnsafe(
    'ALTER TABLE "ReviewEvent" DISABLE TRIGGER USER'
  )
  await database.client.$executeRawUnsafe(
    'ALTER TABLE "ReviewSchedule" DISABLE TRIGGER USER'
  )
  await database.client.$executeRawUnsafe(
    'ALTER TABLE "IdempotencyRecord" DISABLE TRIGGER USER'
  )
  try {
    await database.client.$executeRaw(Prisma.sql`
      WITH selected_question AS (
        SELECT
          question."id" AS "questionId",
          question."currentPublishedVersionId" AS "questionVersionId",
          ROW_NUMBER() OVER (ORDER BY question."id" ASC) AS ordinal
        FROM "Question" AS question
        JOIN "QuestionVersion" AS version
          ON version."id" = question."currentPublishedVersionId"
          AND version."questionId" = question."id"
          AND version."status" = 'PUBLISHED'
        WHERE question."lifecycleStatus" = 'ACTIVE'
        ORDER BY question."id" ASC
        LIMIT ${DECOY_QUESTION_COUNT + 1}
      ), decoy_owner AS (
        SELECT unnest(ARRAY[${Prisma.join(decoyUserIds)}]::uuid[]) AS "userId"
      )
      INSERT INTO "WrongNote" (
        "id", "userId", "questionId", "lastWrongQuestionVersionId",
        "currentReviewQuestionVersionId", "wrongCount", "correctStreak",
        "status", "lastWrongAt", "lastReviewedAt", "createdAt", "updatedAt"
      )
      SELECT
        gen_random_uuid(), owner."userId", question."questionId",
        question."questionVersionId", question."questionVersionId",
        1, 0, 'NEW'::"WrongNoteStatus", ${PLAN_NOW}::timestamptz,
        NULL::timestamptz,
        ${PLAN_NOW}::timestamptz, ${PLAN_NOW}::timestamptz
      FROM decoy_owner AS owner
      CROSS JOIN selected_question AS question
      WHERE question.ordinal <= ${DECOY_QUESTION_COUNT}
      UNION ALL
      SELECT
        gen_random_uuid(), ${targetUserId}::uuid, question."questionId",
        question."questionVersionId", question."questionVersionId",
        1, 0, 'NEW'::"WrongNoteStatus", ${PLAN_NOW}::timestamptz,
        NULL::timestamptz,
        ${PLAN_NOW}::timestamptz, ${PLAN_NOW}::timestamptz
      FROM selected_question AS question
      WHERE question."questionId" <> ${wrongNote.questionId}::uuid
    `)
    await database.client.$executeRaw(Prisma.sql`
      INSERT INTO "ReviewSchedule" (
        "id", "wrongNoteId", "nextReviewAt", "intervalDays",
        "algorithmVersion", "updatedAt"
      )
      SELECT
        gen_random_uuid(), note."id", ${PLAN_NOW}::timestamptz + INTERVAL '1 day',
        1, 1, ${PLAN_NOW}
      FROM "WrongNote" AS note
      WHERE note."userId" IN (${Prisma.join(userIds)})
        AND note."id" <> ${wrongNote.id}::uuid
    `)
    await database.client.$executeRaw(Prisma.sql`
      INSERT INTO "UserMemo" (
        "id", "wrongNoteId", "text", "createdAt", "updatedAt"
      )
      SELECT
        gen_random_uuid(), note."id", 'query-plan memo', ${PLAN_NOW}, ${PLAN_NOW}
      FROM "WrongNote" AS note
      WHERE note."userId" IN (${Prisma.join(memoOwnerIds)})
    `)
    await database.client.$executeRaw`
      INSERT INTO "ReviewEvent" (
        "id", "wrongNoteId", "userId", "questionId", "questionVersionId",
        "source", "studySessionId", "studyAnswerId", "selectedOptionId",
        "isCorrect", "previousStatus", "nextStatus",
        "previousCorrectStreak", "nextCorrectStreak", "previousWrongCount",
        "wrongCountAfter", "algorithmVersion", "occurredAt"
      )
      SELECT
        gen_random_uuid(), ${wrongNote.id}::uuid, ${targetUserId}::uuid,
        ${wrongNote.questionId}::uuid,
        ${wrongNote.lastWrongQuestionVersionId}::uuid,
        'VERSION_REBASE', NULL, NULL, NULL, NULL,
        'NEW', 'NEW', 0, 0, 1, 1, 1,
        ${PLAN_NOW}::timestamptz
          + fixture.sequence * INTERVAL '1 millisecond'
      FROM generate_series(1, ${HISTORY_CARDINALITY - 1}) AS fixture(sequence)
    `
    await database.client.$executeRaw`
      UPDATE "ReviewEvent"
      SET "occurredAt" = ${PLAN_NOW}::timestamptz
        + ${HISTORY_CARDINALITY} * INTERVAL '1 millisecond'
      WHERE "wrongNoteId" = ${wrongNote.id}::uuid
        AND "studyAnswerId" IS NOT NULL
    `
    await database.client.$executeRaw(Prisma.sql`
      WITH ordered_notes AS (
        SELECT
          note."id",
          note."userId",
          note."questionId",
          note."lastWrongQuestionVersionId",
          ROW_NUMBER() OVER (ORDER BY note."id" ASC) AS position
        FROM "WrongNote" AS note
        WHERE note."userId" IN (${Prisma.join(userIds)})
          AND note."id" <> ${wrongNote.id}::uuid
      )
      INSERT INTO "ReviewEvent" (
        "id", "wrongNoteId", "userId", "questionId", "questionVersionId",
        "source", "studySessionId", "studyAnswerId", "selectedOptionId",
        "isCorrect", "previousStatus", "nextStatus",
        "previousCorrectStreak", "nextCorrectStreak", "previousWrongCount",
        "wrongCountAfter", "algorithmVersion", "occurredAt"
      )
      SELECT
        gen_random_uuid(), note."id", note."userId", note."questionId",
        note."lastWrongQuestionVersionId", 'VERSION_REBASE',
        NULL, NULL, NULL, NULL, 'NEW', 'NEW', 0, 0, 1, 1, 1,
        ${PLAN_NOW}::timestamptz
          + fixture.sequence * INTERVAL '1 millisecond'
      FROM ordered_notes AS note
      CROSS JOIN LATERAL generate_series(
        1,
        CASE WHEN note.position <= ${RECONCILIATION_LIMIT} THEN 1 ELSE 4 END
      ) AS fixture(sequence)
    `)
    await database.client.$executeRaw`
      INSERT INTO "IdempotencyRecord" (
        "id", "principalType", "userId", "guestPrincipalId", "operation",
        "idempotencyKey", "studySessionId", "requestHash", "contractVersion",
        "state", "responseStatus", "responseBody", "createdAt",
        "completedAt", "expiresAt"
      )
      SELECT
        gen_random_uuid(), 'USER', ${targetUserId}::uuid, NULL,
        CASE WHEN fixture.sequence <= ${TARGETED_CARDINALITY}
          THEN 'STUDY_TARGETED_REVIEW_CREATE'::"IdempotencyOperation"
          ELSE 'STUDY_DRAFT_SAVE'::"IdempotencyOperation"
        END,
        CASE WHEN fixture.sequence = 1
          THEN ${targetedIdempotencyKey}::uuid
          ELSE gen_random_uuid()
        END,
        ${sessionId}::uuid, repeat('f', 64), 2,
        'SUCCEEDED',
        CASE WHEN fixture.sequence <= ${TARGETED_CARDINALITY} THEN 201 ELSE 200 END,
        '{}'::jsonb,
        CASE WHEN fixture.sequence <= ${TARGETED_CARDINALITY}
          THEN ${PLAN_NOW}::timestamptz - INTERVAL '8 days'
          ELSE ${PLAN_NOW}::timestamptz - INTERVAL '3 days'
        END,
        CASE WHEN fixture.sequence <= ${TARGETED_CARDINALITY}
          THEN CASE WHEN fixture.sequence <= ${CLEANUP_LIMIT}
            THEN ${PLAN_NOW}::timestamptz - INTERVAL '7 days 1 hour'
            ELSE ${PLAN_NOW}::timestamptz - INTERVAL '6 days 23 hours'
          END
          ELSE ${PLAN_NOW}::timestamptz - INTERVAL '2 days 1 hour'
        END,
        CASE
          WHEN fixture.sequence <= ${CLEANUP_LIMIT}
            OR fixture.sequence > ${TARGETED_CARDINALITY}
            THEN ${PLAN_NOW}::timestamptz - INTERVAL '1 hour'
          ELSE ${PLAN_NOW}::timestamptz + INTERVAL '1 hour'
        END
      FROM generate_series(
        1,
        ${TARGETED_CARDINALITY + IDEMPOTENCY_DECOY_CARDINALITY}
      ) AS fixture(sequence)
    `
  } finally {
    await database.client.$executeRawUnsafe(
      'ALTER TABLE "IdempotencyRecord" ENABLE TRIGGER USER'
    )
    await database.client.$executeRawUnsafe(
      'ALTER TABLE "ReviewEvent" ENABLE TRIGGER USER'
    )
    await database.client.$executeRawUnsafe(
      'ALTER TABLE "ReviewSchedule" ENABLE TRIGGER USER'
    )
    await database.client.$executeRawUnsafe(
      'ALTER TABLE "WrongNote" ENABLE TRIGGER USER'
    )
  }

  for (const tableName of [
    'WrongNote',
    'UserMemo',
    'ReviewSchedule',
    'QuestionVersionTag',
    'IdempotencyRecord'
  ]) {
    await database.client.$executeRawUnsafe(`ANALYZE "${tableName}"`)
  }
  await database.client.$executeRawUnsafe('VACUUM (ANALYZE) "ReviewEvent"')

  const historyCursor = await database.client.reviewEvent.findFirstOrThrow({
    where: { wrongNoteId: wrongNote.id },
    orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    skip: HISTORY_LIMIT - 1,
    select: { id: true, occurredAt: true }
  })
  return {
    historyCursorId: historyCursor.id,
    historyCursorOccurredAt: historyCursor.occurredAt,
    questionId: wrongNote.questionId,
    questionType: currentVersion.questionType,
    sessionId,
    tag,
    targetedIdempotencyKey,
    targetUserId,
    wrongNoteId: wrongNote.id
  }
}

beforeAll(async () => {
  await database.checkReadiness()
})

afterAll(async () => {
  if (createdDraftVersionIds.size > 0) {
    await database.client.questionVersion.deleteMany({
      where: { id: { in: [...createdDraftVersionIds] } }
    })
  }
  for (const prefix of createdTagPrefixes) {
    await database.client.tag.deleteMany({
      where: { normalizedName: { startsWith: prefix } }
    })
  }
  if (createdUserIds.size > 0) {
    for (const tableName of [
      'IdempotencyRecord',
      'ReviewEvent',
      'ReviewSchedule',
      'WrongNote'
    ]) {
      await database.client.$executeRawUnsafe(
        `ALTER TABLE "${tableName}" DISABLE TRIGGER USER`
      )
    }
    try {
      await database.client.user.deleteMany({
        where: { id: { in: [...createdUserIds] } }
      })
    } finally {
      for (const tableName of [
        'WrongNote',
        'ReviewSchedule',
        'ReviewEvent',
        'IdempotencyRecord'
      ]) {
        await database.client.$executeRawUnsafe(
          `ALTER TABLE "${tableName}" ENABLE TRIGGER USER`
        )
      }
    }
    for (const tableName of [
      'StudySession',
      'WrongNote',
      'ReviewEvent',
      'ReviewSchedule',
      'UserMemo',
      'IdempotencyRecord',
      'Question',
      'QuestionVersion'
    ]) {
      await database.client.$executeRawUnsafe(
        `VACUUM (FULL, ANALYZE) "${tableName}"`
      )
    }
  }
  await database.disconnect()
})

describe('Phase 5 review-center populated query plans', () => {
  it('memo/history/reconciliation/targeted cleanup이 bounded index plan을 선택한다', async () => {
    const fixture = await createPlanFixture()
    const rollbackSentinel = new Error('ROLLBACK_REVIEW_CENTER_PLANS')
    let plans: ReviewCenterPlans | undefined
    let reconciliationNoteCount = 0

    try {
      await database.client.$transaction(async (transaction) => {
        const reviewQueueInput = {
          userId: fixture.targetUserId,
          view: 'DUE' as const,
          level: 'N5' as const,
          subject: 'VOCABULARY' as const,
          questionType: fixture.questionType,
          tag: fixture.tag,
          sort: 'NEXT_REVIEW' as const,
          page: 1,
          pageSize: 100,
          observedAt: new Date(PLAN_NOW.getTime() + 24 * 60 * 60 * 1_000)
        }
        const reviewQueueCounts = await transaction.$queryRaw<ExplainRow[]>(
          Prisma.sql`
            EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
            ${createReviewQueueCountsQuery(reviewQueueInput)}
          `
        )
        const reviewQueueAvailableTags = await transaction.$queryRaw<
          ExplainRow[]
        >(Prisma.sql`
            EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
            ${createReviewQueueAvailableTagsQuery(reviewQueueInput)}
          `)
        const reviewQueueItems = await transaction.$queryRaw<ExplainRow[]>(
          Prisma.sql`
            EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
            ${createReviewQueueItemsQuery(reviewQueueInput, 0)}
          `
        )
        const memoRead = await transaction.$queryRaw<ExplainRow[]>(Prisma.sql`
          EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
          ${createOwnedMemoReadQuery(fixture.targetUserId, fixture.questionId)}
        `)
        const memoOwnerLock = await transaction.$queryRaw<ExplainRow[]>(
          Prisma.sql`
            EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
            ${createOwnedWrongNoteLockQuery(
              fixture.targetUserId,
              fixture.questionId
            )}
          `
        )
        const memoLookup = await transaction.$queryRaw<ExplainRow[]>(Prisma.sql`
          EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
          ${createOwnedMemoLockQuery(fixture.wrongNoteId)}
        `)
        const historyOwnerRead = await transaction.$queryRaw<ExplainRow[]>(
          Prisma.sql`
            EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
            ${createOwnedWrongNoteReadQuery(
              fixture.targetUserId,
              fixture.questionId
            )}
          `
        )
        const historyInitial = await transaction.$queryRaw<ExplainRow[]>(
          Prisma.sql`
            EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
            ${createReviewEventHistoryBatchQuery({
              wrongNoteId: fixture.wrongNoteId,
              cursor: null,
              limit: HISTORY_LIMIT
            })}
          `
        )
        const historyCursor = await transaction.$queryRaw<ExplainRow[]>(
          Prisma.sql`
            EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
            ${createReviewEventHistoryBatchQuery({
              wrongNoteId: fixture.wrongNoteId,
              cursor: {
                v: 1,
                occurredAt: fixture.historyCursorOccurredAt.toISOString(),
                id: fixture.historyCursorId
              },
              limit: HISTORY_LIMIT
            })}
          `
        )
        const reconciliationNoteQuery =
          createReviewReconciliationNoteBatchQuery({
            batchSize: RECONCILIATION_LIMIT,
            cursor: null
          })
        const reconciliationNotes = await transaction.$queryRaw<ExplainRow[]>(
          Prisma.sql`
            EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
            ${reconciliationNoteQuery}
          `
        )
        const reconciliationNoteRows = await transaction.$queryRaw<
          { id: string }[]
        >(reconciliationNoteQuery)
        reconciliationNoteCount = reconciliationNoteRows.length
        const reconciliationEvents = await transaction.$queryRaw<
          ExplainRow[]
        >(Prisma.sql`
            EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
            ${createReviewReconciliationEventBatchQuery(
              reconciliationNoteRows.map(({ id }) => id)
            )}
          `)
        await transaction.$executeRaw`
          CREATE TEMP TABLE "phase5_targeted_plan_catalog" (
            "questionId" UUID PRIMARY KEY,
            "questionVersionId" UUID UNIQUE NOT NULL
          ) ON COMMIT DROP
        `
        await transaction.$executeRaw`
          INSERT INTO "phase5_targeted_plan_catalog" (
            "questionId", "questionVersionId"
          )
          SELECT gen_random_uuid(), gen_random_uuid()
          FROM generate_series(1, ${TARGETED_CATALOG_DECOY_CARDINALITY})
        `
        await transaction.$executeRaw`
          INSERT INTO "Question" (
            "id", "lifecycleStatus", "createdByLabelSnapshot",
            "createdAt", "updatedAt"
          )
          SELECT
            "questionId", 'ACTIVE', 'SYSTEM_SEED', ${PLAN_NOW}, ${PLAN_NOW}
          FROM "phase5_targeted_plan_catalog"
        `
        await transaction.$executeRaw`
          INSERT INTO "QuestionVersion" (
            "id", "questionId", "versionNumber", "status", "level",
            "subject", "questionType", "questionText", "explanationKo",
            "difficulty", "createdByLabelSnapshot", "createdAt", "updatedAt"
          )
          SELECT
            "questionVersionId", "questionId", 1, 'DRAFT', 'N5',
            'VOCABULARY', 'KANJI_READING', 'targeted plan decoy',
            '실행 계획 전용 설명입니다.', 'EASY', 'SYSTEM_SEED',
            ${PLAN_NOW}, ${PLAN_NOW}
          FROM "phase5_targeted_plan_catalog"
        `
        await transaction.$executeRaw`ANALYZE "Question"`
        await transaction.$executeRaw`ANALYZE "QuestionVersion"`
        const targetedExistingRecord = await transaction.$queryRaw<
          ExplainRow[]
        >(Prisma.sql`
            EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
            ${createTargetedReviewExistingRecordQuery(
              fixture.targetUserId,
              fixture.targetedIdempotencyKey
            )}
          `)
        const targetedQuestionLock = await transaction.$queryRaw<ExplainRow[]>(
          Prisma.sql`
            EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
            ${createTargetedReviewQuestionLockQuery(fixture.questionId)}
          `
        )
        const targetedWrongNoteLock = await transaction.$queryRaw<ExplainRow[]>(
          Prisma.sql`
            EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
            ${createTargetedReviewWrongNoteLockQuery(
              fixture.targetUserId,
              fixture.questionId
            )}
          `
        )
        const targetedCleanup = await transaction.$queryRaw<ExplainRow[]>(
          Prisma.sql`
            EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
            WITH candidates AS MATERIALIZED (
              SELECT record."id"
              FROM "IdempotencyRecord" AS record
              WHERE record."operation" = 'STUDY_TARGETED_REVIEW_CREATE'
                AND record."state" = 'SUCCEEDED'
                AND record."expiresAt" IS NOT NULL
                AND record."expiresAt" <= ${PLAN_NOW}
              ORDER BY record."expiresAt" ASC, record."id" ASC
              LIMIT ${CLEANUP_LIMIT}
              FOR UPDATE OF record SKIP LOCKED
            )
            DELETE FROM "IdempotencyRecord" AS record
            USING candidates
            WHERE record."id" = candidates."id"
              AND record."operation" = 'STUDY_TARGETED_REVIEW_CREATE'
              AND record."state" = 'SUCCEEDED'
              AND record."expiresAt" IS NOT NULL
              AND record."expiresAt" <= ${PLAN_NOW}
            RETURNING record."id"
          `
        )
        plans = {
          memoRead,
          memoOwnerLock,
          memoLookup,
          historyOwnerRead,
          historyInitial,
          historyCursor,
          reconciliationNotes,
          reconciliationEvents,
          reviewQueueCounts,
          reviewQueueAvailableTags,
          reviewQueueItems,
          targetedCleanup,
          targetedExistingRecord,
          targetedQuestionLock,
          targetedWrongNoteLock
        }
        throw rollbackSentinel
      })
    } catch (error) {
      if (error !== rollbackSentinel) {
        throw error
      }
    }
    if (!plans) {
      throw new Error('Review-center query plans가 필요합니다.')
    }

    Object.entries(plans).forEach(([planName, plan]) =>
      expectCommonPlanEvidence(plan, planName as keyof ReviewCenterPlans)
    )
    for (const plan of [
      plans.memoRead,
      plans.memoOwnerLock,
      plans.historyOwnerRead
    ]) {
      expect(readIndexNames(plan)).toContain('WrongNote_userId_questionId_key')
      expectNoSequentialScan(plan, 'WrongNote')
      expectBoundedRelationRows(plan, 'WrongNote', 1)
    }
    for (const plan of [plans.memoRead, plans.memoLookup]) {
      expect(readIndexNames(plan)).toContain('UserMemo_wrongNoteId_key')
      expectNoSequentialScan(plan, 'UserMemo')
      expectBoundedRelationRows(plan, 'UserMemo', 1)
    }
    for (const plan of [
      plans.memoRead,
      plans.memoOwnerLock,
      plans.memoLookup,
      plans.historyOwnerRead
    ]) {
      expectPlanBuffersAtMost(plan, 64)
    }
    for (const plan of [plans.memoOwnerLock, plans.memoLookup]) {
      expect(
        readPlanNodes(plan).some(({ 'Node Type': nodeType }) =>
          ['LockRows', 'Lock'].includes(nodeType)
        )
      ).toBe(true)
    }

    for (const plan of [plans.historyInitial, plans.historyCursor]) {
      expect(readIndexNames(plan)).toContain(
        'ReviewEvent_wrongNoteId_occurredAt_id_idx'
      )
      expectNoSequentialScan(plan, 'ReviewEvent')
      expectNoSequentialScan(plan, 'StudyAnswer')
      expectBoundedRelationRows(plan, 'ReviewEvent', HISTORY_LIMIT)
      expectBoundedRelationRows(plan, 'StudyAnswer', HISTORY_LIMIT)
      expect(readIndexNames(plan)).toContain(
        'StudyAnswer_id_questionVersionId_key'
      )
      expect(readRootPlan(plan)['Actual Rows']).toBe(HISTORY_LIMIT)
      expectPlanBuffersAtMost(plan, 512)
    }
    expectRelationExecuted(plans.historyInitial, 'StudyAnswer')

    for (const plan of [
      plans.reviewQueueCounts,
      plans.reviewQueueAvailableTags,
      plans.reviewQueueItems
    ]) {
      expectNoSequentialScan(plan, 'WrongNote')
      expectBoundedRelationRows(plan, 'WrongNote', 128)
      expectBoundedRelationRows(plan, 'ReviewSchedule', 128)
      expectPlanBuffersAtMost(plan, 4_096)
    }
    expect(readRootPlan(plans.reviewQueueCounts)['Actual Rows']).toBe(1)
    expect(
      readRootPlan(plans.reviewQueueItems)['Actual Rows']
    ).toBeLessThanOrEqual(100)
    expect(readIndexNames(plans.reviewQueueItems)).toContain(
      'WrongNote_userId_questionId_key'
    )
    expect(readIndexNames(plans.reviewQueueItems)).toContain(
      'QuestionVersionTag_questionVersionId_tagId_key'
    )

    expect(readIndexNames(plans.reconciliationNotes)).toContain(
      'WrongNote_pkey'
    )
    expectNoSequentialScan(plans.reconciliationNotes, 'WrongNote')
    expectBoundedRelationRows(
      plans.reconciliationNotes,
      'WrongNote',
      RECONCILIATION_LIMIT
    )
    expect(readRootPlan(plans.reconciliationNotes)['Actual Rows']).toBe(
      RECONCILIATION_LIMIT
    )
    expect(reconciliationNoteCount).toBe(RECONCILIATION_LIMIT)
    expect(readIndexNames(plans.reconciliationEvents)).toContain(
      'ReviewEvent_wrongNoteId_occurredAt_idx'
    )
    expectNoSequentialScan(plans.reconciliationEvents, 'ReviewEvent')
    expectBoundedRelationRows(
      plans.reconciliationEvents,
      'ReviewEvent',
      RECONCILIATION_LIMIT * 8 + HISTORY_CARDINALITY
    )
    expect(
      readRootPlan(plans.reconciliationEvents)['Actual Rows']
    ).toBeGreaterThan(0)

    expect(readIndexNames(plans.targetedCleanup)).toContain(
      'IdempotencyRecord_operation_expiresAt_id_idx'
    )
    expectNoSequentialScan(plans.targetedCleanup, 'IdempotencyRecord')
    expectBoundedRelationRows(
      plans.targetedCleanup,
      'IdempotencyRecord',
      CLEANUP_LIMIT
    )
    expect(readRootPlan(plans.targetedCleanup)['Actual Rows']).toBe(
      CLEANUP_LIMIT
    )

    for (const plan of [
      plans.targetedExistingRecord,
      plans.targetedQuestionLock,
      plans.targetedWrongNoteLock
    ]) {
      expect(readRootPlan(plan)['Actual Rows']).toBe(1)
      expectPlanBuffersAtMost(plan, 64)
    }
    expect(readIndexNames(plans.targetedExistingRecord)).toContain(
      'IdempotencyRecord_user_scope_key'
    )
    expectNoSequentialScan(plans.targetedExistingRecord, 'IdempotencyRecord')
    expectBoundedRelationRows(
      plans.targetedExistingRecord,
      'IdempotencyRecord',
      1
    )

    expect(
      [...readIndexNames(plans.targetedQuestionLock)].some((indexName) =>
        [
          'Question_pkey',
          'Question_currentPublishedVersionId_key',
          'Question_id_currentPublishedVersionId_key'
        ].includes(indexName)
      )
    ).toBe(true)
    expect(
      [...readIndexNames(plans.targetedQuestionLock)].some((indexName) =>
        [
          'QuestionVersion_pkey',
          'QuestionVersion_questionId_id_key',
          'QuestionVersion_questionId_status_versionNumber_idx'
        ].includes(indexName)
      )
    ).toBe(true)
    for (const relationName of ['Question', 'QuestionVersion']) {
      expectNoSequentialScan(plans.targetedQuestionLock, relationName)
      expectBoundedRelationRows(plans.targetedQuestionLock, relationName, 1)
    }

    expect(readIndexNames(plans.targetedWrongNoteLock)).toContain(
      'WrongNote_userId_questionId_key'
    )
    for (const relationName of ['WrongNote', 'QuestionVersion']) {
      expectNoSequentialScan(plans.targetedWrongNoteLock, relationName)
      expectBoundedRelationRows(plans.targetedWrongNoteLock, relationName, 1)
    }
    for (const plan of [
      plans.targetedQuestionLock,
      plans.targetedWrongNoteLock
    ]) {
      expect(
        readPlanNodes(plan).some(({ 'Node Type': nodeType }) =>
          ['LockRows', 'Lock'].includes(nodeType)
        )
      ).toBe(true)
    }

    const expectedReconciliationCount = await database.client.wrongNote.count()
    const reconciliationResult =
      await createPrismaReviewReconciliationRepository(
        database.client
      ).reconcile({ batchSize: RECONCILIATION_LIMIT })
    expect(reconciliationResult.scannedWrongNoteCount).toBe(
      expectedReconciliationCount
    )
    expect(reconciliationResult.scannedWrongNoteCount).toBeGreaterThan(
      RECONCILIATION_LIMIT
    )
    expect(fixture.sessionId).toMatch(/^[0-9a-f-]{36}$/u)
  }, 15_000)
})

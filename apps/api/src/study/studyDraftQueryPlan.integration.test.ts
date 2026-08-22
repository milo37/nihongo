import { createHash, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseApiEnvironment } from '../config/env.js'
import { createDatabaseRuntime } from '../db/database.js'
import { assertSafeTestDatabase } from '../db/databaseTargetGuard.js'
import { Prisma } from '../generated/prisma/client.js'
import { createPrismaStudyResultRetryRepository } from './studyResultRetryRepository.js'
import { createStudyResultRetryService } from './studyResultRetryService.js'
import { createPrismaStudySessionRepository } from './studySessionRepository.js'
import { createPrismaStudySubmissionRepository } from './studySubmissionRepository.js'
import { createStudySubmissionService } from './studySubmissionService.js'

interface ExplainRow {
  'QUERY PLAN': unknown
}

interface FixtureReference {
  readonly questionVersionId: string
  readonly sessionId: string
  readonly sessionQuestionId: string
}

interface RetryFixtureReference {
  readonly sourceSessionId: string
  readonly targetSessionId: string
}

interface PlanNode extends Record<string, unknown> {
  'Node Type': string
}

interface QueryPlans {
  readonly childDelete: ExplainRow[]
  readonly childLookup: ExplainRow[]
  readonly coldCleanup: ExplainRow[]
  readonly guestResumable: ExplainRow[]
  readonly guestResumableOwnerScan: ExplainRow[]
  readonly idempotencyCleanup: ExplainRow[]
  readonly retryIdempotencyCleanup: ExplainRow[]
  readonly retryLeafCleanup: ExplainRow[]
  readonly retryLeafLookup: ExplainRow[]
  readonly userResumable: ExplainRow[]
  readonly userResumableOwnerScan: ExplainRow[]
}

const FIXTURE_CARDINALITY = 640
const USER_OWNER_CARDINALITY = 32
const GUEST_OWNER_CARDINALITY = 32
const EXPIRED_IDEMPOTENCY_CARDINALITY = 32
const CLEANUP_LIMIT = 500
const PAGE_SIZE = 20

const environment = parseApiEnvironment(process.env)
assertSafeTestDatabase({
  nodeEnvironment: environment.NODE_ENV,
  databaseUrl: environment.DATABASE_URL,
  productionDatabaseUrl: process.env.PRODUCTION_DATABASE_URL
})

const database = createDatabaseRuntime(environment.DATABASE_URL)
const createdUserIds = new Set<string>()
const createdGuestIds = new Set<string>()

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

const readIndexNamesForAlias = (
  rows: ExplainRow[],
  relationName: string,
  alias: string
): Set<string> =>
  new Set(
    readPlanNodes(rows).flatMap((node) =>
      node['Relation Name'] === relationName &&
      node.Alias === alias &&
      typeof node['Index Name'] === 'string'
        ? [node['Index Name']]
        : []
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
  const sequentialScans = readPlanNodes(rows).filter(
    (node) =>
      node['Node Type'] === 'Seq Scan' && node['Relation Name'] === relationName
  )
  expect(
    sequentialScans,
    `${relationName} sequential scans: ${JSON.stringify(sequentialScans)}`
  ).toHaveLength(0)
}

const expectNoSequentialScanForAlias = (
  rows: ExplainRow[],
  relationName: string,
  alias: string
): void => {
  const sequentialScans = readPlanNodes(rows).filter(
    (node) =>
      node['Node Type'] === 'Seq Scan' &&
      node['Relation Name'] === relationName &&
      node.Alias === alias
  )
  expect(
    sequentialScans,
    `${relationName} ${alias} sequential scans: ${JSON.stringify(sequentialScans)}`
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

const digestGuestToken = (guestPrincipalId: string): string =>
  createHash('sha256').update(guestPrincipalId).digest('hex')

const analyzeFixtureTables = async (): Promise<void> => {
  await database.client.$executeRaw`ANALYZE "StudySession"`
  await database.client.$executeRaw`ANALYZE "StudyDraft"`
  await database.client.$executeRaw`ANALYZE "StudyDraftAnswer"`
  await database.client.$executeRaw`ANALYZE "IdempotencyRecord"`
}

const createRepresentativeFixture = async ({
  decoyUserId,
  now,
  ownerScanGuestId,
  ownerScanUserId,
  targetGuestId,
  targetUserId
}: {
  readonly decoyUserId: string
  readonly now: Date
  readonly ownerScanGuestId: string
  readonly ownerScanUserId: string
  readonly targetGuestId: string
  readonly targetUserId: string
}): Promise<FixtureReference> => {
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

  return await database.client.$transaction(async (transaction) => {
    await transaction.$executeRaw`
      CREATE TEMP TABLE "slice1_query_plan_fixture" (
        "kind" TEXT NOT NULL,
        "sequence" INTEGER NOT NULL,
        "sessionId" UUID PRIMARY KEY,
        "sessionQuestionId" UUID NOT NULL,
        "userId" UUID,
        "guestPrincipalId" UUID,
        "startedAt" TIMESTAMPTZ(3) NOT NULL,
        "expiresAt" TIMESTAMPTZ(3) NOT NULL,
        "savedAt" TIMESTAMPTZ(3)
      ) ON COMMIT DROP`
    await transaction.$executeRaw`
      INSERT INTO "slice1_query_plan_fixture" (
        "kind", "sequence", "sessionId", "sessionQuestionId", "userId",
        "guestPrincipalId", "startedAt", "expiresAt", "savedAt"
      )
      SELECT
        fixture.kind,
        fixture.sequence,
        gen_random_uuid(),
        gen_random_uuid(),
        CASE
          WHEN fixture.kind = 'USER_RESUMABLE' THEN ${targetUserId}::uuid
          WHEN fixture.kind = 'USER_OWNER_SCAN' THEN ${ownerScanUserId}::uuid
          WHEN fixture.kind IN ('GUEST_RESUMABLE', 'GUEST_OWNER_SCAN') THEN NULL
          ELSE ${decoyUserId}::uuid
        END,
        CASE
          WHEN fixture.kind = 'GUEST_RESUMABLE' THEN ${targetGuestId}::uuid
          WHEN fixture.kind = 'GUEST_OWNER_SCAN' THEN ${ownerScanGuestId}::uuid
          ELSE NULL
        END,
        CASE
          WHEN fixture.kind = 'COLD' THEN
            ${now}::timestamptz - INTERVAL '27 hours'
              - fixture.sequence * INTERVAL '1 millisecond'
          ELSE
            ${now}::timestamptz - INTERVAL '72 hours'
              - fixture.sequence * INTERVAL '1 millisecond'
        END,
        CASE
          WHEN fixture.kind = 'COLD' THEN
            ${now}::timestamptz - INTERVAL '26 hours'
              - fixture.sequence * INTERVAL '1 millisecond'
          ELSE
            ${now}::timestamptz + INTERVAL '24 hours'
              + fixture.sequence * INTERVAL '1 millisecond'
        END,
        CASE
          WHEN fixture.kind = 'IDEM_EXPIRED' THEN
            ${now}::timestamptz - INTERVAL '49 hours'
              - fixture.sequence * INTERVAL '1 millisecond'
          WHEN fixture.kind IN (
            'USER_RESUMABLE',
            'USER_OWNER_SCAN',
            'GUEST_RESUMABLE',
            'GUEST_OWNER_SCAN'
          )
            OR (fixture.kind = 'FILLER' AND fixture.sequence <= 256) THEN
            ${now}::timestamptz - INTERVAL '1 hour'
              - fixture.sequence * INTERVAL '1 millisecond'
          ELSE NULL
        END
      FROM (
        SELECT 'USER_RESUMABLE'::text AS kind, generate_series(1, 32) AS sequence
        UNION ALL
        SELECT 'GUEST_RESUMABLE', generate_series(1, 32)
        UNION ALL
        SELECT 'USER_OWNER_SCAN', generate_series(1, 128)
        UNION ALL
        SELECT 'GUEST_OWNER_SCAN', generate_series(1, 128)
        UNION ALL
        SELECT 'FILLER', generate_series(1, 256)
        UNION ALL
        SELECT 'IDEM_EXPIRED', generate_series(1, 32)
        UNION ALL
        SELECT 'COLD', generate_series(1, 32)
      ) AS fixture`
    await transaction.$executeRaw`
      INSERT INTO "StudySession" (
        "id", "userId", "guestPrincipalId", "level", "subject", "mode",
        "status", "requestedCount", "actualCount", "usedFallback",
        "startedAt", "expiresAt", "practiceContractVersion", "createdAt",
        "updatedAt"
      )
      SELECT
        fixture."sessionId", fixture."userId", fixture."guestPrincipalId",
        'N5', 'VOCABULARY', 'RANDOM', 'IN_PROGRESS', 1, 1, false,
        fixture."startedAt", fixture."expiresAt", 2,
        fixture."startedAt", fixture."startedAt"
      FROM "slice1_query_plan_fixture" AS fixture`
    await transaction.$executeRaw`
      INSERT INTO "StudySessionQuestion" (
        "id", "studySessionId", "questionId", "questionVersionId",
        "ordinal", "createdAt"
      )
      SELECT
        fixture."sessionQuestionId", fixture."sessionId",
        ${question.id}::uuid, ${question.currentPublishedVersionId}::uuid,
        1, fixture."startedAt"
      FROM "slice1_query_plan_fixture" AS fixture`
    await transaction.$executeRaw`
      INSERT INTO "StudyDraft" (
        "studySessionId", "revision", "currentOrdinal", "savedAt",
        "createdAt", "updatedAt"
      )
      SELECT
        fixture."sessionId", 0, 1, NULL,
        fixture."startedAt", fixture."startedAt"
      FROM "slice1_query_plan_fixture" AS fixture`
    await transaction.$executeRaw`
      INSERT INTO "StudyDraftAnswer" (
        "studySessionId", "studySessionQuestionId", "questionVersionId",
        "selectedOptionId", "elapsedSec", "updatedAt"
      )
      SELECT
        fixture."sessionId", fixture."sessionQuestionId",
        ${question.currentPublishedVersionId}::uuid, NULL, 0,
        fixture."startedAt"
      FROM "slice1_query_plan_fixture" AS fixture`
    await transaction.$executeRaw`
      UPDATE "StudyDraft" AS draft
      SET
        "revision" = 1,
        "savedAt" = fixture."savedAt",
        "updatedAt" = fixture."savedAt"
      FROM "slice1_query_plan_fixture" AS fixture
      WHERE draft."studySessionId" = fixture."sessionId"
        AND fixture."savedAt" IS NOT NULL`
    await transaction.$executeRaw`
      UPDATE "StudyDraftAnswer" AS answer
      SET "updatedAt" = fixture."savedAt"
      FROM "slice1_query_plan_fixture" AS fixture
      WHERE answer."studySessionId" = fixture."sessionId"
        AND fixture."savedAt" IS NOT NULL`
    await transaction.$executeRaw`
      INSERT INTO "IdempotencyRecord" (
        "id", "principalType", "userId", "guestPrincipalId", "operation",
        "idempotencyKey", "studySessionId", "requestHash", "contractVersion",
        "state", "createdAt"
      )
      SELECT
        gen_random_uuid(),
        CASE
          WHEN fixture."guestPrincipalId" IS NULL THEN
            'USER'::"IdempotencyPrincipalType"
          ELSE 'GUEST'::"IdempotencyPrincipalType"
        END,
        fixture."userId", fixture."guestPrincipalId", 'STUDY_DRAFT_SAVE',
        gen_random_uuid(), fixture."sessionId", repeat('a', 64), 2,
        'PROCESSING', fixture."savedAt"
      FROM "slice1_query_plan_fixture" AS fixture
      WHERE fixture."savedAt" IS NOT NULL`
    await transaction.$executeRaw`
      UPDATE "IdempotencyRecord" AS record
      SET
        "state" = 'SUCCEEDED',
        "responseStatus" = 200,
        "responseBody" = jsonb_build_object(
          'studySessionId', fixture."sessionId",
          'revision', 1,
          'currentOrdinal', 1,
          'savedAt', fixture."savedAt",
          'answers', jsonb_build_array(jsonb_build_object(
            'studySessionQuestionId', fixture."sessionQuestionId",
            'selectedOptionId', NULL,
            'elapsedSec', 0
          ))
        ),
        "completedAt" = fixture."savedAt",
        "expiresAt" = fixture."savedAt" + INTERVAL '48 hours'
      FROM "slice1_query_plan_fixture" AS fixture
      WHERE record."studySessionId" = fixture."sessionId"
        AND record."operation" = 'STUDY_DRAFT_SAVE'
        AND fixture."savedAt" IS NOT NULL`

    const references = await transaction.$queryRaw<FixtureReference[]>`
      SELECT
        fixture."sessionId",
        fixture."sessionQuestionId",
        ${question.currentPublishedVersionId}::uuid AS "questionVersionId"
      FROM "slice1_query_plan_fixture" AS fixture
      WHERE fixture."kind" = 'COLD'
      ORDER BY fixture."sequence" ASC
      LIMIT 1`
    const reference = references[0]
    if (!reference) {
      throw new Error('Cold cleanup query-plan fixture가 필요합니다.')
    }
    return reference
  })
}

const createExpiredRetryFixture = async (
  userId: string,
  now: Date
): Promise<RetryFixtureReference> => {
  const source = (
    await createPrismaStudySessionRepository(database.client).createRandom({
      owner: { kind: 'USER', userId },
      level: 'N5',
      subject: 'VOCABULARY',
      requestedCount: 1,
      startedAt: new Date(now.getTime() - 9 * 24 * 60 * 60 * 1_000),
      expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1_000),
      practiceContractVersion: 1
    })
  ).session
  await createStudySubmissionService(
    createPrismaStudySubmissionRepository(database.client),
    () => new Date(now.getTime() - 8 * 24 * 60 * 60 * 1_000)
  ).submit(
    source.id,
    randomUUID(),
    {
      answers: source.questions.map(({ sessionQuestionId }) => ({
        studySessionQuestionId: sessionQuestionId,
        selectedOptionId: null,
        elapsedSec: 0
      })),
      durationSec: 0
    },
    { kind: 'USER', userId }
  )
  const retry = await createStudyResultRetryService(
    createPrismaStudyResultRetryRepository(database.client),
    () => new Date(now.getTime() - 7 * 24 * 60 * 60 * 1_000)
  ).create(source.id, randomUUID(), { kind: 'USER', userId })
  return {
    sourceSessionId: source.id,
    targetSessionId: retry.response.session.id
  }
}

const createExpiredGuestRetryFixture = async (
  guestPrincipalId: string,
  now: Date
): Promise<RetryFixtureReference> => {
  const owner = {
    kind: 'GUEST' as const,
    guestPrincipalId,
    tokenDigest: digestGuestToken(guestPrincipalId)
  }
  const startedAt = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1_000)
  const source = (
    await createPrismaStudySessionRepository(database.client).createRandom({
      owner,
      level: 'N5',
      subject: 'VOCABULARY',
      requestedCount: 1,
      startedAt,
      expiresAt: new Date(now.getTime() - 8 * 24 * 60 * 60 * 1_000),
      practiceContractVersion: 1
    })
  ).session
  await createStudySubmissionService(
    createPrismaStudySubmissionRepository(database.client),
    () => new Date(now.getTime() - 9 * 24 * 60 * 60 * 1_000)
  ).submit(
    source.id,
    randomUUID(),
    {
      answers: source.questions.map(({ sessionQuestionId }) => ({
        studySessionQuestionId: sessionQuestionId,
        selectedOptionId: null,
        elapsedSec: 0
      })),
      durationSec: 0
    },
    owner
  )
  const retry = await createStudyResultRetryService(
    createPrismaStudyResultRetryRepository(database.client),
    () => new Date(now.getTime() - 8 * 24 * 60 * 60 * 1_000)
  ).create(source.id, randomUUID(), owner)
  return {
    sourceSessionId: source.id,
    targetSessionId: retry.response.session.id
  }
}

beforeAll(async () => {
  await database.checkReadiness()
})

afterAll(async () => {
  if (createdGuestIds.size > 0) {
    await database.client.guestPrincipal.deleteMany({
      where: { id: { in: [...createdGuestIds] } }
    })
  }
  if (createdUserIds.size > 0) {
    await database.client.user.deleteMany({
      where: { id: { in: [...createdUserIds] } }
    })
  }
  await analyzeFixtureTables()
  await database.disconnect()
})

describe('Phase 4 representative PostgreSQL query plans', () => {
  it('기본 planner가 resumable·cleanup·child FK index와 bounded sort를 선택한다', async () => {
    const now = new Date()
    const [targetUser, ownerScanUser, decoyUser] = await Promise.all(
      ['target', 'owner-scan', 'decoy'].map(
        async (kind) =>
          await database.client.user.create({
            data: {
              name: `Slice 1 query plan ${kind} user`,
              email: `slice1-plan-${kind}-${randomUUID()}@example.test`,
              emailVerified: true
            },
            select: { id: true }
          })
      )
    )
    if (!targetUser || !ownerScanUser || !decoyUser) {
      throw new Error('Query plan users가 필요합니다.')
    }
    createdUserIds.add(targetUser.id)
    createdUserIds.add(ownerScanUser.id)
    createdUserIds.add(decoyUser.id)

    const targetGuestId = randomUUID()
    const ownerScanGuestId = randomUUID()
    const oldGuestTimestamp = new Date(
      now.getTime() - 11 * 24 * 60 * 60 * 1_000
    )
    await database.client.guestPrincipal.createMany({
      data: [
        {
          id: targetGuestId,
          tokenDigest: digestGuestToken(targetGuestId),
          expiresAt: new Date(
            oldGuestTimestamp.getTime() + 7 * 24 * 60 * 60 * 1_000
          ),
          createdAt: oldGuestTimestamp,
          lastSeenAt: oldGuestTimestamp
        },
        {
          id: ownerScanGuestId,
          tokenDigest: digestGuestToken(ownerScanGuestId),
          expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1_000),
          createdAt: now,
          lastSeenAt: now
        }
      ]
    })
    createdGuestIds.add(targetGuestId)
    createdGuestIds.add(ownerScanGuestId)

    const childReference = await createRepresentativeFixture({
      targetUserId: targetUser.id,
      targetGuestId,
      ownerScanGuestId,
      ownerScanUserId: ownerScanUser.id,
      decoyUserId: decoyUser.id,
      now
    })
    const retryReference = await createExpiredRetryFixture(decoyUser.id, now)
    const guestRetryReference = await createExpiredGuestRetryFixture(
      targetGuestId,
      now
    )
    await analyzeFixtureTables()

    const plannerSettings = await database.client.$queryRaw<
      { enableSeqscan: string; enableSort: string }[]
    >`
        SELECT
          current_setting('enable_seqscan') AS "enableSeqscan",
          current_setting('enable_sort') AS "enableSort"`
    expect(plannerSettings).toEqual([{ enableSeqscan: 'on', enableSort: 'on' }])

    const rollbackSentinel = new Error('ROLLBACK_QUERY_PLAN_SIDE_EFFECTS')
    let plans: QueryPlans | undefined
    try {
      await database.client.$transaction(async (transaction) => {
        const userResumableOwnerScan = await transaction.$queryRaw<
          ExplainRow[]
        >(Prisma.sql`
            EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
            SELECT session."id", session."expiresAt"
            FROM "StudySession" AS session
            WHERE session."userId" = ${ownerScanUser.id}::uuid
              AND session."status" = 'IN_PROGRESS'
              AND session."expiresAt" > ${now}
            ORDER BY session."startedAt" DESC, session."id" ASC
            LIMIT ${PAGE_SIZE}
          `)
        const guestResumableOwnerScan = await transaction.$queryRaw<
          ExplainRow[]
        >(Prisma.sql`
            EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
            SELECT session."id", session."expiresAt"
            FROM "StudySession" AS session
            WHERE session."guestPrincipalId" = ${ownerScanGuestId}::uuid
              AND session."status" = 'IN_PROGRESS'
              AND session."expiresAt" > ${now}
            ORDER BY session."startedAt" DESC, session."id" ASC
            LIMIT ${PAGE_SIZE}
          `)
        const userResumable = await transaction.$queryRaw<ExplainRow[]>(
          Prisma.sql`
              EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
              SELECT session."id"
              FROM "StudySession" AS session
              LEFT JOIN "StudyDraft" AS draft
                ON draft."studySessionId" = session."id"
              WHERE session."userId" = ${targetUser.id}::uuid
                AND session."status" = 'IN_PROGRESS'
                AND session."expiresAt" > ${now}
              ORDER BY
                draft."savedAt" DESC NULLS LAST,
                session."startedAt" DESC,
                session."id" ASC
              LIMIT ${PAGE_SIZE}
            `
        )
        const guestResumable = await transaction.$queryRaw<ExplainRow[]>(
          Prisma.sql`
              EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
              SELECT session."id"
              FROM "StudySession" AS session
              LEFT JOIN "StudyDraft" AS draft
                ON draft."studySessionId" = session."id"
              WHERE session."guestPrincipalId" = ${targetGuestId}::uuid
                AND session."status" = 'IN_PROGRESS'
                AND session."expiresAt" > ${now}
              ORDER BY
                draft."savedAt" DESC NULLS LAST,
                session."startedAt" DESC,
                session."id" ASC
              LIMIT ${PAGE_SIZE}
            `
        )
        const coldCleanup = await transaction.$queryRaw<ExplainRow[]>(
          Prisma.sql`
              EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
              SELECT session."id"
              FROM "StudySession" AS session
              JOIN "StudyDraft" AS draft
                ON draft."studySessionId" = session."id"
              WHERE session."practiceContractVersion" = 2
                AND session."status" = 'IN_PROGRESS'
                AND session."expiresAt" <=
                  ${new Date(now.getTime() - 24 * 60 * 60 * 1_000)}
              ORDER BY session."expiresAt" ASC, session."id" ASC
              LIMIT ${CLEANUP_LIMIT}
              FOR UPDATE OF session SKIP LOCKED
            `
        )
        const childLookup = await transaction.$queryRaw<ExplainRow[]>(
          Prisma.sql`
              EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
              SELECT answer."studySessionId"
              FROM "StudyDraftAnswer" AS answer
              WHERE answer."studySessionQuestionId" =
                ${childReference.sessionQuestionId}::uuid
                AND answer."questionVersionId" =
                  ${childReference.questionVersionId}::uuid
            `
        )
        await transaction.studySession.update({
          where: { id: childReference.sessionId },
          data: { status: 'EXPIRED', updatedAt: now }
        })
        const childDelete = await transaction.$queryRaw<ExplainRow[]>(
          Prisma.sql`
              EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
              DELETE FROM "StudyDraftAnswer" AS answer
              WHERE answer."studySessionQuestionId" =
                ${childReference.sessionQuestionId}::uuid
                AND answer."questionVersionId" =
                  ${childReference.questionVersionId}::uuid
              RETURNING answer."studySessionId"
            `
        )
        const idempotencyCleanup = await transaction.$queryRaw<ExplainRow[]>(
          Prisma.sql`
              EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
              WITH candidates AS MATERIALIZED (
                SELECT record."id"
                FROM "IdempotencyRecord" AS record
                WHERE record."operation" = 'STUDY_DRAFT_SAVE'
                  AND record."state" = 'SUCCEEDED'
                  AND record."expiresAt" IS NOT NULL
                  AND record."expiresAt" <= ${now}
                ORDER BY record."expiresAt" ASC, record."id" ASC
                LIMIT ${CLEANUP_LIMIT}
                FOR UPDATE OF record SKIP LOCKED
              )
              DELETE FROM "IdempotencyRecord" AS record
              USING candidates
              WHERE record."id" = candidates."id"
                AND record."operation" = 'STUDY_DRAFT_SAVE'
                AND record."state" = 'SUCCEEDED'
                AND record."expiresAt" IS NOT NULL
                AND record."expiresAt" <= ${now}
              RETURNING record."id"
            `
        )
        const retryIdempotencyCleanup = await transaction.$queryRaw<
          ExplainRow[]
        >(Prisma.sql`
            EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
            WITH candidates AS MATERIALIZED (
              SELECT record."id"
              FROM "IdempotencyRecord" AS record
              WHERE record."operation" = 'STUDY_RETRY_CREATE'
                AND record."state" = 'SUCCEEDED'
                AND record."expiresAt" IS NOT NULL
                AND record."expiresAt" <= ${now}
              ORDER BY record."expiresAt" ASC, record."id" ASC
              LIMIT ${CLEANUP_LIMIT}
              FOR UPDATE OF record SKIP LOCKED
            )
            DELETE FROM "IdempotencyRecord" AS record
            USING candidates
            WHERE record."id" = candidates."id"
              AND record."operation" = 'STUDY_RETRY_CREATE'
              AND record."state" = 'SUCCEEDED'
              AND record."expiresAt" IS NOT NULL
              AND record."expiresAt" <= ${now}
            RETURNING record."id"
          `)
        const retryLeafLookup = await transaction.$queryRaw<ExplainRow[]>(
          Prisma.sql`
            EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
            SELECT retry."id"
            FROM "StudySession" AS retry
            WHERE retry."retryOfStudySessionId" =
              ${retryReference.sourceSessionId}::uuid
            ORDER BY retry."id" ASC
            LIMIT ${CLEANUP_LIMIT}
          `
        )
        const retryLeafCleanup = await transaction.$queryRaw<ExplainRow[]>(
          Prisma.sql`
            EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
            WITH guest_candidates AS MATERIALIZED (
              SELECT guest."id"
              FROM "GuestPrincipal" AS guest
              WHERE EXISTS (
                SELECT 1
                FROM "StudySession" AS session
                WHERE session."guestPrincipalId" = guest."id"
                  AND session."userId" IS NULL
                  AND (
                    (
                      session."status" = 'SUBMITTED'
                      AND session."submittedAt" IS NOT NULL
                      AND session."submittedAt" <=
                        ${now}::timestamptz - INTERVAL '7 days'
                    )
                    OR (
                      session."status" IN (
                        'IN_PROGRESS',
                        'CANCELLED',
                        'EXPIRED'
                      )
                      AND session."expiresAt" <= ${now}
                    )
                  )
                  AND NOT EXISTS (
                    SELECT 1
                    FROM "IdempotencyRecord" AS record
                    WHERE record."studySessionId" = session."id"
                      AND record."state" = 'SUCCEEDED'
                      AND record."expiresAt" IS NOT NULL
                      AND record."expiresAt" > ${now}
                  )
                  AND NOT EXISTS (
                    SELECT 1
                    FROM "StudySession" AS retry
                    WHERE retry."retryOfStudySessionId" = session."id"
                  )
              )
              ORDER BY guest."id" ASC
              LIMIT ${CLEANUP_LIMIT}
              FOR NO KEY UPDATE OF guest SKIP LOCKED
            ),
            session_candidates AS MATERIALIZED (
              SELECT session."id"
              FROM "StudySession" AS session
              JOIN guest_candidates AS guest
                ON guest."id" = session."guestPrincipalId"
              WHERE session."userId" IS NULL
                AND session."guestPrincipalId" IS NOT NULL
                AND (
                  (
                    session."status" = 'SUBMITTED'
                    AND session."submittedAt" IS NOT NULL
                    AND session."submittedAt" <=
                      ${now}::timestamptz - INTERVAL '7 days'
                  )
                  OR (
                    session."status" IN (
                      'IN_PROGRESS',
                      'CANCELLED',
                      'EXPIRED'
                    )
                    AND session."expiresAt" <= ${now}
                  )
                )
                AND NOT EXISTS (
                  SELECT 1
                  FROM "IdempotencyRecord" AS record
                  WHERE record."studySessionId" = session."id"
                    AND record."state" = 'SUCCEEDED'
                    AND record."expiresAt" IS NOT NULL
                    AND record."expiresAt" > ${now}
                )
                AND NOT EXISTS (
                  SELECT 1
                  FROM "StudySession" AS retry
                  WHERE retry."retryOfStudySessionId" = session."id"
                )
              ORDER BY
                session."guestPrincipalId" ASC,
                COALESCE(session."submittedAt", session."expiresAt") ASC,
                session."id" ASC
              LIMIT ${CLEANUP_LIMIT}
              FOR UPDATE OF session
            )
            DELETE FROM "StudySession" AS session
            USING session_candidates AS candidates
            WHERE session."id" = candidates."id"
              AND session."userId" IS NULL
              AND session."guestPrincipalId" IS NOT NULL
              AND (
                (
                  session."status" = 'SUBMITTED'
                  AND session."submittedAt" IS NOT NULL
                  AND session."submittedAt" <=
                    ${now}::timestamptz - INTERVAL '7 days'
                )
                OR (
                  session."status" IN (
                    'IN_PROGRESS',
                    'CANCELLED',
                    'EXPIRED'
                  )
                  AND session."expiresAt" <= ${now}
                )
              )
              AND NOT EXISTS (
                SELECT 1
                FROM "IdempotencyRecord" AS record
                WHERE record."studySessionId" = session."id"
                  AND record."state" = 'SUCCEEDED'
                  AND record."expiresAt" IS NOT NULL
                  AND record."expiresAt" > ${now}
              )
              AND NOT EXISTS (
                SELECT 1
                FROM "StudySession" AS retry
                WHERE retry."retryOfStudySessionId" = session."id"
              )
            RETURNING session."id"
          `
        )

        plans = {
          userResumableOwnerScan,
          guestResumableOwnerScan,
          userResumable,
          guestResumable,
          coldCleanup,
          idempotencyCleanup,
          retryIdempotencyCleanup,
          retryLeafCleanup,
          retryLeafLookup,
          childLookup,
          childDelete
        }
        throw rollbackSentinel
      })
    } catch (error) {
      if (error !== rollbackSentinel) {
        throw error
      }
    }
    if (!plans) {
      throw new Error('Query plan capture가 필요합니다.')
    }

    Object.values(plans).forEach(assertCommonPlanEvidence)
    expect(readRootPlan(plans.userResumableOwnerScan)['Actual Rows']).toBe(
      PAGE_SIZE
    )
    expect(readRootPlan(plans.guestResumableOwnerScan)['Actual Rows']).toBe(
      PAGE_SIZE
    )
    expect(readIndexNames(plans.userResumableOwnerScan)).toContain(
      'StudySession_userId_startedAt_id_resumable_idx'
    )
    const guestOwnerIndexes = readIndexNames(plans.guestResumableOwnerScan)
    expect(
      guestOwnerIndexes,
      `guest resumable indexes: ${[...guestOwnerIndexes].join(', ')}`
    ).toContain('StudySession_guestPrincipalId_startedAt_id_resumable_idx')
    ;[
      plans.userResumableOwnerScan,
      plans.userResumable,
      plans.coldCleanup
    ].forEach((plan) => expectNoSequentialScan(plan, 'StudySession'))
    ;[plans.guestResumableOwnerScan, plans.guestResumable].forEach((plan) =>
      expectNoSequentialScan(plan, 'StudySession')
    )
    expectBoundedRelationRows(
      plans.userResumable,
      'StudySession',
      USER_OWNER_CARDINALITY
    )
    expectBoundedRelationRows(
      plans.guestResumable,
      'StudySession',
      GUEST_OWNER_CARDINALITY
    )
    expectBoundedRelationRows(
      plans.userResumable,
      'StudyDraft',
      FIXTURE_CARDINALITY + 2
    )
    expectBoundedRelationRows(
      plans.guestResumable,
      'StudyDraft',
      FIXTURE_CARDINALITY + 2
    )
    expect(readIndexNames(plans.coldCleanup)).toContain(
      'StudySession_status_expiresAt_idx'
    )
    expectBoundedRelationRows(
      plans.coldCleanup,
      'StudySession',
      FIXTURE_CARDINALITY
    )
    expect(readIndexNames(plans.idempotencyCleanup)).toContain(
      'IdempotencyRecord_operation_expiresAt_id_idx'
    )
    expectNoSequentialScan(plans.idempotencyCleanup, 'IdempotencyRecord')
    expectBoundedRelationRows(
      plans.idempotencyCleanup,
      'IdempotencyRecord',
      EXPIRED_IDEMPOTENCY_CARDINALITY
    )
    expect(readIndexNames(plans.retryIdempotencyCleanup)).toContain(
      'IdempotencyRecord_operation_expiresAt_id_idx'
    )
    expectNoSequentialScan(plans.retryIdempotencyCleanup, 'IdempotencyRecord')
    expectBoundedRelationRows(
      plans.retryIdempotencyCleanup,
      'IdempotencyRecord',
      2
    )
    expect(readIndexNames(plans.retryLeafLookup)).toContain(
      'StudySession_retryOfStudySessionId_id_idx'
    )
    expectNoSequentialScan(plans.retryLeafLookup, 'StudySession')
    expectBoundedRelationRows(plans.retryLeafLookup, 'StudySession', 1)
    expect(readRootPlan(plans.retryLeafLookup)['Actual Rows']).toBe(1)
    expect(
      readIndexNamesForAlias(plans.retryLeafCleanup, 'StudySession', 'retry')
    ).toContain('StudySession_retryOfStudySessionId_id_idx')
    expectNoSequentialScanForAlias(
      plans.retryLeafCleanup,
      'StudySession',
      'retry'
    )
    expectBoundedRelationRows(
      plans.retryLeafCleanup,
      'StudySession',
      FIXTURE_CARDINALITY
    )
    expect(readRootPlan(plans.retryLeafCleanup)['Actual Rows']).toBe(1)
    expect(guestRetryReference.targetSessionId).toMatch(/^[0-9a-f-]{36}$/u)
    expect(
      retryReference.targetSessionId,
      'retry target fixture가 필요합니다.'
    ).toMatch(/^[0-9a-f-]{36}$/u)
    ;[plans.childLookup, plans.childDelete].forEach((plan) => {
      expect(readIndexNames(plan)).toContain(
        'StudyDraftAnswer_studySessionQuestionId_questionVersionId_idx'
      )
      expectNoSequentialScan(plan, 'StudyDraftAnswer')
      expectBoundedRelationRows(plan, 'StudyDraftAnswer', 1)
    })
  }, 60_000)
})

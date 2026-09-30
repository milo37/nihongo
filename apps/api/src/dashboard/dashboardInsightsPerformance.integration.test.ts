import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { getDashboardInsightsResponseSchema } from '@nihongo/contracts/dashboard/get-dashboard-insights'
import { Hono } from 'hono'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PrincipalService } from '../auth/principalService.js'
import { parseApiEnvironment } from '../config/env.js'
import {
  createDatabaseRuntime,
  createRoleDatabaseRuntime
} from '../db/database.js'
import { assertSafeTestDatabase } from '../db/databaseTargetGuard.js'
import {
  Prisma,
  type JlptLevel,
  type PrismaClient,
  type QuestionSubject
} from '../generated/prisma/client.js'
import {
  createPrismaStudySessionRepository,
  type ExistingStudyOwner
} from '../study/studySessionRepository.js'
import { createPrismaStudySubmissionRepository } from '../study/studySubmissionRepository.js'
import { createStudySubmissionService } from '../study/studySubmissionService.js'
import {
  createPhase10TimingMeasurement,
  phase10ApiPerformanceBudget,
  phase10DatabasePerformanceBudget,
  writePhase10DatabaseApiPerformanceEvidence
} from '../e2e/phase10PerformanceEvidence.js'
import type { ApplicationRateLimiter } from '../middleware/applicationRateLimiter.js'
import type { ApiVariables } from '../middleware/requestContext.js'
import { createDashboardInsightsRoutes } from '../routes/dashboardInsights.js'
import {
  createDashboardInsightsClockQuery,
  createDashboardInsightsNonTagQuery,
  createDashboardInsightsReviewQuery,
  createDashboardInsightsTagQuery,
  createDashboardInsightsTargetQuery,
  createPrismaDashboardInsightsRepository,
  type DashboardInsightsPrincipal
} from './dashboardInsightsRepository.js'
import { createDashboardInsightsService } from './dashboardInsightsService.js'

interface ExplainRow {
  'QUERY PLAN': unknown
}

interface PlanNode extends Record<string, unknown> {
  'Node Type': string
}

interface StatementMetrics {
  executeCount: number
  queryCount: number
  transactionCount: number
}

interface BoundedPlanMetrics {
  readonly diskSortCount: number
  readonly overCardinalityNodeCount: number
  readonly repeatedSubplanCount: number
  readonly totalNodeCount: number
}

interface PopulationMetrics {
  answerCount: number
  sessionCount: number
  tagFactCount: number
}

interface ProjectionCardinality {
  answerFactCount: number
  broadMaximumRows: number
  rankedSessionCount: number
  recentSessionCount: number
  tagFactCount: number
  targetCatalogCount: number
}

const DAY_MILLISECONDS = 86_400_000
const POPULATION_ROUNDS = 8
const PERFORMANCE_SAMPLE_COUNT = 20
const SUBJECTS = [
  'VOCABULARY',
  'GRAMMAR',
  'READING'
] as const satisfies readonly QuestionSubject[]
const LEVELS = [
  'N5',
  'N4',
  'N3',
  'N2',
  'N1'
] as const satisfies readonly JlptLevel[]

const environment = parseApiEnvironment(process.env)
const adminDatabaseUrl = process.env.PHASE7_ADMIN_DATABASE_URL
const authGatewayDatabaseUrl = environment.AUTH_GATEWAY_DATABASE_URL
if (!adminDatabaseUrl || !authGatewayDatabaseUrl) {
  throw new Error('Phase 8 performance integration DB URLs are required.')
}
assertSafeTestDatabase({
  nodeEnvironment: environment.NODE_ENV,
  databaseUrl: environment.DATABASE_URL,
  productionDatabaseUrl: process.env.PRODUCTION_DATABASE_URL
})

const database = createRoleDatabaseRuntime(
  environment.DATABASE_URL,
  'nihongo_app'
)
const adminDatabase = createDatabaseRuntime(adminDatabaseUrl)
const authGatewayDatabase = createRoleDatabaseRuntime(
  authGatewayDatabaseUrl,
  'nihongo_auth_gateway'
)
const sessionRepository = createPrismaStudySessionRepository(database.client)
const submissionRepository = createPrismaStudySubmissionRepository(
  database.client
)

const collectPlanNodes = (value: unknown, nodes: PlanNode[]): void => {
  if (Array.isArray(value)) {
    value.forEach((item) => collectPlanNodes(item, nodes))
    return
  }
  if (typeof value !== 'object' || value === null) return

  const record = value as Record<string, unknown>
  if (typeof record['Node Type'] === 'string') {
    nodes.push(record as PlanNode)
  }
  Object.values(record).forEach((item) => collectPlanNodes(item, nodes))
}

const readPlanNodes = (rows: readonly ExplainRow[]): PlanNode[] => {
  const nodes: PlanNode[] = []
  rows.forEach((row) => collectPlanNodes(row['QUERY PLAN'], nodes))
  return nodes
}

const readNumericPlanField = (node: PlanNode, field: string): number => {
  const value = node[field]
  return typeof value === 'number' ? value : 0
}

const sqlText = (query: Prisma.Sql): string => query.strings.join(' ')

const createMeasuredClient = (metrics: StatementMetrics[]): PrismaClient =>
  ({
    $transaction: async <Result>(
      operation: (transaction: Prisma.TransactionClient) => Promise<Result>,
      options?: { isolationLevel?: Prisma.TransactionIsolationLevel }
    ): Promise<Result> => {
      const current: StatementMetrics = {
        executeCount: 0,
        queryCount: 0,
        transactionCount: 1
      }
      try {
        return await database.client.$transaction(async (transaction) => {
          const measuredTransaction = {
            $executeRaw: async (
              query: TemplateStringsArray | Prisma.Sql,
              ...values: unknown[]
            ): Promise<number> => {
              current.executeCount += 1
              return await transaction.$executeRaw(query, ...values)
            },
            $queryRaw: async <QueryResult = unknown>(
              query: TemplateStringsArray | Prisma.Sql,
              ...values: unknown[]
            ): Promise<QueryResult> => {
              current.queryCount += 1
              return await transaction.$queryRaw<QueryResult>(query, ...values)
            }
          } as unknown as Prisma.TransactionClient
          return await operation(measuredTransaction)
        }, options)
      } finally {
        metrics.push(current)
      }
    }
  }) as unknown as PrismaClient

const createAuthenticatedUser = async (): Promise<
  Extract<DashboardInsightsPrincipal, { readonly kind: 'PHASE7' }>
> => {
  const userId = randomUUID()
  const accountId = randomUUID()
  const sessionId = randomUUID()
  const sessionToken = `phase8-performance-${randomUUID()}`
  const now = new Date()

  await adminDatabase.client.$transaction(async (transaction) => {
    await transaction.$executeRaw`
      INSERT INTO "User" (
        "id", "name", "email", "emailVerified", "role", "targetLevel",
        "accountStatus", "createdAt", "updatedAt"
      ) VALUES (
        ${userId}::uuid, 'Phase 8 performance',
        ${`phase8-performance-${randomUUID()}@example.test`}, true,
        'USER', 'N5', 'ACTIVE', ${now}, ${now}
      )
    `
    await transaction.$executeRaw`
      INSERT INTO "Account" (
        "id", "accountId", "providerId", "userId", "password",
        "createdAt", "updatedAt"
      ) VALUES (
        ${accountId}, ${userId}, 'credential', ${userId}::uuid,
        'phase8-performance-password-hash', ${now}, ${now}
      )
    `
  })

  const issued = await authGatewayDatabase.client.$queryRawUnsafe<
    Array<{ familyId: string }>
  >(
    `SELECT * FROM "phase7_issue_v1_session"(
      $1, 1, 'USER', 'ACTIVE', $2, $3,
      '127.0.0.1', 'phase8-dashboard-performance', false
    )`,
    userId,
    sessionId,
    sessionToken
  )
  if (issued.length !== 1 || !issued[0]) {
    throw new Error('Phase 8 performance Session was not issued.')
  }
  return { kind: 'PHASE7', sessionToken, userId }
}

const populateLearningHistory = async (
  principal: DashboardInsightsPrincipal
): Promise<PopulationMetrics> => {
  const owner = {
    kind: 'USER' as const,
    userId: principal.userId
  } satisfies ExistingStudyOwner
  const baseTime = Date.now()
  let answerCount = 0
  let sessionCount = 0
  let tagFactCount = 0

  for (let round = 0; round < POPULATION_ROUNDS; round += 1) {
    for (const [levelIndex, level] of LEVELS.entries()) {
      for (const [subjectIndex, subject] of SUBJECTS.entries()) {
        const submittedAt = new Date(
          baseTime -
            (POPULATION_ROUNDS - round) * DAY_MILLISECONDS +
            (levelIndex * SUBJECTS.length + subjectIndex) * 60_000
        )
        const startedAt = new Date(submittedAt.getTime() - 60_000)
        const created = await sessionRepository.createRandom({
          level,
          subject,
          owner,
          requestedCount: 20,
          startedAt,
          expiresAt: new Date(startedAt.getTime() + DAY_MILLISECONDS)
        })
        const materials = await database.client.studySessionQuestion.findMany({
          where: { studySessionId: created.session.id },
          orderBy: { ordinal: 'asc' },
          select: {
            id: true,
            questionVersion: {
              select: {
                correctOptionId: true,
                tags: { select: { tagId: true } }
              }
            }
          }
        })
        if (materials.length === 0) {
          throw new Error('Phase 8 performance fixture requires questions.')
        }
        const answers = materials.map((material, index) => ({
          studySessionQuestionId: material.id,
          selectedOptionId:
            (round + index) % 2 === 0
              ? material.questionVersion.correctOptionId
              : null,
          elapsedSec: 5 + index
        }))
        await createStudySubmissionService(
          submissionRepository,
          () => submittedAt
        ).submit(
          created.session.id,
          randomUUID(),
          {
            answers,
            durationSec: answers.reduce(
              (total, answer) => total + answer.elapsedSec,
              0
            )
          },
          owner
        )
        answerCount += answers.length
        sessionCount += 1
        tagFactCount += materials.reduce(
          (total, material) => total + material.questionVersion.tags.length,
          0
        )
      }
    }
  }

  return { answerCount, sessionCount, tagFactCount }
}

const analyzeProjectionTables = async (): Promise<void> => {
  for (const table of [
    'StudySession',
    'StudySessionQuestion',
    'StudyAnswer',
    'WrongNote',
    'ReviewSchedule',
    'Question',
    'QuestionVersion',
    'QuestionVersionTag'
  ]) {
    await adminDatabase.client.$executeRawUnsafe(`ANALYZE "${table}"`)
  }
}

const readBusinessState = async (userId: string): Promise<unknown> =>
  await database.client.$queryRaw`
    SELECT jsonb_build_object(
      'sessions', (
        SELECT COUNT(*) FROM "StudySession" WHERE "userId" = ${userId}::uuid
      ),
      'answers', (
        SELECT COUNT(*) FROM "StudyAnswer" AS answer
        JOIN "StudySessionQuestion" AS item
          ON item."id" = answer."studySessionQuestionId"
        JOIN "StudySession" AS session
          ON session."id" = item."studySessionId"
        WHERE session."userId" = ${userId}::uuid
      ),
      'wrongNotes', (
        SELECT COUNT(*) FROM "WrongNote" WHERE "userId" = ${userId}::uuid
      ),
      'reviewSchedules', (
        SELECT COUNT(*) FROM "ReviewSchedule" AS schedule
        JOIN "WrongNote" AS note ON note."id" = schedule."wrongNoteId"
        WHERE note."userId" = ${userId}::uuid
      )
    ) AS snapshot
  `

const readProjectionCardinality = async (
  userId: string,
  fromInclusive: Date,
  observedAt: Date,
  targetLevel: JlptLevel
): Promise<ProjectionCardinality> => {
  const [row] = await database.client.$queryRaw<
    Array<{
      answerFactCount: bigint
      broadMaximumRows: bigint
      rankedSessionCount: bigint
      recentSessionCount: bigint
      tagFactCount: bigint
      targetCatalogCount: bigint
    }>
  >`
    SELECT
      GREATEST(
        (SELECT COUNT(*) FROM "StudySession"),
        (SELECT COUNT(*) FROM "StudySessionQuestion"),
        (SELECT COUNT(*) FROM "StudyAnswer"),
        (SELECT COUNT(*) FROM "WrongNote"),
        (SELECT COUNT(*) FROM "ReviewSchedule"),
        (SELECT COUNT(*) FROM "Question"),
        (SELECT COUNT(*) FROM "QuestionVersion"),
        (
          SELECT COUNT(*)
          FROM "StudyAnswer" AS answer
          JOIN "StudySessionQuestion" AS item
            ON item."id" = answer."studySessionQuestionId"
          JOIN "QuestionVersionTag" AS version_tag
            ON version_tag."questionVersionId" = item."questionVersionId"
        )
      )::bigint AS "broadMaximumRows",
      (
        SELECT COUNT(*)
        FROM "StudyAnswer" AS answer
        JOIN "StudySessionQuestion" AS item
          ON item."id" = answer."studySessionQuestionId"
        JOIN "StudySession" AS session
          ON session."id" = item."studySessionId"
        WHERE session."userId" = ${userId}::uuid
          AND session."status" = 'SUBMITTED'::"StudySessionStatus"
          AND answer."answeredAt" >= ${fromInclusive}
          AND answer."answeredAt" <= ${observedAt}
      )::bigint AS "answerFactCount",
      (
        SELECT COUNT(*)
        FROM "StudyAnswer" AS answer
        JOIN "StudySessionQuestion" AS item
          ON item."id" = answer."studySessionQuestionId"
        JOIN "StudySession" AS session
          ON session."id" = item."studySessionId"
        JOIN "QuestionVersionTag" AS version_tag
          ON version_tag."questionVersionId" = item."questionVersionId"
        WHERE session."userId" = ${userId}::uuid
          AND session."status" = 'SUBMITTED'::"StudySessionStatus"
          AND answer."answeredAt" >= ${fromInclusive}
          AND answer."answeredAt" <= ${observedAt}
      )::bigint AS "tagFactCount",
      (
        SELECT COUNT(*)
        FROM "StudySession" AS session
        WHERE session."userId" = ${userId}::uuid
          AND session."status" = 'SUBMITTED'::"StudySessionStatus"
          AND session."submittedAt" IS NOT NULL
      )::bigint AS "rankedSessionCount",
      (
        SELECT COUNT(*)
        FROM (
          SELECT session."id"
          FROM "StudySession" AS session
          WHERE session."userId" = ${userId}::uuid
            AND session."status" = 'SUBMITTED'::"StudySessionStatus"
            AND session."submittedAt" >= ${new Date(
              observedAt.getTime() - 7 * DAY_MILLISECONDS
            )}
            AND session."submittedAt" <= ${observedAt}
          ORDER BY session."submittedAt" DESC, session."id" ASC
          LIMIT 3
        ) AS recent
      )::bigint AS "recentSessionCount",
      (
        SELECT COUNT(*)
        FROM "Question" AS question
        JOIN "QuestionVersion" AS version
          ON version."questionId" = question."id"
          AND version."id" = question."currentPublishedVersionId"
        WHERE question."lifecycleStatus" = 'ACTIVE'
          AND version."status" = 'PUBLISHED'
          AND version."level" = ${targetLevel}::"JlptLevel"
      )::bigint AS "targetCatalogCount"
  `
  if (!row) throw new Error('Phase 8 performance cardinality is unavailable.')
  return {
    answerFactCount: Number(row.answerFactCount),
    broadMaximumRows: Number(row.broadMaximumRows),
    rankedSessionCount: Number(row.rankedSessionCount),
    recentSessionCount: Number(row.recentSessionCount),
    tagFactCount: Number(row.tagFactCount),
    targetCatalogCount: Number(row.targetCatalogCount)
  }
}

const assertBoundedPlan = (
  name: string,
  rows: readonly ExplainRow[],
  maximumLegitimateRows: number
): BoundedPlanMetrics => {
  const nodes = readPlanNodes(rows)
  const repeatedSubplans = nodes.filter(
    (node) =>
      node['Parent Relationship'] === 'SubPlan' &&
      readNumericPlanField(node, 'Actual Loops') > 1
  )
  const overCardinalityNodes = nodes.filter((node) => {
    const loops = Math.max(1, readNumericPlanField(node, 'Actual Loops'))
    return (
      readNumericPlanField(node, 'Actual Rows') * loops > maximumLegitimateRows
    )
  })
  const diskSorts = nodes.filter(
    (node) =>
      ['Incremental Sort', 'Sort'].includes(node['Node Type']) &&
      node['Sort Space Type'] === 'Disk'
  )
  expect(nodes.length, `${name} plan nodes`).toBeGreaterThan(0)
  expect(repeatedSubplans, `${name} repeated per-row SubPlans`).toHaveLength(0)
  expect(overCardinalityNodes, `${name} unbounded row expansion`).toHaveLength(
    0
  )
  expect(diskSorts, `${name} disk sorts`).toHaveLength(0)
  return {
    diskSortCount: diskSorts.length,
    overCardinalityNodeCount: overCardinalityNodes.length,
    repeatedSubplanCount: repeatedSubplans.length,
    totalNodeCount: nodes.length
  }
}

const assertCteRows = (
  queryName: string,
  rows: readonly ExplainRow[],
  cteName: string,
  expectedRows: number
): number => {
  const matchingNodes = readPlanNodes(rows).filter(
    (node) => node['Subplan Name'] === `CTE ${cteName}`
  )
  expect(matchingNodes, `${queryName} ${cteName} CTE plan node`).toHaveLength(1)
  const matchingNode = matchingNodes[0]
  if (!matchingNode) {
    throw new Error(`${queryName} ${cteName} CTE plan node is unavailable.`)
  }
  expect(
    readNumericPlanField(matchingNode, 'Actual Rows'),
    `${queryName} ${cteName} CTE rows`
  ).toBe(expectedRows)
  return matchingNodes.length
}

const createStatementEvidence = (metrics: readonly StatementMetrics[]) => {
  const sampleCount = metrics.length
  const totalExecuteCount = metrics.reduce(
    (total, metric) => total + metric.executeCount,
    0
  )
  const totalQueryCount = metrics.reduce(
    (total, metric) => total + metric.queryCount,
    0
  )
  const totalTransactionCount = metrics.reduce(
    (total, metric) => total + metric.transactionCount,
    0
  )
  return {
    executePerSample: totalExecuteCount / sampleCount,
    queryPerSample: totalQueryCount / sampleCount,
    sampleCount,
    sqlPerSample: (totalExecuteCount + totalQueryCount) / sampleCount,
    totalExecuteCount,
    totalQueryCount,
    totalSqlCount: totalExecuteCount + totalQueryCount,
    totalTransactionCount,
    transactionPerSample: totalTransactionCount / sampleCount
  }
}

beforeAll(async () => {
  await database.client.$queryRaw`SELECT 1`
  await adminDatabase.client.$queryRaw`SELECT 1`
  await authGatewayDatabase.client.$queryRaw`SELECT 1`
})

afterAll(async () => {
  await database.disconnect()
  await authGatewayDatabase.disconnect()
  await adminDatabase.disconnect()
})

describe.sequential('Phase 8 dashboard insights performance gate', () => {
  it('populated direct projection이 fixed statement·bounded plan·warm p95 evidence를 남긴다', async () => {
    const principal = await createAuthenticatedUser()
    const population = await populateLearningHistory(principal)
    const populatedAnswerCount = population.answerCount
    expect(populatedAnswerCount).toBeGreaterThanOrEqual(500)
    await analyzeProjectionTables()

    const observedAt = new Date()
    const fromInclusive = new Date(observedAt.getTime() - 90 * DAY_MILLISECONDS)
    const queries = [
      {
        name: 'clock',
        query: createDashboardInsightsClockQuery(principal)
      },
      {
        name: 'non-tag',
        query: createDashboardInsightsNonTagQuery(
          principal.userId,
          fromInclusive,
          observedAt
        )
      },
      {
        name: 'tag',
        query: createDashboardInsightsTagQuery(
          principal.userId,
          fromInclusive,
          observedAt
        )
      },
      {
        name: 'review',
        query: createDashboardInsightsReviewQuery(principal.userId, observedAt)
      },
      {
        name: 'target',
        query: createDashboardInsightsTargetQuery(
          principal.userId,
          'N5',
          observedAt
        )
      }
    ] as const
    for (const { query } of queries) {
      expect(query.values).toContain(principal.userId)
      expect(sqlText(query)).not.toMatch(/\bCROSS\s+JOIN\b/iu)
    }

    const cardinality = await readProjectionCardinality(
      principal.userId,
      fromInclusive,
      observedAt,
      'N5'
    )
    expect(cardinality.answerFactCount).toBe(populatedAnswerCount)
    expect(cardinality.tagFactCount).toBe(population.tagFactCount)
    expect(cardinality.rankedSessionCount).toBe(population.sessionCount)
    expect(cardinality.recentSessionCount).toBe(3)
    expect(cardinality.targetCatalogCount).toBeGreaterThan(0)
    const plans = await database.client.$transaction(
      async (transaction) => {
        await transaction.$executeRaw`SET TRANSACTION READ ONLY`
        const result: Array<{ name: string; rows: ExplainRow[] }> = []
        for (const { name, query } of queries) {
          const rows = await transaction.$queryRaw<ExplainRow[]>(Prisma.sql`
            EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
            ${query}
          `)
          result.push({ name, rows })
        }
        return result
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
    )
    const boundedPlanMetrics = plans.map(({ name, rows }) =>
      assertBoundedPlan(name, rows, cardinality.broadMaximumRows)
    )
    const planByName = new Map(plans.map((plan) => [plan.name, plan.rows]))
    const cteAssertionCount = [
      assertCteRows(
        'non-tag',
        planByName.get('non-tag') ?? [],
        'fact',
        cardinality.answerFactCount
      ),
      assertCteRows(
        'tag',
        planByName.get('tag') ?? [],
        'tag_fact',
        cardinality.tagFactCount
      ),
      assertCteRows(
        'review',
        planByName.get('review') ?? [],
        'ranked_sessions',
        cardinality.rankedSessionCount
      ),
      assertCteRows(
        'target',
        planByName.get('target') ?? [],
        'recent_sessions',
        cardinality.recentSessionCount
      ),
      assertCteRows(
        'target',
        planByName.get('target') ?? [],
        'target_catalog',
        cardinality.targetCatalogCount
      )
    ].reduce((total, count) => total + count, 0)
    const planEvidence = {
      cardinality,
      cteAssertionCount,
      diskSortCount: boundedPlanMetrics.reduce(
        (total, metric) => total + metric.diskSortCount,
        0
      ),
      overCardinalityNodeCount: boundedPlanMetrics.reduce(
        (total, metric) => total + metric.overCardinalityNodeCount,
        0
      ),
      queryCount: plans.length,
      repeatedSubplanCount: boundedPlanMetrics.reduce(
        (total, metric) => total + metric.repeatedSubplanCount,
        0
      ),
      totalNodeCount: boundedPlanMetrics.reduce(
        (total, metric) => total + metric.totalNodeCount,
        0
      )
    }

    const metrics: StatementMetrics[] = []
    const service = createDashboardInsightsService(
      createPrismaDashboardInsightsRepository(
        createMeasuredClient(metrics),
        'PHASE7'
      )
    )
    const before = await readBusinessState(principal.userId)
    const warmResponse = getDashboardInsightsResponseSchema.parse(
      await service.getDashboardInsights(principal)
    )
    expect(warmResponse.stats.overall.attemptedCount).toBe(populatedAnswerCount)
    const durations: number[] = []
    for (let index = 0; index < PERFORMANCE_SAMPLE_COUNT; index += 1) {
      const startedAt = performance.now()
      const response = getDashboardInsightsResponseSchema.parse(
        await service.getDashboardInsights(principal)
      )
      durations.push(performance.now() - startedAt)
      expect(response.stats.overall.attemptedCount).toBe(populatedAnswerCount)
      expect(response.stats.byTag.length).toBeLessThanOrEqual(100)
      expect(response.weaknesses.length).toBeLessThanOrEqual(10)
      expect(response.recommendations.length).toBeLessThanOrEqual(5)
    }
    expect(await readBusinessState(principal.userId)).toEqual(before)
    expect(metrics).toHaveLength(PERFORMANCE_SAMPLE_COUNT + 1)
    metrics.forEach((metric) => {
      expect(metric).toEqual({
        executeCount: 1,
        queryCount: 5,
        transactionCount: 1
      })
    })

    const sortedDurations = durations.toSorted((left, right) => left - right)
    const p95Index = Math.ceil(PERFORMANCE_SAMPLE_COUNT * 0.95) - 1
    const p95Milliseconds = sortedDurations[p95Index]
    if (p95Milliseconds === undefined) {
      throw new Error('Phase 8 p95 performance sample is unavailable.')
    }
    const databaseTiming = createPhase10TimingMeasurement({
      ...phase10DatabasePerformanceBudget,
      metric: 'dashboard-insights-service',
      samplesMs: durations
    })
    expect(databaseTiming.budget.passed).toBe(true)

    const apiMetrics: StatementMetrics[] = []
    const apiService = createDashboardInsightsService(
      createPrismaDashboardInsightsRepository(
        createMeasuredClient(apiMetrics),
        'PHASE7'
      )
    )
    let noStoreCount = 0
    let principalResolutionCount = 0
    let rateLimitCount = 0
    let requestCount = 0
    let schemaValidationCount = 0
    let statusOkCount = 0
    const principalService = {
      getAuthenticatedUser: async () => ({
        id: principal.userId,
        name: 'Phase 10 performance',
        role: 'USER' as const,
        targetLevel: 'N5' as const
      }),
      resolveAuthenticatedUser: async () => {
        principalResolutionCount += 1
        return {
          clearSessionCookie: false,
          headers: new Headers(),
          phase7Session: {
            createdAt: new Date(observedAt.getTime() - 60_000),
            expiresAt: new Date(observedAt.getTime() + DAY_MILLISECONDS),
            id: randomUUID(),
            isFresh: true,
            token: principal.sessionToken
          },
          user: {
            id: principal.userId,
            name: 'Phase 10 performance',
            role: 'USER' as const,
            targetLevel: 'N5' as const
          }
        }
      }
    } satisfies PrincipalService
    const rateLimiter = {
      consume: async (input) => {
        expect(input).toEqual({
          clientIp: 'unresolved',
          max: 120,
          operation: 'dashboard-insights-read',
          windowMs: 60_000
        })
        rateLimitCount += 1
      }
    } satisfies ApplicationRateLimiter
    const app = new Hono<{ Variables: ApiVariables }>()
    app.use('*', async (context, next) => {
      const requestUrl = new URL(context.req.url)
      context.set(
        'rawRequestTarget',
        `${requestUrl.pathname}${requestUrl.search}`
      )
      await next()
    })
    app.route(
      '/api/v1/dashboard',
      createDashboardInsightsRoutes({
        dashboardInsightsService: apiService,
        environment,
        principalService,
        rateLimiter
      })
    )
    const requestInsights = async (): Promise<void> => {
      requestCount += 1
      const response = await app.request('/api/v1/dashboard/insights')
      if (response.status === 200) statusOkCount += 1
      expect(response.status).toBe(200)
      const cacheControl = response.headers.get('Cache-Control')
      if (cacheControl === 'private, no-store') noStoreCount += 1
      expect(cacheControl).toBe('private, no-store')
      const body = getDashboardInsightsResponseSchema.parse(
        await response.json()
      )
      schemaValidationCount += 1
      expect(body.stats.overall.attemptedCount).toBe(populatedAnswerCount)
      expect(body.stats.byTag.length).toBeLessThanOrEqual(100)
      expect(body.weaknesses.length).toBeLessThanOrEqual(10)
      expect(body.recommendations.length).toBeLessThanOrEqual(5)
    }
    await requestInsights()
    const apiDurations: number[] = []
    for (let index = 0; index < PERFORMANCE_SAMPLE_COUNT; index += 1) {
      const startedAt = performance.now()
      await requestInsights()
      apiDurations.push(performance.now() - startedAt)
    }
    expect(principalResolutionCount).toBe(PERFORMANCE_SAMPLE_COUNT + 1)
    expect(rateLimitCount).toBe(PERFORMANCE_SAMPLE_COUNT + 1)
    expect(requestCount).toBe(PERFORMANCE_SAMPLE_COUNT + 1)
    expect(statusOkCount).toBe(PERFORMANCE_SAMPLE_COUNT + 1)
    expect(noStoreCount).toBe(PERFORMANCE_SAMPLE_COUNT + 1)
    expect(schemaValidationCount).toBe(PERFORMANCE_SAMPLE_COUNT + 1)
    expect(apiMetrics).toHaveLength(PERFORMANCE_SAMPLE_COUNT + 1)
    apiMetrics.forEach((metric) => {
      expect(metric).toEqual({
        executeCount: 1,
        queryCount: 5,
        transactionCount: 1
      })
    })
    expect(await readBusinessState(principal.userId)).toEqual(before)
    const apiTiming = createPhase10TimingMeasurement({
      ...phase10ApiPerformanceBudget,
      metric: 'dashboard-insights-http',
      samplesMs: apiDurations
    })
    expect(apiTiming.budget.passed).toBe(true)

    const evidenceDirectory = process.env.PHASE10_PERFORMANCE_EVIDENCE_DIR
    if (evidenceDirectory) {
      const commit = process.env.PHASE10_PERFORMANCE_COMMIT
      const sourceTreeDirty = process.env.PHASE10_PERFORMANCE_SOURCE_TREE_DIRTY
      const pnpmVersion = process.env.PHASE10_PERFORMANCE_PNPM_VERSION
      if (
        !commit ||
        !pnpmVersion ||
        (sourceTreeDirty !== 'true' && sourceTreeDirty !== 'false')
      ) {
        throw new Error('Phase 10 performance evidence metadata is missing.')
      }
      await writePhase10DatabaseApiPerformanceEvidence({
        evidence: {
          api: {
            ...apiTiming,
            cacheControl: 'private, no-store',
            noStoreCount,
            principalResolutionCount,
            rateLimitCount,
            requestCount,
            route: 'GET /api/v1/dashboard/insights',
            schemaValidationCount,
            serviceCallCount: apiMetrics.length,
            statements: createStatementEvidence(apiMetrics),
            status: 200,
            statusOkCount
          },
          database: {
            ...databaseTiming,
            plan: planEvidence,
            statements: createStatementEvidence(metrics)
          },
          fixture: {
            answerCount: population.answerCount,
            sessionCount: population.sessionCount,
            tagFactCount: population.tagFactCount
          },
          kind: 'nihongo.phase10.database-api-performance',
          metadata: {
            command: 'pnpm run test:phase10:performance:database-api',
            commit,
            generatedAt: new Date().toISOString(),
            mode: 'test',
            node: process.version,
            pnpm: pnpmVersion,
            sourceTreeDirty: sourceTreeDirty === 'true'
          },
          schemaVersion: 1,
          status: 'passed',
          writes: { businessWriteDelta: 0 }
        },
        filePath: path.join(evidenceDirectory, 'database-api.json')
      })
    }
    process.stdout.write(
      `${JSON.stringify({
        event: 'phase8.dashboard_insights.performance',
        apiP95Milliseconds: apiTiming.statisticsMs.p95,
        databaseP95Milliseconds: databaseTiming.statisticsMs.p95,
        populatedAnswerCount,
        samples: PERFORMANCE_SAMPLE_COUNT,
        p95Milliseconds: Number(p95Milliseconds.toFixed(3)),
        targetMilliseconds: phase10DatabasePerformanceBudget.absoluteCeilingMs,
        targetMet:
          p95Milliseconds <= phase10DatabasePerformanceBudget.absoluteCeilingMs
      })}\n`
    )
  }, 120_000)
})

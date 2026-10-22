import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '../generated/prisma/client.js'
import {
  createDashboardInsightsClockQuery,
  createDashboardInsightsNonTagQuery,
  createDashboardInsightsReviewQuery,
  createDashboardInsightsTagQuery,
  createDashboardInsightsTargetQuery,
  createPrismaDashboardInsightsRepository,
  DashboardInsightsPrincipalLostError,
  DashboardInsightsRepositoryIntegrityError
} from './dashboardInsightsRepository.js'

const USER_ID = '018f6b7a-1f4b-7d5e-8a91-4c27df9c1001'
const SESSION_TOKEN = 'phase7-dashboard-insights-session-token'
const OBSERVED_AT = new Date('2026-09-28T12:00:00.000Z')
const FROM_INCLUSIVE = new Date('2026-06-30T12:00:00.000Z')
const phase7Principal = {
  kind: 'PHASE7' as const,
  sessionToken: SESSION_TOKEN,
  userId: USER_ID
}

const emptyOverallRow = {
  kind: 'OVERALL' as const,
  level: null,
  subject: null,
  questionType: null,
  attemptedCount: 0n,
  correctCount: 0n,
  incorrectCount: 0n,
  elapsedTotal: 0n,
  lastAnsweredAt: null,
  repeatExtra: 0n
}

const emptyCountsRow = {
  kind: 'COUNTS' as const,
  level: null,
  subject: null,
  totalCount: 0n,
  repeatedCount: 0n,
  earliestDueAt: null,
  questionId: null,
  questionText: null,
  wrongCount: null,
  status: null,
  lastWrongAt: null,
  isDue: null
}

const createClient = () => {
  const transaction = {
    $executeRaw: vi.fn().mockResolvedValue(0),
    $queryRaw: vi.fn()
  }
  const client = {
    $transaction: vi.fn(
      async (operation: (value: typeof transaction) => Promise<unknown>) =>
        operation(transaction)
    )
  }
  return { client: client as unknown as PrismaClient, transaction }
}

const sqlText = (value: unknown): string =>
  Array.isArray(value)
    ? value.join(' ')
    : (value as { strings: readonly string[] }).strings.join(' ')

describe('Prisma dashboard insights repository', () => {
  it('6개 고정 statement를 한 read-only RepeatableRead snapshot에서 실행한다', async () => {
    const { client, transaction } = createClient()
    transaction.$queryRaw
      .mockResolvedValueOnce([
        { observedAt: OBSERVED_AT, targetLevel: null, futureAnswerCount: 0n }
      ])
      .mockResolvedValueOnce([emptyOverallRow])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([emptyCountsRow])
      .mockResolvedValueOnce([])

    const repository = createPrismaDashboardInsightsRepository(client, 'PHASE7')

    await expect(
      repository.readOwnedSnapshot(phase7Principal)
    ).resolves.toEqual({
      clock: {
        observedAt: OBSERVED_AT,
        targetLevel: null,
        futureAnswerCount: 0n
      },
      nonTagRows: [emptyOverallRow],
      tagRows: [],
      reviewRows: [emptyCountsRow],
      targetRows: []
    })
    expect(transaction.$executeRaw).toHaveBeenCalledOnce()
    expect(sqlText(transaction.$executeRaw.mock.calls[0]?.[0])).toContain(
      'SET TRANSACTION READ ONLY'
    )
    expect(transaction.$queryRaw).toHaveBeenCalledTimes(5)
    expect(vi.mocked(client.$transaction)).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: 'RepeatableRead' }
    )
  })

  it('owner scope·historical/current 분리·write 0을 SQL surface에 고정한다', () => {
    const queries = [
      createDashboardInsightsClockQuery(phase7Principal),
      createDashboardInsightsNonTagQuery(USER_ID, FROM_INCLUSIVE, OBSERVED_AT),
      createDashboardInsightsTagQuery(USER_ID, FROM_INCLUSIVE, OBSERVED_AT),
      createDashboardInsightsReviewQuery(USER_ID, OBSERVED_AT),
      createDashboardInsightsTargetQuery(USER_ID, 'N2', OBSERVED_AT)
    ]
    const texts = queries.map(sqlText)
    const combined = texts.join('\n')

    for (const query of queries) {
      expect(query.values).toContain(USER_ID)
    }
    expect(combined).not.toMatch(/\b(?:INSERT|UPDATE|DELETE)\b/iu)
    expect(texts[1]).toContain('item."questionVersionId"')
    expect(texts[2]).toContain('"QuestionVersionTag"')
    expect(texts[3]).toContain('question."currentPublishedVersionId"')
    expect(texts[3]).toContain('ranked."rank" <= 10')
    expect(texts[4]).toContain('LIMIT 3')
    expect(texts[0]).toContain('phase7_resolve_v1_principal')
    expect(texts[0]).not.toContain('FROM "User"')
    expect(queries[0]!.values).toContain(SESSION_TOKEN)

    const legacyClock = createDashboardInsightsClockQuery({
      kind: 'LEGACY',
      userId: USER_ID
    })
    expect(sqlText(legacyClock)).toContain('FROM "User"')
    expect(sqlText(legacyClock)).not.toContain('phase7_resolve_v1_principal')
  })

  it('active owner cardinality와 future answer를 fail closed한다', async () => {
    const missing = createClient()
    missing.transaction.$queryRaw.mockResolvedValueOnce([])
    const future = createClient()
    future.transaction.$queryRaw.mockResolvedValueOnce([
      { observedAt: OBSERVED_AT, targetLevel: 'N5', futureAnswerCount: 1n }
    ])

    await expect(
      createPrismaDashboardInsightsRepository(
        missing.client,
        'PHASE7'
      ).readOwnedSnapshot(phase7Principal)
    ).rejects.toBeInstanceOf(DashboardInsightsPrincipalLostError)
    await expect(
      createPrismaDashboardInsightsRepository(
        future.client,
        'PHASE7'
      ).readOwnedSnapshot(phase7Principal)
    ).rejects.toBeInstanceOf(DashboardInsightsRepositoryIntegrityError)
    expect(missing.transaction.$queryRaw).toHaveBeenCalledOnce()
    expect(future.transaction.$queryRaw).toHaveBeenCalledOnce()
  })

  it('configured authority와 principal proof가 다르면 SQL 전에 닫는다', async () => {
    const { client, transaction } = createClient()

    await expect(
      createPrismaDashboardInsightsRepository(
        client,
        'PHASE7'
      ).readOwnedSnapshot({ kind: 'LEGACY', userId: USER_ID })
    ).rejects.toBeInstanceOf(DashboardInsightsPrincipalLostError)
    expect(transaction.$executeRaw).not.toHaveBeenCalled()
    expect(transaction.$queryRaw).not.toHaveBeenCalled()
  })
})

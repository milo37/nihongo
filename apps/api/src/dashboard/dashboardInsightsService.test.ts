import { describe, expect, it, vi } from 'vitest'
import { ApplicationError } from '../errors/applicationError.js'
import { createDashboardInsightsService } from './dashboardInsightsService.js'
import {
  DashboardInsightsPrincipalLostError,
  DashboardInsightsRepositoryIntegrityError,
  DashboardInsightsRepositoryUnavailableError,
  type DashboardInsightsRepository,
  type DashboardInsightsSnapshotRecord
} from './dashboardInsightsRepository.js'

const USER_ID = '018f6b7a-1f4b-7d5e-8a91-4c27df9c10d2'
const principal = { kind: 'LEGACY' as const, userId: USER_ID }

const emptySnapshot = (): DashboardInsightsSnapshotRecord => ({
  clock: {
    observedAt: new Date('2026-09-28T12:00:00.000Z'),
    targetLevel: null,
    futureAnswerCount: 0n
  },
  nonTagRows: [
    {
      kind: 'OVERALL',
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
  ],
  tagRows: [],
  reviewRows: [
    {
      kind: 'COUNTS',
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
  ],
  targetRows: []
})

const createRepository = (): DashboardInsightsRepository => ({
  readOwnedSnapshot: vi.fn().mockResolvedValue(emptySnapshot())
})

describe('Dashboard insights service', () => {
  it('principal userId만 repository에 전달하고 strict response를 반환한다', async () => {
    const repository = createRepository()
    const response =
      await createDashboardInsightsService(repository).getDashboardInsights(
        principal
      )

    expect(repository.readOwnedSnapshot).toHaveBeenCalledWith(principal)
    expect(response).toMatchObject({
      observedAt: '2026-09-28T12:00:00.000Z',
      reviewQueueCounts: { due: 0, repeated: 0 },
      recommendations: [
        {
          kind: 'PRACTICE_SETUP',
          reason: { code: 'TARGET_LEVEL_NOT_SET' }
        }
      ],
      personalizationFallbackReason: 'TARGET_LEVEL_NOT_SET'
    })
  })

  it('repository availability를 retryable 503으로 정규화한다', async () => {
    const repository = createRepository()
    vi.mocked(repository.readOwnedSnapshot).mockRejectedValue(
      new DashboardInsightsRepositoryUnavailableError({
        cause: new Error('database unavailable')
      })
    )

    await expect(
      createDashboardInsightsService(repository).getDashboardInsights(principal)
    ).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      retryable: true
    } satisfies Partial<ApplicationError>)
  })

  it('repository·mapper integrity를 retryable 500으로 정규화한다', async () => {
    const repositoryIntegrity = createRepository()
    vi.mocked(repositoryIntegrity.readOwnedSnapshot).mockRejectedValue(
      new DashboardInsightsRepositoryIntegrityError('invalid snapshot')
    )
    const mapperIntegrity = createRepository()
    vi.mocked(mapperIntegrity.readOwnedSnapshot).mockResolvedValue({
      ...emptySnapshot(),
      clock: {
        ...emptySnapshot().clock,
        futureAnswerCount: 1n
      }
    })

    await expect(
      createDashboardInsightsService(repositoryIntegrity).getDashboardInsights(
        principal
      )
    ).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      retryable: true
    } satisfies Partial<ApplicationError>)
    await expect(
      createDashboardInsightsService(mapperIntegrity).getDashboardInsights(
        principal
      )
    ).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      retryable: true
    } satisfies Partial<ApplicationError>)
  })

  it('snapshot 안에서 principal을 잃으면 expired auth로 닫는다', async () => {
    const repository = createRepository()
    vi.mocked(repository.readOwnedSnapshot).mockRejectedValue(
      new DashboardInsightsPrincipalLostError()
    )

    await expect(
      createDashboardInsightsService(repository).getDashboardInsights(principal)
    ).rejects.toMatchObject({
      code: 'AUTH_SESSION_EXPIRED',
      retryable: false
    } satisfies Partial<ApplicationError>)
  })
})

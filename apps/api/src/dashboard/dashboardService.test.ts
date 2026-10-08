import { describe, expect, it, vi } from 'vitest'
import { ApplicationError } from '../errors/applicationError.js'
import {
  createDashboardService,
  normalizeDashboardWindow
} from './dashboardService.js'
import {
  DashboardRepositoryUnavailableError,
  type DashboardRepository
} from './dashboardRepository.js'

const USER_ID = '018f6b7a-1f4b-7d5e-8a91-4c27df9c10d2'

const createRepository = (): DashboardRepository => ({
  readOwnedSnapshot: vi.fn().mockResolvedValue({
    subjectStats: [],
    recentSessions: [],
    dailyCounts: [],
    noteCounts: { totalCount: 0n, solvedCount: 0n },
    repeatedWrongQuestions: []
  })
})

describe('Dashboard service', () => {
  it('inclusive calendar range를 정확한 UTC half-open activity window로 만든다', () => {
    expect(
      normalizeDashboardWindow(
        USER_ID,
        { from: '2024-02-28', to: '2024-03-01' },
        new Date('2030-01-01T23:59:59.999Z')
      )
    ).toEqual({
      userId: USER_ID,
      anchorDate: '2024-03-01',
      activityFromInclusive: new Date('2024-02-28T00:00:00.000Z'),
      activityToExclusive: new Date('2024-03-02T00:00:00.000Z'),
      dailyFromInclusive: new Date('2024-02-24T00:00:00.000Z'),
      dailyToExclusive: new Date('2024-03-02T00:00:00.000Z')
    })
  })

  it('range가 없으면 관측된 현재 UTC 날짜를 7일 anchor로 사용한다', async () => {
    const repository = createRepository()
    const service = createDashboardService(
      repository,
      () => new Date('2026-08-16T23:59:59.999Z')
    )

    const response = await service.getDashboardStats(USER_ID, {})

    expect(repository.readOwnedSnapshot).toHaveBeenCalledWith({
      userId: USER_ID,
      activityFromInclusive: null,
      activityToExclusive: null,
      dailyFromInclusive: new Date('2026-08-10T00:00:00.000Z'),
      dailyToExclusive: new Date('2026-08-17T00:00:00.000Z'),
      anchorDate: '2026-08-16'
    })
    expect(response.dailyStudyCountLast7Days.at(0)?.date).toBe('2026-08-10')
    expect(response.dailyStudyCountLast7Days.at(-1)?.date).toBe('2026-08-16')
  })

  it('activity range와 무관하게 repository의 all-time WrongNote count를 보존한다', async () => {
    const repository = createRepository()
    vi.mocked(repository.readOwnedSnapshot).mockResolvedValue({
      subjectStats: [],
      recentSessions: [],
      dailyCounts: [],
      noteCounts: { totalCount: 9n, solvedCount: 4n },
      repeatedWrongQuestions: []
    })
    const service = createDashboardService(repository)

    const response = await service.getDashboardStats(USER_ID, {
      from: '2026-08-16',
      to: '2026-08-16'
    })

    expect(response.totalAnsweredCount).toBe(0)
    expect(response.wrongNoteCount).toBe(9)
    expect(response.solvedWrongNoteCount).toBe(4)
  })

  it('repository unavailable과 unsafe aggregate를 closed mapping한다', async () => {
    const unavailable = createRepository()
    vi.mocked(unavailable.readOwnedSnapshot).mockRejectedValue(
      new DashboardRepositoryUnavailableError({
        cause: new Error('database unavailable')
      })
    )
    const unsafe = createRepository()
    vi.mocked(unsafe.readOwnedSnapshot).mockResolvedValue({
      subjectStats: [
        {
          subject: 'VOCABULARY',
          answeredCount: BigInt(Number.MAX_SAFE_INTEGER) + 1n,
          correctCount: 0n
        }
      ],
      recentSessions: [],
      dailyCounts: [],
      noteCounts: { totalCount: 0n, solvedCount: 0n },
      repeatedWrongQuestions: []
    })

    await expect(
      createDashboardService(unavailable).getDashboardStats(USER_ID, {})
    ).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      retryable: true
    } satisfies Partial<ApplicationError>)
    await expect(
      createDashboardService(unsafe).getDashboardStats(USER_ID, {})
    ).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      retryable: true
    } satisfies Partial<ApplicationError>)
  })
})

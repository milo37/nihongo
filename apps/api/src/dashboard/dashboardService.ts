import type {
  GetDashboardStatsResponse,
  ParsedGetDashboardStatsQuery
} from '@nihongo/contracts/dashboard/get-dashboard-stats'
import { ApplicationError } from '../errors/applicationError.js'
import {
  DashboardMapperIntegrityError,
  toDashboardStats
} from './dashboardMapper.js'
import {
  DashboardRepositoryIntegrityError,
  DashboardRepositoryUnavailableError,
  type DashboardReadWindow,
  type DashboardRepository
} from './dashboardRepository.js'

const DAY_MILLISECONDS = 24 * 60 * 60 * 1_000

export interface DashboardService {
  getDashboardStats: (
    userId: string,
    query: ParsedGetDashboardStatsQuery
  ) => Promise<GetDashboardStatsResponse>
}

export interface NormalizedDashboardWindow extends DashboardReadWindow {
  readonly anchorDate: string
}

const startOfUtcDate = (calendarDate: string): Date =>
  new Date(`${calendarDate}T00:00:00.000Z`)

const addUtcDays = (date: Date, days: number): Date =>
  new Date(date.getTime() + days * DAY_MILLISECONDS)

export const normalizeDashboardWindow = (
  userId: string,
  query: ParsedGetDashboardStatsQuery,
  observedAt: Date
): NormalizedDashboardWindow => {
  const anchorDate = query.to ?? observedAt.toISOString().slice(0, 10)
  const anchorStart = startOfUtcDate(anchorDate)

  return {
    userId,
    anchorDate,
    activityFromInclusive: query.from ? startOfUtcDate(query.from) : null,
    activityToExclusive: query.to
      ? addUtcDays(startOfUtcDate(query.to), 1)
      : null,
    dailyFromInclusive: addUtcDays(anchorStart, -6),
    dailyToExclusive: addUtcDays(anchorStart, 1)
  }
}

const throwMappedError = (error: unknown): never => {
  if (error instanceof DashboardRepositoryUnavailableError) {
    throw new ApplicationError({
      code: 'SERVICE_UNAVAILABLE',
      message: '대시보드 저장소에 연결할 수 없습니다.',
      retryable: true,
      cause: error
    })
  }
  if (
    error instanceof DashboardRepositoryIntegrityError ||
    error instanceof DashboardMapperIntegrityError
  ) {
    throw new ApplicationError({
      code: 'INTERNAL_SERVER_ERROR',
      message: '대시보드 집계 무결성을 확인하지 못했습니다.',
      retryable: true,
      cause: error
    })
  }
  throw error
}

export const createDashboardService = (
  repository: DashboardRepository,
  now: () => Date = () => new Date()
): DashboardService => ({
  getDashboardStats: async (userId, query) => {
    try {
      const window = normalizeDashboardWindow(userId, query, now())
      const snapshot = await repository.readOwnedSnapshot(window)
      return toDashboardStats(snapshot, window.anchorDate)
    } catch (error: unknown) {
      return throwMappedError(error)
    }
  }
})

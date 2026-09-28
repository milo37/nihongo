import type { GetDashboardInsightsResponse } from '@nihongo/contracts/dashboard/get-dashboard-insights'
import { DashboardInsightCalculationError } from '@nihongo/domain/dashboard/calculate-dashboard-insights'
import { ApplicationError } from '../errors/applicationError.js'
import {
  DashboardInsightsMapperIntegrityError,
  toDashboardInsights
} from './dashboardInsightsMapper.js'
import {
  DashboardInsightsPrincipalLostError,
  DashboardInsightsRepositoryIntegrityError,
  DashboardInsightsRepositoryUnavailableError,
  type DashboardInsightsPrincipal,
  type DashboardInsightsRepository
} from './dashboardInsightsRepository.js'

export interface DashboardInsightsService {
  getDashboardInsights: (
    principal: DashboardInsightsPrincipal
  ) => Promise<GetDashboardInsightsResponse>
}

const throwMappedError = (error: unknown): never => {
  if (error instanceof DashboardInsightsPrincipalLostError) {
    throw new ApplicationError({
      code: 'AUTH_SESSION_EXPIRED',
      message: '로그인 세션이 만료됐습니다.',
      retryable: false,
      cause: error
    })
  }
  if (error instanceof DashboardInsightsRepositoryUnavailableError) {
    throw new ApplicationError({
      code: 'SERVICE_UNAVAILABLE',
      message: '대시보드 인사이트 저장소에 연결할 수 없습니다.',
      retryable: true,
      cause: error
    })
  }
  if (
    error instanceof DashboardInsightsRepositoryIntegrityError ||
    error instanceof DashboardInsightsMapperIntegrityError ||
    error instanceof DashboardInsightCalculationError
  ) {
    throw new ApplicationError({
      code: 'INTERNAL_SERVER_ERROR',
      message: '대시보드 인사이트 무결성을 확인하지 못했습니다.',
      retryable: true,
      cause: error
    })
  }
  throw error
}

export const createDashboardInsightsService = (
  repository: DashboardInsightsRepository
): DashboardInsightsService => ({
  getDashboardInsights: async (principal) => {
    try {
      return toDashboardInsights(await repository.readOwnedSnapshot(principal))
    } catch (error: unknown) {
      return throwMappedError(error)
    }
  }
})

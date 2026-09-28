import { queryOptions } from '@tanstack/react-query'
import { getDashboardInsightsV1 } from '@api/dashboard/getDashboardInsightsV1'
import { getDashboardStatsV1 } from '@api/dashboard/getDashboardStatsV1'
import { serverStateQueryKeys } from '@app/serverStateQueryKeys'

const getStats = () => getDashboardStatsV1()

const getInsights = () => getDashboardInsightsV1()

export const dashboardQueries = {
  allKey: serverStateQueryKeys.dashboard.all,
  stats: () =>
    queryOptions({
      queryKey: [...dashboardQueries.allKey(), 'get-stats'] as const,
      queryFn: getStats,
      staleTime: 30_000
    }),
  insights: () =>
    queryOptions({
      queryKey: [...dashboardQueries.allKey(), 'get-insights'] as const,
      queryFn: getInsights,
      staleTime: 30_000
    })
} as const

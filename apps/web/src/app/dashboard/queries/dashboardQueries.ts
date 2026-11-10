import { queryOptions } from '@tanstack/react-query'
import { getDashboardStatsV1 } from '@api/dashboard/getDashboardStatsV1'
import { serverStateQueryKeys } from '@nihongo/browser/libs/serverStateQueryKeys'

const getStats = () => getDashboardStatsV1()

export const dashboardQueries = {
  allKey: serverStateQueryKeys.dashboard.all,
  stats: () =>
    queryOptions({
      queryKey: [...dashboardQueries.allKey(), 'get-stats'] as const,
      queryFn: getStats,
      staleTime: 30_000
    })
} as const

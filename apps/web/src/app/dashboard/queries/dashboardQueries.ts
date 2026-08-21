import { queryOptions } from '@tanstack/react-query'
import { getDashboardStatsV1 } from '@api/dashboard/getDashboardStatsV1'
import { toCanonicalDashboardView } from '@app/dashboard/adapters/dashboardView'
import { serverStateQueryKeys } from '@app/serverStateQueryKeys'

const getStats = async () =>
  toCanonicalDashboardView(await getDashboardStatsV1())

export const dashboardQueries = {
  allKey: serverStateQueryKeys.dashboard.all,
  stats: () =>
    queryOptions({
      queryKey: [...dashboardQueries.allKey(), 'get-stats'] as const,
      queryFn: getStats,
      staleTime: 30_000
    })
} as const

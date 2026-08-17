import { queryOptions } from '@tanstack/react-query'
import { getDashboardStats } from '@api/dashboard/getDashboardStats'
import { getDashboardStatsV1 } from '@api/dashboard/getDashboardStatsV1'
import {
  toCanonicalDashboardView,
  toLegacyDashboardView
} from '@app/dashboard/adapters/dashboardView'
import { serverStateQueryKeys } from '@app/serverStateQueryKeys'
import { isMockApiMode } from '@libs/apiMode'

const getStats = async () => {
  if (isMockApiMode) {
    return toLegacyDashboardView(await getDashboardStats())
  }

  return toCanonicalDashboardView(await getDashboardStatsV1())
}

export const dashboardQueries = {
  allKey: serverStateQueryKeys.dashboard.all,
  stats: () =>
    queryOptions({
      queryKey: [...dashboardQueries.allKey(), 'get-stats'] as const,
      queryFn: getStats,
      staleTime: 30_000
    })
} as const

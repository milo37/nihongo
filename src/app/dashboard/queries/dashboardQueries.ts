import { queryOptions } from '@tanstack/react-query'
import { getDashboardStats } from '@api/dashboard/getDashboardStats'

export const dashboardQueries = {
  allKey: () => ['dashboard'] as const,
  stats: () =>
    queryOptions({
      queryKey: [...dashboardQueries.allKey(), 'get-stats'] as const,
      queryFn: getDashboardStats,
      staleTime: 30_000
    })
} as const

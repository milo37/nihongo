import { queryOptions } from '@tanstack/react-query'
import { getDashboardStatsV1 } from '@api/dashboard/getDashboardStatsV1'
import type { JlptLevel } from '@nihongo/browser/common/types/domain'
import { serverStateQueryKeys } from '@nihongo/browser/libs/serverStateQueryKeys'

type DashboardStatsParams = {
  /** JLP-853: only this level's sessions and wrong notes. */
  level?: JlptLevel
}

export const dashboardQueries = {
  allKey: serverStateQueryKeys.dashboard.all,
  stats: ({ level }: DashboardStatsParams = {}) =>
    queryOptions({
      queryKey: level
        ? ([...dashboardQueries.allKey(), 'get-stats', { level }] as const)
        : ([...dashboardQueries.allKey(), 'get-stats'] as const),
      queryFn: () => getDashboardStatsV1(level ? { level } : {}),
      staleTime: 30_000
    })
} as const

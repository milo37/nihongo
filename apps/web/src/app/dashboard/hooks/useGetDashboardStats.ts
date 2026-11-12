import { useQuery } from '@tanstack/react-query'
import { dashboardQueries } from '@app/dashboard/queries/dashboardQueries'
import type { JlptLevel } from '@nihongo/browser/common/types/domain'

type DashboardStatsOptions = {
  enabled?: boolean
  /** Count only this level's records (My page: the target level). */
  level?: JlptLevel
  /**
   * My page: re-read on mount even when a recent copy is cached, and show a
   * failure in the card instead of the shared error banner.
   */
  myPage?: boolean
}

export const useGetDashboardStats = ({
  enabled = true,
  level,
  myPage = false
}: DashboardStatsOptions = {}) => {
  return useQuery({
    ...dashboardQueries.stats({ level }),
    enabled,
    ...(myPage
      ? { refetchOnMount: 'always' as const, meta: { localErrorUi: true } }
      : {})
  })
}

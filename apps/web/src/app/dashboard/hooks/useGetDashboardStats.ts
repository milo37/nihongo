import { useQuery } from '@tanstack/react-query'
import { dashboardQueries } from '@app/dashboard/queries/dashboardQueries'

type DashboardStatsOptions = {
  enabled?: boolean
  /**
   * My page: re-read on mount even when a recent copy is cached, and show a
   * failure in the card instead of the shared error banner.
   */
  myPage?: boolean
}

export const useGetDashboardStats = ({
  enabled = true,
  myPage = false
}: DashboardStatsOptions = {}) => {
  return useQuery({
    ...dashboardQueries.stats(),
    enabled,
    ...(myPage
      ? { refetchOnMount: 'always' as const, meta: { localErrorUi: true } }
      : {})
  })
}

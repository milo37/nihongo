import { useQuery } from '@tanstack/react-query'
import { dashboardQueries } from '@app/dashboard/queries/dashboardQueries'

// fresh: re-read on mount even when a recent copy is cached (account page).
export const useGetDashboardStats = (enabled = true, fresh = false) => {
  return useQuery({
    ...dashboardQueries.stats(),
    enabled,
    ...(fresh ? { refetchOnMount: 'always' as const } : {})
  })
}

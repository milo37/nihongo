import { useQuery } from '@tanstack/react-query'
import { dashboardQueries } from '@app/dashboard/queries/dashboardQueries'

export const useGetDashboardStats = (enabled = true) => {
  return useQuery({ ...dashboardQueries.stats(), enabled })
}

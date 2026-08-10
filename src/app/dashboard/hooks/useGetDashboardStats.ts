import { useQuery } from '@tanstack/react-query'
import { dashboardQueries } from '@app/dashboard/queries/dashboardQueries'

export const useGetDashboardStats = () => {
  return useQuery(dashboardQueries.stats())
}

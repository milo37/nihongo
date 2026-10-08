import { useQuery } from '@tanstack/react-query'
import { toCanonicalDashboardView } from '@app/dashboard/adapters/dashboardView'
import { dashboardQueries } from '@app/dashboard/queries/dashboardQueries'

export const useGetDashboardStats = () => {
  return useQuery({
    ...dashboardQueries.stats(),
    select: toCanonicalDashboardView
  })
}

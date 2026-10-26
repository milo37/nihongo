import { getDashboardStatsResponseSchema } from '@api/dashboard/getDashboardStats/schema'
import type { GetDashboardStatsResponse } from '@api/dashboard/getDashboardStats/schema'
import { safeGet } from '@nihongo/browser/api/http'

const requestDashboardStats = safeGet(getDashboardStatsResponseSchema)

export const getDashboardStats = (): Promise<GetDashboardStatsResponse> =>
  requestDashboardStats('/dashboard/stats')

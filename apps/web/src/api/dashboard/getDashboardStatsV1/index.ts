import { safeGet } from '@api/http'
import {
  getDashboardStatsV1RequestSchema,
  getDashboardStatsV1ResponseSchema
} from '@api/dashboard/getDashboardStatsV1/schema'
import type {
  GetDashboardStatsV1Request,
  GetDashboardStatsV1Response
} from '@api/dashboard/getDashboardStatsV1/schema'

const requestDashboardStats = safeGet(getDashboardStatsV1ResponseSchema)

export const getDashboardStatsV1 = (
  params: GetDashboardStatsV1Request = {}
): Promise<GetDashboardStatsV1Response> =>
  requestDashboardStats(
    '/v1/dashboard',
    getDashboardStatsV1RequestSchema.parse(params)
  )

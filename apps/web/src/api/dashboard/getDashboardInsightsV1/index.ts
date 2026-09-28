import { safeGet } from '@api/http'
import {
  getDashboardInsightsV1RequestSchema,
  getDashboardInsightsV1ResponseSchema
} from '@api/dashboard/getDashboardInsightsV1/schema'
import type {
  GetDashboardInsightsV1Request,
  GetDashboardInsightsV1Response
} from '@api/dashboard/getDashboardInsightsV1/schema'

const requestDashboardInsights = safeGet(getDashboardInsightsV1ResponseSchema)

export const getDashboardInsightsV1 = (
  params: GetDashboardInsightsV1Request = {}
): Promise<GetDashboardInsightsV1Response> =>
  requestDashboardInsights(
    '/v1/dashboard/insights',
    getDashboardInsightsV1RequestSchema.parse(params)
  )

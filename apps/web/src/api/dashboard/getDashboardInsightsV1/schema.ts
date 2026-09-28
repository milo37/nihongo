import {
  getDashboardInsightsQuerySchema as canonicalGetDashboardInsightsQuerySchema,
  getDashboardInsightsResponseSchema as canonicalGetDashboardInsightsResponseSchema
} from '@nihongo/contracts/dashboard/get-dashboard-insights'
import type {
  GetDashboardInsightsQuery,
  GetDashboardInsightsResponse,
  ParsedGetDashboardInsightsQuery
} from '@nihongo/contracts/dashboard/get-dashboard-insights'

export const getDashboardInsightsV1RequestSchema =
  canonicalGetDashboardInsightsQuerySchema
export const getDashboardInsightsV1ResponseSchema =
  canonicalGetDashboardInsightsResponseSchema

export type GetDashboardInsightsV1Request = GetDashboardInsightsQuery
export type GetDashboardInsightsV1Params = ParsedGetDashboardInsightsQuery
export type GetDashboardInsightsV1Response = GetDashboardInsightsResponse

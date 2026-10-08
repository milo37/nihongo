import {
  getDashboardStatsQuerySchema as canonicalGetDashboardStatsQuerySchema,
  getDashboardStatsResponseSchema as canonicalGetDashboardStatsResponseSchema
} from '@nihongo/contracts/dashboard/get-dashboard-stats'
import type {
  GetDashboardStatsQuery,
  GetDashboardStatsResponse,
  ParsedGetDashboardStatsQuery
} from '@nihongo/contracts/dashboard/get-dashboard-stats'

export const getDashboardStatsV1RequestSchema =
  canonicalGetDashboardStatsQuerySchema
export const getDashboardStatsV1ResponseSchema =
  canonicalGetDashboardStatsResponseSchema

export type GetDashboardStatsV1Request = GetDashboardStatsQuery
export type GetDashboardStatsV1Params = ParsedGetDashboardStatsQuery
export type GetDashboardStatsV1Response = GetDashboardStatsResponse

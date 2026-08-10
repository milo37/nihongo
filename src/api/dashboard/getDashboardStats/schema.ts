import { dashboardStatsSchema } from '@api/schema'
import { z } from 'zod'

export const getDashboardStatsRequestSchema = z.object({}).strict()
export const getDashboardStatsResponseSchema = dashboardStatsSchema

export type GetDashboardStatsRequest = z.infer<
  typeof getDashboardStatsRequestSchema
>
export type GetDashboardStatsResponse = z.infer<
  typeof getDashboardStatsResponseSchema
>

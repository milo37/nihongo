import {
  createReportRequestSchema,
  createReportResponseSchema
} from '@nihongo/contracts/report/reports'

export const createReportBodySchema = createReportRequestSchema
export const createReportTransportResponseSchema = createReportResponseSchema

export type { CreateReportRequest } from '@nihongo/contracts/report/reports'

import { safePost } from '@nihongo/browser/api/http'
import {
  createReportBodySchema,
  createReportTransportResponseSchema
} from '@api/report/createReport/schema'
import type { CreateReportRequest } from '@api/report/createReport/schema'

const requestCreateReport = safePost(createReportTransportResponseSchema)

export const createReport = (body: CreateReportRequest) =>
  requestCreateReport('/v1/reports', createReportBodySchema.parse(body))

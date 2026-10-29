import type { CreateQuestionReportRequest } from '@nihongo/contracts/admin/phase7'
import { requestContentOperation } from '@nihongo/browser/api/content-operations/requestContentOperation'

export const createQuestionReport = (body: CreateQuestionReportRequest) =>
  requestContentOperation({
    operation: 'createQuestionReport',
    params: {},
    query: {},
    body
  })

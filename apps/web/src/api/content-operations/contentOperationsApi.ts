import type { CreateQuestionReportRequest } from '@nihongo/contracts/admin/phase7'
import { requestPhase7Operation } from '@nihongo/browser/api/phase7/requestPhase7Operation'

export const createQuestionReport = (body: CreateQuestionReportRequest) =>
  requestPhase7Operation({
    operation: 'createQuestionReport',
    params: {},
    query: {},
    body
  })

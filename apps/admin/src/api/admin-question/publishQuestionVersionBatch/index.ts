import { requestContentOperation } from '@nihongo/browser/api/content-operations/requestContentOperation'
import type { PublishQuestionVersionBatchRequest } from '@api/admin-question/publishQuestionVersionBatch/schema'
export const publishQuestionVersionBatch = (
  body: PublishQuestionVersionBatchRequest
) =>
  requestContentOperation({
    operation: 'publishQuestionVersionBatch',
    params: {},
    query: {},
    body
  })

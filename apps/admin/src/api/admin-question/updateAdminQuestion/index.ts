import { requestContentOperation } from '@nihongo/browser/api/content-operations/requestContentOperation'
import type { UpdateAdminQuestionRequest } from '@api/admin-question/updateAdminQuestion/schema'
export const updateAdminQuestion = (
  versionId: string,
  body: UpdateAdminQuestionRequest
) =>
  requestContentOperation({
    operation: 'updateQuestionVersion',
    params: { versionId },
    query: {},
    body: body
  })

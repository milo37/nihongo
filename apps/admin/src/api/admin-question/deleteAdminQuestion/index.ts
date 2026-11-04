import { requestContentOperation } from '@nihongo/browser/api/content-operations/requestContentOperation'
import type { DeleteAdminQuestionRequest } from '@api/admin-question/deleteAdminQuestion/schema'
export const deleteAdminQuestion = (
  questionId: string,
  body: DeleteAdminQuestionRequest
) =>
  requestContentOperation({
    operation: 'archiveAdminQuestion',
    params: { questionId },
    query: {},
    body: body
  })

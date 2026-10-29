import { requestContentOperation } from '../../content-operations/requestContentOperation'
import type { DeleteAdminQuestionRequest } from './schema'
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

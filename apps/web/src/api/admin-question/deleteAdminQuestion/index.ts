import { requestPhase7Operation } from '@api/phase7/requestPhase7Operation'
import type { DeleteAdminQuestionRequest } from '@api/admin-question/deleteAdminQuestion/schema'
export const deleteAdminQuestion = (
  questionId: string,
  body: DeleteAdminQuestionRequest
) =>
  requestPhase7Operation({
    operation: 'archiveAdminQuestion',
    params: { questionId },
    query: {},
    body: body
  })

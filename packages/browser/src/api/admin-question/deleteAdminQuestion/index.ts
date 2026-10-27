import { requestPhase7Operation } from '../../phase7/requestPhase7Operation'
import type { DeleteAdminQuestionRequest } from './schema'
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

import { requestPhase7Operation } from '../../phase7/requestPhase7Operation'
import type { UpdateAdminQuestionRequest } from './schema'
export const updateAdminQuestion = (
  versionId: string,
  body: UpdateAdminQuestionRequest
) =>
  requestPhase7Operation({
    operation: 'updateQuestionVersion',
    params: { versionId },
    query: {},
    body: body
  })

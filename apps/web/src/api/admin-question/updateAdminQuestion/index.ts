import { requestPhase7Operation } from '@api/phase7/requestPhase7Operation'
import type { UpdateAdminQuestionRequest } from '@api/admin-question/updateAdminQuestion/schema'
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

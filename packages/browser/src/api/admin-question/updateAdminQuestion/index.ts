import { requestContentOperation } from '../../content-operations/requestContentOperation'
import type { UpdateAdminQuestionRequest } from './schema'
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

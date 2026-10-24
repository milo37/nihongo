import { requestPhase7Operation } from '@api/phase7/requestPhase7Operation'
import type { CreateAdminQuestionRequest } from '@api/admin-question/createAdminQuestion/schema'
export const createAdminQuestion = (body: CreateAdminQuestionRequest) =>
  requestPhase7Operation({
    operation: 'createAdminQuestion',
    params: {},
    query: {},
    body: body
  })

import { requestPhase7Operation } from '@api/phase7/requestPhase7Operation'
import type { ListAdminQuestionRequest } from '@api/admin-question/listAdminQuestion/schema'
export const listAdminQuestion = (query: ListAdminQuestionRequest = {}) =>
  requestPhase7Operation({
    operation: 'listAdminQuestions',
    params: {},
    query: query,
    body: undefined
  })

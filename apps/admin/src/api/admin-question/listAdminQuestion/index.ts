import { requestContentOperation } from '@nihongo/browser/api/content-operations/requestContentOperation'
import type { ListAdminQuestionRequest } from '@api/admin-question/listAdminQuestion/schema'
export const listAdminQuestion = (query: ListAdminQuestionRequest = {}) =>
  requestContentOperation({
    operation: 'listAdminQuestions',
    params: {},
    query: query,
    body: undefined
  })

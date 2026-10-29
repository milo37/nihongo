import { requestContentOperation } from '../../content-operations/requestContentOperation'
import type { ListAdminQuestionRequest } from './schema'
export const listAdminQuestion = (query: ListAdminQuestionRequest = {}) =>
  requestContentOperation({
    operation: 'listAdminQuestions',
    params: {},
    query: query,
    body: undefined
  })

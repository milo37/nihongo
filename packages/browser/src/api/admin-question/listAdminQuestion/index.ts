import { requestPhase7Operation } from '../../phase7/requestPhase7Operation'
import type { ListAdminQuestionRequest } from './schema'
export const listAdminQuestion = (query: ListAdminQuestionRequest = {}) =>
  requestPhase7Operation({
    operation: 'listAdminQuestions',
    params: {},
    query: query,
    body: undefined
  })

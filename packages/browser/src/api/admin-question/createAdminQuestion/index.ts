import { requestContentOperation } from '../../content-operations/requestContentOperation'
import type { CreateAdminQuestionRequest } from './schema'
export const createAdminQuestion = (body: CreateAdminQuestionRequest) =>
  requestContentOperation({
    operation: 'createAdminQuestion',
    params: {},
    query: {},
    body: body
  })

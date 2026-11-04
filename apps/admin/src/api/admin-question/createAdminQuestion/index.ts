import { requestContentOperation } from '@nihongo/browser/api/content-operations/requestContentOperation'
import type { CreateAdminQuestionRequest } from '@api/admin-question/createAdminQuestion/schema'
export const createAdminQuestion = (body: CreateAdminQuestionRequest) =>
  requestContentOperation({
    operation: 'createAdminQuestion',
    params: {},
    query: {},
    body: body
  })

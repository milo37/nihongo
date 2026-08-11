import {
  listAdminQuestionRequestSchema,
  listAdminQuestionResponseSchema
} from '@api/admin-question/listAdminQuestion/schema'
import type {
  ListAdminQuestionRequest,
  ListAdminQuestionResponse
} from '@api/admin-question/listAdminQuestion/schema'
import { safeGet } from '@api/http'

const requestAdminQuestionList = safeGet(listAdminQuestionResponseSchema)

export const listAdminQuestion = (
  params: ListAdminQuestionRequest = {}
): Promise<ListAdminQuestionResponse> =>
  requestAdminQuestionList(
    '/admin/question',
    listAdminQuestionRequestSchema.parse(params)
  )

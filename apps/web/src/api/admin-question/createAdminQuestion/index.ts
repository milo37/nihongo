import {
  createAdminQuestionRequestSchema,
  createAdminQuestionResponseSchema
} from '@api/admin-question/createAdminQuestion/schema'
import type {
  CreateAdminQuestionRequest,
  CreateAdminQuestionResponse
} from '@api/admin-question/createAdminQuestion/schema'
import { safePost } from '@api/http'

const requestAdminQuestionCreation = safePost(createAdminQuestionResponseSchema)

export const createAdminQuestion = (
  input: CreateAdminQuestionRequest
): Promise<CreateAdminQuestionResponse> =>
  requestAdminQuestionCreation(
    '/admin/question',
    createAdminQuestionRequestSchema.parse(input)
  )

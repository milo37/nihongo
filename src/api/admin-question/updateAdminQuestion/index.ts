import {
  updateAdminQuestionParamsSchema,
  updateAdminQuestionRequestSchema,
  updateAdminQuestionResponseSchema
} from '@api/admin-question/updateAdminQuestion/schema'
import type {
  UpdateAdminQuestionRequest,
  UpdateAdminQuestionResponse
} from '@api/admin-question/updateAdminQuestion/schema'
import { safePut } from '@api/http'

const requestAdminQuestionUpdate = safePut(updateAdminQuestionResponseSchema)

export const updateAdminQuestion = (
  questionId: string,
  input: UpdateAdminQuestionRequest
): Promise<UpdateAdminQuestionResponse> => {
  const params = updateAdminQuestionParamsSchema.parse({ questionId })
  const request = updateAdminQuestionRequestSchema.parse(input)

  return requestAdminQuestionUpdate(
    `/admin/question/${params.questionId}`,
    request
  )
}

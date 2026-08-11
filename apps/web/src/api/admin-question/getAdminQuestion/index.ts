import {
  getAdminQuestionRequestSchema,
  getAdminQuestionResponseSchema
} from '@api/admin-question/getAdminQuestion/schema'
import type { GetAdminQuestionResponse } from '@api/admin-question/getAdminQuestion/schema'
import { safeGet } from '@api/http'

const requestAdminQuestion = safeGet(getAdminQuestionResponseSchema)

export const getAdminQuestion = (
  questionId: string
): Promise<GetAdminQuestionResponse> => {
  const request = getAdminQuestionRequestSchema.parse({ questionId })

  return requestAdminQuestion(`/admin/question/${request.questionId}`)
}

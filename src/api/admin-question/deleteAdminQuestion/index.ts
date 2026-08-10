import {
  deleteAdminQuestionRequestSchema,
  deleteAdminQuestionResponseSchema
} from '@api/admin-question/deleteAdminQuestion/schema'
import type { DeleteAdminQuestionResponse } from '@api/admin-question/deleteAdminQuestion/schema'
import { safeDel } from '@api/http'

const requestAdminQuestionDeletion = safeDel(deleteAdminQuestionResponseSchema)

export const deleteAdminQuestion = (
  questionId: string
): Promise<DeleteAdminQuestionResponse> => {
  const request = deleteAdminQuestionRequestSchema.parse({ questionId })

  return requestAdminQuestionDeletion(`/admin/question/${request.questionId}`)
}

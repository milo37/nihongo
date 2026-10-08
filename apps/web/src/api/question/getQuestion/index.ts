import { safeGet } from '@api/http'
import {
  getQuestionRequestSchema,
  getQuestionResponseSchema
} from '@api/question/getQuestion/schema'
import type { GetQuestionResponse } from '@api/question/getQuestion/schema'

const requestQuestion = safeGet(getQuestionResponseSchema)

export const getQuestion = (
  questionId: string
): Promise<GetQuestionResponse> => {
  const request = getQuestionRequestSchema.parse({ questionId })

  return requestQuestion(`/v1/questions/${request.questionId}`)
}

import { safeGet } from '@nihongo/browser/api/http'
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

  return requestQuestion(`/question/${request.questionId}`)
}

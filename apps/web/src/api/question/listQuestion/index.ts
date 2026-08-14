import { safeGet } from '@api/http'
import {
  listQuestionRequestSchema,
  listQuestionResponseSchema
} from '@api/question/listQuestion/schema'
import type {
  ListQuestionRequest,
  ListQuestionResponse
} from '@api/question/listQuestion/schema'

const requestQuestionList = safeGet(listQuestionResponseSchema)

export const listQuestion = (
  params: ListQuestionRequest = {}
): Promise<ListQuestionResponse> =>
  requestQuestionList('/v1/questions', listQuestionRequestSchema.parse(params))

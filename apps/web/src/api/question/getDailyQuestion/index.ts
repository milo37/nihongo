import { safeGet } from '@nihongo/browser/api/http'
import {
  getDailyQuestionRequestSchema,
  getDailyQuestionResponseSchema
} from '@api/question/getDailyQuestion/schema'
import type {
  GetDailyQuestionQuery,
  GetDailyQuestionResponse
} from '@api/question/getDailyQuestion/schema'

const requestDailyQuestion = safeGet(getDailyQuestionResponseSchema)

export const getDailyQuestion = (
  query: GetDailyQuestionQuery,
  signal?: AbortSignal
): Promise<GetDailyQuestionResponse> =>
  requestDailyQuestion(
    '/v1/daily-question',
    getDailyQuestionRequestSchema.parse(query),
    { signal }
  )

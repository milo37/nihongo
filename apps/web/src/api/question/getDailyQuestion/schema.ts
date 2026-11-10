import {
  getDailyQuestionQuerySchema,
  getDailyQuestionResponseSchema as contractSchema
} from '@nihongo/contracts/question/get-daily-question'
import type {
  GetDailyQuestionQuery,
  GetDailyQuestionResponse
} from '@nihongo/contracts/question/get-daily-question'

export const getDailyQuestionRequestSchema = getDailyQuestionQuerySchema
export const getDailyQuestionResponseSchema = contractSchema

export type { GetDailyQuestionQuery, GetDailyQuestionResponse }

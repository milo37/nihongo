import {
  getQuestionParamsSchema,
  getQuestionResponseSchema as canonicalGetQuestionResponseSchema
} from '@nihongo/contracts/question/get-question'
import type {
  GetQuestionParams,
  GetQuestionResponse as CanonicalGetQuestionResponse
} from '@nihongo/contracts/question/get-question'

export const getQuestionRequestSchema = getQuestionParamsSchema

export const getQuestionResponseSchema = canonicalGetQuestionResponseSchema

export type GetQuestionRequest = GetQuestionParams
export type GetQuestionResponse = CanonicalGetQuestionResponse

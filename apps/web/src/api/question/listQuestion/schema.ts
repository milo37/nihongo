import {
  listQuestionsQuerySchema as canonicalListQuestionsQuerySchema,
  listQuestionsResponseSchema as canonicalListQuestionsResponseSchema
} from '@nihongo/contracts/question/list-questions'
import type {
  ListQuestionsQuery,
  ListQuestionsResponse,
  ParsedListQuestionsQuery
} from '@nihongo/contracts/question/list-questions'

export const listQuestionRequestSchema = canonicalListQuestionsQuerySchema
export const listQuestionResponseSchema = canonicalListQuestionsResponseSchema

export type ListQuestionRequest = ListQuestionsQuery
export type ListQuestionParams = ParsedListQuestionsQuery
export type ListQuestionResponse = ListQuestionsResponse

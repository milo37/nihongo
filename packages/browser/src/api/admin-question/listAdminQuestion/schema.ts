import {
  listAdminQuestionsQuerySchema as listAdminQuestionRequestSchema,
  listAdminQuestionsResponseSchema as listAdminQuestionResponseSchema
} from '@nihongo/contracts/admin/content-operations'
import type { z } from 'zod'
export { listAdminQuestionRequestSchema, listAdminQuestionResponseSchema }
export type ListAdminQuestionRequest = z.input<
  typeof listAdminQuestionRequestSchema
>
export type ListAdminQuestionResponse = z.output<
  typeof listAdminQuestionResponseSchema
>
export type ListAdminQuestionParams = z.output<
  typeof listAdminQuestionRequestSchema
>

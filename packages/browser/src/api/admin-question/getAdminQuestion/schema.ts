import {
  getAdminQuestionParamsSchema as getAdminQuestionRequestSchema,
  getAdminQuestionResponseSchema as getAdminQuestionResponseSchema
} from '@nihongo/contracts/admin/content-operations'
import type { z } from 'zod'
export { getAdminQuestionRequestSchema, getAdminQuestionResponseSchema }
export type GetAdminQuestionRequest = z.input<
  typeof getAdminQuestionRequestSchema
>
export type GetAdminQuestionResponse = z.output<
  typeof getAdminQuestionResponseSchema
>

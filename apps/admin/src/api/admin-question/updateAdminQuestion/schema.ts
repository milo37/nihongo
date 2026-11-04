import {
  updateQuestionVersionRequestSchema as updateAdminQuestionRequestSchema,
  updateQuestionVersionResponseSchema as updateAdminQuestionResponseSchema
} from '@nihongo/contracts/admin/content-operations'
import type { z } from 'zod'
export { updateAdminQuestionRequestSchema, updateAdminQuestionResponseSchema }
export type UpdateAdminQuestionRequest = z.input<
  typeof updateAdminQuestionRequestSchema
>
export type UpdateAdminQuestionResponse = z.output<
  typeof updateAdminQuestionResponseSchema
>
export { updateQuestionVersionParamsSchema as updateAdminQuestionParamsSchema } from '@nihongo/contracts/admin/content-operations'

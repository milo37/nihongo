import {
  archiveAdminQuestionRequestSchema as deleteAdminQuestionRequestSchema,
  archiveAdminQuestionResponseSchema as deleteAdminQuestionResponseSchema
} from '@nihongo/contracts/admin/content-operations'
import type { z } from 'zod'
export { deleteAdminQuestionRequestSchema, deleteAdminQuestionResponseSchema }
export type DeleteAdminQuestionRequest = z.input<
  typeof deleteAdminQuestionRequestSchema
>
export type DeleteAdminQuestionResponse = z.output<
  typeof deleteAdminQuestionResponseSchema
>

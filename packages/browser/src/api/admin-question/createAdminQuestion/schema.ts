import {
  createAdminQuestionRequestSchema as createAdminQuestionRequestSchema,
  createAdminQuestionResponseSchema as createAdminQuestionResponseSchema
} from '@nihongo/contracts/admin/content-operations'
import type { z } from 'zod'
export { createAdminQuestionRequestSchema, createAdminQuestionResponseSchema }
export type CreateAdminQuestionRequest = z.input<
  typeof createAdminQuestionRequestSchema
>
export type CreateAdminQuestionResponse = z.output<
  typeof createAdminQuestionResponseSchema
>

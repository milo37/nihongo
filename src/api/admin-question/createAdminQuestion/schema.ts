import { questionEditorInputSchema, questionRecordSchema } from '@api/schema'
import { z } from 'zod'

export const createAdminQuestionRequestSchema = questionEditorInputSchema
export const createAdminQuestionResponseSchema = questionRecordSchema

export type CreateAdminQuestionRequest = z.infer<
  typeof createAdminQuestionRequestSchema
>
export type CreateAdminQuestionResponse = z.infer<
  typeof createAdminQuestionResponseSchema
>

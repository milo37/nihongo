import { questionEditorInputSchema, questionRecordSchema } from '@api/schema'
import { z } from 'zod'

export const updateAdminQuestionParamsSchema = z
  .object({
    questionId: z.string().min(1)
  })
  .strict()

export const updateAdminQuestionRequestSchema = questionEditorInputSchema
export const updateAdminQuestionResponseSchema = questionRecordSchema

export type UpdateAdminQuestionRequest = z.infer<
  typeof updateAdminQuestionRequestSchema
>
export type UpdateAdminQuestionResponse = z.infer<
  typeof updateAdminQuestionResponseSchema
>

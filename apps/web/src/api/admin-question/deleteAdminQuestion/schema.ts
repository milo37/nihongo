import { z } from 'zod'

export const deleteAdminQuestionRequestSchema = z
  .object({
    questionId: z.string().min(1)
  })
  .strict()

export const deleteAdminQuestionResponseSchema = z
  .object({
    success: z.literal(true),
    questionId: z.string().min(1)
  })
  .strict()

export type DeleteAdminQuestionRequest = z.infer<
  typeof deleteAdminQuestionRequestSchema
>
export type DeleteAdminQuestionResponse = z.infer<
  typeof deleteAdminQuestionResponseSchema
>

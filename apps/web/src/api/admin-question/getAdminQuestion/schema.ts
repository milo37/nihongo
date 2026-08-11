import { questionRecordSchema } from '@api/schema'
import { z } from 'zod'

export const getAdminQuestionRequestSchema = z
  .object({
    questionId: z.string().min(1)
  })
  .strict()

export const getAdminQuestionResponseSchema = questionRecordSchema

export type GetAdminQuestionRequest = z.infer<
  typeof getAdminQuestionRequestSchema
>
export type GetAdminQuestionResponse = z.infer<
  typeof getAdminQuestionResponseSchema
>

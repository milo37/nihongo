import { practiceQuestionSchema } from '@api/schema'
import { z } from 'zod'

export const getQuestionRequestSchema = z
  .object({
    questionId: z.string().min(1)
  })
  .strict()

export const getQuestionResponseSchema = practiceQuestionSchema

export type GetQuestionRequest = z.infer<typeof getQuestionRequestSchema>
export type GetQuestionResponse = z.infer<typeof getQuestionResponseSchema>

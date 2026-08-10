import { bookmarkSchema, practiceQuestionSchema } from '@api/schema'
import { z } from 'zod'

export const createBookmarkRequestSchema = z
  .object({
    questionId: z.string().min(1)
  })
  .strict()

export const createBookmarkResponseSchema = z
  .object({
    bookmark: bookmarkSchema,
    question: practiceQuestionSchema
  })
  .strict()

export type CreateBookmarkRequest = z.infer<typeof createBookmarkRequestSchema>
export type CreateBookmarkResponse = z.infer<
  typeof createBookmarkResponseSchema
>

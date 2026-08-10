import { bookmarkSchema, practiceQuestionSchema } from '@api/schema'
import { z } from 'zod'

export const listBookmarkRequestSchema = z.object({}).strict()

export const listBookmarkResponseSchema = z
  .object({
    items: z.array(
      z
        .object({
          bookmark: bookmarkSchema,
          question: practiceQuestionSchema
        })
        .strict()
    ),
    total: z.number().int().nonnegative()
  })
  .strict()

export type ListBookmarkRequest = z.infer<typeof listBookmarkRequestSchema>
export type ListBookmarkResponse = z.infer<typeof listBookmarkResponseSchema>

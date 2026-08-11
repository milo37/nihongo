import { z } from 'zod'

export const deleteBookmarkRequestSchema = z
  .object({
    questionId: z.string().min(1)
  })
  .strict()

export const deleteBookmarkResponseSchema = z
  .object({
    success: z.literal(true),
    questionId: z.string().min(1)
  })
  .strict()

export type DeleteBookmarkRequest = z.infer<typeof deleteBookmarkRequestSchema>
export type DeleteBookmarkResponse = z.infer<
  typeof deleteBookmarkResponseSchema
>

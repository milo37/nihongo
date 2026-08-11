import { wrongNoteSchema } from '@api/schema'
import { z } from 'zod'

export const reviewWrongNoteParamsSchema = z
  .object({
    questionId: z.string().min(1)
  })
  .strict()

export const reviewWrongNoteRequestSchema = z
  .object({
    isCorrect: z.boolean()
  })
  .strict()

export const reviewWrongNoteResponseSchema = z
  .object({
    wrongNote: wrongNoteSchema,
    isCorrect: z.boolean()
  })
  .strict()

export type ReviewWrongNoteRequest = z.infer<
  typeof reviewWrongNoteRequestSchema
>
export type ReviewWrongNoteResponse = z.infer<
  typeof reviewWrongNoteResponseSchema
>

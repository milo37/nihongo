import { questionRecordSchema, wrongNoteSchema } from '@api/schema'
import { z } from 'zod'

export const getWrongNoteRequestSchema = z
  .object({
    questionId: z.string().min(1)
  })
  .strict()

export const getWrongNoteResponseSchema = z
  .object({
    wrongNote: wrongNoteSchema,
    question: questionRecordSchema
  })
  .strict()

export type GetWrongNoteRequest = z.infer<typeof getWrongNoteRequestSchema>
export type GetWrongNoteResponse = z.infer<typeof getWrongNoteResponseSchema>

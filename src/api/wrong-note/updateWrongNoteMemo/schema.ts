import { questionRecordSchema, wrongNoteSchema } from '@api/schema'
import { z } from 'zod'

export const updateWrongNoteMemoParamsSchema = z
  .object({
    questionId: z.string().min(1)
  })
  .strict()

export const updateWrongNoteMemoRequestSchema = z
  .object({
    memo: z.string().trim().max(2000).nullable()
  })
  .strict()

export const updateWrongNoteMemoResponseSchema = z
  .object({
    wrongNote: wrongNoteSchema,
    question: questionRecordSchema
  })
  .strict()

export type UpdateWrongNoteMemoRequest = z.infer<
  typeof updateWrongNoteMemoRequestSchema
>
export type UpdateWrongNoteMemoResponse = z.infer<
  typeof updateWrongNoteMemoResponseSchema
>

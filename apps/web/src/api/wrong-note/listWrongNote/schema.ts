import {
  jlptLevelSchema,
  questionDifficultySchema,
  questionSubjectSchema,
  questionTypeSchema,
  wrongNoteSchema,
  wrongNoteStatusSchema
} from '@api/schema'
import { z } from 'zod'

export const wrongNoteQuestionSummarySchema = z
  .object({
    id: z.string().min(1),
    level: jlptLevelSchema,
    subject: questionSubjectSchema,
    questionType: questionTypeSchema,
    questionText: z.string().min(1),
    difficulty: questionDifficultySchema,
    tags: z.array(z.string().min(1)).min(1)
  })
  .strict()

export const listWrongNoteRequestSchema = z
  .object({
    level: jlptLevelSchema.optional(),
    subject: questionSubjectSchema.optional(),
    status: wrongNoteStatusSchema.optional(),
    tag: z.string().trim().min(1).optional(),
    sort: z.enum(['RECENT', 'MOST_WRONG', 'OLDEST']).default('RECENT'),
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20)
  })
  .strict()

export const listWrongNoteResponseSchema = z
  .object({
    items: z.array(
      z
        .object({
          wrongNote: wrongNoteSchema,
          question: wrongNoteQuestionSummarySchema
        })
        .strict()
    ),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    availableTags: z.array(z.string().min(1))
  })
  .strict()

export type ListWrongNoteRequest = z.input<typeof listWrongNoteRequestSchema>
export type ListWrongNoteParams = z.output<typeof listWrongNoteRequestSchema>
export type ListWrongNoteResponse = z.infer<typeof listWrongNoteResponseSchema>

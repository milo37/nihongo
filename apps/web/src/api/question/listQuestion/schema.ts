import {
  jlptLevelSchema,
  practiceQuestionSchema,
  questionDifficultySchema,
  questionSubjectSchema,
  questionTypeSchema
} from '@api/schema'
import { z } from 'zod'

export const listQuestionRequestSchema = z
  .object({
    level: jlptLevelSchema.optional(),
    subject: questionSubjectSchema.optional(),
    questionType: questionTypeSchema.optional(),
    difficulty: questionDifficultySchema.optional(),
    search: z.string().trim().optional(),
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20)
  })
  .strict()

export const listQuestionResponseSchema = z
  .object({
    items: z.array(practiceQuestionSchema),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive()
  })
  .strict()

export type ListQuestionRequest = z.input<typeof listQuestionRequestSchema>
export type ListQuestionParams = z.output<typeof listQuestionRequestSchema>
export type ListQuestionResponse = z.infer<typeof listQuestionResponseSchema>

import {
  adminQuestionSummarySchema,
  jlptLevelSchema,
  questionDifficultySchema,
  questionStatusSchema,
  questionSubjectSchema
} from '@api/schema'
import { z } from 'zod'

export const listAdminQuestionRequestSchema = z
  .object({
    search: z.string().trim().optional(),
    level: jlptLevelSchema.optional(),
    subject: questionSubjectSchema.optional(),
    status: questionStatusSchema.optional(),
    difficulty: questionDifficultySchema.optional(),
    sort: z.enum(['RECENT', 'LEVEL', 'STATUS']).default('RECENT'),
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20)
  })
  .strict()

export const listAdminQuestionResponseSchema = z
  .object({
    items: z.array(adminQuestionSummarySchema),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive()
  })
  .strict()

export type ListAdminQuestionRequest = z.input<
  typeof listAdminQuestionRequestSchema
>
export type ListAdminQuestionParams = z.output<
  typeof listAdminQuestionRequestSchema
>
export type ListAdminQuestionResponse = z.infer<
  typeof listAdminQuestionResponseSchema
>

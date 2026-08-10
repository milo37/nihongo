import {
  jlptLevelSchema,
  practiceQuestionSchema,
  questionSubjectSchema,
  studyModeSchema,
  studySessionSchema
} from '@api/schema'
import { z } from 'zod'

export const createStudySessionRequestSchema = z
  .object({
    level: jlptLevelSchema,
    subject: questionSubjectSchema,
    mode: studyModeSchema,
    count: z.number().int().min(1).max(20),
    questionIds: z.array(z.string().min(1)).optional()
  })
  .strict()

export const createStudySessionResponseSchema = z
  .object({
    session: studySessionSchema,
    questions: z.array(practiceQuestionSchema).min(1),
    requestedCount: z.number().int().positive(),
    actualCount: z.number().int().positive(),
    usedFallback: z.boolean()
  })
  .strict()

export type CreateStudySessionRequest = z.infer<
  typeof createStudySessionRequestSchema
>
export type CreateStudySessionResponse = z.infer<
  typeof createStudySessionResponseSchema
>

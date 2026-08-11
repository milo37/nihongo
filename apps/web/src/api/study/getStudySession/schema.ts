import { practiceQuestionSchema, studySessionSchema } from '@api/schema'
import { z } from 'zod'

export const getStudySessionRequestSchema = z
  .object({
    sessionId: z.string().min(1)
  })
  .strict()

export const getStudySessionResponseSchema = z
  .object({
    session: studySessionSchema,
    questions: z.array(practiceQuestionSchema).min(1),
    requestedCount: z.number().int().positive(),
    actualCount: z.number().int().positive(),
    usedFallback: z.boolean()
  })
  .strict()

export type GetStudySessionRequest = z.infer<
  typeof getStudySessionRequestSchema
>
export type GetStudySessionResponse = z.infer<
  typeof getStudySessionResponseSchema
>

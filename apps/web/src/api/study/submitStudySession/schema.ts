import { studyAnswerInputSchema, studyResultSchema } from '@api/schema'
import { z } from 'zod'

export const submitStudySessionParamsSchema = z
  .object({
    sessionId: z.string().min(1)
  })
  .strict()

export const submitStudySessionRequestSchema = z
  .object({
    answers: z.array(studyAnswerInputSchema),
    durationSec: z.number().int().nonnegative()
  })
  .strict()

export const submitStudySessionResponseSchema = studyResultSchema

export type SubmitStudySessionRequest = z.infer<
  typeof submitStudySessionRequestSchema
>
export type SubmitStudySessionResponse = z.infer<
  typeof submitStudySessionResponseSchema
>

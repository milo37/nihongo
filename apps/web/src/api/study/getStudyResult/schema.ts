import { studyResultSchema } from '@api/schema'
import { z } from 'zod'

export const getStudyResultRequestSchema = z
  .object({
    sessionId: z.string().min(1)
  })
  .strict()

export const getStudyResultResponseSchema = studyResultSchema

export type GetStudyResultRequest = z.infer<typeof getStudyResultRequestSchema>
export type GetStudyResultResponse = z.infer<
  typeof getStudyResultResponseSchema
>

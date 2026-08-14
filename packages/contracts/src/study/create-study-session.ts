import { z } from 'zod'
import {
  jlptLevelSchema,
  questionSubjectSchema,
  studyModeSchema
} from '../common/enum.js'
import { createApiFailureSchema } from '../common/error.js'
import { opaqueIdSchema } from '../common/id.js'
import { studySessionPayloadSchema } from './study-session.js'

export const createStudySessionOperationId = 'study.createStudySession' as const

export const createStudySessionBodySchema = z
  .object({
    level: jlptLevelSchema,
    subject: questionSubjectSchema,
    mode: studyModeSchema,
    count: z.number().int().min(1).max(20),
    explicitQuestionIds: z
      .array(opaqueIdSchema)
      .min(1)
      .max(20)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        '문제 ID는 중복될 수 없습니다.'
      )
      .optional()
  })
  .strict()

export const createStudySessionResponseSchema =
  studySessionPayloadSchema.refine(
    ({ session }) => session.status === 'IN_PROGRESS',
    {
      path: ['session', 'status'],
      message: '새 학습 세션은 IN_PROGRESS 상태여야 합니다.'
    }
  )

export const createStudySessionErrorCodeSchema = z.enum([
  'INVALID_JSON',
  'INVALID_REQUEST',
  'INVALID_CSRF',
  'UNTRUSTED_ORIGIN',
  'AUTHENTICATION_REQUIRED',
  'VALIDATION_ERROR',
  'QUESTION_NOT_AVAILABLE',
  'NO_ELIGIBLE_QUESTIONS',
  'RATE_LIMITED',
  'INTERNAL_SERVER_ERROR',
  'SERVICE_UNAVAILABLE'
])

export const createStudySessionErrorSchema = createApiFailureSchema(
  createStudySessionErrorCodeSchema
)

export type CreateStudySessionBody = z.input<
  typeof createStudySessionBodySchema
>
export type ParsedCreateStudySessionBody = z.output<
  typeof createStudySessionBodySchema
>
export type CreateStudySessionResponse = z.output<
  typeof createStudySessionResponseSchema
>
export type CreateStudySessionError = z.output<
  typeof createStudySessionErrorSchema
>

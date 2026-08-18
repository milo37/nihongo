import { z } from 'zod'
import {
  jlptLevelSchema,
  questionSubjectSchema,
  studyModeSchema
} from '../common/enum.js'
import { createApiFailureSchema } from '../common/error.js'
import {
  studySessionPayloadSchema,
  versionedStudySessionPayloadSchema
} from './study-session.js'
import { practiceContractV2HeadersSchema } from './practice-contract.js'

export const createStudySessionOperationId = 'study.createStudySession' as const

export const createStudySessionBodySchema = z
  .object({
    level: jlptLevelSchema,
    subject: questionSubjectSchema,
    mode: studyModeSchema,
    count: z.number().int().min(1).max(20)
  })
  .strict()

export const createStudySessionHeadersSchema = z.object({}).strict()

export const createStudySessionV2HeadersSchema = practiceContractV2HeadersSchema

export const createStudySessionResponseSchema =
  studySessionPayloadSchema.refine(
    ({ session }) => session.status === 'IN_PROGRESS',
    {
      path: ['session', 'status'],
      message: '새 학습 세션은 IN_PROGRESS 상태여야 합니다.'
    }
  )

export const createStudySessionV2ResponseSchema =
  versionedStudySessionPayloadSchema.refine(
    ({ session }) =>
      session.status === 'IN_PROGRESS' && session.practiceContractVersion === 2,
    {
      path: ['session'],
      message: '새 v2 학습 세션은 version 2 IN_PROGRESS 상태여야 합니다.'
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
export type CreateStudySessionHeaders = z.input<
  typeof createStudySessionHeadersSchema
>
export type CreateStudySessionV2Headers = z.input<
  typeof createStudySessionV2HeadersSchema
>
export type ParsedCreateStudySessionBody = z.output<
  typeof createStudySessionBodySchema
>
export type CreateStudySessionResponse = z.output<
  typeof createStudySessionResponseSchema
>
export type CreateStudySessionV2Response = z.output<
  typeof createStudySessionV2ResponseSchema
>
export type CreateStudySessionError = z.output<
  typeof createStudySessionErrorSchema
>

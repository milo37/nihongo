import { z } from 'zod'
import { createApiFailureSchema } from '../common/error.js'
import { opaqueIdSchema } from '../common/id.js'
import { createStudySessionV2ResponseSchema } from './create-study-session.js'
import { idempotentPracticeContractV2HeadersSchema } from './practice-contract.js'

export const createResultRetrySessionOperationId =
  'study.createResultRetrySession' as const

export const createResultRetrySessionParamsSchema = z
  .object({ sessionId: opaqueIdSchema })
  .strict()

export const createResultRetrySessionHeadersSchema =
  idempotentPracticeContractV2HeadersSchema

export const createResultRetrySessionBodySchema = z.object({}).strict()

export const createResultRetrySessionResponseSchema =
  createStudySessionV2ResponseSchema.refine(
    ({ session }) => session.mode === 'RANDOM' || session.mode === 'WRONG_NOTE',
    {
      path: ['session', 'mode'],
      message:
        'retry session mode는 actor에 따라 RANDOM 또는 WRONG_NOTE여야 합니다.'
    }
  )

export const createResultRetrySessionErrorCodeSchema = z.enum([
  'AUTHENTICATION_REQUIRED',
  'AUTH_SESSION_EXPIRED',
  'GUEST_SESSION_EXPIRED',
  'INVALID_JSON',
  'INVALID_REQUEST',
  'INVALID_CSRF',
  'UNTRUSTED_ORIGIN',
  'INVALID_ID',
  'RESOURCE_NOT_FOUND',
  'IDEMPOTENCY_KEY_REQUIRED',
  'IDEMPOTENCY_KEY_REUSED',
  'STUDY_RESULT_NOT_READY',
  'NO_ELIGIBLE_QUESTIONS',
  'RATE_LIMITED',
  'INTERNAL_SERVER_ERROR',
  'SERVICE_UNAVAILABLE'
])

export const createResultRetrySessionErrorSchema = createApiFailureSchema(
  createResultRetrySessionErrorCodeSchema
)

export type CreateResultRetrySessionParams = z.input<
  typeof createResultRetrySessionParamsSchema
>
export type CreateResultRetrySessionHeaders = z.input<
  typeof createResultRetrySessionHeadersSchema
>
export type CreateResultRetrySessionBody = z.input<
  typeof createResultRetrySessionBodySchema
>
export type CreateResultRetrySessionResponse = z.output<
  typeof createResultRetrySessionResponseSchema
>
export type CreateResultRetrySessionError = z.output<
  typeof createResultRetrySessionErrorSchema
>

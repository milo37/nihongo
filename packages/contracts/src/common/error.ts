import { z, type ZodType } from 'zod'
import { requestIdSchema } from './id.js'

export const stableErrorCodeSchema = z.enum([
  'AUTHENTICATION_REQUIRED',
  'AUTH_SESSION_EXPIRED',
  'GUEST_SESSION_EXPIRED',
  'INVALID_CSRF',
  'UNTRUSTED_ORIGIN',
  'FORBIDDEN',
  'ADMIN_REQUIRED',
  'RESOURCE_NOT_FOUND',
  'INVALID_JSON',
  'INVALID_REQUEST',
  'VALIDATION_ERROR',
  'INVALID_ID',
  'INVALID_DURATION',
  'DUPLICATE_SESSION_QUESTION',
  'ANSWER_NOT_IN_SESSION',
  'DUPLICATE_ANSWER',
  'OPTION_NOT_IN_VERSION',
  'QUESTION_NOT_AVAILABLE',
  'NO_ELIGIBLE_QUESTIONS',
  'VERSION_CONFLICT',
  'QUESTION_VERSION_IMMUTABLE',
  'STUDY_SESSION_NOT_EDITABLE',
  'SESSION_ALREADY_SUBMITTED',
  'STUDY_RESULT_NOT_READY',
  'IDEMPOTENCY_KEY_REQUIRED',
  'IDEMPOTENCY_KEY_REUSED',
  'SUBMISSION_IN_PROGRESS',
  'RATE_LIMITED',
  'INTERNAL_SERVER_ERROR',
  'SERVICE_UNAVAILABLE'
])

export type StableErrorCode = z.output<typeof stableErrorCodeSchema>

export const errorStatusByCode = {
  AUTHENTICATION_REQUIRED: 401,
  AUTH_SESSION_EXPIRED: 401,
  GUEST_SESSION_EXPIRED: 401,
  INVALID_CSRF: 403,
  UNTRUSTED_ORIGIN: 403,
  FORBIDDEN: 403,
  ADMIN_REQUIRED: 403,
  RESOURCE_NOT_FOUND: 404,
  INVALID_JSON: 400,
  INVALID_REQUEST: 400,
  VALIDATION_ERROR: 422,
  INVALID_ID: 422,
  INVALID_DURATION: 422,
  DUPLICATE_SESSION_QUESTION: 422,
  ANSWER_NOT_IN_SESSION: 422,
  DUPLICATE_ANSWER: 422,
  OPTION_NOT_IN_VERSION: 422,
  QUESTION_NOT_AVAILABLE: 422,
  NO_ELIGIBLE_QUESTIONS: 404,
  VERSION_CONFLICT: 409,
  QUESTION_VERSION_IMMUTABLE: 409,
  STUDY_SESSION_NOT_EDITABLE: 409,
  SESSION_ALREADY_SUBMITTED: 409,
  STUDY_RESULT_NOT_READY: 409,
  IDEMPOTENCY_KEY_REQUIRED: 400,
  IDEMPOTENCY_KEY_REUSED: 409,
  SUBMISSION_IN_PROGRESS: 409,
  RATE_LIMITED: 429,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503
} as const satisfies Record<StableErrorCode, number>

const fieldErrorsSchema = z.record(
  z.string().min(1),
  z.array(z.string().min(1)).min(1)
)

export const createApiFailureSchema = <CodeSchema extends ZodType<string>>(
  codeSchema: CodeSchema
) =>
  z
    .object({
      code: codeSchema,
      message: z.string().min(1),
      fieldErrors: fieldErrorsSchema.optional(),
      requestId: requestIdSchema,
      retryable: z.boolean()
    })
    .strict()

export const apiFailureSchema = createApiFailureSchema(stableErrorCodeSchema)

export type ApiFailure = z.output<typeof apiFailureSchema>

import { z } from 'zod'
import { createApiFailureSchema } from '../common/error.js'
import { opaqueIdSchema } from '../common/id.js'

export const importGuestResultOperationId = 'study.importGuestResult' as const

/**
 * JLP-823: right after Google login the web calls this once. The guest's
 * last result on this device becomes the member's, and its wrong answers go
 * to the member's wrong notes by the usual rule. The guest cookie is cleared,
 * so a second call finds nothing (`importedSessionId: null`).
 */
export const importGuestResultBodySchema = z.object({}).strict()

export const importGuestResultResponseSchema = z
  .object({
    importedSessionId: opaqueIdSchema.nullable(),
    /** Wrong answers of the moved result now waiting in the wrong notes. */
    wrongAnswerCount: z.number().int().min(0).max(100)
  })
  .strict()
  .refine(
    (response) =>
      response.importedSessionId !== null || response.wrongAnswerCount === 0,
    {
      path: ['wrongAnswerCount'],
      message: '옮긴 결과가 없으면 틀린 문제 수는 0이어야 합니다.'
    }
  )

export const importGuestResultErrorCodeSchema = z.enum([
  'AUTHENTICATION_REQUIRED',
  'AUTH_SESSION_EXPIRED',
  'ACCOUNT_RESTRICTED',
  'INVALID_JSON',
  'INVALID_REQUEST',
  'INVALID_CSRF',
  'UNTRUSTED_ORIGIN',
  'RATE_LIMITED',
  'INTERNAL_SERVER_ERROR',
  'SERVICE_UNAVAILABLE'
])

export const importGuestResultErrorSchema = createApiFailureSchema(
  importGuestResultErrorCodeSchema
)

export type ImportGuestResultBody = z.input<typeof importGuestResultBodySchema>
export type ImportGuestResultResponse = z.output<
  typeof importGuestResultResponseSchema
>
export type ImportGuestResultError = z.output<
  typeof importGuestResultErrorSchema
>

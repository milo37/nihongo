import { z } from 'zod'
import { isoDateTimeSchema } from '../common/date.js'
import { jlptLevelSchema, persistedUserRoleSchema } from '../common/enum.js'
import { createApiFailureSchema } from '../common/error.js'
import { opaqueIdSchema } from '../common/id.js'

export const getCurrentPrincipalOperationId =
  'auth.getCurrentPrincipal' as const

export const authenticatedUserSchema = z
  .object({
    id: opaqueIdSchema,
    name: z.string().trim().min(1),
    role: persistedUserRoleSchema,
    targetLevel: jlptLevelSchema.nullable(),
    /** Only for ADMIN: the server side 8 hour absolute session limit. */
    adminSessionExpiresAt: isoDateTimeSchema.optional(),
    /**
     * Only for ADMIN: end of the 5 minute fresh sign-in window, or null when
     * the session is not fresh. Display hint only; commands still answer
     * FRESH_ASSURANCE_REQUIRED.
     */
    adminFreshUntil: isoDateTimeSchema.nullable().optional()
  })
  .strict()
  .refine(
    (user) =>
      (user.role === 'ADMIN') === (user.adminSessionExpiresAt !== undefined),
    {
      path: ['adminSessionExpiresAt'],
      message: '관리자에게만 세션 만료 시각이 있어야 합니다.'
    }
  )
  .refine(
    (user) => (user.role === 'ADMIN') === (user.adminFreshUntil !== undefined),
    {
      path: ['adminFreshUntil'],
      message: '관리자에게만 본인 확인 유효 시각이 있어야 합니다.'
    }
  )

export const currentPrincipalSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('GUEST') }).strict(),
  z.object({ kind: z.literal('USER'), user: authenticatedUserSchema }).strict()
])

export const getCurrentPrincipalResponseSchema = currentPrincipalSchema

export const getCurrentPrincipalErrorCodeSchema = z.enum([
  'RATE_LIMITED',
  'INTERNAL_SERVER_ERROR',
  'SERVICE_UNAVAILABLE'
])

export const getCurrentPrincipalErrorSchema = createApiFailureSchema(
  getCurrentPrincipalErrorCodeSchema
)

export type AuthenticatedUser = z.output<typeof authenticatedUserSchema>
export type CurrentPrincipal = z.output<typeof currentPrincipalSchema>
export type GetCurrentPrincipalResponse = z.output<
  typeof getCurrentPrincipalResponseSchema
>
export type GetCurrentPrincipalError = z.output<
  typeof getCurrentPrincipalErrorSchema
>

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
    adminSessionExpiresAt: isoDateTimeSchema.optional()
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

import { z } from 'zod'
import { createApiFailureSchema } from '../common/error.js'

export const deleteGuestPrincipalOperationId =
  'auth.deleteGuestPrincipal' as const

export const deleteGuestPrincipalErrorCodeSchema = z.enum([
  'INTERNAL_SERVER_ERROR',
  'SERVICE_UNAVAILABLE'
])

export const deleteGuestPrincipalErrorSchema = createApiFailureSchema(
  deleteGuestPrincipalErrorCodeSchema
)

export type DeleteGuestPrincipalError = z.output<
  typeof deleteGuestPrincipalErrorSchema
>

import { getCurrentPrincipalResponseSchema } from '@nihongo/contracts/auth/get-current-principal'
import type { AuthenticatedUser } from '@nihongo/contracts/auth/get-current-principal'

export const getCurrentUserResponseSchema =
  getCurrentPrincipalResponseSchema.transform((principal) =>
    principal.kind === 'USER' ? principal.user : null
  )

export type GetCurrentUserResponse = AuthenticatedUser | null

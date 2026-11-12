import { z } from 'zod'
import { getCurrentPrincipalResponseSchema } from '@nihongo/contracts/auth/get-current-principal'

// JLP-845: a pending account gets the restore offer instead of a session.
export const completeMockSocialSignInResponseSchema = z.union([
  getCurrentPrincipalResponseSchema,
  z.object({ restoreAvailable: z.literal(true) }).strict()
])

import { z } from 'zod'
import type { SignupConsentState } from '@nihongo/contracts/auth/signup-consent'

// #1085: the contract module's other schemas are not tree-shaken, so the
// page keeps its own copy, held to the contract type.
export const getSignupConsentResponseSchema = z.object({
  kind: z.enum(['NEW', 'EXISTING']),
  expiresAt: z.string(),
  redirect: z.string().startsWith('/'),
  // #1096: '' leaves the nickname field empty.
  nicknameDefault: z.string()
}) satisfies z.ZodType<SignupConsentState>

import { z } from 'zod'
import type { SignupConsentResponse } from '@nihongo/contracts/auth/signup-consent'

// Kept here, not imported from the contract module (see getSignupConsent).
export const agreeSignupConsentResponseSchema = z.object({
  signedIn: z.literal(true),
  redirect: z.string().startsWith('/')
}) satisfies z.ZodType<SignupConsentResponse>

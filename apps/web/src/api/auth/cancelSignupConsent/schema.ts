import { z } from 'zod'
import type { CancelSignupConsentResponse } from '@nihongo/contracts/auth/signup-consent'

// Kept here, not imported from the contract module (see getSignupConsent).
export const cancelSignupConsentResponseSchema = z.object({
  cancelled: z.literal(true)
}) satisfies z.ZodType<CancelSignupConsentResponse>

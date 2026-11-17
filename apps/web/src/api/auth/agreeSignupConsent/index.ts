import { safePost } from '@nihongo/browser/api/http'
import type { SignupConsentRequest } from '@nihongo/contracts/auth/signup-consent'
import { agreeSignupConsentResponseSchema } from '@api/auth/agreeSignupConsent/schema'
const request = safePost(agreeSignupConsentResponseSchema)
// #1085: records both checks, creates or signs in the account (200).
export const agreeSignupConsent = () =>
  request('/auth/sso/signup-consent', {
    ageConfirmed: true,
    termsConfirmed: true
  } satisfies SignupConsentRequest)

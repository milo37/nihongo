import { safePost } from '@nihongo/browser/api/http'
import { cancelSignupConsentResponseSchema } from '@api/auth/cancelSignupConsent/schema'
const request = safePost(cancelSignupConsentResponseSchema)
// #1085: drops the pending cookie; nothing was stored, so nothing is left.
export const cancelSignupConsent = () =>
  request('/auth/sso/signup-consent/cancel', {})

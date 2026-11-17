import { safeGet } from '@nihongo/browser/api/http'
import { getSignupConsentResponseSchema } from '@api/auth/getSignupConsent/schema'
const request = safeGet(getSignupConsentResponseSchema)
// #1085: reads the pending sign-up cookie set by the provider return.
export const getSignupConsent = () => request('/auth/sso/signup-consent')

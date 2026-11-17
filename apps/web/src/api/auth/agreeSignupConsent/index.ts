import { safePost } from '@nihongo/browser/api/http'
import type { SignupConsentRequest } from '@nihongo/contracts/auth/signup-consent'
import { agreeSignupConsentResponseSchema } from '@api/auth/agreeSignupConsent/schema'
const request = safePost(agreeSignupConsentResponseSchema)
// #1085: records both checks, creates or signs in the account (200).
// #1096: the account takes the nickname, never the Google name.
export const agreeSignupConsent = (nickname: string) =>
  request('/auth/sso/signup-consent', {
    nickname,
    ageConfirmed: true,
    termsConfirmed: true
  } satisfies SignupConsentRequest)

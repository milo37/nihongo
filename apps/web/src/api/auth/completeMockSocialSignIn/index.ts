import { completeMockSocialSignInResponseSchema } from '@api/auth/completeMockSocialSignIn/schema'
import type { SsoProviderId } from '@nihongo/contracts/auth/sign-in-social'
import { safePost } from '@nihongo/browser/api/http'

// This transport is loaded only by development/test mock authentication.
const requestMockCallback = safePost(completeMockSocialSignInResponseSchema)

export const completeMockSocialSignIn = (provider: SsoProviderId) =>
  requestMockCallback('/_mock/auth/social/callback', {
    provider
  })

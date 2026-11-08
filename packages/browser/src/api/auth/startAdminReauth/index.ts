import { adminFreshSsoRequestSchema } from '@nihongo/contracts/auth/admin-fresh-sso'
import type { AdminFreshSsoRequest } from '@nihongo/contracts/auth/admin-fresh-sso'
import {
  isSsoAuthorizationURLForProvider,
  signInSocialResponseSchema
} from '@nihongo/contracts/auth/sign-in-social'
import { createResponseValidationError } from '../../config'
import { safePost } from '../../http'

const requestStart = safePost(signInSocialResponseSchema)

/** Starts the admin re-verification (ADMIN_FRESH) Google sign-in. */
export const startAdminReauth = async (raw: AdminFreshSsoRequest) => {
  const input = adminFreshSsoRequestSchema.parse(raw)
  const response = await requestStart('/auth/sign-in/social', input)
  if (!isSsoAuthorizationURLForProvider(input.provider, response.url))
    throw createResponseValidationError(
      new Error('Unexpected administrator SSO provider endpoint.')
    )
  return response
}

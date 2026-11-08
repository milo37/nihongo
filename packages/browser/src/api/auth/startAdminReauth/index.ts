import { isSsoAuthorizationURLForProvider } from '@nihongo/contracts/auth/sign-in-social'
import { createResponseValidationError } from '../../config'
import { safePost } from '../../http'
import {
  startAdminReauthRequestSchema,
  startAdminReauthResponseSchema
} from './schema'
import type { StartAdminReauthRequest } from './schema'

const requestStart = safePost(startAdminReauthResponseSchema)

/** Starts the admin re-verification (ADMIN_FRESH) Google sign-in. */
export const startAdminReauth = async (raw: StartAdminReauthRequest) => {
  const input = startAdminReauthRequestSchema.parse(raw)
  const response = await requestStart('/auth/sign-in/social', input)
  if (!isSsoAuthorizationURLForProvider(input.provider, response.url))
    throw createResponseValidationError(
      new Error('Unexpected administrator SSO provider endpoint.')
    )
  return response
}

import type { AccountSsoRequest } from '@nihongo/contracts/auth/sso-account-management'
import { isSsoAuthorizationURLForProvider } from '@nihongo/contracts/auth/sign-in-social'
import { createResponseValidationError } from '@nihongo/browser/api/config'
import { safePost } from '@nihongo/browser/api/http'
import {
  startAccountSsoRequestSchema,
  startAccountSsoResponseSchema
} from '@api/auth/startAccountSso/schema'
const request = safePost(startAccountSsoResponseSchema)
export const startAccountSso = async (raw: AccountSsoRequest) => {
  const input = startAccountSsoRequestSchema.parse(raw)
  const response = await request('/auth/sign-in/social', input)
  if (!isSsoAuthorizationURLForProvider(input.provider, response.url))
    throw createResponseValidationError(
      new Error('Unexpected account SSO endpoint.')
    )
  return response
}

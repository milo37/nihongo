import { isSsoAuthorizationURLForProvider } from '@nihongo/contracts/auth/sign-in-social'
import { createResponseValidationError } from '@nihongo/browser/api/config'
import { safePost } from '@nihongo/browser/api/http'
import {
  startAdminFreshRequestSchema,
  startAdminFreshResponseSchema
} from '@api/auth/startAdminFresh/schema'
import type { AdminFreshSsoRequest } from '@api/auth/startAdminFresh/schema'
const requestStart = safePost(startAdminFreshResponseSchema)
export const startAdminFresh = async (raw: AdminFreshSsoRequest) => {
  const input = startAdminFreshRequestSchema.parse(raw)
  const response = await requestStart('/auth/sign-in/social', input)
  if (!isSsoAuthorizationURLForProvider(input.provider, response.url))
    throw createResponseValidationError(
      new Error('Unexpected administrator SSO provider endpoint.')
    )
  return response
}

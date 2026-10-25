import { isSsoAuthorizationURLForProvider } from '@nihongo/contracts/auth/sign-in-social'
import { createResponseValidationError } from '@api/config'
import { safePost } from '@api/http'
import {
  signInSocialRequestSchema,
  signInSocialResponseSchema
} from '@api/auth/signInSocial/schema'
import type {
  SignInSocialRequest,
  SignInSocialResponse
} from '@api/auth/signInSocial/schema'

const requestSocialSignIn = safePost(signInSocialResponseSchema)

export const signInSocial = async (
  rawInput: SignInSocialRequest
): Promise<SignInSocialResponse> => {
  const input = signInSocialRequestSchema.parse(rawInput)
  const response = await requestSocialSignIn('/auth/sign-in/social', input)
  if (!isSsoAuthorizationURLForProvider(input.provider, response.url)) {
    throw createResponseValidationError(
      new Error('Unexpected SSO provider authorization endpoint.')
    )
  }
  return response
}

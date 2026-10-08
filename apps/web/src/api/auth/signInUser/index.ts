import { signInUserResponseSchema } from '@api/auth/signInUser/schema'
import type {
  SignInUserRequest,
  SignInUserResponse
} from '@api/auth/signInUser/schema'
import { safePost } from '@api/http'

const requestSignIn = safePost(signInUserResponseSchema)

export const signInUser = (
  input: SignInUserRequest
): Promise<SignInUserResponse> => requestSignIn('/auth/sign-in/email', input)

import { signUpUserResponseSchema } from '@api/auth/signUpUser/schema'
import type {
  SignUpUserRequest,
  SignUpUserResponse
} from '@api/auth/signUpUser/schema'
import { safePost } from '@api/http'

const requestSignUp = safePost(signUpUserResponseSchema)

export const signUpUser = (
  input: SignUpUserRequest
): Promise<SignUpUserResponse> => requestSignUp('/auth/sign-up/email', input)

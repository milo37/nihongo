import { verifyEmailResponseSchema } from '@api/auth/verifyEmail/schema'
import type {
  VerifyEmailRequest,
  VerifyEmailResponse
} from '@api/auth/verifyEmail/schema'
import { safePost } from '@api/http'

const requestVerification = safePost(verifyEmailResponseSchema)

export const verifyEmail = (
  input: VerifyEmailRequest
): Promise<VerifyEmailResponse> =>
  requestVerification('/auth/verify-email', input)

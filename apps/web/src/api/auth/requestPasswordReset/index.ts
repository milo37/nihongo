import {
  requestPasswordResetResponseSchema,
  type RequestPasswordResetRequest,
  type RequestPasswordResetResponse
} from '@api/auth/requestPasswordReset/schema'
import { safePost } from '@api/http'

const requestReset = safePost(requestPasswordResetResponseSchema)

export const requestPasswordReset = (
  input: RequestPasswordResetRequest
): Promise<RequestPasswordResetResponse> =>
  requestReset('/auth/request-password-reset', input)

import {
  resetPasswordResponseSchema,
  type ResetPasswordRequest,
  type ResetPasswordResponse
} from '@api/auth/resetPassword/schema'
import { safePost } from '@api/http'

const requestReset = safePost(resetPasswordResponseSchema)

export const resetPassword = (
  input: ResetPasswordRequest
): Promise<ResetPasswordResponse> => requestReset('/auth/reset-password', input)

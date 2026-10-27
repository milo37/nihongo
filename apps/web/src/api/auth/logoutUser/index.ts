import { logoutUserResponseSchema } from '@api/auth/logoutUser/schema'
import type { LogoutUserResponse } from '@api/auth/logoutUser/schema'
import { safePost } from '@nihongo/browser/api/http'

const requestLogout = safePost(logoutUserResponseSchema)

export const logoutUser = (): Promise<LogoutUserResponse> =>
  requestLogout('/auth/sign-out', {})

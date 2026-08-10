import { logoutUserResponseSchema } from '@api/auth/logoutUser/schema'
import type { LogoutUserResponse } from '@api/auth/logoutUser/schema'
import { safePost } from '@api/http'

const requestLogout = safePost(logoutUserResponseSchema)

export const logoutUser = (): Promise<LogoutUserResponse> =>
  requestLogout('/auth/logout', {})

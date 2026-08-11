import { loginDemoAdminResponseSchema } from '@api/auth/loginDemoAdmin/schema'
import type { LoginDemoAdminResponse } from '@api/auth/loginDemoAdmin/schema'
import { safePost } from '@api/http'

const requestDemoAdminLogin = safePost(loginDemoAdminResponseSchema)

export const loginDemoAdmin = (): Promise<LoginDemoAdminResponse> =>
  requestDemoAdminLogin('/auth/login/admin', {})

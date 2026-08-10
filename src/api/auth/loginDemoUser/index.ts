import { loginDemoUserResponseSchema } from '@api/auth/loginDemoUser/schema'
import type { LoginDemoUserResponse } from '@api/auth/loginDemoUser/schema'
import { safePost } from '@api/http'

const requestDemoUserLogin = safePost(loginDemoUserResponseSchema)

export const loginDemoUser = (): Promise<LoginDemoUserResponse> =>
  requestDemoUserLogin('/auth/login/user', {})

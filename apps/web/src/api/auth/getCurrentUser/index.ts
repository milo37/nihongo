import { getCurrentUserResponseSchema } from '@api/auth/getCurrentUser/schema'
import type { GetCurrentUserResponse } from '@api/auth/getCurrentUser/schema'
import { safeGet } from '@api/http'

const requestCurrentUser = safeGet(getCurrentUserResponseSchema)

export const getCurrentUser = (): Promise<GetCurrentUserResponse> =>
  requestCurrentUser('/auth/current-user')

import { getCurrentUserResponseSchema } from './schema'
import type { GetCurrentUserResponse } from './schema'
import { safeGet } from '../../http'

const requestCurrentUser = safeGet(getCurrentUserResponseSchema)

export const getCurrentUser = (): Promise<GetCurrentUserResponse> =>
  requestCurrentUser('/v1/me')

import { safeGet } from '@api/http'
import { getSsoDeletionResponseSchema } from '@api/auth/getSsoDeletion/schema'
const request = safeGet(getSsoDeletionResponseSchema)
export const getSsoDeletion = () => request('/auth/sso/deletion')

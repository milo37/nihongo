import { safePost } from '@nihongo/browser/api/http'
import {
  restoreSsoAccountRequestSchema,
  restoreSsoAccountResponseSchema
} from '@api/auth/restoreSsoAccount/schema'
const request = safePost(restoreSsoAccountResponseSchema)
// JLP-845: ACTIVE again with a new session (200), or 404/409 without one.
export const restoreSsoAccount = () =>
  request('/auth/sso/restore', restoreSsoAccountRequestSchema.parse({}))

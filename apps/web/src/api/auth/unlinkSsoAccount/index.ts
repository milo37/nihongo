import { safePost } from '@nihongo/browser/api/http'
import type { UnlinkSsoAccountRequest } from '@nihongo/contracts/auth/sso-account-management'
import {
  unlinkSsoAccountRequestSchema,
  unlinkSsoAccountResponseSchema
} from '@api/auth/unlinkSsoAccount/schema'
const request = safePost(unlinkSsoAccountResponseSchema)
export const unlinkSsoAccount = (input: UnlinkSsoAccountRequest) =>
  request('/auth/sso/unlink', unlinkSsoAccountRequestSchema.parse(input))

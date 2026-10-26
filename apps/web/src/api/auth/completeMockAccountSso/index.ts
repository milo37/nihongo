import { safePost } from '@nihongo/browser/api/http'
import type { AccountSsoRequest } from '@nihongo/contracts/auth/sso-account-management'
import {
  completeMockAccountSsoRequestSchema,
  completeMockAccountSsoResponseSchema
} from '@api/auth/completeMockAccountSso/schema'
const request = safePost(completeMockAccountSsoResponseSchema)
export const completeMockAccountSso = (input: AccountSsoRequest) =>
  request(
    '/_mock/auth/account/callback',
    completeMockAccountSsoRequestSchema.parse(input)
  )

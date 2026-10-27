import type { DeleteSsoAccountRequest } from '@nihongo/contracts/auth/sso-account-management'
import { safePostWithMetadata } from '@nihongo/browser/api/http'
import {
  deleteSsoAccountRequestSchema,
  deleteSsoAccountTransportResponseSchema
} from '@api/auth/deleteSsoAccount/schema'

const request = safePostWithMetadata(deleteSsoAccountTransportResponseSchema)
export const deleteSsoAccount = (input: DeleteSsoAccountRequest) =>
  request(
    '/auth/sso/delete-account',
    deleteSsoAccountRequestSchema.parse(input)
  )

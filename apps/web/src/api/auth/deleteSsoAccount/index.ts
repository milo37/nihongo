import type { DeleteSsoAccountRequest } from '@nihongo/contracts/auth/sso-account-management'
import { createResponseValidationError } from '@api/config'
import { postWithMetadata } from '@api/http'
import {
  deleteSsoAccountRequestSchema,
  deleteSsoAccountResponseSchema
} from '@api/auth/deleteSsoAccount/schema'
export const deleteSsoAccount = async (input: DeleteSsoAccountRequest) => {
  const response = await postWithMetadata(
    '/auth/sso/delete-account',
    deleteSsoAccountRequestSchema.parse(input)
  )
  const parsed = deleteSsoAccountResponseSchema.safeParse(response.data)
  if (
    response.status !== 202 ||
    !parsed.success ||
    parsed.data.appStatus !== 'DELETION_PENDING'
  )
    throw createResponseValidationError(
      new Error('Unconfirmed account deletion acceptance.')
    )
  return parsed.data
}

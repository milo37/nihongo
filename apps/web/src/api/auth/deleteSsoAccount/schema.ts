import { z } from 'zod'
import {
  deleteSsoAccountRequestSchema as sharedRequestSchema,
  ssoAccountDeletionSchema as sharedResponseSchema
} from '@nihongo/contracts/auth/sso-account-management'

export const deleteSsoAccountRequestSchema = sharedRequestSchema
export const deleteSsoAccountResponseSchema = sharedResponseSchema
export const deleteSsoAccountTransportResponseSchema = z
  .object({
    status: z.literal(202),
    data: deleteSsoAccountResponseSchema.refine(
      (data) => data.appStatus === 'DELETION_PENDING',
      'Unconfirmed account deletion acceptance.'
    )
  })
  .transform(({ data }) => data)

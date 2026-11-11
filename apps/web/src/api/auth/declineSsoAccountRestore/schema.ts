import {
  declineSsoAccountRestoreResponseSchema as sharedResponseSchema,
  restoreSsoAccountRequestSchema as sharedRequestSchema
} from '@nihongo/contracts/auth/sso-account-management'

export const declineSsoAccountRestoreRequestSchema = sharedRequestSchema
export const declineSsoAccountRestoreResponseSchema = sharedResponseSchema

import { safePost } from '@nihongo/browser/api/http'
import {
  declineSsoAccountRestoreRequestSchema,
  declineSsoAccountRestoreResponseSchema
} from '@api/auth/declineSsoAccountRestore/schema'
const request = safePost(declineSsoAccountRestoreResponseSchema)
// JLP-845: keeps the scheduled erasure and clears the restore cookie.
export const declineSsoAccountRestore = () =>
  request(
    '/auth/sso/restore/decline',
    declineSsoAccountRestoreRequestSchema.parse({})
  )

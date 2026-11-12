import { safeGet } from '@nihongo/browser/api/http'
import { getSsoRestoreResponseSchema } from '@api/auth/getSsoRestore/schema'
const request = safeGet(getSsoRestoreResponseSchema)
// JLP-845: reads the restore cookie set by a sign-in to a pending account.
export const getSsoRestore = () => request('/auth/sso/restore')

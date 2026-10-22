import { adminFreshSsoRequestSchema as sharedRequest } from '@nihongo/contracts/auth/admin-fresh-sso'
import { signInSocialResponseSchema as sharedResponse } from '@nihongo/contracts/auth/sign-in-social'
export const startAdminFreshRequestSchema = sharedRequest
export const startAdminFreshResponseSchema = sharedResponse
export type { AdminFreshSsoRequest } from '@nihongo/contracts/auth/admin-fresh-sso'

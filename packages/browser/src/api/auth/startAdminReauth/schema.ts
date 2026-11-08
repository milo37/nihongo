import { adminFreshSsoRequestSchema } from '@nihongo/contracts/auth/admin-fresh-sso'
import { signInSocialResponseSchema } from '@nihongo/contracts/auth/sign-in-social'

export const startAdminReauthRequestSchema = adminFreshSsoRequestSchema
export const startAdminReauthResponseSchema = signInSocialResponseSchema
export type { AdminFreshSsoRequest as StartAdminReauthRequest } from '@nihongo/contracts/auth/admin-fresh-sso'

import { z } from 'zod'
import {
  relativeURL,
  safeSsoReturnPath,
  ssoProviderIdSchema
} from './sign-in-social.js'

/**
 * The account action a member re-authenticates for, carried back as
 * `/login?reauth=<value>` so the same dialog reopens (#683).
 */
export const accountReauthActionSchema = z.enum([
  'delete',
  ...ssoProviderIdSchema.options.map(
    (provider) => `unlink:${provider}` as const
  )
])
export type AccountReauthAction = z.output<typeof accountReauthActionSchema>

/**
 * Account SSO returns to sign-in, optionally with one known `reauth` action,
 * or to a page the sign-in policy allows.
 */
export const safeAccountSsoReturnPath = (value: unknown): string => {
  if (value === undefined || value === '/login') return '/login'
  const url = relativeURL(value)
  if (url?.pathname !== '/login') return safeSsoReturnPath(value)
  const keys = [...url.searchParams.keys()]
  return keys.length === 1 &&
    keys[0] === 'reauth' &&
    accountReauthActionSchema.safeParse(url.searchParams.get('reauth')).success
    ? url.pathname + url.search
    : '/login'
}

const accountSsoPurposeSchema = z.enum(['ACCOUNT_FRESH', 'ACCOUNT_LINK'])
export const accountSsoRequestSchema = z
  .object({
    purpose: accountSsoPurposeSchema,
    provider: ssoProviderIdSchema,
    callbackURL: z
      .string()
      .max(2048)
      .optional()
      .transform(safeAccountSsoReturnPath)
  })
  .strict()
export const accountFreshOutcomeSchema = z.enum([
  'REAUTHENTICATED',
  'CANCELLED',
  'FAILED',
  'INVALID_CALLBACK'
])
export const accountLinkOutcomeSchema = z.enum([
  'LINKED',
  'CANCELLED',
  'FAILED',
  'INVALID_CALLBACK'
])
const providerList = z
  .array(ssoProviderIdSchema)
  .max(2)
  .refine((v) => new Set(v).size === v.length)
export const ssoAccountCapabilitiesSchema = z
  .object({
    providers: z
      .array(
        z
          .object({
            provider: ssoProviderIdSchema,
            reauthAvailable: z.boolean(),
            canUnlink: z.boolean(),
            unlinkBlockedReason: z
              .enum(['LAST_SIGN_IN_METHOD', 'PROVIDER_UNAVAILABLE'])
              .nullable()
          })
          .strict()
          .refine((v) => v.canUnlink === (v.unlinkBlockedReason === null))
      )
      .max(2)
      .refine((v) => new Set(v.map((p) => p.provider)).size === v.length),
    linkableProviders: providerList,
    unlinkRequiresFresh: z.boolean(),
    canDelete: z.boolean(),
    // JLP-845: LAST_ACTIVE_ADMIN shows the disabled button early; the 409 on
    // deletion still covers a race.
    deletionBlockedReason: z
      .enum(['OPEN_ADMIN_WORK', 'LAST_ACTIVE_ADMIN'])
      .nullable(),
    deleteRequiresFresh: z.literal(true),
    freshVerified: z.boolean()
  })
  .strict()
  .refine((v) => v.canDelete === (v.deletionBlockedReason === null))
  .refine(
    (v) =>
      !v.linkableProviders.some((p) =>
        v.providers.some((a) => a.provider === p)
      )
  )
export const unlinkSsoAccountRequestSchema = z
  .object({ provider: ssoProviderIdSchema })
  .strict()
/** Unlink preserves server domain data but revokes ALL sessions/families. */
export const unlinkSsoAccountResponseSchema = z
  .object({ unlinked: z.literal(true), sessionRevoked: z.literal(true) })
  .strict()
export const deleteSsoAccountRequestSchema = z.object({}).strict()
const ssoProviderCleanupSchema = z
  .object({
    provider: ssoProviderIdSchema,
    // PENDING includes not attempted; it is never proof of provider revocation.
    status: z.enum(['PENDING', 'COMPLETED', 'FAILED'])
  })
  .strict()
/**
 * HTTP202 accepts erasure; DELETED covers app data only, while provider cleanup
 * remains independent. JLP-845: erasure runs at `deletionScheduledAt` (the first
 * hour after the 7-day grace period); CANCELLED means the member restored the
 * account, and has no scheduled time.
 */
export const ssoAccountDeletionSchema = z
  .object({
    appStatus: z.enum(['DELETION_PENDING', 'DELETED', 'CANCELLED']),
    // Optional only so older clients and mocks still parse; the API always sends it.
    deletionScheduledAt: z.iso.datetime().nullable().optional(),
    providerCleanup: z
      .array(ssoProviderCleanupSchema)
      .min(1)
      .max(2)
      .refine((v) => new Set(v.map((p) => p.provider)).size === v.length)
  })
  .strict()
  .refine(
    (v) => (v.appStatus === 'CANCELLED') === (v.deletionScheduledAt === null)
  )
/**
 * JLP-845: signing in to a DELETION_PENDING account returns to
 * `/login?sso=RESTORE_AVAILABLE` with a short-lived restore cookie. GET reads
 * the scheduled time; POST restores (200, new session) or declines.
 */
export const ssoAccountRestoreStateSchema = z
  .object({ deletionScheduledAt: z.iso.datetime() })
  .strict()
export const restoreSsoAccountRequestSchema = z.object({}).strict()
export const restoreSsoAccountResponseSchema = z
  .object({ restored: z.literal(true) })
  .strict()
export const declineSsoAccountRestoreResponseSchema = z
  .object({ declined: z.literal(true), deletionScheduledAt: z.iso.datetime() })
  .strict()
export const ssoAccountErrorCodeSchema = z.enum([
  'AUTHENTICATION_REQUIRED',
  'SSO_ACCOUNT_NOT_LINKED',
  'SSO_LAST_SIGN_IN_METHOD',
  'SSO_PROVIDER_UNAVAILABLE',
  'SSO_FRESH_REQUIRED',
  'SSO_ACCOUNT_DELETION_BLOCKED',
  'SSO_DELETION_RECEIPT_UNAVAILABLE',
  'SSO_ACCOUNT_OPERATION_UNAVAILABLE',
  // JLP-845: no valid restore cookie (404); erasure already started (409).
  'SSO_ACCOUNT_RESTORE_UNAVAILABLE',
  'SSO_ACCOUNT_RESTORE_TOO_LATE'
])
export type AccountSsoPurpose = z.output<typeof accountSsoPurposeSchema>
export type SsoAccountCapabilities = z.output<
  typeof ssoAccountCapabilitiesSchema
>
export type SsoAccountDeletion = z.output<typeof ssoAccountDeletionSchema>
export type SsoAccountRestoreState = z.output<
  typeof ssoAccountRestoreStateSchema
>
export type RestoreSsoAccountResponse = z.output<
  typeof restoreSsoAccountResponseSchema
>
export type DeclineSsoAccountRestoreResponse = z.output<
  typeof declineSsoAccountRestoreResponseSchema
>
export type UnlinkSsoAccountResponse = z.output<
  typeof unlinkSsoAccountResponseSchema
>
export type SsoAccountErrorCode = z.output<typeof ssoAccountErrorCodeSchema>

export type AccountSsoRequest = z.input<typeof accountSsoRequestSchema>
export type UnlinkSsoAccountRequest = z.input<
  typeof unlinkSsoAccountRequestSchema
>
export type DeleteSsoAccountRequest = z.input<
  typeof deleteSsoAccountRequestSchema
>
export type RestoreSsoAccountRequest = z.input<
  typeof restoreSsoAccountRequestSchema
>

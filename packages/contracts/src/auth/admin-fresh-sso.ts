import { z } from 'zod'
import { safeSsoReturnPath, ssoProviderIdSchema } from './sign-in-social.js'

export const safeAdminFreshReturnPath = (value: unknown): string =>
  value === undefined || value === '/login'
    ? '/login'
    : safeSsoReturnPath(value)
export const adminFreshSsoRequestSchema = z
  .object({
    purpose: z.literal('ADMIN_FRESH'),
    provider: ssoProviderIdSchema,
    callbackURL: z
      .string()
      .max(2048)
      .optional()
      .transform(safeAdminFreshReturnPath)
  })
  .strict()
export const adminFreshSsoOutcomeSchema = z.enum([
  'REAUTHENTICATED',
  'CANCELLED',
  'FAILED',
  'INVALID_CALLBACK'
])
export type AdminFreshSsoRequest = z.input<typeof adminFreshSsoRequestSchema>
export type AdminFreshSsoOutcome = z.output<typeof adminFreshSsoOutcomeSchema>

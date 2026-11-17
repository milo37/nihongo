import { z } from 'zod'

/**
 * #1085: sign-up consent before an account exists. A Google or Apple sign-in
 * of a new identity, or of a member without a consent record for the current
 * terms, returns to `/login?sso=CONSENT_REQUIRED&redirect=…` with a short
 * encrypted pending cookie and no session. GET reads the pending kind, POST
 * agrees (the account and its consent record are created together, then the
 * session cookie is set), cancel drops the cookie and leaves no record.
 * The optional event and offer notice consent is off unless the member
 * checks it; signing up never depends on it.
 */
export const SIGNUP_CONSENT_PATHS = {
  consent: '/api/auth/sso/signup-consent',
  cancel: '/api/auth/sso/signup-consent/cancel'
} as const
/** The terms version a consent records; a new version asks members again. */
export const SIGNUP_TERMS_VERSION = 'v1'
/** Seconds a pending sign-up stays open after the provider returns. */
export const SIGNUP_PENDING_SECONDS = 600

export const signupConsentKindSchema = z.enum(['NEW', 'EXISTING'])
export const signupConsentStateSchema = z
  .object({
    kind: signupConsentKindSchema,
    expiresAt: z.iso.datetime(),
    redirect: z.string().startsWith('/').max(2048)
  })
  .strict()
export const signupConsentRequestSchema = z
  .object({
    ageConfirmed: z.literal(true),
    termsConfirmed: z.literal(true),
    // Optional: event and offer notices. Sent explicitly, false when unchecked.
    marketingOptIn: z.boolean()
  })
  .strict()
export const signupConsentResponseSchema = z
  .object({
    signedIn: z.literal(true),
    redirect: z.string().startsWith('/').max(2048),
    marketingOptIn: z.boolean()
  })
  .strict()
export const cancelSignupConsentRequestSchema = z.object({}).strict()
export const cancelSignupConsentResponseSchema = z
  .object({ cancelled: z.literal(true) })
  .strict()
export const signupConsentErrorCodeSchema = z.enum([
  // 400: both required boxes must be true and marketingOptIn a boolean.
  'SIGNUP_CONSENT_REQUIRED',
  // 404: no pending cookie, or it passed its 10 minutes.
  'SIGNUP_PENDING_EXPIRED',
  // 409: the identity can no longer sign up or sign in (e.g. its email
  // belongs to another account, or the account became unavailable).
  'SIGNUP_UNAVAILABLE'
])

export type SignupConsentKind = z.output<typeof signupConsentKindSchema>
export type SignupConsentState = z.output<typeof signupConsentStateSchema>
export type SignupConsentRequest = z.input<typeof signupConsentRequestSchema>
export type SignupConsentResponse = z.output<typeof signupConsentResponseSchema>
export type CancelSignupConsentResponse = z.output<
  typeof cancelSignupConsentResponseSchema
>
export type SignupConsentErrorCode = z.output<
  typeof signupConsentErrorCodeSchema
>

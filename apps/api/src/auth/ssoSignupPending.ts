import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes
} from 'node:crypto'
import { z } from 'zod'
import {
  SIGNUP_PENDING_SECONDS,
  signupConsentKindSchema
} from '@nihongo/contracts/auth/signup-consent'
import { ssoProviderIdSchema } from '@nihongo/contracts/auth/sign-in-social'

/**
 * #1085: the pending sign-up between the provider callback and the consent.
 * It holds the verified identity (email and name included), so it is
 * AES-256-GCM encrypted with a key derived from the auth secret and lasts 10
 * minutes. No table stores it: cancelling or closing the window leaves
 * nothing in the database.
 */
const CONTEXT = 'nihongo-sso-signup-pending-v1'
const VALUE = /^[A-Za-z0-9_-]{60,4000}$/u
const payloadSchema = z
  .object({
    provider: ssoProviderIdSchema,
    accountId: z.string().min(1).max(255),
    email: z.email().max(320),
    name: z.string().trim().min(1).max(80),
    kind: signupConsentKindSchema,
    redirect: z.string().startsWith('/').max(2048),
    expiresAt: z.number().int().positive()
  })
  .strict()
export type SignupPending = z.output<typeof payloadSchema>

const key = (secret: string): Buffer =>
  Buffer.from(hkdfSync('sha256', secret, '', CONTEXT, 32))

export const createSignupPending = (
  secret: string,
  pending: Omit<SignupPending, 'expiresAt'>,
  now: number
): string => {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(secret), iv)
  cipher.setAAD(Buffer.from(CONTEXT, 'utf8'))
  const body = Buffer.concat([
    cipher.update(
      JSON.stringify(
        payloadSchema.parse({
          ...pending,
          expiresAt: Math.floor(now / 1000) + SIGNUP_PENDING_SECONDS
        })
      ),
      'utf8'
    ),
    cipher.final()
  ])
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url')
}

/** The pending sign-up, or null when the value is malformed or expired. */
export const readSignupPending = (
  secret: string,
  value: string | null,
  now: number
): SignupPending | null => {
  if (!value || !VALUE.test(value)) return null
  try {
    const raw = Buffer.from(value, 'base64url')
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key(secret),
      raw.subarray(0, 12)
    )
    decipher.setAAD(Buffer.from(CONTEXT, 'utf8'))
    decipher.setAuthTag(raw.subarray(12, 28))
    const payload = payloadSchema.parse(
      JSON.parse(
        Buffer.concat([
          decipher.update(raw.subarray(28)),
          decipher.final()
        ]).toString('utf8')
      )
    )
    return payload.expiresAt > Math.floor(now / 1000) ? payload : null
  } catch {
    return null
  }
}

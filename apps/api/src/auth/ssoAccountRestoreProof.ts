import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import type { RestorableErasure } from './accountErasureAuthority.js'

/**
 * JLP-845: the short-lived proof that the member just signed in with the
 * provider account of a DELETION_PENDING User. It is an HMAC-signed cookie, so
 * no table stores it. The restore re-checks the User, its request and the
 * authority generation under lock and steps the generation, so a proof works
 * once.
 */
export const RESTORE_PROOF_SECONDS = 600
const CONTEXT = 'nihongo-sso-account-restore-v1'
const payloadSchema = z
  .object({
    userId: z.uuid(),
    requestId: z.uuid(),
    authorityGeneration: z.number().int().positive(),
    deletionScheduledAt: z.iso.datetime(),
    expiresAt: z.number().int().positive()
  })
  .strict()
const VALUE = /^[A-Za-z0-9_-]{1,1024}\.[A-Za-z0-9_-]{43}$/u

const sign = (secret: string, body: string): string =>
  createHmac('sha256', secret).update(`${CONTEXT}\0${body}`).digest('base64url')

export const createRestoreProof = (
  secret: string,
  restore: RestorableErasure,
  now: number
): string => {
  const body = Buffer.from(
    JSON.stringify(
      payloadSchema.parse({
        userId: restore.userId,
        requestId: restore.requestId,
        authorityGeneration: restore.authorityGeneration,
        deletionScheduledAt: restore.deletionScheduledAt,
        expiresAt: Math.floor(now / 1000) + RESTORE_PROOF_SECONDS
      })
    ),
    'utf8'
  ).toString('base64url')
  return `${body}.${sign(secret, body)}`
}

/** The signed restore data, or null when the value is malformed or expired. */
export const readRestoreProof = (
  secret: string,
  value: string | null,
  now: number
): RestorableErasure | null => {
  if (!value || !VALUE.test(value)) return null
  const [body, mac] = value.split('.') as [string, string]
  const expected = Buffer.from(sign(secret, body), 'utf8')
  const actual = Buffer.from(mac, 'utf8')
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
    return null
  try {
    const payload = payloadSchema.parse(
      JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    )
    if (payload.expiresAt <= Math.floor(now / 1000)) return null
    return {
      userId: payload.userId,
      requestId: payload.requestId,
      authorityGeneration: payload.authorityGeneration,
      deletionScheduledAt: payload.deletionScheduledAt
    }
  } catch {
    return null
  }
}

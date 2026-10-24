import { randomBytes, randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { PrismaClient } from '../generated/prisma/client.js'
import type { SsoVerifiedIdentity } from './ssoProtocol.js'

const mappingSchema = z.discriminatedUnion('outcome', [
  z
    .object({
      outcome: z.literal('RESOLVED'),
      userId: z.uuid(),
      authorityGeneration: z.number().int().positive(),
      role: z.enum(['USER', 'ADMIN']),
      accountStatus: z.literal('ACTIVE')
    })
    .strict(),
  z
    .object({
      outcome: z.enum([
        'TRANSITION_REQUIRED',
        'IDENTITY_CONFLICT',
        'ACCOUNT_UNAVAILABLE'
      ])
    })
    .strict()
])
const issuedSchema = z
  .object({
    id: z.uuid(),
    familyId: z.uuid(),
    createdAt: z.date(),
    expiresAt: z.date(),
    authorityGeneration: z.number().int().positive()
  })
  .strict()
const identitySchema = z
  .object({
    provider: z.enum(['apple', 'google']),
    accountId: z.string().min(1).max(255),
    email: z.email().max(320),
    name: z.string().trim().min(1).max(80)
  })
  .strict()
export type SsoIdentityResult =
  | {
      kind: 'SESSION_CONFIRMED'
      token: string
      createdAt: Date
      expiresAt: Date
    }
  | {
      kind: 'TRANSITION_REQUIRED' | 'IDENTITY_CONFLICT' | 'ACCOUNT_UNAVAILABLE'
    }
export interface SsoIdentityPort {
  signIn: (
    identity: SsoVerifiedIdentity,
    metadata: { ipAddress: string; userAgent: string }
  ) => Promise<SsoIdentityResult>
}

export const createSsoIdentityRepository = (
  client: Pick<PrismaClient, '$queryRawUnsafe'>
): SsoIdentityPort => ({
  signIn: async (untrustedIdentity, metadata) => {
    const identity = identitySchema.parse(untrustedIdentity)
    const rows = await client.$queryRawUnsafe<Array<{ result: unknown }>>(
      'SELECT "phase7_resolve_sso_identity"($1, $2, $3, $4) AS result',
      identity.provider,
      identity.accountId,
      identity.email.toLowerCase(),
      identity.name
    )
    if (rows.length !== 1)
      throw new Error('SSO identity resolution unavailable.')
    const authority = mappingSchema.parse(rows[0]?.result)
    if (authority.outcome !== 'RESOLVED') return { kind: authority.outcome }
    const sessionId = randomUUID()
    const token = randomBytes(32).toString('base64url')
    const compensate = async (): Promise<void> => {
      try {
        await client.$queryRawUnsafe(
          'SELECT "phase7_owned_sign_out"($1)',
          token
        )
      } catch {
        /* Never deliver an unconfirmed cookie. */
      }
    }
    try {
      const issued = await client.$queryRawUnsafe<unknown[]>(
        'SELECT * FROM "phase7_issue_v1_session"($1, $2, $3::"UserRole", $4::"UserAccountStatus", $5, $6, $7, $8, true)',
        authority.userId,
        authority.authorityGeneration,
        authority.role,
        authority.accountStatus,
        sessionId,
        token,
        metadata.ipAddress,
        metadata.userAgent.slice(0, 512)
      )
      if (issued.length !== 1)
        throw new Error('SSO session issuance unavailable.')
      const session = issuedSchema.parse(issued[0])
      if (
        session.id !== sessionId ||
        session.authorityGeneration !== authority.authorityGeneration ||
        session.expiresAt <= session.createdAt
      )
        throw new Error('SSO session issuance mismatch.')
      const confirmed = await client.$queryRawUnsafe<
        Array<{ confirmed: boolean }>
      >(
        'SELECT "phase7_confirm_v1_session_issuance"($1, $2, $3, $4, $5::"UserRole", $6::"UserAccountStatus") AS confirmed',
        token,
        sessionId,
        authority.userId,
        authority.authorityGeneration,
        authority.role,
        authority.accountStatus
      )
      if (confirmed.length !== 1 || confirmed[0]?.confirmed !== true)
        throw new Error('SSO session confirmation unavailable.')
      return {
        kind: 'SESSION_CONFIRMED',
        token,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt
      }
    } catch {
      await compensate()
      throw new Error('SSO session unavailable.')
    }
  }
})

import { randomBytes, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { SIGNUP_TERMS_VERSION } from '@nihongo/contracts/auth/signup-consent'
import type { PrismaClient } from '../generated/prisma/client.js'
import {
  confirmOwnedSession,
  issueOwnedSession,
  signOutOwnedSession,
  type OwnedSessionClient
} from './ownedSessionAuthority.js'
import type { SsoVerifiedIdentity } from './ssoProtocol.js'
import {
  findRestorableErasure,
  type RestorableErasure
} from './accountErasureAuthority.js'

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
  // JLP-845: no session; the member may restore the account in the grace period.
  | { kind: 'RESTORE_AVAILABLE'; restore: RestorableErasure }
/**
 * #1085: whether a verified identity may sign in now. NEW has no account and
 * no other account holds its email; EXISTING is an ACTIVE member without a
 * consent for the current terms. Both wait for the consent. PROCEED keeps
 * the sign-in as before (consented, an unavailable or restorable account, or
 * an email that already belongs to another account).
 */
export type SsoConsentState = 'PROCEED' | 'NEW' | 'EXISTING'
export interface SsoIdentityPort {
  signIn: (
    identity: SsoVerifiedIdentity,
    metadata: { ipAddress: string; userAgent: string }
  ) => Promise<SsoIdentityResult>
  consentState: (identity: SsoVerifiedIdentity) => Promise<SsoConsentState>
  /**
   * #1085: creates the account if needed and its consent, with the optional
   * event and offer notice choice, in one commit.
   */
  signUpWithConsent: (
    identity: SsoVerifiedIdentity,
    consent: { marketingOptIn: boolean },
    metadata: { ipAddress: string; userAgent: string }
  ) => Promise<SsoIdentityResult>
}

/** Issues and confirms one remembered Session for an ACTIVE User. */
export const issueConfirmedSsoSession = async (
  client: OwnedSessionClient,
  authority: {
    userId: string
    authorityGeneration: number
    role: 'USER' | 'ADMIN'
    accountStatus: 'ACTIVE'
  },
  metadata: { ipAddress: string; userAgent: string }
): Promise<Extract<SsoIdentityResult, { kind: 'SESSION_CONFIRMED' }>> => {
  const sessionId = randomUUID()
  const token = randomBytes(32).toString('base64url')
  const compensate = async (): Promise<void> => {
    try {
      await signOutOwnedSession(client, token)
    } catch {
      /* Never deliver an unconfirmed cookie. */
    }
  }
  try {
    const session = await issueOwnedSession(client, {
      userId: authority.userId,
      authorityGeneration: authority.authorityGeneration,
      role: authority.role,
      accountStatus: authority.accountStatus,
      sessionId,
      token,
      ipAddress: metadata.ipAddress,
      userAgent: metadata.userAgent.slice(0, 512),
      remember: true
    })
    if (
      session.id !== sessionId ||
      session.authorityGeneration !== authority.authorityGeneration ||
      session.expiresAt <= session.createdAt
    )
      throw new Error('SSO session issuance mismatch.')
    const confirmed = await confirmOwnedSession(client, {
      token,
      sessionId,
      userId: authority.userId,
      authorityGeneration: authority.authorityGeneration,
      role: authority.role,
      accountStatus: authority.accountStatus
    })
    if (!confirmed) throw new Error('SSO session confirmation unavailable.')
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

const resolveIdentity = async (
  client: Pick<PrismaClient, '$queryRawUnsafe'>,
  identity: z.output<typeof identitySchema>
): Promise<z.output<typeof mappingSchema>> => {
  const rows = await client.$queryRawUnsafe<Array<{ result: unknown }>>(
    'SELECT "resolve_sso_identity"($1, $2, $3, $4) AS result',
    identity.provider,
    identity.accountId,
    identity.email.toLowerCase(),
    identity.name
  )
  if (rows.length !== 1) throw new Error('SSO identity resolution unavailable.')
  return mappingSchema.parse(rows[0]?.result)
}

export const createSsoIdentityRepository = (
  client: Pick<PrismaClient, '$queryRawUnsafe'> & OwnedSessionClient
): SsoIdentityPort => ({
  consentState: async (untrustedIdentity) => {
    const identity = identitySchema.parse(untrustedIdentity)
    const rows = await client.$queryRawUnsafe<
      Array<{
        account: boolean
        active: boolean
        consented: boolean
        taken: boolean
      }>
    >(
      `SELECT member."id" IS NOT NULL AS account,
         COALESCE(member."accountStatus"::text = 'ACTIVE'
           AND member."deletedAt" IS NULL, false) AS active,
         EXISTS (SELECT 1 FROM "UserConsent" AS consent
           WHERE consent."userId" = member."id"
             AND consent."termsVersion" = $3) AS consented,
         EXISTS (SELECT 1 FROM "User" AS other
           WHERE lower(other."email") = lower($4)) AS taken
       FROM (SELECT 1) AS one
       LEFT JOIN "Account" AS account
         ON account."providerId" = $1 AND account."accountId" = $2
       LEFT JOIN "User" AS member ON member."id" = account."userId"`,
      identity.provider,
      identity.accountId,
      SIGNUP_TERMS_VERSION,
      identity.email
    )
    const row = rows[0]
    if (rows.length !== 1 || !row)
      throw new Error('SSO consent state unavailable.')
    if (!row.account) return row.taken ? 'PROCEED' : 'NEW'
    return row.active && !row.consented ? 'EXISTING' : 'PROCEED'
  },
  signUpWithConsent: async (untrustedIdentity, consent, metadata) => {
    const identity = identitySchema.parse(untrustedIdentity)
    // The account and its consent commit together; the Session follows.
    const authority = await client.$transaction(async (transaction) => {
      const resolved = await resolveIdentity(transaction, identity)
      if (resolved.outcome === 'RESOLVED')
        await transaction.$executeRawUnsafe(
          `INSERT INTO "UserConsent"
             ("userId", "termsVersion", "ageConfirmedAt", "termsConfirmedAt",
              "marketingConsented", "marketingConsentedAt")
           VALUES ($1::uuid, $2, clock_timestamp(), clock_timestamp(),
             $3::boolean, CASE WHEN $3::boolean THEN clock_timestamp() END)
           ON CONFLICT DO NOTHING`,
          resolved.userId,
          SIGNUP_TERMS_VERSION,
          consent.marketingOptIn
        )
      return resolved
    })
    if (authority.outcome !== 'RESOLVED') return { kind: authority.outcome }
    return issueConfirmedSsoSession(client, authority, metadata)
  },
  signIn: async (untrustedIdentity, metadata) => {
    const identity = identitySchema.parse(untrustedIdentity)
    const authority = await resolveIdentity(client, identity)
    if (authority.outcome === 'ACCOUNT_UNAVAILABLE') {
      const restore = await findRestorableErasure(
        client,
        identity.provider,
        identity.accountId
      )
      if (restore) return { kind: 'RESTORE_AVAILABLE', restore }
    }
    if (authority.outcome !== 'RESOLVED') return { kind: authority.outcome }
    return issueConfirmedSsoSession(client, authority, metadata)
  }
})

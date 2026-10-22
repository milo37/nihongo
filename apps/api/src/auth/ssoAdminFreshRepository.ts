import { randomBytes, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { ssoProviderIdSchema } from '@nihongo/contracts/auth/sign-in-social'
import type { SsoProviderId } from '@nihongo/contracts/auth/sign-in-social'
import type { PrismaClient } from '../generated/prisma/client.js'
import type { SsoTransaction, SsoVerifiedIdentity } from './ssoProtocol.js'

export const adminFreshContextSchema = z
  .object({
    intentId: z.uuid(),
    userId: z.uuid(),
    sessionId: z.uuid(),
    authorityGeneration: z.number().int().positive(),
    provider: ssoProviderIdSchema,
    accountId: z.string().min(1).max(255)
  })
  .strict()
export type AdminFreshContext = z.output<typeof adminFreshContextSchema>
export interface AdminFreshTransaction
  extends Omit<SsoTransaction, 'stateDigest' | 'bindingDigest'> {
  context: AdminFreshContext
}
export interface AdminFreshSession {
  id: string
  userId: string
  token: string
  createdAt: Date
  expiresAt: Date
  callbackURL: string
}
export interface SsoAdminFreshPort {
  prepare: (
    token: string,
    provider: SsoProviderId
  ) => Promise<AdminFreshContext | null>
  create: (
    transaction: SsoTransaction,
    context: AdminFreshContext
  ) => Promise<void>
  consume: (
    state: string,
    binding: string,
    provider: SsoProviderId
  ) => Promise<AdminFreshTransaction | null>
  stageProof: (
    context: AdminFreshContext,
    identity: SsoVerifiedIdentity,
    digest: string,
    callbackURL: string
  ) => Promise<boolean>
  complete: (
    proofDigest: string,
    oldToken: string,
    metadata: { ipAddress: string; userAgent: string }
  ) => Promise<AdminFreshSession | null>
  abort: (context: AdminFreshContext) => Promise<void>
}
const transactionSchema = z
  .object({
    provider: ssoProviderIdSchema,
    nonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
    codeVerifier: z.string().regex(/^[A-Za-z0-9_-]{86}$/u),
    callbackURL: z.string().max(2048),
    context: adminFreshContextSchema
  })
  .strict()
  .refine((value) => value.provider === value.context.provider)
const sessionSchema = z
  .object({
    id: z.uuid(),
    familyId: z.uuid(),
    userId: z.uuid(),
    authorityGeneration: z.number().int().positive(),
    createdAt: z.date(),
    expiresAt: z.date(),
    callbackURL: z.string().max(2048)
  })
  .strict()
const created = (rows: Array<{ created: boolean }>): boolean =>
  rows.length === 1 && rows[0]?.created === true

export const createSsoAdminFreshRepository = (
  client: Pick<PrismaClient, '$queryRawUnsafe'>
): SsoAdminFreshPort => ({
  prepare: async (token, provider) => {
    const rows = await client.$queryRawUnsafe<Array<{ context: unknown }>>(
      'SELECT "phase7_prepare_sso_admin_fresh"($1,$2) AS context',
      token,
      provider
    )
    if (rows.length !== 1)
      throw new Error('ADMIN_FRESH preparation unavailable.')
    if (rows[0]?.context === null) return null
    const context = adminFreshContextSchema.parse(rows[0]?.context)
    if (context.provider !== provider)
      throw new Error('ADMIN_FRESH provider mismatch.')
    return context
  },
  create: async (transaction, context) => {
    const rows = await client.$queryRawUnsafe<Array<{ created: boolean }>>(
      'SELECT "phase7_create_sso_admin_fresh_transaction"($1,$2,$3,$4,$5,$6,$7::jsonb) AS created',
      transaction.provider,
      transaction.stateDigest,
      transaction.bindingDigest,
      transaction.nonce,
      transaction.codeVerifier,
      transaction.callbackURL,
      JSON.stringify(adminFreshContextSchema.parse(context))
    )
    if (!created(rows)) throw new Error('ADMIN_FRESH transaction unavailable.')
  },
  consume: async (state, binding, provider) => {
    const rows = await client.$queryRawUnsafe<unknown[]>(
      'SELECT * FROM "phase7_consume_sso_admin_fresh_transaction"($1,$2,$3)',
      provider,
      state,
      binding
    )
    if (rows.length === 0) return null
    if (rows.length !== 1) throw new Error('Invalid ADMIN_FRESH consumption.')
    return transactionSchema.parse(rows[0])
  },
  stageProof: async (context, identity, digest, callbackURL) => {
    if (
      context.provider !== identity.provider ||
      context.accountId !== identity.accountId
    )
      return false
    const rows = await client.$queryRawUnsafe<Array<{ created: boolean }>>(
      'SELECT "phase7_stage_sso_admin_fresh_proof"($1::jsonb,$2,$3,$4,$5) AS created',
      JSON.stringify(context),
      identity.provider,
      identity.accountId,
      digest,
      callbackURL
    )
    return created(rows)
  },
  complete: async (proofDigest, oldToken, metadata) => {
    const id = randomUUID()
    const token = randomBytes(32).toString('base64url')
    const parse = (rows: unknown[]): AdminFreshSession | null => {
      if (rows.length === 0) return null
      if (rows.length !== 1)
        throw new Error('Invalid ADMIN_FRESH rotation result.')
      const session = sessionSchema.parse(rows[0])
      if (session.id !== id || session.expiresAt <= session.createdAt)
        throw new Error('ADMIN_FRESH rotation mismatch.')
      return {
        id,
        token,
        userId: session.userId,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
        callbackURL: session.callbackURL
      }
    }
    try {
      const rows = await client.$queryRawUnsafe<unknown[]>(
        'SELECT * FROM "phase7_complete_sso_admin_fresh"($1,$2,$3,$4,$5,$6)',
        proofDigest,
        oldToken,
        id,
        token,
        metadata.ipAddress,
        metadata.userAgent.slice(0, 512)
      )
      return parse(rows)
    } catch {
      // A lost commit response is not proof of rollback. Reconcile the exact
      // proof/new token before any compensation; never restore an old session.
      try {
        const reconciled = parse(
          await client.$queryRawUnsafe<unknown[]>(
            'SELECT * FROM "phase7_reconcile_sso_admin_fresh"($1,$2)',
            proofDigest,
            token
          )
        )
        if (reconciled) return reconciled
      } catch {
        throw new Error('ADMIN_FRESH commit outcome is unknown.')
      }
      try {
        await client.$queryRawUnsafe(
          'SELECT "phase7_cancel_sso_admin_fresh_proof"($1)',
          proofDigest
        )
      } catch {
        /* Keep the public result fail-closed. */
      }
      throw new Error('ADMIN_FRESH rotation unavailable.')
    }
  },
  abort: async (context) => {
    await client.$queryRawUnsafe(
      'SELECT "phase7_abort_reauthentication"($1)',
      context.intentId
    )
  }
})

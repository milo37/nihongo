import { randomBytes, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { ssoProviderIdSchema } from '@nihongo/contracts/auth/sign-in-social'
import type { SsoProviderId } from '@nihongo/contracts/auth/sign-in-social'
import type { PrismaClient } from '../generated/prisma/client.js'
import {
  abortReauthentication,
  cancelAdminFreshProof,
  completeAdminFresh,
  consumeAdminFreshTransaction,
  createAdminFreshTransaction,
  prepareAdminFresh,
  reconcileAdminFresh,
  stageAdminFreshProof,
  type AdminFreshClient
} from './adminFreshAuthority.js'
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
    userId: z.uuid(),
    authorityGeneration: z.number().int().positive(),
    createdAt: z.date(),
    expiresAt: z.date(),
    callbackURL: z.string().max(2048)
  })
  .strict()

export const createSsoAdminFreshRepository = (
  client: Pick<PrismaClient, '$queryRawUnsafe'> & AdminFreshClient
): SsoAdminFreshPort => ({
  prepare: async (token, provider) => {
    const prepared = await prepareAdminFresh(client, token, provider)
    if (prepared === null) return null
    const context = adminFreshContextSchema.parse(prepared)
    if (context.provider !== provider)
      throw new Error('ADMIN_FRESH provider mismatch.')
    return context
  },
  create: async (transaction, context) => {
    const createdTransaction = await createAdminFreshTransaction(client, {
      provider: transaction.provider,
      stateDigest: transaction.stateDigest,
      bindingDigest: transaction.bindingDigest,
      nonce: transaction.nonce,
      codeVerifier: transaction.codeVerifier,
      callbackURL: transaction.callbackURL,
      context: adminFreshContextSchema.parse(context)
    })
    if (!createdTransaction)
      throw new Error('ADMIN_FRESH transaction unavailable.')
  },
  consume: async (state, binding, provider) => {
    const rows = await consumeAdminFreshTransaction(
      client,
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
    return stageAdminFreshProof(client, {
      context,
      provider: identity.provider,
      accountId: identity.accountId,
      proofDigest: digest,
      callbackURL
    })
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
      const rows = await completeAdminFresh(client, {
        proofDigest,
        rawOldToken: oldToken,
        newSessionId: id,
        rawNewToken: token,
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent.slice(0, 512)
      })
      return parse(rows)
    } catch {
      // A lost commit response is not proof of rollback. Reconcile the exact
      // proof/new token before any compensation; never restore an old session.
      try {
        const reconciled = parse(
          await reconcileAdminFresh(client, proofDigest, token)
        )
        if (reconciled) return reconciled
      } catch {
        throw new Error('ADMIN_FRESH commit outcome is unknown.')
      }
      try {
        await cancelAdminFreshProof(client, proofDigest)
      } catch {
        /* Keep the public result fail-closed. */
      }
      throw new Error('ADMIN_FRESH rotation unavailable.')
    }
  },
  abort: async (context) => {
    await abortReauthentication(client, context.intentId)
  }
})

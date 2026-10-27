import { z } from 'zod'
import {
  ssoAccountCapabilitiesSchema,
  ssoAccountDeletionSchema,
  ssoAccountErrorCodeSchema,
  unlinkSsoAccountResponseSchema
} from '@nihongo/contracts/auth/sso-account-management'
import type {
  AccountSsoPurpose,
  SsoAccountCapabilities,
  SsoAccountDeletion,
  SsoAccountErrorCode,
  UnlinkSsoAccountResponse
} from '@nihongo/contracts/auth/sso-account-management'
import { ssoProviderIdSchema } from '@nihongo/contracts/auth/sign-in-social'
import type { SsoProviderId } from '@nihongo/contracts/auth/sign-in-social'
import type { PrismaClient } from '../generated/prisma/client.js'
import type { SsoTransaction, SsoVerifiedIdentity } from './ssoProtocol.js'

const digest = z.string().regex(/^[0-9a-f]{64}$/u)
export const ssoAccountContextSchema = z
  .object({
    purpose: z.enum(['ACCOUNT_FRESH', 'ACCOUNT_LINK']),
    userId: z.uuid(),
    sessionId: z.uuid(),
    role: z.enum(['USER', 'ADMIN']),
    authorityGeneration: z.number().int().positive(),
    tokenDigest: digest,
    provider: ssoProviderIdSchema,
    accountId: z.string().min(1).max(255).nullable(),
    freshProofDigest: digest.optional()
  })
  .strict()
  .refine((v) =>
    v.purpose === 'ACCOUNT_FRESH'
      ? v.accountId !== null && v.freshProofDigest === undefined
      : v.freshProofDigest !== undefined
  )
export type SsoAccountContext = z.output<typeof ssoAccountContextSchema>
export interface SsoAccountTransaction
  extends Omit<SsoTransaction, 'stateDigest' | 'bindingDigest'> {
  context: SsoAccountContext
}
export type AccountResult<T> = T | { code: SsoAccountErrorCode }
export interface SsoAccountPort {
  prepare: (
    token: string,
    provider: SsoProviderId,
    purpose: AccountSsoPurpose,
    proof: string | null
  ) => Promise<SsoAccountContext | null>
  create: (
    transaction: SsoTransaction,
    context: SsoAccountContext
  ) => Promise<void>
  consume: (
    state: string,
    binding: string,
    provider: SsoProviderId,
    purpose: AccountSsoPurpose
  ) => Promise<SsoAccountTransaction | null>
  stageProof: (
    context: SsoAccountContext,
    identity: SsoVerifiedIdentity,
    digest: string,
    callbackURL: string
  ) => Promise<boolean>
  complete: (
    digest: string,
    token: string,
    purpose: AccountSsoPurpose
  ) => Promise<string | null>
  capabilities: (
    token: string,
    available: SsoProviderId[],
    proof: string | null
  ) => Promise<SsoAccountCapabilities | null>
  unlink: (
    token: string,
    provider: SsoProviderId,
    available: SsoProviderId[],
    proof: string | null
  ) => Promise<AccountResult<UnlinkSsoAccountResponse>>
  requestErasure: (
    token: string,
    proof: string | null,
    receipt: string
  ) => Promise<AccountResult<SsoAccountDeletion>>
  erasureStatus: (receipt: string) => Promise<SsoAccountDeletion | null>
}
const transactionSchema = z
  .object({
    provider: ssoProviderIdSchema,
    nonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
    codeVerifier: z.string().regex(/^[A-Za-z0-9_-]{86}$/u),
    callbackURL: z.string().max(2048),
    context: ssoAccountContextSchema
  })
  .strict()
  .refine((v) => v.provider === v.context.provider)
const errorSchema = z.object({ code: ssoAccountErrorCodeSchema }).strict()
const boolRows = (rows: Array<{ created: boolean }>): boolean =>
  rows.length === 1 && rows[0]?.created === true
export const createSsoAccountRepository = (
  client: Pick<PrismaClient, '$queryRawUnsafe'>
): SsoAccountPort => {
  const result = async (sql: string, ...args: unknown[]): Promise<unknown> => {
    const rows = await client.$queryRawUnsafe<Array<{ result: unknown }>>(
      sql,
      ...args
    )
    if (rows.length !== 1) throw new Error('SSO account operation unavailable.')
    return rows[0]?.result
  }
  return {
    prepare: async (token, provider, purpose, proof) => {
      const raw =
        purpose === 'ACCOUNT_FRESH'
          ? await result(
              'SELECT "phase7_prepare_sso_account_fresh"($1,$2) AS result',
              token,
              provider
            )
          : await result(
              'SELECT "phase7_prepare_sso_account_link"($1,$2,$3) AS result',
              token,
              provider,
              proof
            )
      if (raw === null) return null
      const context = ssoAccountContextSchema.parse(raw)
      if (context.provider !== provider || context.purpose !== purpose)
        throw new Error('SSO account purpose mismatch.')
      return context
    },
    create: async (transaction, context) => {
      if (transaction.provider !== context.provider)
        throw new Error('SSO account provider mismatch.')
      const rows = await client.$queryRawUnsafe<Array<{ created: boolean }>>(
        'SELECT "phase7_create_sso_account_fresh_transaction"($1,$2,$3,$4,$5,$6,$7::jsonb) AS created',
        transaction.provider,
        transaction.stateDigest,
        transaction.bindingDigest,
        transaction.nonce,
        transaction.codeVerifier,
        transaction.callbackURL,
        JSON.stringify(ssoAccountContextSchema.parse(context))
      )
      if (!boolRows(rows))
        throw new Error('SSO account transaction unavailable.')
    },
    consume: async (state, binding, provider, purpose) => {
      const rows = await client.$queryRawUnsafe<unknown[]>(
        'SELECT * FROM "phase7_consume_sso_account_fresh_transaction"($1,$2,$3,$4)',
        provider,
        state,
        binding,
        purpose
      )
      if (rows.length === 0) return null
      if (rows.length !== 1)
        throw new Error('SSO account transaction unavailable.')
      const row = transactionSchema.parse(rows[0])
      if (row.context.purpose !== purpose)
        throw new Error('SSO account purpose mismatch.')
      return row
    },
    stageProof: async (context, identity, proof, callbackURL) => {
      if (
        context.provider !== identity.provider ||
        (context.purpose === 'ACCOUNT_FRESH' &&
          context.accountId !== identity.accountId)
      )
        return false
      const rows = await client.$queryRawUnsafe<Array<{ created: boolean }>>(
        'SELECT "phase7_stage_sso_account_fresh_proof"($1::jsonb,$2,$3,$4,$5) AS created',
        JSON.stringify(ssoAccountContextSchema.parse(context)),
        identity.provider,
        identity.accountId,
        proof,
        callbackURL
      )
      return boolRows(rows)
    },
    complete: async (proof, token, purpose) => {
      const raw = await result(
        purpose === 'ACCOUNT_FRESH'
          ? 'SELECT "phase7_complete_sso_account_fresh"($1,$2) AS result'
          : 'SELECT "phase7_complete_sso_account_link"($1,$2) AS result',
        proof,
        token
      )
      return raw === null ? null : z.string().max(2048).parse(raw)
    },
    capabilities: async (token, available, proof) => {
      const raw = await result(
        'SELECT "phase7_sso_account_capabilities"($1,$2::text[],$3) AS result',
        token,
        available,
        proof
      )
      return raw === null ? null : ssoAccountCapabilitiesSchema.parse(raw)
    },
    unlink: async (token, provider, available, proof) =>
      z
        .union([unlinkSsoAccountResponseSchema, errorSchema])
        .parse(
          await result(
            'SELECT "phase7_unlink_sso_account"($1,$2,$3::text[],$4) AS result',
            token,
            provider,
            available,
            proof
          )
        ),
    requestErasure: async (token, proof, receipt) =>
      z
        .union([ssoAccountDeletionSchema, errorSchema])
        .parse(
          await result(
            'SELECT "phase7_request_sso_account_erasure"($1,$2,$3) AS result',
            token,
            proof,
            receipt
          )
        ),
    erasureStatus: async (receipt) => {
      const raw = await result(
        'SELECT "phase7_sso_account_erasure_status"($1) AS result',
        receipt
      )
      return raw === null ? null : ssoAccountDeletionSchema.parse(raw)
    }
  }
}
export const ssoAccountErasureEnvironmentSchema = z.enum([
  'TEST',
  'DEVELOPMENT',
  'PRODUCTION'
])
export type SsoAccountErasureEnvironment = z.output<
  typeof ssoAccountErasureEnvironmentSchema
>
const erasureQueueSchema = z
  .array(
    z
      .object({
        id: z.uuid(),
        ...ssoAccountDeletionSchema.shape
      })
      .strict()
  )
  .max(100)
const providerCleanupClaimSchema = z
  .array(
    z
      .object({
        id: z.uuid(),
        providers: z.array(
          z
            .object({
              provider: ssoProviderIdSchema,
              subject: z.string().min(1).nullable()
            })
            .strict()
        )
      })
      .strict()
  )
  .max(100)
export type SsoProviderCleanupClaim = z.output<
  typeof providerCleanupClaimSchema
>[number]
/** Internal erasure-worker port only. No provider calls or credentials. */
export const createSsoAccountErasureWorker = (
  client: Pick<PrismaClient, '$queryRawUnsafe'>
) => ({
  list: async (
    batchSize: number,
    environment: SsoAccountErasureEnvironment
  ) => {
    const rows = await client.$queryRawUnsafe<Array<{ result: unknown }>>(
      'SELECT "phase7_list_sso_account_erasures"($1::integer,$2::"AdminAuditEnvironment") AS result',
      z.number().int().min(1).max(100).parse(batchSize),
      ssoAccountErasureEnvironmentSchema.parse(environment)
    )
    if (rows.length !== 1) throw new Error('SSO erasure queue unavailable.')
    return erasureQueueSchema.parse(rows[0]?.result)
  },
  claimProviderCleanups: async (
    batchSize: number,
    leaseSeconds: number,
    environment: SsoAccountErasureEnvironment
  ) => {
    const rows = await client.$queryRawUnsafe<Array<{ result: unknown }>>(
      'SELECT "phase7_claim_sso_provider_cleanups"($1::integer,$2::integer,$3::"AdminAuditEnvironment") AS result',
      z.number().int().min(1).max(100).parse(batchSize),
      z.number().int().min(30).max(3600).parse(leaseSeconds),
      ssoAccountErasureEnvironmentSchema.parse(environment)
    )
    if (rows.length !== 1) throw new Error('SSO provider claim unavailable.')
    return providerCleanupClaimSchema.parse(rows[0]?.result)
  },
  complete: async (
    requestId: string,
    environment: SsoAccountErasureEnvironment
  ): Promise<boolean> => {
    const rows = await client.$queryRawUnsafe<Array<{ completed: boolean }>>(
      'SELECT "phase7_complete_sso_account_erasure"($1::uuid,$2::"AdminAuditEnvironment") AS completed',
      z.uuid().parse(requestId),
      ssoAccountErasureEnvironmentSchema.parse(environment)
    )
    return rows.length === 1 && rows[0]?.completed === true
  },
  recordProviderCleanup: async (
    requestId: string,
    provider: SsoProviderId,
    status: 'COMPLETED' | 'FAILED',
    environment: SsoAccountErasureEnvironment
  ): Promise<boolean> => {
    const rows = await client.$queryRawUnsafe<Array<{ completed: boolean }>>(
      'SELECT "phase7_record_sso_provider_cleanup"($1::uuid,$2,$3,$4::"AdminAuditEnvironment") AS completed',
      z.uuid().parse(requestId),
      ssoProviderIdSchema.parse(provider),
      z.enum(['COMPLETED', 'FAILED']).parse(status),
      ssoAccountErasureEnvironmentSchema.parse(environment)
    )
    return rows.length === 1 && rows[0]?.completed === true
  }
})
export type SsoAccountErasureWorker = ReturnType<
  typeof createSsoAccountErasureWorker
>
export interface SsoAccountErasureRunResult {
  completedIds: string[]
  providerCleanupPendingIds: string[]
  failedIds: string[]
  batchLimitReached: boolean
}
/** One-shot batch: each request commits alone so one failure never blocks the rest. */
export const runSsoAccountErasureBatch = async (
  worker: Pick<SsoAccountErasureWorker, 'list' | 'complete'>,
  environment: SsoAccountErasureEnvironment,
  batchSize: number
): Promise<SsoAccountErasureRunResult> => {
  const result: SsoAccountErasureRunResult = {
    completedIds: [],
    providerCleanupPendingIds: [],
    failedIds: [],
    batchLimitReached: false
  }
  const requests = await worker.list(batchSize, environment)
  result.batchLimitReached = requests.length >= batchSize
  for (const request of requests) {
    // Provider cleanup proof is required before destructive app erasure.
    if (
      request.providerCleanup.length === 0 ||
      !request.providerCleanup.every((p) => p.status === 'COMPLETED')
    ) {
      result.providerCleanupPendingIds.push(request.id)
      continue
    }
    const deleted =
      request.appStatus === 'DELETED' ||
      (await worker.complete(request.id, environment).catch(() => false))
    if (deleted) result.completedIds.push(request.id)
    else result.failedIds.push(request.id)
  }
  return result
}

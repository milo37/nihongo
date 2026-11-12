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
import {
  completeSsoAccountErasure,
  listSsoAccountErasures,
  requestInactiveAccountErasures,
  requestSsoAccountErasure,
  restoreSsoAccount,
  ssoAccountErasureStatus,
  type RestorableErasure
} from './accountErasureAuthority.js'
import type { OwnedSessionClient } from './ownedSessionAuthority.js'
import {
  issueConfirmedSsoSession,
  type SsoIdentityResult
} from './ssoIdentityRepository.js'
import {
  accountCapabilities,
  beginProviderCleanup,
  claimProviderCleanups,
  completeAccountFresh,
  completeAccountLink,
  consumeAccountFreshTransaction,
  createAccountFreshTransaction,
  prepareAccountFresh,
  prepareAccountLink,
  recordProviderCleanup,
  stageAccountFreshProof,
  unlinkAccount
} from './ssoAccountAuthority.js'

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
interface SsoAccountTransaction
  extends Omit<SsoTransaction, 'stateDigest' | 'bindingDigest'> {
  context: SsoAccountContext
}
type AccountResult<T> = T | { code: SsoAccountErrorCode }
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
  /** JLP-845: restores the account of a restore proof and issues a Session. */
  restore: (
    proof: RestorableErasure,
    metadata: { ipAddress: string; userAgent: string }
  ) => Promise<
    | {
        code: 'SSO_ACCOUNT_RESTORE_UNAVAILABLE' | 'SSO_ACCOUNT_RESTORE_TOO_LATE'
      }
    | Extract<SsoIdentityResult, { kind: 'SESSION_CONFIRMED' }>
  >
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
export const createSsoAccountRepository = (
  client: OwnedSessionClient,
  // Runs after the request commits; #669 keeps the User id outside the
  // database so a restore can re-apply erasures requested after its dump.
  onErasureRequested?: (userId: string) => void,
  // JLP-845: runs after a restore commits, so that re-apply skips the User.
  onErasureCancelled?: (userId: string) => void
): SsoAccountPort => {
  return {
    prepare: async (token, provider, purpose, proof) => {
      const raw =
        purpose === 'ACCOUNT_FRESH'
          ? await prepareAccountFresh(client, token, provider)
          : await prepareAccountLink(client, token, provider, proof)
      if (raw === null) return null
      const context = ssoAccountContextSchema.parse(raw)
      if (context.provider !== provider || context.purpose !== purpose)
        throw new Error('SSO account purpose mismatch.')
      return context
    },
    create: async (transaction, context) => {
      if (transaction.provider !== context.provider)
        throw new Error('SSO account provider mismatch.')
      const created = await createAccountFreshTransaction(client, {
        provider: transaction.provider,
        stateDigest: transaction.stateDigest,
        bindingDigest: transaction.bindingDigest,
        nonce: transaction.nonce,
        codeVerifier: transaction.codeVerifier,
        callbackURL: transaction.callbackURL,
        context: JSON.stringify(ssoAccountContextSchema.parse(context))
      })
      if (!created) throw new Error('SSO account transaction unavailable.')
    },
    consume: async (state, binding, provider, purpose) => {
      const rows = await consumeAccountFreshTransaction(client, {
        provider,
        stateDigest: state,
        bindingDigest: binding,
        purpose
      })
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
      return stageAccountFreshProof(client, {
        context: JSON.stringify(ssoAccountContextSchema.parse(context)),
        provider: identity.provider,
        subject: identity.accountId,
        proofDigest: proof,
        callbackURL
      })
    },
    complete: async (proof, token, purpose) => {
      const raw =
        purpose === 'ACCOUNT_FRESH'
          ? await completeAccountFresh(client, proof, token)
          : await completeAccountLink(client, proof, token)
      return raw === null ? null : z.string().max(2048).parse(raw)
    },
    capabilities: async (token, available, proof) => {
      const raw = await accountCapabilities(client, token, available, proof)
      return raw === null ? null : ssoAccountCapabilitiesSchema.parse(raw)
    },
    unlink: async (token, provider, available, proof) =>
      z
        .union([unlinkSsoAccountResponseSchema, errorSchema])
        .parse(await unlinkAccount(client, token, provider, available, proof)),
    requestErasure: async (token, proof, receipt) => {
      const raw = await requestSsoAccountErasure(client, token, proof, receipt)
      if (!('userId' in raw))
        return z.union([ssoAccountDeletionSchema, errorSchema]).parse(raw)
      const { userId, ...accepted } = raw
      const result = ssoAccountDeletionSchema.parse(accepted)
      onErasureRequested?.(userId)
      return result
    },
    erasureStatus: async (receipt) => {
      const raw = await ssoAccountErasureStatus(client, receipt)
      return raw === null ? null : ssoAccountDeletionSchema.parse(raw)
    },
    restore: async (proof, metadata) => {
      const restored = await restoreSsoAccount(client, proof)
      if ('code' in restored) return restored
      onErasureCancelled?.(restored.userId)
      return issueConfirmedSsoSession(
        client,
        { ...restored, accountStatus: 'ACTIVE' },
        metadata
      )
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
        appStatus: ssoAccountDeletionSchema.shape.appStatus,
        providerCleanup: ssoAccountDeletionSchema.shape.providerCleanup
      })
      .strict()
  )
  .max(100)
const providerCleanupClaimSchema = z
  .array(
    z
      .object({
        id: z.uuid(),
        leaseToken: z.uuid(),
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
/** Internal erasure-worker port only. No provider calls or credentials. */
export const createSsoAccountErasureWorker = (
  client: Pick<
    PrismaClient,
    '$queryRawUnsafe' | '$executeRawUnsafe' | '$transaction'
  >
) => ({
  list: async (
    batchSize: number,
    environment: SsoAccountErasureEnvironment
  ) => {
    const result = await listSsoAccountErasures(
      client,
      z.number().int().min(1).max(100).parse(batchSize),
      ssoAccountErasureEnvironmentSchema.parse(environment)
    )
    if (result === undefined) throw new Error('SSO erasure queue unavailable.')
    return erasureQueueSchema.parse(result)
  },
  // JLP-852: members past a year without sign-in join the erasure queue.
  requestInactive: async (
    batchSize: number,
    environment: SsoAccountErasureEnvironment
  ) =>
    requestInactiveAccountErasures(
      client,
      z.number().int().min(1).max(100).parse(batchSize),
      ssoAccountErasureEnvironmentSchema.parse(environment)
    ),
  claimProviderCleanups: async (
    batchSize: number,
    leaseSeconds: number,
    environment: SsoAccountErasureEnvironment
  ) => {
    const result = await claimProviderCleanups(
      client,
      z.number().int().min(1).max(100).parse(batchSize),
      z.number().int().min(30).max(3600).parse(leaseSeconds),
      ssoAccountErasureEnvironmentSchema.parse(environment)
    )
    if (result === undefined) throw new Error('SSO provider claim unavailable.')
    return providerCleanupClaimSchema.parse(result)
  },
  complete: async (
    requestId: string,
    environment: SsoAccountErasureEnvironment
  ): Promise<boolean> => {
    const id = z.uuid().parse(requestId)
    const parsed = ssoAccountErasureEnvironmentSchema.parse(environment)
    return client.$transaction((transaction) =>
      completeSsoAccountErasure(transaction, id, parsed)
    )
  },
  beginProviderCleanup: async (
    requestId: string,
    provider: SsoProviderId,
    leaseToken: string,
    environment: SsoAccountErasureEnvironment
  ): Promise<boolean> => {
    return beginProviderCleanup(client, {
      requestId: z.uuid().parse(requestId),
      provider: ssoProviderIdSchema.parse(provider),
      leaseToken: z.uuid().parse(leaseToken),
      environment: ssoAccountErasureEnvironmentSchema.parse(environment)
    })
  },
  recordProviderCleanup: async (
    requestId: string,
    provider: SsoProviderId,
    status: 'COMPLETED' | 'FAILED' | 'UNAVAILABLE',
    leaseToken: string,
    environment: SsoAccountErasureEnvironment
  ): Promise<boolean> => {
    return recordProviderCleanup(client, {
      requestId: z.uuid().parse(requestId),
      provider: ssoProviderIdSchema.parse(provider),
      status: z.enum(['COMPLETED', 'FAILED', 'UNAVAILABLE']).parse(status),
      leaseToken: z.uuid().parse(leaseToken),
      environment: ssoAccountErasureEnvironmentSchema.parse(environment)
    })
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

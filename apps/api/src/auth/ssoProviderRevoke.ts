import type { SsoProviderId } from '@nihongo/contracts/auth/sign-in-social'
import type {
  SsoAccountErasureEnvironment,
  SsoAccountErasureWorker
} from './ssoAccountRepository.js'

export type SsoProviderRevokeOutcome = 'REVOKED' | 'FAILED' | 'UNAVAILABLE'
export interface SsoProviderRevokeTarget {
  provider: SsoProviderId
  subject: string
}
/** Upper bound for one adapter call, vault lookup included. */
export const SSO_PROVIDER_REVOKE_TIMEOUT_MS = 10_000
/** An adapter must settle within SSO_PROVIDER_REVOKE_TIMEOUT_MS of being called. */
export type SsoProviderRevokeAdapter = (
  target: SsoProviderRevokeTarget
) => Promise<SsoProviderRevokeOutcome>
/** Token storage is not provisioned; SSO sign-in persists no provider tokens. */
export interface SsoProviderTokenVault {
  refreshToken: (target: SsoProviderRevokeTarget) => Promise<string | null>
}

/** Default: nothing is revoked or recorded, so erasure stays pending. */
export const unavailableSsoProviderRevokeAdapter: SsoProviderRevokeAdapter =
  async () => 'UNAVAILABLE'

export const createHttpSsoProviderRevokeAdapter =
  (input: {
    tokens: SsoProviderTokenVault
    apple: { clientId: string; clientSecret: string } | null
    fetch?: typeof fetch
  }): SsoProviderRevokeAdapter =>
  async (target) => {
    // Started before the vault lookup so no request is sent after the bound.
    const signal = AbortSignal.timeout(SSO_PROVIDER_REVOKE_TIMEOUT_MS)
    const token = await input.tokens.refreshToken(target)
    if (token === null || token.length === 0) return 'UNAVAILABLE'
    let url: string
    let body: Record<string, string>
    if (target.provider === 'google') {
      url = 'https://oauth2.googleapis.com/revoke'
      body = { token }
    } else {
      if (input.apple === null) return 'UNAVAILABLE'
      url = 'https://appleid.apple.com/auth/revoke'
      body = {
        client_id: input.apple.clientId,
        client_secret: input.apple.clientSecret,
        token,
        token_type_hint: 'refresh_token'
      }
    }
    const response = await (input.fetch ?? fetch)(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body),
      signal
    }).catch(() => null)
    if (response === null) return 'FAILED'
    if (response.ok) return 'REVOKED'
    // Google answers 400 invalid_token for an already revoked or expired token.
    if (target.provider !== 'google' || response.status !== 400) return 'FAILED'
    const error = await response
      .json()
      .then((json: unknown) =>
        typeof json === 'object' && json !== null && 'error' in json
          ? json.error
          : null
      )
      .catch(() => null)
    return error === 'invalid_token' ? 'REVOKED' : 'FAILED'
  }

export interface SsoProviderRevokeRunResult {
  revoked: number
  failed: number
  unavailable: number
  /** Not called because the lease could expire mid-call; re-claimed later. */
  deferred: number
  claimLimitReached: boolean
}
// One adapter call plus its record must finish before the lease can expire.
const LEASE_RESERVE_MS = 2 * SSO_PROVIDER_REVOKE_TIMEOUT_MS
/**
 * A provider is called only while the claim's lease cannot expire before the
 * call and its record finish, so a re-claim by another one-shot never overlaps.
 */
export const runSsoProviderRevokeBatch = async (
  worker: Pick<
    SsoAccountErasureWorker,
    'claimProviderCleanups' | 'recordProviderCleanup'
  >,
  revoke: SsoProviderRevokeAdapter,
  environment: SsoAccountErasureEnvironment,
  batchSize: number,
  leaseSeconds: number,
  now: () => number = () => performance.now()
): Promise<SsoProviderRevokeRunResult> => {
  if (!Number.isFinite(leaseSeconds) || leaseSeconds * 1000 <= LEASE_RESERVE_MS)
    throw new Error('Provider lease is shorter than one revoke call.')
  const result: SsoProviderRevokeRunResult = {
    revoked: 0,
    failed: 0,
    unavailable: 0,
    deferred: 0,
    claimLimitReached: false
  }
  // Measured before the claim, so the database lease ends no earlier than this.
  const callDeadline = now() + leaseSeconds * 1000 - LEASE_RESERVE_MS
  const claims = await worker.claimProviderCleanups(
    batchSize,
    leaseSeconds,
    environment
  )
  result.claimLimitReached = claims.length >= batchSize
  for (const claim of claims) {
    for (const { provider, subject } of claim.providers) {
      if (subject !== null && now() > callDeadline) {
        result.deferred += 1
        continue
      }
      const outcome =
        subject === null
          ? 'UNAVAILABLE'
          : await revoke({ provider, subject }).catch(
              (): SsoProviderRevokeOutcome => 'FAILED'
            )
      if (outcome === 'UNAVAILABLE') {
        result.unavailable += 1
        continue
      }
      const recorded = await worker
        .recordProviderCleanup(
          claim.id,
          provider,
          outcome === 'REVOKED' ? 'COMPLETED' : 'FAILED',
          environment
        )
        .catch(() => false)
      if (outcome === 'REVOKED' && recorded) result.revoked += 1
      else result.failed += 1
    }
  }
  return result
}

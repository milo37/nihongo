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
      signal: AbortSignal.timeout(10_000)
    }).catch(() => null)
    return response?.ok === true ? 'REVOKED' : 'FAILED'
  }

export interface SsoProviderRevokeRunResult {
  revoked: number
  failed: number
  unavailable: number
  claimLimitReached: boolean
}
/** Only leased claims reach a provider, so concurrent one-shots never double-call. */
export const runSsoProviderRevokeBatch = async (
  worker: Pick<
    SsoAccountErasureWorker,
    'claimProviderCleanups' | 'recordProviderCleanup'
  >,
  revoke: SsoProviderRevokeAdapter,
  environment: SsoAccountErasureEnvironment,
  batchSize: number,
  leaseSeconds: number
): Promise<SsoProviderRevokeRunResult> => {
  const result: SsoProviderRevokeRunResult = {
    revoked: 0,
    failed: 0,
    unavailable: 0,
    claimLimitReached: false
  }
  const claims = await worker.claimProviderCleanups(
    batchSize,
    leaseSeconds,
    environment
  )
  result.claimLimitReached = claims.length >= batchSize
  for (const claim of claims) {
    for (const { provider, subject } of claim.providers) {
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

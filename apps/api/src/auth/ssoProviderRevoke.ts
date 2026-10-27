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
export const SSO_PROVIDER_REVOKE_TIMEOUT_MS = 10_000
/**
 * Respect cancellation. UNAVAILABLE proves no provider request was sent.
 * The batch bounds even adapters that ignore cancellation; their durable
 * dispatch marker prevents another worker retrying an uncertain outcome.
 */
export type SsoProviderRevokeAdapter = (
  target: SsoProviderRevokeTarget,
  signal?: AbortSignal
) => Promise<SsoProviderRevokeOutcome>
/** Token storage is not provisioned; SSO sign-in persists no provider tokens. */
export interface SsoProviderTokenVault {
  refreshToken: (
    target: SsoProviderRevokeTarget,
    signal?: AbortSignal
  ) => Promise<string | null>
}

/** Bound waiting independently of the operation's cancellation support. */
const withinDeadline = async <T>(
  deadline: number,
  now: () => number,
  operation: (signal: AbortSignal) => Promise<T>,
  parent?: AbortSignal
): Promise<T> => {
  const controller = new AbortController()
  const error = new Error('Provider cleanup deadline exceeded.')
  const remaining = deadline - now()
  if (remaining <= 0 || parent?.aborted) throw error
  let rejectTimeout: (error: Error) => void = () => {}
  const timeout = new Promise<never>((_resolve, reject) => {
    rejectTimeout = reject
  })
  const abort = () => {
    controller.abort()
    rejectTimeout(error)
  }
  const timer = setTimeout(abort, remaining)
  parent?.addEventListener('abort', abort, { once: true })
  try {
    const result = await Promise.race([
      timeout,
      Promise.resolve().then(() => {
        controller.signal.throwIfAborted()
        if (now() >= deadline) throw error
        return operation(controller.signal)
      })
    ])
    // A delayed event loop or injected clock must not admit a late result.
    if (now() >= deadline || controller.signal.aborted) throw error
    return result
  } finally {
    clearTimeout(timer)
    parent?.removeEventListener('abort', abort)
    controller.abort()
  }
}

export const unavailableSsoProviderRevokeAdapter: SsoProviderRevokeAdapter =
  async () => 'UNAVAILABLE'

export const createHttpSsoProviderRevokeAdapter =
  (input: {
    tokens: SsoProviderTokenVault
    apple: { clientId: string; clientSecret: string } | null
    fetch?: typeof fetch
  }): SsoProviderRevokeAdapter =>
  async (target, parent) => {
    const deadline = performance.now() + SSO_PROVIDER_REVOKE_TIMEOUT_MS
    return withinDeadline(
      deadline,
      () => performance.now(),
      async (signal): Promise<SsoProviderRevokeOutcome> => {
        const token = await input.tokens.refreshToken(target, signal)
        // A late vault result must never dispatch, even if the vault ignored abort.
        signal.throwIfAborted()
        if (performance.now() >= deadline)
          throw new Error('Provider cleanup deadline exceeded.')
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
        })
        if (response.ok) return 'REVOKED'
        // Google answers 400 invalid_token for an already revoked or expired token.
        if (target.provider !== 'google' || response.status !== 400)
          return 'FAILED'
        const error = await response
          .json()
          .then((json: unknown) =>
            typeof json === 'object' && json !== null && 'error' in json
              ? json.error
              : null
          )
          .catch(() => null)
        return error === 'invalid_token' ? 'REVOKED' : 'FAILED'
      },
      parent
    )
  }

export interface SsoProviderRevokeRunResult {
  revoked: number
  failed: number
  unavailable: number
  /** Not called because the lease could expire mid-call. */
  deferred: number
  claimLimitReached: boolean
}
const LEASE_RESERVE_MS = 2 * SSO_PROVIDER_REVOKE_TIMEOUT_MS
/**
 * All waits share a conservative lease deadline. SQL fences begin/record using
 * the claim token and live DB clock; unresolved dispatches cannot be re-claimed.
 */
export const runSsoProviderRevokeBatch = async (
  worker: Pick<
    SsoAccountErasureWorker,
    'claimProviderCleanups' | 'beginProviderCleanup' | 'recordProviderCleanup'
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
  // Start before claim; reserve 1ms for TIMESTAMPTZ(3) rounding in PostgreSQL.
  const leaseDeadline = now() + leaseSeconds * 1000 - 1
  const callDeadline = leaseDeadline - LEASE_RESERVE_MS
  const bounded = <T>(operation: (signal: AbortSignal) => Promise<T>) =>
    withinDeadline(
      Math.min(leaseDeadline, now() + SSO_PROVIDER_REVOKE_TIMEOUT_MS),
      now,
      operation
    )
  const claims = await bounded(() =>
    worker.claimProviderCleanups(batchSize, leaseSeconds, environment)
  )
  result.claimLimitReached = claims.length >= batchSize
  for (const claim of claims) {
    for (const { provider, subject } of claim.providers) {
      if (subject === null) {
        result.unavailable += 1
        continue
      }
      if (now() > callDeadline) {
        result.deferred += 1
        continue
      }
      const started = await bounded(() =>
        worker.beginProviderCleanup(
          claim.id,
          provider,
          claim.leaseToken,
          environment
        )
      ).catch(() => false)
      if (!started) {
        result.failed += 1
        continue
      }
      if (now() > callDeadline) {
        // No dispatch occurred. Release only with the same live claim token.
        await bounded(() =>
          worker.recordProviderCleanup(
            claim.id,
            provider,
            'UNAVAILABLE',
            claim.leaseToken,
            environment
          )
        ).catch(() => false)
        result.deferred += 1
        continue
      }
      const outcome = await bounded((signal) =>
        revoke({ provider, subject }, signal)
      ).catch(() => null)
      if (outcome === null) {
        // Unknown remote outcome: leave the durable marker, never record late.
        result.failed += 1
        continue
      }
      const recorded = await bounded(() =>
        worker.recordProviderCleanup(
          claim.id,
          provider,
          outcome === 'REVOKED' ? 'COMPLETED' : outcome,
          claim.leaseToken,
          environment
        )
      ).catch(() => false)
      if (outcome === 'REVOKED' && recorded) result.revoked += 1
      else if (outcome === 'UNAVAILABLE' && recorded) result.unavailable += 1
      else result.failed += 1
    }
  }
  return result
}

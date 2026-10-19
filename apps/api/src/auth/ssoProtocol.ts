import { createHash, randomBytes } from 'node:crypto'
import type { SsoProviderId } from '@nihongo/contracts/auth/sign-in-social'
import { safeSsoReturnPath } from '@nihongo/contracts/auth/sign-in-social'
export { safeSsoReturnPath } from '@nihongo/contracts/auth/sign-in-social'

export const SSO_TRANSACTION_SECONDS = 600
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u
export interface SsoVerifiedIdentity {
  readonly provider: SsoProviderId
  readonly accountId: string
  readonly email: string
  readonly name: string
}

export interface SsoTransaction {
  readonly provider: SsoProviderId
  readonly stateDigest: string
  readonly bindingDigest: string
  readonly nonce: string
  readonly codeVerifier: string
  readonly callbackURL: string
}

export interface SsoTransactionStore {
  readonly create: (transaction: SsoTransaction) => Promise<void>
  /** Atomically deletes and returns an unexpired, browser-bound transaction. */
  readonly consume: (
    stateDigest: string,
    bindingDigest: string,
    provider: SsoProviderId
  ) => Promise<Omit<SsoTransaction, 'stateDigest' | 'bindingDigest'> | null>
}

export interface SsoProvider {
  readonly authorizationURL: (input: {
    state: string
    nonce: string
    codeVerifier: string
  }) => Promise<string>
  readonly exchange: (input: {
    code: string
    nonce: string
    codeVerifier: string
  }) => Promise<SsoVerifiedIdentity | null>
}

export type SsoFailure = 'CANCELLED' | 'FAILED' | 'INVALID_CALLBACK'
export type SsoCallbackResult =
  | {
      readonly kind: 'IDENTITY_VERIFIED'
      readonly identity: SsoVerifiedIdentity
      readonly callbackURL: string
    }
  | { readonly kind: SsoFailure; readonly callbackURL: string }

export class SsoUnavailableError extends Error {
  constructor() {
    super('SSO_UNAVAILABLE')
    this.name = 'SsoUnavailableError'
  }
}

const hasControlOrSpace = (value: string): boolean =>
  [...value].some(
    (character) =>
      character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127
  )

export const ssoTransactionDigest = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex')

export const ssoBindingCookieName = (production: boolean): string =>
  production ? '__Host-nihongo.sso_binding' : 'nihongo.sso_binding'

export const createSsoBindingCookie = (
  binding: string | null,
  production: boolean,
  provider: SsoProviderId = 'google'
): string => {
  if (binding !== null && !TOKEN_PATTERN.test(binding)) {
    throw new TypeError('Invalid SSO browser binding.')
  }
  return `${ssoBindingCookieName(production || provider === 'apple')}=${binding ?? ''}; Path=/; HttpOnly; SameSite=${provider === 'apple' ? 'None' : 'Lax'}; Max-Age=${binding === null ? 0 : SSO_TRANSACTION_SECONDS}${production || provider === 'apple' ? '; Secure' : ''}`
}

export const readSsoBindingCookie = (
  headers: Headers,
  production: boolean,
  provider: SsoProviderId = 'google'
): string | null => {
  const matches = (headers.get('Cookie') ?? '')
    .split(';')
    .map((part) => part.trim().split('='))
    .filter(
      ([name]) =>
        name === ssoBindingCookieName(production || provider === 'apple')
    )
  if (matches.length !== 1 || matches[0]?.length !== 2) return null
  const value = matches[0]?.[1]
  return value && TOKEN_PATTERN.test(value) ? value : null
}

export const createSsoLoginService = ({
  provider,
  store,
  providerId = 'google',
  purpose = 'LOGIN',
  returnPathPolicy = safeSsoReturnPath
}: {
  provider: SsoProvider | undefined
  store: SsoTransactionStore
  providerId?: SsoProviderId
  purpose?: 'LOGIN' | 'ADMIN_FRESH' | 'ACCOUNT_FRESH' | 'ACCOUNT_LINK'
  returnPathPolicy?: (value: unknown) => string
}) => ({
  start: async (callbackURL: unknown) => {
    if (!provider) throw new SsoUnavailableError()
    let state = randomBytes(32).toString('base64url')
    if (purpose === 'ADMIN_FRESH') state = `F${state.slice(1)}`
    else if (purpose === 'ACCOUNT_FRESH') state = `A${state.slice(1)}`
    else if (purpose === 'ACCOUNT_LINK') state = `L${state.slice(1)}`
    else
      while (/^[FAL]/u.test(state))
        state = randomBytes(32).toString('base64url')
    const binding = randomBytes(32).toString('base64url')
    const nonce = randomBytes(32).toString('base64url')
    const codeVerifier = randomBytes(64).toString('base64url')
    try {
      const url = await provider.authorizationURL({
        state,
        nonce,
        codeVerifier
      })
      const target = new URL(url)
      if (
        (providerId === 'google'
          ? target.origin !== 'https://accounts.google.com' ||
            target.pathname !== '/o/oauth2/v2/auth'
          : target.origin !== 'https://appleid.apple.com' ||
            target.pathname !== '/auth/authorize' ||
            target.searchParams.get('response_mode') !== 'form_post' ||
            target.searchParams.get('response_type') !== 'code') ||
        target.username ||
        target.password ||
        target.hash ||
        target.searchParams.get('state') !== state ||
        target.searchParams.get('nonce') !== nonce ||
        target.searchParams.get('code_challenge_method') !== 'S256' ||
        target.searchParams.get('code_challenge') !==
          createHash('sha256').update(codeVerifier).digest('base64url')
      ) {
        throw new SsoUnavailableError()
      }
      await store.create({
        provider: providerId,
        stateDigest: ssoTransactionDigest(state),
        bindingDigest: ssoTransactionDigest(binding),
        nonce,
        codeVerifier,
        callbackURL: returnPathPolicy(callbackURL)
      })
      return { url, binding }
    } catch {
      throw new SsoUnavailableError()
    }
  },
  finish: async ({
    query,
    binding
  }: {
    query: URLSearchParams
    binding: string | null
  }): Promise<SsoCallbackResult> => {
    const invalid = { kind: 'INVALID_CALLBACK', callbackURL: '/' } as const
    const seen = new Set<string>()
    for (const key of query.keys()) {
      if (seen.has(key)) return invalid
      seen.add(key)
    }
    const state = query.get('state')
    const code = query.get('code')
    const error = query.get('error')
    if (
      !state ||
      !TOKEN_PATTERN.test(state) ||
      (purpose === 'ADMIN_FRESH'
        ? !state.startsWith('F')
        : purpose === 'ACCOUNT_FRESH'
          ? !state.startsWith('A')
          : purpose === 'ACCOUNT_LINK'
            ? !state.startsWith('L')
            : /^[FAL]/u.test(state)) ||
      !binding ||
      !TOKEN_PATTERN.test(binding)
    )
      return invalid
    if (
      (code === null) === (error === null) ||
      (code !== null &&
        (code.length < 1 || code.length > 4096 || hasControlOrSpace(code))) ||
      (error !== null && (error.length < 1 || error.length > 256))
    )
      return invalid
    let transaction: Awaited<ReturnType<SsoTransactionStore['consume']>>
    try {
      transaction = await store.consume(
        ssoTransactionDigest(state),
        ssoTransactionDigest(binding),
        providerId
      )
    } catch {
      return { kind: 'FAILED', callbackURL: '/' }
    }
    if (!transaction || transaction.provider !== providerId) return invalid
    const callbackURL = returnPathPolicy(transaction.callbackURL)
    if (error !== null)
      return {
        kind: error === 'access_denied' ? 'CANCELLED' : 'FAILED',
        callbackURL
      }
    if (!provider) return { kind: 'FAILED', callbackURL }
    try {
      const identity = await provider.exchange({
        code: code!,
        nonce: transaction.nonce,
        codeVerifier: transaction.codeVerifier
      })
      return identity && identity.provider === providerId
        ? { kind: 'IDENTITY_VERIFIED', identity, callbackURL }
        : { kind: 'FAILED', callbackURL }
    } catch {
      return { kind: 'FAILED', callbackURL }
    }
  }
})

import { createHash, randomBytes } from 'node:crypto'

export const SSO_TRANSACTION_SECONDS = 600
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u
const FILTER_KEYS = new Set([
  'level',
  'subject',
  'type',
  'status',
  'tagId',
  'difficulty',
  'mode',
  'page',
  'pageSize',
  'sort',
  'search'
])
const BUSINESS_PATH =
  /^\/(?:$|dashboard$|bookmarks$|practice(?:\/(?:session|result)\/[A-Za-z0-9-]+)?$|wrong-notes(?:\/(?:history|[A-Za-z0-9-]+))?$|admin\/questions(?:\/[A-Za-z0-9/-]+)?$)/u

export interface SsoVerifiedIdentity {
  readonly provider: 'google'
  readonly accountId: string
  readonly email: string
  readonly name: string
}

export interface SsoTransaction {
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
    bindingDigest: string
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

export const safeSsoReturnPath = (value: unknown): string => {
  if (
    typeof value !== 'string' ||
    value.length > 2048 ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    /[\\#]/u.test(value) ||
    hasControlOrSpace(value)
  )
    return '/'
  try {
    const parsed = new URL(value, 'https://return.invalid')
    if (
      parsed.origin !== 'https://return.invalid' ||
      parsed.pathname !== value.split('?')[0] ||
      !BUSINESS_PATH.test(parsed.pathname)
    )
      return '/'
    const seen = new Set<string>()
    for (const key of parsed.searchParams.keys()) {
      if (!FILTER_KEYS.has(key) || seen.has(key)) return '/'
      seen.add(key)
    }
    return parsed.pathname + parsed.search
  } catch {
    return '/'
  }
}

export const ssoTransactionDigest = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex')

export const ssoBindingCookieName = (production: boolean): string =>
  production ? '__Host-nihongo.sso_binding' : 'nihongo.sso_binding'

export const createSsoBindingCookie = (
  binding: string | null,
  production: boolean
): string => {
  if (binding !== null && !TOKEN_PATTERN.test(binding)) {
    throw new TypeError('Invalid SSO browser binding.')
  }
  return `${ssoBindingCookieName(production)}=${binding ?? ''}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${binding === null ? 0 : SSO_TRANSACTION_SECONDS}${production ? '; Secure' : ''}`
}

export const readSsoBindingCookie = (
  headers: Headers,
  production: boolean
): string | null => {
  const matches = (headers.get('Cookie') ?? '')
    .split(';')
    .map((part) => part.trim().split('='))
    .filter(([name]) => name === ssoBindingCookieName(production))
  if (matches.length !== 1 || matches[0]?.length !== 2) return null
  const value = matches[0]?.[1]
  return value && TOKEN_PATTERN.test(value) ? value : null
}

export const createSsoLoginService = ({
  provider,
  store
}: {
  provider: SsoProvider | undefined
  store: SsoTransactionStore
}) => ({
  start: async (callbackURL: unknown) => {
    if (!provider) throw new SsoUnavailableError()
    const state = randomBytes(32).toString('base64url')
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
        target.origin !== 'https://accounts.google.com' ||
        target.pathname !== '/o/oauth2/v2/auth' ||
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
        stateDigest: ssoTransactionDigest(state),
        bindingDigest: ssoTransactionDigest(binding),
        nonce,
        codeVerifier,
        callbackURL: safeSsoReturnPath(callbackURL)
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
        ssoTransactionDigest(binding)
      )
    } catch {
      return { kind: 'FAILED', callbackURL: '/' }
    }
    if (!transaction) return invalid
    const callbackURL = safeSsoReturnPath(transaction.callbackURL)
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
      return identity
        ? { kind: 'IDENTITY_VERIFIED', identity, callbackURL }
        : { kind: 'FAILED', callbackURL }
    } catch {
      return { kind: 'FAILED', callbackURL }
    }
  }
})

import { randomBytes } from 'node:crypto'
import {
  accountSsoRequestSchema,
  deleteSsoAccountRequestSchema,
  unlinkSsoAccountRequestSchema,
  ssoAccountCapabilitiesSchema,
  ssoAccountDeletionSchema,
  unlinkSsoAccountResponseSchema
} from '@nihongo/contracts/auth/sso-account-management'
import type {
  AccountSsoPurpose,
  SsoAccountErrorCode
} from '@nihongo/contracts/auth/sso-account-management'
import { safeAdminFreshReturnPath } from '@nihongo/contracts/auth/admin-fresh-sso'
import { signInSocialResponseSchema } from '@nihongo/contracts/auth/sign-in-social'
import type { SsoProviderId } from '@nihongo/contracts/auth/sign-in-social'
import type { ApiEnvironment } from '../config/env.js'
import type {
  SsoAccountContext,
  SsoAccountPort
} from './ssoAccountRepository.js'
import {
  createSsoBindingCookie,
  createSsoLoginService,
  ssoTransactionDigest
} from './ssoProtocol.js'
import type { SsoProvider, SsoTransactionStore } from './ssoProtocol.js'
import {
  createExpiredSessionCookies,
  readSessionToken
} from './sessionCookie.js'

export const SSO_ACCOUNT_PATHS = {
  capabilities: '/api/auth/sso/accounts',
  unlink: '/api/auth/sso/unlink',
  deletion: '/api/auth/sso/delete-account',
  status: '/api/auth/sso/deletion',
  freshComplete: '/api/auth/sso/account-fresh/complete',
  linkComplete: '/api/auth/sso/account-link/complete'
} as const
export interface SsoAccountRuntime {
  clearOnLogin: () => readonly string[]
  start: (request: Request, payload: unknown) => Promise<Response>
  callback: (
    request: Request,
    provider: SsoProviderId,
    query: URLSearchParams,
    binding: string | null,
    purpose: AccountSsoPurpose
  ) => Promise<Response>
  complete: (request: Request, purpose: AccountSsoPurpose) => Promise<Response>
  handle: (
    request: Request,
    path: string,
    payload: unknown
  ) => Promise<Response>
}
const TOKEN = /^[A-Za-z0-9_-]{43}$/u
export const createSsoAccountRuntime = ({
  environment,
  providers,
  port
}: {
  environment: ApiEnvironment
  providers: Partial<Record<SsoProviderId, SsoProvider>>
  port: SsoAccountPort
}): SsoAccountRuntime => {
  const production = environment.NODE_ENV === 'production'
  const secure =
    production || new URL(environment.BETTER_AUTH_URL).protocol === 'https:'
  const available = (['apple', 'google'] as const).filter(
    (provider) => providers[provider] !== undefined
  )
  const name = (kind: 'fresh' | 'link' | 'receipt') =>
    `${secure ? '__Host-' : ''}nihongo.sso_account_${kind}`
  const cookie = (
    kind: 'fresh' | 'link' | 'receipt',
    value: string | null,
    maxAge = 300
  ) =>
    `${name(kind)}=${value ?? ''}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${value ? maxAge : 0}${secure ? '; Secure' : ''}`
  const read = (
    request: Request,
    kind: 'fresh' | 'link' | 'receipt'
  ): string | null => {
    const values = (request.headers.get('Cookie') ?? '')
      .split(';')
      .map((v) => v.trim().split('='))
      .filter(([key]) => key === name(kind))
    const value =
      values.length === 1 && values[0]?.length === 2 ? values[0][1] : undefined
    return value && TOKEN.test(value) ? value : null
  }
  const token = (request: Request) =>
    readSessionToken({
      cookieHeader: request.headers.get('Cookie'),
      isProduction: production,
      secret: environment.BETTER_AUTH_SECRET
    }).token
  const proof = (request: Request) => {
    const value = read(request, 'fresh')
    return value ? ssoTransactionDigest(value) : null
  }
  const json = (body: unknown, status = 200, cookies: string[] = []) => {
    const headers = new Headers({
      'Content-Type': 'application/json',
      'Cache-Control': 'private, no-store'
    })
    for (const value of cookies) headers.append('Set-Cookie', value)
    return new Response(JSON.stringify(body), { status, headers })
  }
  const error = (code: SsoAccountErrorCode): Response =>
    json(
      { code },
      code === 'AUTHENTICATION_REQUIRED'
        ? 401
        : code === 'SSO_FRESH_REQUIRED'
          ? 403
          : code === 'SSO_DELETION_RECEIPT_UNAVAILABLE'
            ? 404
            : code === 'SSO_ACCOUNT_OPERATION_UNAVAILABLE'
              ? 503
              : 409
    )
  const outcome = (
    purpose: AccountSsoPurpose,
    value:
      | 'REAUTHENTICATED'
      | 'LINKED'
      | 'CANCELLED'
      | 'FAILED'
      | 'INVALID_CALLBACK',
    callbackURL: unknown = '/login',
    cookies: string[] = []
  ) => {
    const target = new URL(
      safeAdminFreshReturnPath(callbackURL),
      environment.TRUSTED_ORIGINS[0] ?? environment.BETTER_AUTH_URL
    )
    target.searchParams.set(
      purpose === 'ACCOUNT_FRESH' ? 'ssoAccountFresh' : 'ssoAccountLink',
      value
    )
    const headers = new Headers({
      Location: target.href,
      'Cache-Control': 'private, no-store',
      'Referrer-Policy': 'no-referrer'
    })
    for (const value of cookies) headers.append('Set-Cookie', value)
    return new Response(null, { status: 303, headers })
  }
  const clearSession = () => [
    ...createExpiredSessionCookies(production),
    cookie('fresh', null),
    cookie('link', null)
  ]
  return {
    clearOnLogin: () => [
      cookie('fresh', null),
      cookie('link', null),
      cookie('receipt', null)
    ],
    start: async (request, payload) => {
      const parsed = accountSsoRequestSchema.safeParse(payload)
      if (!parsed.success) return json({ code: 'INVALID_AUTH_PAYLOAD' }, 400)
      const current = token(request)
      if (!current) return error('AUTHENTICATION_REQUIRED')
      if (!providers[parsed.data.provider])
        return error('SSO_PROVIDER_UNAVAILABLE')
      try {
        const context = await port.prepare(
          current,
          parsed.data.provider,
          parsed.data.purpose,
          proof(request)
        )
        if (!context) return error('SSO_FRESH_REQUIRED')
        const store: SsoTransactionStore = {
          create: (tx) => port.create(tx, context),
          consume: async () => null
        }
        const started = await createSsoLoginService({
          providerId: parsed.data.provider,
          provider: providers[parsed.data.provider],
          purpose: parsed.data.purpose,
          store,
          returnPathPolicy: safeAdminFreshReturnPath
        }).start(parsed.data.callbackURL)
        return json(
          signInSocialResponseSchema.parse({
            url: started.url,
            redirect: true
          }),
          200,
          [
            createSsoBindingCookie(
              started.binding,
              production,
              parsed.data.provider
            )
          ]
        )
      } catch {
        return error('SSO_ACCOUNT_OPERATION_UNAVAILABLE')
      }
    },
    callback: async (_request, provider, query, binding, purpose) => {
      const clear = createSsoBindingCookie(null, production, provider)
      try {
        let context: SsoAccountContext | undefined
        const store: SsoTransactionStore = {
          create: async () => {
            throw new Error('Callback cannot prepare an account action.')
          },
          consume: async (...args) => {
            const row = await port.consume(...args, purpose)
            if (!row) return null
            context = row.context
            const { context: _context, ...transaction } = row
            return transaction
          }
        }
        const verified = await createSsoLoginService({
          providerId: provider,
          provider: providers[provider],
          purpose,
          store,
          returnPathPolicy: safeAdminFreshReturnPath
        }).finish({ query, binding })
        if (verified.kind !== 'IDENTITY_VERIFIED')
          return outcome(purpose, verified.kind, verified.callbackURL, [clear])
        if (
          !context ||
          context.purpose !== purpose ||
          context.provider !== verified.identity.provider ||
          (purpose === 'ACCOUNT_FRESH' &&
            context.accountId !== verified.identity.accountId)
        )
          return outcome(purpose, 'FAILED', verified.callbackURL, [clear])
        const rawProof = randomBytes(32).toString('base64url')
        if (
          !(await port.stageProof(
            context,
            verified.identity,
            ssoTransactionDigest(rawProof),
            verified.callbackURL
          ))
        )
          return outcome(purpose, 'FAILED', verified.callbackURL, [clear])
        const kind = purpose === 'ACCOUNT_FRESH' ? 'fresh' : 'link'
        const headers = new Headers({
          Location: new URL(
            purpose === 'ACCOUNT_FRESH'
              ? SSO_ACCOUNT_PATHS.freshComplete
              : SSO_ACCOUNT_PATHS.linkComplete,
            environment.BETTER_AUTH_URL
          ).href,
          'Cache-Control': 'private, no-store',
          'Referrer-Policy': 'no-referrer'
        })
        headers.append('Set-Cookie', clear)
        headers.append('Set-Cookie', cookie(kind, rawProof, 120))
        return new Response(null, { status: 303, headers })
      } catch {
        return outcome(purpose, 'FAILED', '/login', [clear])
      }
    },
    complete: async (request, purpose) => {
      const kind = purpose === 'ACCOUNT_FRESH' ? 'fresh' : 'link'
      const raw = read(request, kind),
        current = token(request)
      if (new URL(request.url).search || !raw || !current)
        return outcome(purpose, 'INVALID_CALLBACK', '/login', [
          cookie(kind, null)
        ])
      try {
        const target = await port.complete(
          ssoTransactionDigest(raw),
          current,
          purpose
        )
        if (target === null)
          return outcome(purpose, 'FAILED', '/login', [cookie(kind, null)])
        return outcome(
          purpose,
          purpose === 'ACCOUNT_FRESH' ? 'REAUTHENTICATED' : 'LINKED',
          target,
          purpose === 'ACCOUNT_FRESH'
            ? [cookie('fresh', raw)]
            : [cookie('fresh', null), cookie('link', null)]
        )
      } catch {
        return outcome(purpose, 'FAILED', '/login', [cookie(kind, null)])
      }
    },
    handle: async (request, path, payload) => {
      if (new URL(request.url).search)
        return json({ code: 'INVALID_AUTH_PAYLOAD' }, 400)
      try {
        if (path === SSO_ACCOUNT_PATHS.status && request.method === 'GET') {
          const receipt = read(request, 'receipt')
          if (!receipt) return error('SSO_DELETION_RECEIPT_UNAVAILABLE')
          const status = await port.erasureStatus(ssoTransactionDigest(receipt))
          return status
            ? json(ssoAccountDeletionSchema.parse(status))
            : error('SSO_DELETION_RECEIPT_UNAVAILABLE')
        }
        const current = token(request)
        if (!current) return error('AUTHENTICATION_REQUIRED')
        if (
          path === SSO_ACCOUNT_PATHS.capabilities &&
          request.method === 'GET'
        ) {
          const capabilities = await port.capabilities(
            current,
            available,
            proof(request)
          )
          return capabilities
            ? json(ssoAccountCapabilitiesSchema.parse(capabilities))
            : error('AUTHENTICATION_REQUIRED')
        }
        if (path === SSO_ACCOUNT_PATHS.unlink && request.method === 'POST') {
          const parsed = unlinkSsoAccountRequestSchema.safeParse(payload)
          if (!parsed.success)
            return json({ code: 'INVALID_AUTH_PAYLOAD' }, 400)
          const result = await port.unlink(
            current,
            parsed.data.provider,
            available,
            proof(request)
          )
          return 'code' in result
            ? error(result.code)
            : json(
                unlinkSsoAccountResponseSchema.parse(result),
                200,
                clearSession()
              )
        }
        if (path === SSO_ACCOUNT_PATHS.deletion && request.method === 'POST') {
          if (!deleteSsoAccountRequestSchema.safeParse(payload).success)
            return json({ code: 'INVALID_AUTH_PAYLOAD' }, 400)
          const receipt = randomBytes(32).toString('base64url')
          const result = await port.requestErasure(
            current,
            proof(request),
            ssoTransactionDigest(receipt)
          )
          if ('code' in result) return error(result.code)
          const accepted = ssoAccountDeletionSchema.parse(result)
          if (accepted.appStatus !== 'DELETION_PENDING')
            return error('SSO_ACCOUNT_OPERATION_UNAVAILABLE')
          return json(accepted, 202, [
            ...clearSession(),
            cookie('receipt', receipt, 86400)
          ])
        }
        return json({ code: 'AUTH_ROUTE_NOT_FOUND' }, 404)
      } catch {
        return error('SSO_ACCOUNT_OPERATION_UNAVAILABLE')
      }
    }
  }
}

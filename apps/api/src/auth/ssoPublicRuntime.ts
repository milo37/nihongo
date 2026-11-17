import type { SsoAccountRuntime } from './ssoAccountRuntime.js'
import {
  signInSocialRequestSchema,
  signInSocialResponseSchema,
  safeSsoReturnPath
} from '@nihongo/contracts/auth/sign-in-social'
import type { SsoProviderId } from '@nihongo/contracts/auth/sign-in-social'
import {
  SIGNUP_CONSENT_PATHS,
  SIGNUP_PENDING_SECONDS,
  cancelSignupConsentRequestSchema,
  cancelSignupConsentResponseSchema,
  signupConsentRequestSchema,
  signupConsentResponseSchema,
  signupConsentStateSchema
} from '@nihongo/contracts/auth/signup-consent'
import type { SignupConsentErrorCode } from '@nihongo/contracts/auth/signup-consent'
import type { ApiEnvironment } from '../config/env.js'
import { readLimitedAuthBody } from './authGateway.js'
import { createAppleSsoProvider } from './ssoAppleProvider.js'
import { createGoogleSsoProvider } from './ssoGoogleProvider.js'
import type { SsoIdentityPort } from './ssoIdentityRepository.js'
import {
  createSsoBindingCookie,
  createSsoLoginService,
  readSsoBindingCookie
} from './ssoProtocol.js'
import type { SsoProvider, SsoTransactionStore } from './ssoProtocol.js'
import { createSessionCookie } from './sessionCookie.js'
import { INTERNAL_CLIENT_IP_HEADER } from './clientIp.js'
import type { SsoAdminFreshRuntime } from './ssoAdminFreshRuntime.js'
import { createSignupPending, readSignupPending } from './ssoSignupPending.js'

export interface SsoPublicRuntime {
  start: (request: Request, payload: unknown) => Promise<Response>
  callback: (request: Request, provider: SsoProviderId) => Promise<Response>
  completeAdminFresh?: (request: Request) => Promise<Response>
  /** #1085: GET/POST the pending sign-up consent, or POST its cancel. */
  signupConsent: (
    request: Request,
    path: string,
    payload: unknown
  ) => Promise<Response>
}
const unavailable = (): Response =>
  Response.json({ code: 'SSO_UNAVAILABLE' }, { status: 503 })
export const createConfiguredSsoProviders = (
  environment: ApiEnvironment
): Partial<Record<SsoProviderId, SsoProvider>> => ({
  ...(environment.GOOGLE_CLIENT_ID && environment.GOOGLE_CLIENT_SECRET
    ? {
        google: createGoogleSsoProvider({
          clientId: environment.GOOGLE_CLIENT_ID,
          clientSecret: environment.GOOGLE_CLIENT_SECRET,
          callbackURL: new URL(
            '/api/auth/callback/google',
            environment.BETTER_AUTH_URL
          ).href
        })
      }
    : {}),
  ...(environment.APPLE_CLIENT_ID && environment.APPLE_CLIENT_SECRET
    ? {
        apple: createAppleSsoProvider({
          clientId: environment.APPLE_CLIENT_ID,
          clientSecret: environment.APPLE_CLIENT_SECRET,
          callbackURL: new URL(
            '/api/auth/callback/apple',
            environment.BETTER_AUTH_URL
          ).href
        })
      }
    : {})
})
export const createSsoPublicRuntime = ({
  environment,
  providers,
  store,
  identities,
  adminFresh,
  accountRuntime,
  now = Date.now
}: {
  environment: ApiEnvironment
  providers: Partial<Record<SsoProviderId, SsoProvider>>
  store: SsoTransactionStore
  identities: SsoIdentityPort
  adminFresh?: SsoAdminFreshRuntime
  accountRuntime?: SsoAccountRuntime
  now?: () => number
}): SsoPublicRuntime => {
  const production = environment.NODE_ENV === 'production'
  const secure =
    production || new URL(environment.BETTER_AUTH_URL).protocol === 'https:'
  const pendingName = `${secure ? '__Host-' : ''}nihongo.sso_signup_pending`
  const pendingCookie = (value: string | null) =>
    `${pendingName}=${value ?? ''}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${value ? SIGNUP_PENDING_SECONDS : 0}${secure ? '; Secure' : ''}`
  const readPending = (request: Request) => {
    const values = (request.headers.get('Cookie') ?? '')
      .split(';')
      .map((v) => v.trim().split('='))
      .filter(([key]) => key === pendingName)
    return readSignupPending(
      environment.BETTER_AUTH_SECRET,
      values.length === 1 && values[0]?.length === 2
        ? (values[0][1] ?? null)
        : null,
      now()
    )
  }
  const json = (body: unknown, status = 200, cookies: string[] = []) => {
    const headers = new Headers({
      'Content-Type': 'application/json',
      'Cache-Control': 'private, no-store'
    })
    for (const value of cookies) headers.append('Set-Cookie', value)
    return new Response(JSON.stringify(body), { status, headers })
  }
  const consentError = (code: SignupConsentErrorCode | 'SSO_UNAVAILABLE') =>
    json(
      { code },
      code === 'SIGNUP_CONSENT_REQUIRED'
        ? 400
        : code === 'SIGNUP_PENDING_EXPIRED'
          ? 404
          : code === 'SIGNUP_UNAVAILABLE'
            ? 409
            : 503,
      code === 'SSO_UNAVAILABLE' ? [] : [pendingCookie(null)]
    )
  const spaOrigin =
    environment.TRUSTED_ORIGINS[0] ?? environment.BETTER_AUTH_URL
  const services = {
    apple: createSsoLoginService({
      providerId: 'apple',
      provider: providers.apple,
      store
    }),
    google: createSsoLoginService({
      providerId: 'google',
      provider: providers.google,
      store
    })
  }
  const redirect = (
    provider: SsoProviderId,
    path: string,
    cookie?: string
  ): Response => {
    const headers = new Headers({
      Location: new URL(path, spaOrigin).href,
      'Cache-Control': 'private, no-store',
      'Referrer-Policy': 'no-referrer'
    })
    headers.append(
      'Set-Cookie',
      createSsoBindingCookie(null, production, provider)
    )
    if (cookie) {
      headers.append('Set-Cookie', cookie)
      headers.append('Set-Cookie', pendingCookie(null))
      // A new canonical login cannot inherit another account's private receipt.
      for (const value of accountRuntime?.clearOnLogin() ?? [])
        headers.append('Set-Cookie', value)
    }
    return new Response(null, { status: 303, headers })
  }
  const failure = (
    provider: SsoProviderId,
    outcome: 'CANCELLED' | 'FAILED' | 'INVALID_CALLBACK',
    returnPath = '/'
  ): Response => {
    const query = new URLSearchParams({
      sso: outcome,
      redirect: safeSsoReturnPath(returnPath)
    })
    return redirect(provider, `/login?${query}`)
  }
  return {
    ...(adminFresh ? { completeAdminFresh: adminFresh.complete } : {}),
    signupConsent: async (request, path, payload) => {
      if (path === SIGNUP_CONSENT_PATHS.cancel && request.method === 'POST') {
        if (!cancelSignupConsentRequestSchema.safeParse(payload).success)
          return json({ code: 'INVALID_AUTH_PAYLOAD' }, 400)
        // Nothing was stored; dropping the cookie is the whole cancel.
        return json(
          cancelSignupConsentResponseSchema.parse({ cancelled: true }),
          200,
          [pendingCookie(null)]
        )
      }
      if (path !== SIGNUP_CONSENT_PATHS.consent)
        return json({ code: 'AUTH_ROUTE_NOT_FOUND' }, 404)
      const pending = readPending(request)
      if (request.method === 'GET')
        return pending
          ? json(
              signupConsentStateSchema.parse({
                kind: pending.kind,
                expiresAt: new Date(pending.expiresAt * 1000).toISOString(),
                redirect: pending.redirect
              })
            )
          : consentError('SIGNUP_PENDING_EXPIRED')
      if (request.method !== 'POST')
        return json({ code: 'AUTH_ROUTE_NOT_FOUND' }, 404)
      if (!signupConsentRequestSchema.safeParse(payload).success)
        return json({ code: 'SIGNUP_CONSENT_REQUIRED' }, 400)
      if (!pending) return consentError('SIGNUP_PENDING_EXPIRED')
      let resolved: Awaited<ReturnType<SsoIdentityPort['signUpWithConsent']>>
      try {
        resolved = await identities.signUpWithConsent(
          {
            provider: pending.provider,
            accountId: pending.accountId,
            email: pending.email,
            name: pending.name
          },
          {
            ipAddress:
              request.headers.get(INTERNAL_CLIENT_IP_HEADER) ?? 'unresolved',
            userAgent: request.headers.get('User-Agent') ?? ''
          }
        )
      } catch {
        return consentError('SSO_UNAVAILABLE')
      }
      if (resolved.kind !== 'SESSION_CONFIRMED')
        return consentError('SIGNUP_UNAVAILABLE')
      return json(
        signupConsentResponseSchema.parse({
          signedIn: true,
          redirect: pending.redirect
        }),
        200,
        [
          createSessionCookie({
            expiresAt: resolved.expiresAt,
            isProduction: production,
            rememberMe: true,
            now: resolved.createdAt,
            secret: environment.BETTER_AUTH_SECRET,
            token: resolved.token
          }),
          pendingCookie(null),
          // A new canonical login cannot inherit another account's receipt.
          ...(accountRuntime?.clearOnLogin() ?? [])
        ]
      )
    },
    start: async (_request, payload) => {
      if (
        payload &&
        typeof payload === 'object' &&
        'purpose' in payload &&
        (payload.purpose === 'ACCOUNT_FRESH' ||
          payload.purpose === 'ACCOUNT_LINK')
      )
        return accountRuntime
          ? accountRuntime.start(_request, payload)
          : unavailable()
      if (
        payload &&
        typeof payload === 'object' &&
        'purpose' in payload &&
        payload.purpose === 'ADMIN_FRESH'
      )
        return adminFresh ? adminFresh.start(_request, payload) : unavailable()
      const parsed = signInSocialRequestSchema.safeParse(payload)
      if (!parsed.success)
        return Response.json({ code: 'INVALID_AUTH_PAYLOAD' }, { status: 400 })
      try {
        const result = await services[parsed.data.provider].start(
          parsed.data.callbackURL
        )
        const body = signInSocialResponseSchema.parse({
          url: result.url,
          redirect: true
        })
        return Response.json(body, {
          headers: {
            'Set-Cookie': createSsoBindingCookie(
              result.binding,
              production,
              parsed.data.provider
            ),
            'Cache-Control': 'private, no-store'
          }
        })
      } catch {
        return unavailable()
      }
    },
    callback: async (request, provider) => {
      try {
        const url = new URL(request.url)
        let query: URLSearchParams
        if (provider === 'apple') {
          if (
            request.method !== 'POST' ||
            url.search ||
            !/^application\/x-www-form-urlencoded(?:;\s*charset=utf-8)?$/iu.test(
              request.headers.get('Content-Type') ?? ''
            ) ||
            (
              request.headers.get('Content-Encoding') ?? 'identity'
            ).toLowerCase() !== 'identity'
          )
            return failure(provider, 'INVALID_CALLBACK')
          query = new URLSearchParams(await readLimitedAuthBody(request, 8192))
        } else {
          if (request.method !== 'GET' || url.search.length > 8192)
            return failure(provider, 'INVALID_CALLBACK')
          query = url.searchParams
        }
        if (
          query.get('state')?.startsWith('A') ||
          query.get('state')?.startsWith('L')
        )
          return accountRuntime
            ? accountRuntime.callback(
                request,
                provider,
                query,
                readSsoBindingCookie(request.headers, production, provider),
                query.get('state')!.startsWith('A')
                  ? 'ACCOUNT_FRESH'
                  : 'ACCOUNT_LINK'
              )
            : failure(provider, 'INVALID_CALLBACK')
        if (query.get('state')?.startsWith('F'))
          return adminFresh
            ? adminFresh.callback(
                request,
                provider,
                query,
                readSsoBindingCookie(request.headers, production, provider)
              )
            : failure(provider, 'INVALID_CALLBACK')
        const verified = await services[provider].finish({
          query,
          binding: readSsoBindingCookie(request.headers, production, provider)
        })
        if (verified.kind !== 'IDENTITY_VERIFIED')
          return failure(provider, verified.kind, verified.callbackURL)
        const consent = await identities.consentState(verified.identity)
        if (consent !== 'PROCEED') {
          // #1085: no account and no session before the consent; the login
          // page opens the consent with this short encrypted pending.
          const returnPath = safeSsoReturnPath(verified.callbackURL)
          const response = redirect(
            provider,
            `/login?${new URLSearchParams({
              sso: 'CONSENT_REQUIRED',
              redirect: returnPath
            })}`
          )
          response.headers.append(
            'Set-Cookie',
            pendingCookie(
              createSignupPending(
                environment.BETTER_AUTH_SECRET,
                {
                  provider,
                  accountId: verified.identity.accountId,
                  email: verified.identity.email,
                  name: verified.identity.name,
                  kind: consent,
                  redirect: returnPath
                },
                now()
              )
            )
          )
          return response
        }
        const resolved = await identities.signIn(verified.identity, {
          ipAddress:
            request.headers.get(INTERNAL_CLIENT_IP_HEADER) ?? 'unresolved',
          userAgent: request.headers.get('User-Agent') ?? ''
        })
        if (resolved.kind === 'RESTORE_AVAILABLE' && accountRuntime) {
          // JLP-845: no session; the login page offers restore or keeps the
          // scheduled erasure.
          const response = redirect(
            provider,
            `/login?${new URLSearchParams({
              sso: 'RESTORE_AVAILABLE',
              redirect: safeSsoReturnPath(verified.callbackURL)
            })}`
          )
          response.headers.append(
            'Set-Cookie',
            accountRuntime.restoreCookie(resolved.restore)
          )
          return response
        }
        if (resolved.kind !== 'SESSION_CONFIRMED')
          return failure(provider, 'FAILED', verified.callbackURL)
        return redirect(
          provider,
          safeSsoReturnPath(verified.callbackURL),
          createSessionCookie({
            expiresAt: resolved.expiresAt,
            isProduction: production,
            rememberMe: true,
            now: resolved.createdAt,
            secret: environment.BETTER_AUTH_SECRET,
            token: resolved.token
          })
        )
      } catch {
        return failure(provider, 'FAILED')
      }
    }
  }
}

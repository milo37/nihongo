import type { SsoAccountRuntime } from './ssoAccountRuntime.js'
import {
  signInSocialRequestSchema,
  signInSocialResponseSchema,
  safeSsoReturnPath
} from '@nihongo/contracts/auth/sign-in-social'
import type { SsoProviderId } from '@nihongo/contracts/auth/sign-in-social'
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
import { createPhase7SessionCookie } from './sessionCookie.js'
import { INTERNAL_CLIENT_IP_HEADER } from './clientIp.js'
import type { SsoAdminFreshRuntime } from './ssoAdminFreshRuntime.js'

export interface SsoPublicRuntime {
  start: (request: Request, payload: unknown) => Promise<Response>
  callback: (request: Request, provider: SsoProviderId) => Promise<Response>
  completeAdminFresh?: (request: Request) => Promise<Response>
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
  accountRuntime
}: {
  environment: ApiEnvironment
  providers: Partial<Record<SsoProviderId, SsoProvider>>
  store: SsoTransactionStore
  identities: SsoIdentityPort
  adminFresh?: SsoAdminFreshRuntime
  accountRuntime?: SsoAccountRuntime
}): SsoPublicRuntime => {
  const production = environment.NODE_ENV === 'production'
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
        const resolved = await identities.signIn(verified.identity, {
          ipAddress:
            request.headers.get(INTERNAL_CLIENT_IP_HEADER) ?? 'unresolved',
          userAgent: request.headers.get('User-Agent') ?? ''
        })
        if (resolved.kind !== 'SESSION_CONFIRMED')
          return failure(provider, 'FAILED', verified.callbackURL)
        return redirect(
          provider,
          safeSsoReturnPath(verified.callbackURL),
          createPhase7SessionCookie({
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

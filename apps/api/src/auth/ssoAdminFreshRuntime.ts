import { randomBytes } from 'node:crypto'
import {
  adminFreshSsoRequestSchema,
  safeAdminFreshReturnPath
} from '@nihongo/contracts/auth/admin-fresh-sso'
import type { AdminFreshSsoOutcome } from '@nihongo/contracts/auth/admin-fresh-sso'
import type { SsoProviderId } from '@nihongo/contracts/auth/sign-in-social'
import { signInSocialResponseSchema } from '@nihongo/contracts/auth/sign-in-social'
import type { ApiEnvironment } from '../config/env.js'
import type {
  AdminFreshContext,
  SsoAdminFreshPort
} from './ssoAdminFreshRepository.js'
import {
  createSsoBindingCookie,
  createSsoLoginService,
  ssoTransactionDigest
} from './ssoProtocol.js'
import type { SsoProvider, SsoTransactionStore } from './ssoProtocol.js'
import {
  createPhase7SessionCookie,
  createPhase7DontRememberCookie,
  readPhase7SessionToken
} from './sessionCookie.js'
import { INTERNAL_CLIENT_IP_HEADER } from './clientIp.js'

export const ADMIN_FRESH_COMPLETE_PATH = '/api/auth/sso/admin-fresh/complete'
export interface SsoAdminFreshRuntime {
  start: (request: Request, payload: unknown) => Promise<Response>
  callback: (
    request: Request,
    provider: SsoProviderId,
    query: URLSearchParams,
    binding: string | null
  ) => Promise<Response>
  complete: (request: Request) => Promise<Response>
}
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u
export const createSsoAdminFreshRuntime = ({
  environment,
  providers,
  port
}: {
  environment: ApiEnvironment
  providers: Partial<Record<SsoProviderId, SsoProvider>>
  port: SsoAdminFreshPort
}): SsoAdminFreshRuntime => {
  const production = environment.NODE_ENV === 'production'
  const secure = new URL(environment.BETTER_AUTH_URL).protocol === 'https:'
  const proofName = secure ? '__Host-nihongo.sso_fresh' : 'nihongo.sso_fresh'
  const proofCookie = (value: string | null): string =>
    `${proofName}=${value ?? ''}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${value ? 120 : 0}${secure ? '; Secure' : ''}`
  const oldToken = (request: Request): string | null =>
    readPhase7SessionToken({
      cookieHeader: request.headers.get('Cookie'),
      isProduction: production,
      secret: environment.BETTER_AUTH_SECRET
    }).token
  const redirect = (path: string, cookies: string[] = []): Response => {
    const headers = new Headers({
      Location: new URL(
        path,
        environment.TRUSTED_ORIGINS[0] ?? environment.BETTER_AUTH_URL
      ).href,
      'Cache-Control': 'private, no-store',
      'Referrer-Policy': 'no-referrer'
    })
    for (const cookie of cookies) headers.append('Set-Cookie', cookie)
    return new Response(null, { status: 303, headers })
  }
  const outcome = (
    kind: AdminFreshSsoOutcome,
    callbackURL: unknown = '/login',
    cookies: string[] = []
  ): Response => {
    const target = new URL(
      safeAdminFreshReturnPath(callbackURL),
      environment.TRUSTED_ORIGINS[0] ?? environment.BETTER_AUTH_URL
    )
    target.searchParams.set('ssoFresh', kind)
    return redirect(target.pathname + target.search, cookies)
  }
  const abort = async (context: AdminFreshContext): Promise<void> => {
    try {
      await port.abort(context)
    } catch {
      /* No cookie or fresh assurance is delivered. */
    }
  }
  return {
    start: async (request, payload) => {
      const parsed = adminFreshSsoRequestSchema.safeParse(payload)
      if (!parsed.success)
        return Response.json({ code: 'INVALID_AUTH_PAYLOAD' }, { status: 400 })
      const provider = providers[parsed.data.provider]
      if (!provider)
        return Response.json({ code: 'SSO_UNAVAILABLE' }, { status: 503 })
      const token = oldToken(request)
      if (!token)
        return Response.json(
          { code: 'AUTHENTICATION_REQUIRED' },
          { status: 401 }
        )
      let context: AdminFreshContext | null = null
      try {
        context = await port.prepare(token, parsed.data.provider)
        if (!context)
          return Response.json({ code: 'ADMIN_REQUIRED' }, { status: 403 })
        const prepared = context
        const store: SsoTransactionStore = {
          create: (tx) => port.create(tx, prepared),
          consume: async () => null
        }
        const service = createSsoLoginService({
          providerId: parsed.data.provider,
          provider,
          store,
          purpose: 'ADMIN_FRESH',
          returnPathPolicy: safeAdminFreshReturnPath
        })
        const result = await service.start(parsed.data.callbackURL)
        const body = signInSocialResponseSchema.parse({
          url: result.url,
          redirect: true
        })
        return Response.json(body, {
          headers: {
            'Cache-Control': 'private, no-store',
            'Set-Cookie': createSsoBindingCookie(
              result.binding,
              production,
              parsed.data.provider
            )
          }
        })
      } catch {
        if (context) await abort(context)
        return Response.json({ code: 'SSO_UNAVAILABLE' }, { status: 503 })
      }
    },
    callback: async (_request, provider, query, binding) => {
      let context: AdminFreshContext | undefined
      const clear = createSsoBindingCookie(null, production, provider)
      try {
        const store: SsoTransactionStore = {
          create: async () => {
            throw new Error('Callback cannot start ADMIN_FRESH.')
          },
          consume: async (...args) => {
            const transaction = await port.consume(...args)
            if (!transaction) return null
            context = transaction.context
            const { context: _context, ...base } = transaction
            return base
          }
        }
        const result = await createSsoLoginService({
          providerId: provider,
          provider: providers[provider],
          store,
          purpose: 'ADMIN_FRESH',
          returnPathPolicy: safeAdminFreshReturnPath
        }).finish({ query, binding })
        if (result.kind !== 'IDENTITY_VERIFIED') {
          if (context) await abort(context)
          return outcome(result.kind, result.callbackURL, [clear])
        }
        if (
          !context ||
          context.provider !== result.identity.provider ||
          context.accountId !== result.identity.accountId
        ) {
          if (context) await abort(context)
          return outcome('FAILED', result.callbackURL, [clear])
        }
        const proof = randomBytes(32).toString('base64url')
        if (
          !(await port.stageProof(
            context,
            result.identity,
            ssoTransactionDigest(proof),
            result.callbackURL
          ))
        ) {
          await abort(context)
          return outcome('FAILED', result.callbackURL, [clear])
        }
        // Apple form_post cannot carry the canonical SameSite=Lax session.
        // A same-origin top-level GET rechecks it before any session rotation.
        const response = redirect(ADMIN_FRESH_COMPLETE_PATH, [
          clear,
          proofCookie(proof)
        ])
        response.headers.set(
          'Location',
          new URL(ADMIN_FRESH_COMPLETE_PATH, environment.BETTER_AUTH_URL).href
        )
        return response
      } catch {
        if (context) await abort(context)
        return outcome('FAILED', '/login', [clear])
      }
    },
    complete: async (request) => {
      const parts = (request.headers.get('Cookie') ?? '')
        .split(';')
        .map((part) => part.trim().split('='))
        .filter(([name]) => name === proofName)
      const proof =
        parts.length === 1 && parts[0]?.length === 2 ? parts[0][1] : undefined
      const token = oldToken(request)
      if (
        new URL(request.url).search ||
        !proof ||
        !TOKEN_PATTERN.test(proof) ||
        !token
      )
        return outcome('INVALID_CALLBACK', '/login', [proofCookie(null)])
      try {
        const session = await port.complete(
          ssoTransactionDigest(proof),
          token,
          {
            ipAddress:
              request.headers.get(INTERNAL_CLIENT_IP_HEADER) ?? 'unresolved',
            userAgent: request.headers.get('User-Agent') ?? ''
          }
        )
        if (!session) return outcome('FAILED', '/login', [proofCookie(null)])
        return outcome('REAUTHENTICATED', session.callbackURL, [
          proofCookie(null),
          createPhase7DontRememberCookie({
            isProduction: production,
            secret: environment.BETTER_AUTH_SECRET
          }),
          createPhase7SessionCookie({
            isProduction: production,
            secret: environment.BETTER_AUTH_SECRET,
            token: session.token,
            now: session.createdAt,
            expiresAt: session.expiresAt,
            rememberMe: false
          })
        ])
      } catch {
        return outcome('FAILED', '/login', [proofCookie(null)])
      }
    }
  }
}

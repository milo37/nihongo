import { createSsoAccountRepository } from './ssoAccountRepository.js'
import { createSsoAccountRuntime } from './ssoAccountRuntime.js'
import type { SsoProviderId } from '@nihongo/contracts/auth/sign-in-social'
import type { ApiEnvironment } from '../config/env.js'
import type { PrismaClient } from '../generated/prisma/client.js'
import type { ApplicationRateLimiter } from '../middleware/applicationRateLimiter.js'
import { createAuthGateway } from './authGateway.js'
import { createOwnedPrincipalService } from './principalService.js'
import {
  createConfiguredSsoProviders,
  createSsoPublicRuntime
} from './ssoPublicRuntime.js'
import { createSsoAdminFreshRuntime } from './ssoAdminFreshRuntime.js'
import { createSsoAdminFreshRepository } from './ssoAdminFreshRepository.js'
import { createSsoIdentityRepository } from './ssoIdentityRepository.js'
import { createSsoTransactionStore } from './ssoTransactionRepository.js'
import type { SsoProvider } from './ssoProtocol.js'
import {
  createExpiredSessionCookies,
  readSessionToken
} from './sessionCookie.js'
import {
  signOutOwnedSession,
  type OwnedSessionClient
} from './ownedSessionAuthority.js'
import type { AuthFacade } from './authFacade.js'
import type { StructuredLogger } from '../observability/logger.js'

/** Source-only composition: no mail/password adapter or CMS enablement. */
export const createSsoAuthentication = ({
  environment,
  applicationClient,
  gatewayClient,
  rateLimiter,
  providers = createConfiguredSsoProviders(environment),
  logger
}: {
  environment: ApiEnvironment
  applicationClient: Pick<PrismaClient, '$queryRawUnsafe'>
  gatewayClient: OwnedSessionClient
  rateLimiter: ApplicationRateLimiter
  providers?: Partial<Record<SsoProviderId, SsoProvider>>
  logger?: StructuredLogger
}) => {
  const principalService = createOwnedPrincipalService({
    client: applicationClient,
    refreshClient: gatewayClient,
    secret: environment.BETTER_AUTH_SECRET,
    isProduction: environment.NODE_ENV === 'production'
  })
  const adminFresh = createSsoAdminFreshRuntime({
    environment,
    providers,
    port: createSsoAdminFreshRepository(gatewayClient)
  })
  const accountRuntime = createSsoAccountRuntime({
    environment,
    providers,
    port: createSsoAccountRepository(
      gatewayClient,
      (userId) =>
        logger?.info('auth.account_erasure.requested', {
          userId,
          occurredAt: new Date().toISOString()
        }),
      (userId) =>
        logger?.info('auth.account_erasure.cancelled', {
          userId,
          occurredAt: new Date().toISOString()
        })
    )
  })
  const social = createSsoPublicRuntime({
    environment,
    providers,
    store: createSsoTransactionStore(gatewayClient),
    identities: createSsoIdentityRepository(gatewayClient),
    adminFresh,
    accountRuntime
  })
  const facade: AuthFacade = {
    handle: async (request, pathname, payload) => {
      if (pathname !== '/api/auth/sign-out')
        return Response.json({ code: 'AUTH_ROUTE_NOT_FOUND' }, { status: 404 })
      if (Object.keys(payload).length !== 0)
        return Response.json({ code: 'INVALID_AUTH_PAYLOAD' }, { status: 400 })
      const token = readSessionToken({
        cookieHeader: request.headers.get('Cookie'),
        isProduction: environment.NODE_ENV === 'production',
        secret: environment.BETTER_AUTH_SECRET
      }).token
      if (token) {
        try {
          await signOutOwnedSession(gatewayClient, token)
        } catch {
          return Response.json({ code: 'SSO_UNAVAILABLE' }, { status: 503 })
        }
      }
      const headers = new Headers({
        'Content-Type': 'application/json',
        'Cache-Control': 'private, no-store'
      })
      for (const cookie of createExpiredSessionCookies(
        environment.NODE_ENV === 'production'
      ))
        headers.append('Set-Cookie', cookie)
      return new Response(JSON.stringify({ success: true }), { headers })
    }
  }
  return {
    principalService,
    gateway: createAuthGateway({
      environment,
      ownedAuthFacade: facade,
      technicalRateLimiter: rateLimiter,
      ssoRuntime: social,
      ssoAccountRuntime: accountRuntime
    })
  }
}

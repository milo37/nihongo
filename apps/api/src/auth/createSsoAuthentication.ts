import type { SsoProviderId } from '@nihongo/contracts/auth/sign-in-social'
import type { ApiEnvironment } from '../config/env.js'
import { createAuthRuntimePlan } from '../config/authRuntimePlan.js'
import type { PrismaClient } from '../generated/prisma/client.js'
import type { ApplicationRateLimiter } from '../middleware/applicationRateLimiter.js'
import { createAuthGateway } from './authGateway.js'
import { createPhase7PrincipalService } from './principalService.js'
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
  createExpiredPhase7SessionCookies,
  readPhase7SessionToken
} from './phase7SessionCookie.js'
import type { Phase7AuthFacade } from './phase7AuthFacade.js'

/** Source-only composition: no mail/password adapter or CMS enablement. */
export const createSsoAuthentication = ({
  environment,
  applicationClient,
  gatewayClient,
  rateLimiter,
  providers = createConfiguredSsoProviders(environment)
}: {
  environment: ApiEnvironment
  applicationClient: Pick<PrismaClient, '$queryRawUnsafe'>
  gatewayClient: Pick<PrismaClient, '$queryRawUnsafe'>
  rateLimiter: ApplicationRateLimiter
  providers?: Partial<Record<SsoProviderId, SsoProvider>>
}) => {
  if (!createAuthRuntimePlan(environment).ownedAuth)
    throw new Error('SSO requires its dedicated database authority.')
  const principalService = createPhase7PrincipalService({
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
  const social = createSsoPublicRuntime({
    environment,
    providers,
    store: createSsoTransactionStore(gatewayClient),
    identities: createSsoIdentityRepository(gatewayClient),
    adminFresh
  })
  const facade: Phase7AuthFacade = {
    handle: async (request, pathname, payload) => {
      if (pathname !== '/api/auth/sign-out')
        return Response.json({ code: 'AUTH_ROUTE_NOT_FOUND' }, { status: 404 })
      if (Object.keys(payload).length !== 0)
        return Response.json({ code: 'INVALID_AUTH_PAYLOAD' }, { status: 400 })
      const token = readPhase7SessionToken({
        cookieHeader: request.headers.get('Cookie'),
        isProduction: environment.NODE_ENV === 'production',
        secret: environment.BETTER_AUTH_SECRET
      }).token
      if (token) {
        try {
          const rows = await gatewayClient.$queryRawUnsafe<
            Array<{ signedOut: boolean }>
          >('SELECT "phase7_owned_sign_out"($1) AS "signedOut"', token)
          if (rows.length !== 1 || rows[0]?.signedOut !== true)
            return Response.json({ code: 'SSO_UNAVAILABLE' }, { status: 503 })
        } catch {
          return Response.json({ code: 'SSO_UNAVAILABLE' }, { status: 503 })
        }
      }
      const headers = new Headers({
        'Content-Type': 'application/json',
        'Cache-Control': 'private, no-store'
      })
      for (const cookie of createExpiredPhase7SessionCookies(
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
      phase7Facade: facade,
      technicalRateLimiter: rateLimiter,
      ssoRuntime: social
    })
  }
}

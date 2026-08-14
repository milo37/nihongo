import { getCurrentPrincipalResponseSchema } from '@nihongo/contracts/auth/get-current-principal'
import { deleteCookie, getCookie } from 'hono/cookie'
import { Hono, type Context } from 'hono'
import type { ApiEnvironment } from '../config/env.js'
import type { GuestPrincipalService } from '../auth/guestPrincipalService.js'
import type { PrincipalService } from '../auth/principalService.js'
import type { ApiVariables } from '../middleware/requestContext.js'

export const GUEST_COOKIE_NAME = 'nihongo.guest_principal'

type PrincipalRouteEnvironment = { Variables: ApiVariables }

interface PrincipalRouteDependencies {
  environment: ApiEnvironment
  guestPrincipalService: GuestPrincipalService
  principalService: PrincipalService
}

const appendAuthHeaders = (
  context: Context<PrincipalRouteEnvironment>,
  resolution: Awaited<ReturnType<PrincipalService['resolveAuthenticatedUser']>>,
  environment: ApiEnvironment
): void => {
  for (const cookie of resolution.headers.getSetCookie?.() ?? []) {
    context.header('Set-Cookie', cookie, { append: true })
  }
  if (resolution.clearSessionCookie) {
    const attributes = `Path=/; HttpOnly; SameSite=Lax; Max-Age=0${
      environment.NODE_ENV === 'production' ? '; Secure' : ''
    }`
    context.header('Set-Cookie', `nihongo.session_token=; ${attributes}`, {
      append: true
    })
    context.header(
      'Set-Cookie',
      `__Secure-nihongo.session_token=; ${attributes}`,
      { append: true }
    )
  }
}

export const createPrincipalRoutes = ({
  environment,
  guestPrincipalService,
  principalService
}: PrincipalRouteDependencies): Hono<PrincipalRouteEnvironment> => {
  const routes = new Hono<PrincipalRouteEnvironment>()

  routes.get('/me', async (context) => {
    const resolution = await principalService.resolveAuthenticatedUser(
      context.req.raw.headers
    )
    appendAuthHeaders(context, resolution, environment)

    if (resolution.user) {
      const response = getCurrentPrincipalResponseSchema.parse({
        kind: 'USER',
        user: resolution.user
      })
      context.header('Cache-Control', 'private, no-store')
      return context.json(response)
    }

    const response = getCurrentPrincipalResponseSchema.parse({ kind: 'GUEST' })
    context.header('Cache-Control', 'private, no-store')
    return context.json(response)
  })

  routes.delete('/guest-principal', async (context) => {
    const resolution = await principalService.resolveAuthenticatedUser(
      context.req.raw.headers
    )
    appendAuthHeaders(context, resolution, environment)

    if (!resolution.user) {
      await guestPrincipalService.clear(getCookie(context, GUEST_COOKIE_NAME))
      deleteCookie(context, GUEST_COOKIE_NAME, {
        secure: environment.NODE_ENV === 'production',
        sameSite: 'Lax',
        path: '/'
      })
    }
    context.header('Cache-Control', 'private, no-store')
    return context.body(null, 204)
  })

  return routes
}

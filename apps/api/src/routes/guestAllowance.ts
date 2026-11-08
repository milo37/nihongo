import {
  getGuestAllowanceQuerySchema,
  getGuestAllowanceResponseSchema
} from '@nihongo/contracts/study/get-guest-allowance'
import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { z } from 'zod'
import type { GuestPrincipalService } from '../auth/guestPrincipalService.js'
import type { PrincipalService } from '../auth/principalService.js'
import type { ApiEnvironment } from '../config/env.js'
import { ApplicationError } from '../errors/applicationError.js'
import type { ApplicationRateLimiter } from '../middleware/applicationRateLimiter.js'
import { createClientIpMiddleware } from '../middleware/clientIp.js'
import type { ApiVariables } from '../middleware/requestContext.js'
import type { GuestAllowanceReader } from '../study/guestAllowance.js'
import { GUEST_COOKIE_NAME } from './principal.js'
import { appendAuthHeaders, toFieldErrors } from './routeSupport.js'

interface GuestAllowanceRouteDependencies {
  environment: ApiEnvironment
  guestAllowanceReader: GuestAllowanceReader
  guestPrincipalService: GuestPrincipalService
  principalService: PrincipalService
  rateLimiter: ApplicationRateLimiter
  now?: () => Date
}

/**
 * GET /api/v1/guest-allowance: sessions a guest may still start today and
 * when that resets (#737). A member gets `{ kind: 'USER' }`. Reading never
 * issues a guest cookie or writes a guest row.
 */
export const createGuestAllowanceRoutes = ({
  environment,
  guestAllowanceReader,
  guestPrincipalService,
  principalService,
  rateLimiter,
  now = () => new Date()
}: GuestAllowanceRouteDependencies): Hono<{ Variables: ApiVariables }> => {
  const routes = new Hono<{ Variables: ApiVariables }>()
  routes.use(
    '*',
    createClientIpMiddleware(environment.AUTH_TRUSTED_PROXY_CIDRS)
  )

  routes.get('/', async (context) => {
    const clientIp = context.get('clientIp')
    await rateLimiter.consume({
      clientIp,
      operation: 'guest-allowance-read',
      windowMs: 60_000,
      max: 60
    })
    try {
      getGuestAllowanceQuerySchema.parse(context.req.query())
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        throw new ApplicationError({
          code: 'INVALID_REQUEST',
          message: '남은 횟수 조회는 조건을 받지 않습니다.',
          fieldErrors: toFieldErrors(error),
          retryable: false
        })
      }
      throw error
    }
    context.header('Cache-Control', 'private, no-store')
    const resolution = await principalService.resolveAuthenticatedUser(
      context.req.raw.headers
    )
    appendAuthHeaders(context, resolution, environment)
    if (resolution.user) {
      return context.json(
        getGuestAllowanceResponseSchema.parse({ kind: 'USER' })
      )
    }
    const inspected = guestPrincipalService.inspectCookie(
      getCookie(context, GUEST_COOKIE_NAME)
    )
    const allowance = await guestAllowanceReader.read({
      at: now(),
      clientIp,
      guest:
        inspected.kind === 'VERIFIED'
          ? {
              guestPrincipalId: inspected.id,
              tokenDigest: inspected.tokenDigest
            }
          : null
    })
    return context.json(getGuestAllowanceResponseSchema.parse(allowance))
  })

  return routes
}

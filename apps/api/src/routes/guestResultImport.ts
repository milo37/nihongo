import {
  importGuestResultBodySchema,
  importGuestResultResponseSchema
} from '@nihongo/contracts/study/import-guest-result'
import { deleteCookie, getCookie } from 'hono/cookie'
import { Hono } from 'hono'
import { z } from 'zod'
import {
  assertAccountNotRestricted,
  type AccountRestrictionReader
} from '../account/accountRestriction.js'
import type { GuestPrincipalService } from '../auth/guestPrincipalService.js'
import type { PrincipalService } from '../auth/principalService.js'
import type { ApiEnvironment } from '../config/env.js'
import { ApplicationError } from '../errors/applicationError.js'
import type { ApplicationRateLimiter } from '../middleware/applicationRateLimiter.js'
import { createClientIpMiddleware } from '../middleware/clientIp.js'
import { readBoundedJsonObject } from '../middleware/boundedJson.js'
import type { ApiVariables } from '../middleware/requestContext.js'
import type { GuestResultImportService } from '../study/guestResultImport.js'
import { GUEST_COOKIE_NAME } from './principal.js'
import { appendAuthHeaders, toFieldErrors } from './routeSupport.js'

interface GuestResultImportRouteDependencies {
  accountRestrictionReader: AccountRestrictionReader
  environment: ApiEnvironment
  guestPrincipalService: GuestPrincipalService
  guestResultImportService: GuestResultImportService
  now?: () => Date
  principalService: PrincipalService
  rateLimiter: ApplicationRateLimiter
}

type GuestResultImportRouteEnvironment = { Variables: ApiVariables }

/** POST /api/v1/me/guest-result-import, once right after login (JLP-823). */
export const createGuestResultImportRoutes = ({
  accountRestrictionReader,
  environment,
  guestPrincipalService,
  guestResultImportService,
  now = () => new Date(),
  principalService,
  rateLimiter
}: GuestResultImportRouteDependencies): Hono<GuestResultImportRouteEnvironment> => {
  const routes = new Hono<GuestResultImportRouteEnvironment>()
  routes.use(
    '*',
    createClientIpMiddleware(environment.AUTH_TRUSTED_PROXY_CIDRS)
  )

  routes.post('/', async (context) => {
    await rateLimiter.consume({
      clientIp: context.get('clientIp'),
      operation: 'guest-result-import',
      windowMs: 60_000,
      max: 10
    })
    try {
      importGuestResultBodySchema.parse(
        await readBoundedJsonObject(context.req.raw)
      )
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        throw new ApplicationError({
          code: 'INVALID_REQUEST',
          message: '비회원 결과 옮기기 요청 본문은 빈 JSON object여야 합니다.',
          fieldErrors: toFieldErrors(error),
          retryable: false
        })
      }
      throw error
    }
    const resolution = await principalService.resolveAuthenticatedUser(
      context.req.raw.headers
    )
    appendAuthHeaders(context, resolution, environment)
    if (!resolution.user) {
      throw new ApplicationError({
        code: resolution.clearSessionCookie
          ? 'AUTH_SESSION_EXPIRED'
          : 'AUTHENTICATION_REQUIRED',
        message: resolution.clearSessionCookie
          ? '로그인 세션이 만료됐습니다.'
          : '비회원 결과를 옮기려면 로그인이 필요합니다.',
        retryable: false
      })
    }
    await assertAccountNotRestricted(
      accountRestrictionReader,
      resolution.user.id
    )

    const rawGuestCookie = getCookie(context, GUEST_COOKIE_NAME)
    const inspected = guestPrincipalService.inspectCookie(rawGuestCookie)
    const response =
      inspected.kind === 'VERIFIED'
        ? await guestResultImportService.importLast({
            guest: { id: inspected.id, tokenDigest: inspected.tokenDigest },
            observedAt: now(),
            userId: resolution.user.id
          })
        : { importedSessionId: null, wrongAnswerCount: 0 }
    if (rawGuestCookie !== undefined) {
      // The member no longer plays as this guest on this device.
      deleteCookie(context, GUEST_COOKIE_NAME, {
        secure: environment.NODE_ENV === 'production',
        sameSite: 'Lax',
        path: '/'
      })
    }
    context.header('Cache-Control', 'private, no-store')
    return context.json(importGuestResultResponseSchema.parse(response))
  })

  return routes
}

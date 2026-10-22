import {
  getDashboardInsightsQuerySchema,
  getDashboardInsightsResponseSchema
} from '@nihongo/contracts/dashboard/get-dashboard-insights'
import { getConnInfo } from '@hono/node-server/conninfo'
import { Hono, type Context } from 'hono'
import { createClientIpAuthority } from '../auth/clientIp.js'
import type { PrincipalService } from '../auth/principalService.js'
import type { ApiEnvironment } from '../config/env.js'
import type { DashboardInsightsService } from '../dashboard/dashboardInsightsService.js'
import { ApplicationError } from '../errors/applicationError.js'
import { parseStrictRawQuery } from '../http/rawQuery.js'
import type { ApplicationRateLimiter } from '../middleware/applicationRateLimiter.js'
import type { ApiVariables } from '../middleware/requestContext.js'

interface DashboardInsightsRouteDependencies {
  readonly dashboardInsightsService: DashboardInsightsService
  readonly environment: ApiEnvironment
  readonly principalService: PrincipalService
  readonly rateLimiter: ApplicationRateLimiter
}

type DashboardInsightsRouteEnvironment = { Variables: ApiVariables }

const appendExpiredSessionCookies = (
  context: Context<DashboardInsightsRouteEnvironment>,
  environment: ApiEnvironment
): void => {
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

const appendAuthHeaders = (
  context: Context<DashboardInsightsRouteEnvironment>,
  resolution: Awaited<ReturnType<PrincipalService['resolveAuthenticatedUser']>>,
  environment: ApiEnvironment
): void => {
  for (const cookie of resolution.headers.getSetCookie?.() ?? []) {
    context.header('Set-Cookie', cookie, { append: true })
  }
  if (resolution.clearSessionCookie) {
    appendExpiredSessionCookies(context, environment)
  }
}

export const createDashboardInsightsRoutes = ({
  dashboardInsightsService,
  environment,
  principalService,
  rateLimiter
}: DashboardInsightsRouteDependencies): Hono<DashboardInsightsRouteEnvironment> => {
  const routes = new Hono<DashboardInsightsRouteEnvironment>()
  const clientIpAuthority = createClientIpAuthority(
    environment.AUTH_TRUSTED_PROXY_CIDRS
  )

  routes.get('/insights', async (context) => {
    let peerAddress: string | undefined
    try {
      peerAddress = getConnInfo(context).remote.address
    } catch {
      peerAddress = undefined
    }
    await rateLimiter.consume({
      clientIp: clientIpAuthority.resolve(
        peerAddress,
        context.req.header('X-Forwarded-For') ?? null
      ),
      operation: 'dashboard-insights-read',
      windowMs: 60_000,
      max: 120
    })

    parseStrictRawQuery(
      context.get('rawRequestTarget'),
      getDashboardInsightsQuerySchema,
      '대시보드 인사이트 조회 조건이 올바르지 않습니다.'
    )
    getDashboardInsightsQuerySchema.parse(context.req.query())

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
          : '대시보드 인사이트를 조회하려면 로그인이 필요합니다.',
        retryable: false
      })
    }

    const principal =
      environment.ADMIN_CMS_MODE === 'technical'
        ? (() => {
            if (!resolution.phase7Session) {
              appendExpiredSessionCookies(context, environment)
              throw new ApplicationError({
                code: 'AUTH_SESSION_EXPIRED',
                message: '로그인 세션이 만료됐습니다.',
                retryable: false
              })
            }
            return {
              kind: 'PHASE7' as const,
              sessionToken: resolution.phase7Session.token,
              userId: resolution.user.id
            }
          })()
        : { kind: 'LEGACY' as const, userId: resolution.user.id }
    let response: unknown
    try {
      response = await dashboardInsightsService.getDashboardInsights(principal)
    } catch (error: unknown) {
      if (
        error instanceof ApplicationError &&
        error.code === 'AUTH_SESSION_EXPIRED'
      ) {
        appendExpiredSessionCookies(context, environment)
      }
      throw error
    }
    context.header('Cache-Control', 'private, no-store')
    return context.json(getDashboardInsightsResponseSchema.parse(response))
  })

  return routes
}

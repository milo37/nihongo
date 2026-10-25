import {
  getDashboardStatsQuerySchema,
  getDashboardStatsResponseSchema
} from '@nihongo/contracts/dashboard/get-dashboard-stats'
import { getConnInfo } from '@hono/node-server/conninfo'
import { Hono, type Context } from 'hono'
import { z, type ZodError } from 'zod'
import { createClientIpAuthority } from '../auth/clientIp.js'
import type { PrincipalService } from '../auth/principalService.js'
import type { ApiEnvironment } from '../config/env.js'
import type { DashboardService } from '../dashboard/dashboardService.js'
import { ApplicationError } from '../errors/applicationError.js'
import type { ApplicationRateLimiter } from '../middleware/applicationRateLimiter.js'
import type { ApiVariables } from '../middleware/requestContext.js'

interface DashboardRouteDependencies {
  dashboardService: DashboardService
  environment: ApiEnvironment
  principalService: PrincipalService
  rateLimiter: ApplicationRateLimiter
}

type DashboardRouteEnvironment = { Variables: ApiVariables }

const toFieldErrors = (error: ZodError): Record<string, string[]> => {
  const fieldErrors: Record<string, string[]> = {}

  for (const issue of error.issues) {
    const path = issue.path.length > 0 ? issue.path.join('.') : 'request'
    fieldErrors[path] = [...(fieldErrors[path] ?? []), issue.message]
  }

  return fieldErrors
}

const appendAuthHeaders = (
  context: Context<DashboardRouteEnvironment>,
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

export const createDashboardRoutes = ({
  dashboardService,
  environment,
  principalService,
  rateLimiter
}: DashboardRouteDependencies): Hono<DashboardRouteEnvironment> => {
  const routes = new Hono<DashboardRouteEnvironment>()
  const clientIpAuthority = createClientIpAuthority(
    environment.AUTH_TRUSTED_PROXY_CIDRS
  )
  const resolveClientIp = (
    context: Context<DashboardRouteEnvironment>
  ): string => {
    let peerAddress: string | undefined
    try {
      peerAddress = getConnInfo(context).remote.address
    } catch {
      peerAddress = undefined
    }
    return clientIpAuthority.resolve(
      peerAddress,
      context.req.header('X-Forwarded-For') ?? null
    )
  }

  routes.get('/', async (context) => {
    await rateLimiter.consume({
      clientIp: resolveClientIp(context),
      operation: 'dashboard-read',
      windowMs: 60_000,
      max: 120
    })

    let query
    try {
      query = getDashboardStatsQuerySchema.parse(context.req.query())
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        throw new ApplicationError({
          code: 'VALIDATION_ERROR',
          message: '대시보드 조회 조건이 올바르지 않습니다.',
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
          : '대시보드를 조회하려면 로그인이 필요합니다.',
        retryable: false
      })
    }

    const response = getDashboardStatsResponseSchema.parse(
      await dashboardService.getDashboardStats(resolution.user.id, query)
    )
    context.header('Cache-Control', 'private, no-store')
    return context.json(response)
  })

  return routes
}

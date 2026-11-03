import {
  getDashboardStatsQuerySchema,
  getDashboardStatsResponseSchema
} from '@nihongo/contracts/dashboard/get-dashboard-stats'
import { Hono } from 'hono'
import { z } from 'zod'
import type { PrincipalService } from '../auth/principalService.js'
import type { ApiEnvironment } from '../config/env.js'
import type { DashboardService } from '../dashboard/dashboardService.js'
import { ApplicationError } from '../errors/applicationError.js'
import type { ApplicationRateLimiter } from '../middleware/applicationRateLimiter.js'
import { createClientIpMiddleware } from '../middleware/clientIp.js'
import type { ApiVariables } from '../middleware/requestContext.js'
import { appendAuthHeaders, toFieldErrors } from './routeSupport.js'

interface DashboardRouteDependencies {
  dashboardService: DashboardService
  environment: ApiEnvironment
  principalService: PrincipalService
  rateLimiter: ApplicationRateLimiter
}

type DashboardRouteEnvironment = { Variables: ApiVariables }

export const createDashboardRoutes = ({
  dashboardService,
  environment,
  principalService,
  rateLimiter
}: DashboardRouteDependencies): Hono<DashboardRouteEnvironment> => {
  const routes = new Hono<DashboardRouteEnvironment>()
  routes.use(
    '*',
    createClientIpMiddleware(environment.AUTH_TRUSTED_PROXY_CIDRS)
  )

  routes.get('/', async (context) => {
    await rateLimiter.consume({
      clientIp: context.get('clientIp'),
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

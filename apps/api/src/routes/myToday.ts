import {
  getMyTodayQuerySchema,
  getMyTodayResponseSchema
} from '@nihongo/contracts/dashboard/get-my-today'
import { Hono } from 'hono'
import { z } from 'zod'
import type { PrincipalService } from '../auth/principalService.js'
import type { ApiEnvironment } from '../config/env.js'
import type { MyTodayService } from '../dashboard/myTodayService.js'
import { ApplicationError } from '../errors/applicationError.js'
import type { ApplicationRateLimiter } from '../middleware/applicationRateLimiter.js'
import { createClientIpMiddleware } from '../middleware/clientIp.js'
import type { ApiVariables } from '../middleware/requestContext.js'
import { appendAuthHeaders, toFieldErrors } from './routeSupport.js'

interface MyTodayRouteDependencies {
  environment: ApiEnvironment
  myTodayService: MyTodayService
  principalService: PrincipalService
  rateLimiter: ApplicationRateLimiter
}

type MyTodayRouteEnvironment = { Variables: ApiVariables }

/** Learner home "my today" card (#773). Members only; guests get 401. */
export const createMyTodayRoutes = ({
  environment,
  myTodayService,
  principalService,
  rateLimiter
}: MyTodayRouteDependencies): Hono<MyTodayRouteEnvironment> => {
  const routes = new Hono<MyTodayRouteEnvironment>()
  routes.use(
    '*',
    createClientIpMiddleware(environment.AUTH_TRUSTED_PROXY_CIDRS)
  )

  routes.get('/today', async (context) => {
    await rateLimiter.consume({
      clientIp: context.get('clientIp'),
      operation: 'me-today-read',
      windowMs: 60_000,
      max: 120
    })

    try {
      getMyTodayQuerySchema.parse(context.req.query())
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        throw new ApplicationError({
          code: 'VALIDATION_ERROR',
          message: '오늘의 학습 조회 조건이 올바르지 않습니다.',
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
          : '오늘의 학습을 보려면 로그인이 필요합니다.',
        retryable: false
      })
    }

    const response = getMyTodayResponseSchema.parse(
      await myTodayService.getMyToday(resolution.user.id)
    )
    context.header('Cache-Control', 'private, no-store')
    return context.json(response)
  })

  return routes
}

import {
  updateTargetLevelBodySchema,
  updateTargetLevelResponseSchema
} from '@nihongo/contracts/auth/update-target-level'
import { Hono } from 'hono'
import { z } from 'zod'
import type { PrincipalService } from '../auth/principalService.js'
import type { ApiEnvironment } from '../config/env.js'
import { ApplicationError } from '../errors/applicationError.js'
import type { TargetLevelService } from '../member/targetLevel.js'
import type { ApplicationRateLimiter } from '../middleware/applicationRateLimiter.js'
import { createClientIpMiddleware } from '../middleware/clientIp.js'
import { readBoundedJsonObject } from '../middleware/boundedJson.js'
import type { ApiVariables } from '../middleware/requestContext.js'
import { appendAuthHeaders, toFieldErrors } from './routeSupport.js'

interface TargetLevelRouteDependencies {
  environment: ApiEnvironment
  principalService: PrincipalService
  rateLimiter: ApplicationRateLimiter
  targetLevelService: TargetLevelService
}

type TargetLevelRouteEnvironment = { Variables: ApiVariables }

export const createTargetLevelRoutes = ({
  environment,
  principalService,
  rateLimiter,
  targetLevelService
}: TargetLevelRouteDependencies): Hono<TargetLevelRouteEnvironment> => {
  const routes = new Hono<TargetLevelRouteEnvironment>()
  routes.use(
    '*',
    createClientIpMiddleware(environment.AUTH_TRUSTED_PROXY_CIDRS)
  )

  routes.put('/', async (context) => {
    await rateLimiter.consume({
      clientIp: context.get('clientIp'),
      operation: 'target-level-write',
      windowMs: 60_000,
      max: 30
    })
    let body
    try {
      body = updateTargetLevelBodySchema.parse(
        await readBoundedJsonObject(context.req.raw)
      )
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        throw new ApplicationError({
          code: 'INVALID_REQUEST',
          message: '목표 급수 요청이 올바르지 않습니다.',
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
          : '목표 급수는 로그인이 필요합니다.',
        retryable: false
      })
    }
    const response = updateTargetLevelResponseSchema.parse(
      await targetLevelService.update(resolution.user.id, body.targetLevel)
    )
    context.header('Cache-Control', 'private, no-store')
    return context.json(response)
  })

  return routes
}

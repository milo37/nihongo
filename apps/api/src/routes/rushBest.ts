import {
  rushBestResponseSchema,
  submitRushScoreBodySchema,
  submitRushScoreResponseSchema
} from '@nihongo/contracts/study/rush-best'
import { Hono, type Context } from 'hono'
import { z } from 'zod'
import type { PrincipalService } from '../auth/principalService.js'
import type { ApiEnvironment } from '../config/env.js'
import { ApplicationError } from '../errors/applicationError.js'
import type { RushBestService } from '../member/rushBest.js'
import type { ApplicationRateLimiter } from '../middleware/applicationRateLimiter.js'
import { createClientIpMiddleware } from '../middleware/clientIp.js'
import { readBoundedJsonObject } from '../middleware/boundedJson.js'
import type { ApiVariables } from '../middleware/requestContext.js'
import { appendAuthHeaders, toFieldErrors } from './routeSupport.js'

interface RushBestRouteDependencies {
  environment: ApiEnvironment
  principalService: PrincipalService
  rateLimiter: ApplicationRateLimiter
  rushBestService: RushBestService
}

type RushBestRouteEnvironment = { Variables: ApiVariables }

/** #1043: read the member's rush bests and submit one round's score. */
export const createRushBestRoutes = ({
  environment,
  principalService,
  rateLimiter,
  rushBestService
}: RushBestRouteDependencies): Hono<RushBestRouteEnvironment> => {
  const routes = new Hono<RushBestRouteEnvironment>()
  routes.use(
    '*',
    createClientIpMiddleware(environment.AUTH_TRUSTED_PROXY_CIDRS)
  )

  const consume = (
    context: Context<RushBestRouteEnvironment>,
    operation: 'rush-best-read' | 'rush-best-write'
  ) =>
    rateLimiter.consume({
      clientIp: context.get('clientIp'),
      operation,
      windowMs: 60_000,
      max: operation === 'rush-best-read' ? 60 : 30
    })

  const parseBody = async <T>(
    context: Context<RushBestRouteEnvironment>,
    schema: z.ZodType<T>
  ): Promise<T> => {
    try {
      return schema.parse(await readBoundedJsonObject(context.req.raw))
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        throw new ApplicationError({
          code: 'INVALID_REQUEST',
          message: '러시 기록 요청이 올바르지 않습니다.',
          fieldErrors: toFieldErrors(error),
          retryable: false
        })
      }
      throw error
    }
  }

  const memberId = async (
    context: Context<RushBestRouteEnvironment>
  ): Promise<string> => {
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
          : '러시 최고 기록은 로그인이 필요합니다.',
        retryable: false
      })
    }
    return resolution.user.id
  }

  routes.get('/', async (context) => {
    await consume(context, 'rush-best-read')
    const userId = await memberId(context)
    const response = rushBestResponseSchema.parse(
      await rushBestService.read(userId)
    )
    context.header('Cache-Control', 'private, no-store')
    return context.json(response)
  })

  routes.put('/', async (context) => {
    await consume(context, 'rush-best-write')
    const body = await parseBody(context, submitRushScoreBodySchema)
    const userId = await memberId(context)
    const response = submitRushScoreResponseSchema.parse(
      await rushBestService.submit(userId, body)
    )
    context.header('Cache-Control', 'private, no-store')
    return context.json(response)
  })

  return routes
}

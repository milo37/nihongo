import {
  rushKanjiPairsQuerySchema,
  rushKanjiPairsResponseSchema
} from '@nihongo/contracts/study/rush-pairs'
import { Hono, type Context } from 'hono'
import { z } from 'zod'
import type { PrincipalService } from '../auth/principalService.js'
import type { ApiEnvironment } from '../config/env.js'
import { ApplicationError } from '../errors/applicationError.js'
import type { ApplicationRateLimiter } from '../middleware/applicationRateLimiter.js'
import { createClientIpMiddleware } from '../middleware/clientIp.js'
import type { ApiVariables } from '../middleware/requestContext.js'
import type { RushKanjiPairsReader } from '../question/rushKanjiPairs.js'
import { appendAuthHeaders, toFieldErrors } from './routeSupport.js'

interface RushKanjiPairsRouteDependencies {
  environment: ApiEnvironment
  principalService: PrincipalService
  rateLimiter: ApplicationRateLimiter
  rushKanjiPairsReader: RushKanjiPairsReader
}

type RushKanjiPairsRouteEnvironment = { Variables: ApiVariables }

/** #1043: the pairs a member's kanji rush plays; guests have no rush. */
export const createRushKanjiPairsRoutes = ({
  environment,
  principalService,
  rateLimiter,
  rushKanjiPairsReader
}: RushKanjiPairsRouteDependencies): Hono<RushKanjiPairsRouteEnvironment> => {
  const routes = new Hono<RushKanjiPairsRouteEnvironment>()
  routes.use(
    '*',
    createClientIpMiddleware(environment.AUTH_TRUSTED_PROXY_CIDRS)
  )

  const requireMember = async (
    context: Context<RushKanjiPairsRouteEnvironment>
  ): Promise<void> => {
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
          : '한자 러시는 로그인이 필요합니다.',
        retryable: false
      })
    }
  }

  routes.get('/', async (context) => {
    await rateLimiter.consume({
      clientIp: context.get('clientIp'),
      operation: 'rush-pairs-read',
      windowMs: 60_000,
      max: 60
    })
    let query
    try {
      query = rushKanjiPairsQuerySchema.parse(context.req.query())
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        throw new ApplicationError({
          code: 'INVALID_REQUEST',
          message: '러시 문제 요청이 올바르지 않습니다.',
          fieldErrors: toFieldErrors(error),
          retryable: false
        })
      }
      throw error
    }
    await requireMember(context)
    const response = rushKanjiPairsResponseSchema.parse(
      await rushKanjiPairsReader.read(query.level)
    )
    context.header('Cache-Control', 'private, no-store')
    return context.json(response)
  })

  return routes
}

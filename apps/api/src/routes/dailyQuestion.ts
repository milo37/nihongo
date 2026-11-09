import {
  getDailyQuestionQuerySchema,
  getDailyQuestionResponseSchema
} from '@nihongo/contracts/question/get-daily-question'
import { getConnInfo } from '@hono/node-server/conninfo'
import { Hono } from 'hono'
import { z } from 'zod'
import { createClientIpAuthority } from '../auth/clientIp.js'
import type { ApiEnvironment } from '../config/env.js'
import { ApplicationError } from '../errors/applicationError.js'
import type { ApplicationRateLimiter } from '../middleware/applicationRateLimiter.js'
import type { ApiVariables } from '../middleware/requestContext.js'
import type { DailyQuestionReader } from '../question/dailyQuestion.js'
import { toFieldErrors } from './routeSupport.js'

type DailyQuestionRouteEnvironment = { Variables: ApiVariables }

interface DailyQuestionRouteDependencies {
  readonly dailyQuestionReader: DailyQuestionReader
  readonly environment: ApiEnvironment
  readonly rateLimiter: ApplicationRateLimiter
  readonly now?: () => Date
}

/** GET /api/v1/daily-question?level=N5 (JLP-815). No sign-in, no record. */
export const createDailyQuestionRoutes = ({
  dailyQuestionReader,
  environment,
  rateLimiter,
  now = () => new Date()
}: DailyQuestionRouteDependencies): Hono<DailyQuestionRouteEnvironment> => {
  const routes = new Hono<DailyQuestionRouteEnvironment>()
  const clientIpAuthority = createClientIpAuthority(
    environment.AUTH_TRUSTED_PROXY_CIDRS
  )

  routes.get('/', async (context) => {
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
      max: 60,
      operation: 'daily-question-read',
      windowMs: 60_000
    })

    let query
    try {
      query = getDailyQuestionQuerySchema.parse(context.req.query())
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        throw new ApplicationError({
          code: 'VALIDATION_ERROR',
          message: '오늘의 문제 급수가 올바르지 않습니다.',
          fieldErrors: toFieldErrors(error),
          retryable: false
        })
      }
      throw error
    }

    const { response, maxAgeSeconds } =
      await dailyQuestionReader.getDailyQuestion(query.level, now())
    context.header('Cache-Control', `public, max-age=${maxAgeSeconds}`)
    return context.json(getDailyQuestionResponseSchema.parse(response))
  })

  return routes
}

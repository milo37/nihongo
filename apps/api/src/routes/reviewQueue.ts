import {
  listReviewQueueQuerySchema,
  listReviewQueueResponseSchema
} from '@nihongo/contracts/wrong-note/list-review-queue'
import { getConnInfo } from '@hono/node-server/conninfo'
import { Hono } from 'hono'
import { z } from 'zod'
import { createClientIpAuthority } from '../auth/clientIp.js'
import type { PrincipalService } from '../auth/principalService.js'
import type { ApiEnvironment } from '../config/env.js'
import { ApplicationError } from '../errors/applicationError.js'
import type { ApplicationRateLimiter } from '../middleware/applicationRateLimiter.js'
import type { ApiVariables } from '../middleware/requestContext.js'
import type { WrongNoteReviewQueueService } from '../wrong-note/wrongNoteReviewQueueService.js'
import { appendAuthHeaders, toFieldErrors } from './routeSupport.js'

interface ReviewQueueRouteDependencies {
  readonly environment: ApiEnvironment
  readonly principalService: PrincipalService
  readonly rateLimiter: ApplicationRateLimiter
  readonly reviewQueueService: WrongNoteReviewQueueService
}

type ReviewQueueRouteEnvironment = { Variables: ApiVariables }

const toRawQuery = (url: string): Record<string, string | string[]> => {
  const searchParams = new URL(url).searchParams
  const query: Record<string, string | string[]> = Object.create(
    null
  ) as Record<string, string | string[]>
  for (const key of new Set(searchParams.keys())) {
    const values = searchParams.getAll(key)
    const parsedKey = key === '__proto__' ? '__forbidden_proto__' : key
    query[parsedKey] = values.length === 1 ? (values[0] ?? '') : values
  }
  return query
}

export const createReviewQueueRoutes = ({
  environment,
  principalService,
  rateLimiter,
  reviewQueueService
}: ReviewQueueRouteDependencies): Hono<ReviewQueueRouteEnvironment> => {
  const routes = new Hono<ReviewQueueRouteEnvironment>()
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
      operation: 'wrong-note-review-queue',
      windowMs: 60_000,
      max: 120
    })

    let query
    try {
      query = listReviewQueueQuerySchema.parse(toRawQuery(context.req.url))
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        throw new ApplicationError({
          code: 'VALIDATION_ERROR',
          message: '복습 대기열 조회 조건이 올바르지 않습니다.',
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
          : '복습 대기열을 조회하려면 로그인이 필요합니다.',
        retryable: false
      })
    }

    const response = listReviewQueueResponseSchema.parse(
      await reviewQueueService.listReviewQueue(resolution.user.id, query)
    )
    context.header('Cache-Control', 'private, no-store')
    return context.json(response)
  })

  return routes
}

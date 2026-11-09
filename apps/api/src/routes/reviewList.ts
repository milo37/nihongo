import {
  listReviewListQuerySchema,
  listReviewListResponseSchema
} from '@nihongo/contracts/wrong-note/list-review-list'
import { getConnInfo } from '@hono/node-server/conninfo'
import { Hono } from 'hono'
import { z } from 'zod'
import { createClientIpAuthority } from '../auth/clientIp.js'
import type { PrincipalService } from '../auth/principalService.js'
import type { ApiEnvironment } from '../config/env.js'
import { ApplicationError } from '../errors/applicationError.js'
import type { ApplicationRateLimiter } from '../middleware/applicationRateLimiter.js'
import type { ApiVariables } from '../middleware/requestContext.js'
import type { WrongNoteReviewListService } from '../wrong-note/wrongNoteReviewList.js'
import { appendAuthHeaders, toFieldErrors } from './routeSupport.js'

interface ReviewListRouteDependencies {
  readonly environment: ApiEnvironment
  readonly principalService: PrincipalService
  readonly rateLimiter: ApplicationRateLimiter
  readonly reviewListService: WrongNoteReviewListService
}

type ReviewListRouteEnvironment = { Variables: ApiVariables }

/** GET /api/v1/review-list: wrong notes in two tabs (JLP-812). Members only. */
export const createReviewListRoutes = ({
  environment,
  principalService,
  rateLimiter,
  reviewListService
}: ReviewListRouteDependencies): Hono<ReviewListRouteEnvironment> => {
  const routes = new Hono<ReviewListRouteEnvironment>()
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
      query = listReviewListQuerySchema.parse(context.req.query())
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        throw new ApplicationError({
          code: 'VALIDATION_ERROR',
          message: '오답노트 조회 조건이 올바르지 않습니다.',
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
          : '오답노트를 보려면 로그인이 필요합니다.',
        retryable: false
      })
    }

    const response = listReviewListResponseSchema.parse(
      await reviewListService.listReviewList(resolution.user.id, query)
    )
    context.header('Cache-Control', 'private, no-store')
    return context.json(response)
  })

  return routes
}

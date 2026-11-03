import {
  createBookmarkBodySchema,
  createBookmarkParamsSchema,
  createBookmarkResponseSchema
} from '@nihongo/contracts/bookmark/create-bookmark'
import { deleteBookmarkParamsSchema } from '@nihongo/contracts/bookmark/delete-bookmark'
import {
  listBookmarksQuerySchema,
  listBookmarksResponseSchema
} from '@nihongo/contracts/bookmark/list-bookmarks'
import { Hono, type Context } from 'hono'
import { z } from 'zod'
import type { PrincipalService } from '../auth/principalService.js'
import type { BookmarkService } from '../bookmark/bookmarkService.js'
import type { ApiEnvironment } from '../config/env.js'
import { ApplicationError } from '../errors/applicationError.js'
import type { ApplicationRateLimiter } from '../middleware/applicationRateLimiter.js'
import { createClientIpMiddleware } from '../middleware/clientIp.js'
import { readBoundedJsonObject } from '../middleware/boundedJson.js'
import type { ApiVariables } from '../middleware/requestContext.js'
import { appendAuthHeaders, toFieldErrors } from './routeSupport.js'

interface BookmarkRouteDependencies {
  bookmarkService: BookmarkService
  environment: ApiEnvironment
  principalService: PrincipalService
  rateLimiter: ApplicationRateLimiter
}

type BookmarkRouteEnvironment = { Variables: ApiVariables }

const requireAuthenticatedUserId = async (
  context: Context<BookmarkRouteEnvironment>,
  principalService: PrincipalService,
  environment: ApiEnvironment
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
        : '즐겨찾기는 로그인이 필요합니다.',
      retryable: false
    })
  }
  return resolution.user.id
}

const toRawQuery = (url: string): Record<string, string | string[]> => {
  const searchParams = new URL(url).searchParams
  const query: Record<string, string | string[]> = {}
  for (const key of new Set(searchParams.keys())) {
    const values = searchParams.getAll(key)
    query[key] =
      key === 'questionIds'
        ? values
        : values.length === 1
          ? (values[0] ?? '')
          : values
  }
  return query
}

export const createBookmarkRoutes = ({
  bookmarkService,
  environment,
  principalService,
  rateLimiter
}: BookmarkRouteDependencies): Hono<BookmarkRouteEnvironment> => {
  const routes = new Hono<BookmarkRouteEnvironment>()
  routes.use(
    '*',
    createClientIpMiddleware(environment.AUTH_TRUSTED_PROXY_CIDRS)
  )

  routes.get('/', async (context) => {
    await rateLimiter.consume({
      clientIp: context.get('clientIp'),
      operation: 'bookmark-list',
      windowMs: 60_000,
      max: 120
    })
    let query
    try {
      query = listBookmarksQuerySchema.parse(toRawQuery(context.req.url))
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        throw new ApplicationError({
          code: 'VALIDATION_ERROR',
          message: '즐겨찾기 조회 조건이 올바르지 않습니다.',
          fieldErrors: toFieldErrors(error),
          retryable: false
        })
      }
      throw error
    }
    const userId = await requireAuthenticatedUserId(
      context,
      principalService,
      environment
    )
    const response = listBookmarksResponseSchema.parse(
      await bookmarkService.list(userId, query)
    )
    context.header('Cache-Control', 'private, no-store')
    return context.json(response)
  })

  routes.put('/:questionId', async (context) => {
    await rateLimiter.consume({
      clientIp: context.get('clientIp'),
      operation: 'bookmark-write',
      windowMs: 60_000,
      max: 60
    })
    let params
    try {
      params = createBookmarkParamsSchema.parse({
        questionId: context.req.param('questionId')
      })
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        throw new ApplicationError({
          code: 'INVALID_ID',
          message: '문제 ID 형식이 올바르지 않습니다.',
          fieldErrors: toFieldErrors(error),
          retryable: false
        })
      }
      throw error
    }
    try {
      createBookmarkBodySchema.parse(
        await readBoundedJsonObject(context.req.raw)
      )
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        throw new ApplicationError({
          code: 'INVALID_REQUEST',
          message: '즐겨찾기 생성 요청이 올바르지 않습니다.',
          fieldErrors: toFieldErrors(error),
          retryable: false
        })
      }
      throw error
    }
    const userId = await requireAuthenticatedUserId(
      context,
      principalService,
      environment
    )
    const created = await bookmarkService.create(userId, params.questionId)
    const response = createBookmarkResponseSchema.parse(created.bookmark)
    context.header('Cache-Control', 'private, no-store')
    context.header('Location', `/api/v1/bookmarks/${params.questionId}`)
    return created.created
      ? context.json(response, 201)
      : context.json(response, 200)
  })

  routes.delete('/:questionId', async (context) => {
    await rateLimiter.consume({
      clientIp: context.get('clientIp'),
      operation: 'bookmark-write',
      windowMs: 60_000,
      max: 60
    })
    let params
    try {
      params = deleteBookmarkParamsSchema.parse({
        questionId: context.req.param('questionId')
      })
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        throw new ApplicationError({
          code: 'INVALID_ID',
          message: '문제 ID 형식이 올바르지 않습니다.',
          fieldErrors: toFieldErrors(error),
          retryable: false
        })
      }
      throw error
    }
    const userId = await requireAuthenticatedUserId(
      context,
      principalService,
      environment
    )
    await bookmarkService.delete(userId, params.questionId)
    context.header('Cache-Control', 'private, no-store')
    return context.body(null, 204)
  })

  return routes
}

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
import { getConnInfo } from '@hono/node-server/conninfo'
import { Hono, type Context } from 'hono'
import { z, type ZodError } from 'zod'
import { createClientIpAuthority } from '../auth/clientIp.js'
import type { PrincipalService } from '../auth/principalService.js'
import type { BookmarkService } from '../bookmark/bookmarkService.js'
import type { ApiEnvironment } from '../config/env.js'
import { ApplicationError } from '../errors/applicationError.js'
import type { ApplicationRateLimiter } from '../middleware/applicationRateLimiter.js'
import { readBoundedJsonObject } from '../middleware/boundedJson.js'
import type { ApiVariables } from '../middleware/requestContext.js'

interface BookmarkRouteDependencies {
  bookmarkService: BookmarkService
  environment: ApiEnvironment
  principalService: PrincipalService
  rateLimiter: ApplicationRateLimiter
}

type BookmarkRouteEnvironment = { Variables: ApiVariables }

const toFieldErrors = (error: ZodError): Record<string, string[]> => {
  const fieldErrors: Record<string, string[]> = {}
  for (const issue of error.issues) {
    const path = issue.path.length > 0 ? issue.path.join('.') : 'request'
    fieldErrors[path] = [...(fieldErrors[path] ?? []), issue.message]
  }
  return fieldErrors
}

const appendAuthHeaders = (
  context: Context<BookmarkRouteEnvironment>,
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
  const clientIpAuthority = createClientIpAuthority(
    environment.AUTH_TRUSTED_PROXY_CIDRS
  )
  const resolveClientIp = (
    context: Context<BookmarkRouteEnvironment>
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
      clientIp: resolveClientIp(context),
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
      clientIp: resolveClientIp(context),
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

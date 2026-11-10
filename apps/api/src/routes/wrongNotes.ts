import {
  getWrongNoteParamsSchema,
  getWrongNoteQuerySchema,
  getWrongNoteResponseSchema
} from '@nihongo/contracts/wrong-note/get-wrong-note'
import {
  createGetWrongNoteMemoResponseSchema,
  getWrongNoteMemoParamsSchema,
  getWrongNoteMemoQuerySchema,
  getWrongNoteMemoResponseSchema
} from '@nihongo/contracts/wrong-note/get-wrong-note-memo'
import {
  listReviewEventsParamsSchema,
  listReviewEventsQuerySchema,
  listReviewEventsResponseSchema
} from '@nihongo/contracts/wrong-note/list-review-events'
import {
  createUpdateWrongNoteMemoResponseSchema,
  updateWrongNoteMemoBodySchema,
  updateWrongNoteMemoParamsSchema,
  updateWrongNoteMemoResponseSchema
} from '@nihongo/contracts/wrong-note/update-wrong-note-memo'
import { Hono, type Context } from 'hono'
import { z, type ZodError, type ZodIssue } from 'zod'
import type { PrincipalService } from '../auth/principalService.js'
import type { ApiEnvironment } from '../config/env.js'
import { ApplicationError } from '../errors/applicationError.js'
import type { ApplicationRateLimiter } from '../middleware/applicationRateLimiter.js'
import { createClientIpMiddleware } from '../middleware/clientIp.js'
import { readBoundedJsonObject } from '../middleware/boundedJson.js'
import type { ApiVariables } from '../middleware/requestContext.js'
import type { WrongNoteReviewCenterService } from '../wrong-note/wrongNoteReviewCenterService.js'
import type { WrongNoteService } from '../wrong-note/wrongNoteService.js'
import { appendAuthHeaders, toFieldErrors } from './routeSupport.js'

interface WrongNoteRouteDependencies {
  environment: ApiEnvironment
  principalService: PrincipalService
  rateLimiter: ApplicationRateLimiter
  reviewCenterEnabled: boolean
  reviewCenterService: WrongNoteReviewCenterService
  wrongNoteService: WrongNoteService
}

const MEMO_BODY_MAX_BYTES = 32 * 1_024

type WrongNoteRouteEnvironment = { Variables: ApiVariables }

const requireAuthenticatedUserId = async (
  context: Context<WrongNoteRouteEnvironment>,
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
        : '오답 노트를 조회하려면 로그인이 필요합니다.',
      retryable: false
    })
  }

  return resolution.user.id
}

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

const invalidQuestionId = (error: ZodError): ApplicationError =>
  new ApplicationError({
    code: 'INVALID_ID',
    message: '문제 ID 형식이 올바르지 않습니다.',
    fieldErrors: toFieldErrors(error),
    retryable: false
  })

const memoBodyError = (error: ZodError): ApplicationError => {
  const containsCustomIssue = (issue: ZodIssue): boolean => {
    if (issue.code === 'custom') {
      return true
    }
    if (issue.code === 'invalid_union') {
      return issue.errors.some((branch) => branch.some(containsCustomIssue))
    }
    if (issue.code === 'invalid_key' || issue.code === 'invalid_element') {
      return issue.issues.some(containsCustomIssue)
    }
    return false
  }
  const isSemanticMemoError = error.issues.some(
    (issue) => issue.path[0] === 'memo' && containsCustomIssue(issue)
  )
  return new ApplicationError({
    code: isSemanticMemoError ? 'VALIDATION_ERROR' : 'INVALID_REQUEST',
    message: isSemanticMemoError
      ? '오답 메모 내용이 올바르지 않습니다.'
      : '오답 메모 요청 형식이 올바르지 않습니다.',
    fieldErrors: toFieldErrors(error),
    retryable: false
  })
}

export const createWrongNoteRoutes = ({
  environment,
  principalService,
  rateLimiter,
  reviewCenterEnabled,
  reviewCenterService,
  wrongNoteService
}: WrongNoteRouteDependencies): Hono<WrongNoteRouteEnvironment> => {
  const routes = new Hono<WrongNoteRouteEnvironment>()
  routes.use(
    '*',
    createClientIpMiddleware(environment.AUTH_TRUSTED_PROXY_CIDRS)
  )

  if (reviewCenterEnabled) {
    routes.get('/:questionId/memo', async (context) => {
      await rateLimiter.consume({
        clientIp: context.get('clientIp'),
        operation: 'wrong-note-memo-read',
        windowMs: 60_000,
        max: 120
      })

      let params
      try {
        params = getWrongNoteMemoParamsSchema.parse({
          questionId: context.req.param('questionId')
        })
      } catch (error: unknown) {
        if (error instanceof z.ZodError) {
          throw invalidQuestionId(error)
        }
        throw error
      }

      try {
        getWrongNoteMemoQuerySchema.parse(toRawQuery(context.req.url))
      } catch (error: unknown) {
        if (error instanceof z.ZodError) {
          throw new ApplicationError({
            code: 'VALIDATION_ERROR',
            message: '오답 메모 조회 조건이 올바르지 않습니다.',
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
      const response = getWrongNoteMemoResponseSchema.parse(
        createGetWrongNoteMemoResponseSchema(params.questionId).parse(
          await reviewCenterService.getMemo(userId, params.questionId)
        )
      )
      context.header('Cache-Control', 'private, no-store')
      return context.json(response)
    })

    routes.put('/:questionId/memo', async (context) => {
      await rateLimiter.consume({
        clientIp: context.get('clientIp'),
        operation: 'wrong-note-memo-write',
        windowMs: 60_000,
        max: 60
      })

      let params
      try {
        params = updateWrongNoteMemoParamsSchema.parse({
          questionId: context.req.param('questionId')
        })
      } catch (error: unknown) {
        if (error instanceof z.ZodError) {
          throw invalidQuestionId(error)
        }
        throw error
      }

      try {
        getWrongNoteMemoQuerySchema.parse(toRawQuery(context.req.url))
      } catch (error: unknown) {
        if (error instanceof z.ZodError) {
          throw new ApplicationError({
            code: 'VALIDATION_ERROR',
            message: '오답 메모 수정 조건이 올바르지 않습니다.',
            fieldErrors: toFieldErrors(error),
            retryable: false
          })
        }
        throw error
      }

      let body
      try {
        body = updateWrongNoteMemoBodySchema.parse(
          await readBoundedJsonObject(context.req.raw, {
            maxBytes: MEMO_BODY_MAX_BYTES
          })
        )
      } catch (error: unknown) {
        if (error instanceof z.ZodError) {
          throw memoBodyError(error)
        }
        throw error
      }

      const userId = await requireAuthenticatedUserId(
        context,
        principalService,
        environment
      )
      const response = updateWrongNoteMemoResponseSchema.parse(
        createUpdateWrongNoteMemoResponseSchema(params.questionId).parse(
          await reviewCenterService.updateMemo(userId, params.questionId, body)
        )
      )
      context.header('Cache-Control', 'private, no-store')
      return context.json(response)
    })

    routes.get('/:questionId/review-events', async (context) => {
      await rateLimiter.consume({
        clientIp: context.get('clientIp'),
        operation: 'wrong-note-history',
        windowMs: 60_000,
        max: 120
      })

      let params
      try {
        params = listReviewEventsParamsSchema.parse({
          questionId: context.req.param('questionId')
        })
      } catch (error: unknown) {
        if (error instanceof z.ZodError) {
          throw invalidQuestionId(error)
        }
        throw error
      }

      let query
      try {
        query = listReviewEventsQuerySchema.parse(toRawQuery(context.req.url))
      } catch (error: unknown) {
        if (error instanceof z.ZodError) {
          throw new ApplicationError({
            code: 'VALIDATION_ERROR',
            message: '복습 기록 조회 조건이 올바르지 않습니다.',
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
      const response = listReviewEventsResponseSchema.parse(
        await reviewCenterService.listReviewEvents(
          userId,
          params.questionId,
          query
        )
      )
      context.header('Cache-Control', 'private, no-store')
      return context.json(response)
    })
  }

  routes.get('/:questionId', async (context) => {
    await rateLimiter.consume({
      clientIp: context.get('clientIp'),
      operation: 'wrong-note-detail',
      windowMs: 60_000,
      max: 120
    })

    let params
    try {
      params = getWrongNoteParamsSchema.parse({
        questionId: context.req.param('questionId')
      })
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        throw invalidQuestionId(error)
      }
      throw error
    }

    try {
      getWrongNoteQuerySchema.parse(context.req.query())
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        throw new ApplicationError({
          code: 'VALIDATION_ERROR',
          message: '오답 노트 상세 조회 조건이 올바르지 않습니다.',
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
    const response = getWrongNoteResponseSchema.parse(
      await wrongNoteService.getWrongNote(userId, params.questionId)
    )
    context.header('Cache-Control', 'private, no-store')
    return context.json(response)
  })

  return routes
}

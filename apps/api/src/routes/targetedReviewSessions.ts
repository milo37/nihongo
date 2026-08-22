import {
  createTargetedReviewSessionBodySchema,
  createTargetedReviewSessionHeadersSchema,
  createTargetedReviewSessionLocationSchema,
  createTargetedReviewSessionParamsSchema,
  createTargetedReviewSessionQuerySchema,
  createTargetedReviewSessionResponseForQuestionSchema,
  createTargetedReviewSessionResponseSchema
} from '@nihongo/contracts/wrong-note/create-targeted-review-session'
import { getConnInfo } from '@hono/node-server/conninfo'
import { Hono, type Context } from 'hono'
import { z, type ZodError } from 'zod'
import { createClientIpAuthority } from '../auth/clientIp.js'
import type { PrincipalService } from '../auth/principalService.js'
import type { ApiEnvironment } from '../config/env.js'
import { ApplicationError } from '../errors/applicationError.js'
import type { ApplicationRateLimiter } from '../middleware/applicationRateLimiter.js'
import { readBoundedJsonObject } from '../middleware/boundedJson.js'
import type { ApiVariables } from '../middleware/requestContext.js'
import type { WrongNoteTargetedReviewService } from '../wrong-note/wrongNoteTargetedReviewService.js'

interface TargetedReviewSessionRouteDependencies {
  readonly environment: ApiEnvironment
  readonly principalService: PrincipalService
  readonly rateLimiter: ApplicationRateLimiter
  readonly targetedReviewService: WrongNoteTargetedReviewService
}

type TargetedReviewSessionRouteEnvironment = { Variables: ApiVariables }

const toFieldErrors = (error: ZodError): Record<string, string[]> => {
  const fieldErrors: Record<string, string[]> = {}
  for (const issue of error.issues) {
    const path = issue.path.length > 0 ? issue.path.join('.') : 'request'
    fieldErrors[path] = [...(fieldErrors[path] ?? []), issue.message]
  }
  return fieldErrors
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

const appendAuthHeaders = (
  context: Context<TargetedReviewSessionRouteEnvironment>,
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

export const createTargetedReviewSessionRoutes = ({
  environment,
  principalService,
  rateLimiter,
  targetedReviewService
}: TargetedReviewSessionRouteDependencies): Hono<TargetedReviewSessionRouteEnvironment> => {
  const routes = new Hono<TargetedReviewSessionRouteEnvironment>()
  const clientIpAuthority = createClientIpAuthority(
    environment.AUTH_TRUSTED_PROXY_CIDRS
  )

  routes.post('/:questionId/review-session', async (context) => {
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
      operation: 'wrong-note-targeted-review',
      windowMs: 60_000,
      max: 20
    })

    let params
    try {
      params = createTargetedReviewSessionParamsSchema.parse({
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
      createTargetedReviewSessionQuerySchema.parse(toRawQuery(context.req.url))
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        throw new ApplicationError({
          code: 'INVALID_REQUEST',
          message: 'targeted 복습 생성 조건이 올바르지 않습니다.',
          fieldErrors: toFieldErrors(error),
          retryable: false
        })
      }
      throw error
    }

    if (context.req.header('X-Nihongo-Practice-Contract') !== '2') {
      throw new ApplicationError({
        code: 'INVALID_REQUEST',
        message: 'targeted 복습에는 practice contract 2가 필요합니다.',
        retryable: false
      })
    }

    let headers
    try {
      headers = createTargetedReviewSessionHeadersSchema.parse({
        'idempotency-key': context.req.header('Idempotency-Key'),
        'x-nihongo-practice-contract': context.req.header(
          'X-Nihongo-Practice-Contract'
        )
      })
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        throw new ApplicationError({
          code: 'IDEMPOTENCY_KEY_REQUIRED',
          message: '유효한 Idempotency-Key UUID header가 필요합니다.',
          retryable: false
        })
      }
      throw error
    }

    try {
      createTargetedReviewSessionBodySchema.parse(
        await readBoundedJsonObject(context.req.raw)
      )
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        throw new ApplicationError({
          code: 'INVALID_REQUEST',
          message: 'targeted 복습 요청 본문은 빈 JSON object여야 합니다.',
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
          : 'targeted 복습을 시작하려면 로그인이 필요합니다.',
        retryable: false
      })
    }

    const created = await targetedReviewService.createTargetedReviewSession(
      resolution.user.id,
      params.questionId,
      headers['idempotency-key']
    )
    const response = createTargetedReviewSessionResponseSchema.parse(
      createTargetedReviewSessionResponseForQuestionSchema(
        params.questionId
      ).parse(created.response)
    )
    const location = createTargetedReviewSessionLocationSchema(
      response.session.id
    ).parse(`/api/v1/study-sessions/${response.session.id}`)

    context.header('Cache-Control', 'private, no-store')
    context.header('X-Nihongo-Practice-Contract', '2')
    context.header('Location', location)
    if (created.replayed) {
      context.header('Idempotency-Replayed', 'true')
    }
    return context.json(response, 201)
  })

  return routes
}

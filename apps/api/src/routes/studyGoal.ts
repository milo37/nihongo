import {
  skipStudyGoalBodySchema,
  studyGoalResponseSchema,
  updateStudyGoalBodySchema
} from '@nihongo/contracts/auth/study-goal'
import { Hono, type Context } from 'hono'
import { z } from 'zod'
import type { PrincipalService } from '../auth/principalService.js'
import type { ApiEnvironment } from '../config/env.js'
import { ApplicationError } from '../errors/applicationError.js'
import type { StudyGoalService } from '../member/studyGoal.js'
import type { ApplicationRateLimiter } from '../middleware/applicationRateLimiter.js'
import { createClientIpMiddleware } from '../middleware/clientIp.js'
import { readBoundedJsonObject } from '../middleware/boundedJson.js'
import type { ApiVariables } from '../middleware/requestContext.js'
import { appendAuthHeaders, toFieldErrors } from './routeSupport.js'

interface StudyGoalRouteDependencies {
  environment: ApiEnvironment
  principalService: PrincipalService
  rateLimiter: ApplicationRateLimiter
  studyGoalService: StudyGoalService
}

type StudyGoalRouteEnvironment = { Variables: ApiVariables }

/** #1090: read, save and skip the member's own study goal. */
export const createStudyGoalRoutes = ({
  environment,
  principalService,
  rateLimiter,
  studyGoalService
}: StudyGoalRouteDependencies): Hono<StudyGoalRouteEnvironment> => {
  const routes = new Hono<StudyGoalRouteEnvironment>()
  routes.use(
    '*',
    createClientIpMiddleware(environment.AUTH_TRUSTED_PROXY_CIDRS)
  )

  const consume = (
    context: Context<StudyGoalRouteEnvironment>,
    operation: 'study-goal-read' | 'study-goal-write'
  ) =>
    rateLimiter.consume({
      clientIp: context.get('clientIp'),
      operation,
      windowMs: 60_000,
      max: operation === 'study-goal-read' ? 60 : 30
    })

  const parseBody = async <T>(
    context: Context<StudyGoalRouteEnvironment>,
    schema: z.ZodType<T>
  ): Promise<T> => {
    try {
      return schema.parse(await readBoundedJsonObject(context.req.raw))
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        throw new ApplicationError({
          code: 'INVALID_REQUEST',
          message: '학습 목표 요청이 올바르지 않습니다.',
          fieldErrors: toFieldErrors(error),
          retryable: false
        })
      }
      throw error
    }
  }

  const memberId = async (
    context: Context<StudyGoalRouteEnvironment>
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
          : '학습 목표는 로그인이 필요합니다.',
        retryable: false
      })
    }
    return resolution.user.id
  }

  routes.get('/', async (context) => {
    await consume(context, 'study-goal-read')
    const userId = await memberId(context)
    const response = studyGoalResponseSchema.parse(
      await studyGoalService.read(userId)
    )
    context.header('Cache-Control', 'private, no-store')
    return context.json(response)
  })

  routes.put('/', async (context) => {
    await consume(context, 'study-goal-write')
    const body = await parseBody(context, updateStudyGoalBodySchema)
    const userId = await memberId(context)
    const response = studyGoalResponseSchema.parse(
      await studyGoalService.update(userId, body)
    )
    context.header('Cache-Control', 'private, no-store')
    return context.json(response)
  })

  routes.post('/skip', async (context) => {
    await consume(context, 'study-goal-write')
    await parseBody(context, skipStudyGoalBodySchema)
    const userId = await memberId(context)
    const response = studyGoalResponseSchema.parse(
      await studyGoalService.skip(userId)
    )
    context.header('Cache-Control', 'private, no-store')
    return context.json(response)
  })

  return routes
}

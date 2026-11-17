import {
  updateNicknameBodySchema,
  updateNicknameResponseSchema
} from '@nihongo/contracts/auth/update-nickname'
import { Hono } from 'hono'
import { z } from 'zod'
import type { PrincipalService } from '../auth/principalService.js'
import type { ApiEnvironment } from '../config/env.js'
import { ApplicationError } from '../errors/applicationError.js'
import type { NicknameService } from '../member/nickname.js'
import type { ApplicationRateLimiter } from '../middleware/applicationRateLimiter.js'
import { createClientIpMiddleware } from '../middleware/clientIp.js'
import { readBoundedJsonObject } from '../middleware/boundedJson.js'
import type { ApiVariables } from '../middleware/requestContext.js'
import { appendAuthHeaders, toFieldErrors } from './routeSupport.js'

interface NicknameRouteDependencies {
  environment: ApiEnvironment
  principalService: PrincipalService
  rateLimiter: ApplicationRateLimiter
  nicknameService: NicknameService
}

type NicknameRouteEnvironment = { Variables: ApiVariables }

export const createNicknameRoutes = ({
  environment,
  principalService,
  rateLimiter,
  nicknameService
}: NicknameRouteDependencies): Hono<NicknameRouteEnvironment> => {
  const routes = new Hono<NicknameRouteEnvironment>()
  routes.use(
    '*',
    createClientIpMiddleware(environment.AUTH_TRUSTED_PROXY_CIDRS)
  )

  routes.put('/', async (context) => {
    await rateLimiter.consume({
      clientIp: context.get('clientIp'),
      operation: 'nickname-write',
      windowMs: 60_000,
      max: 30
    })
    let body
    try {
      body = updateNicknameBodySchema.parse(
        await readBoundedJsonObject(context.req.raw)
      )
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        throw new ApplicationError({
          code: 'INVALID_REQUEST',
          message: '닉네임을 2자 이상 입력해 주세요',
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
          : '닉네임은 로그인이 필요합니다.',
        retryable: false
      })
    }
    const response = updateNicknameResponseSchema.parse(
      await nicknameService.update(resolution.user.id, body.nickname)
    )
    context.header('Cache-Control', 'private, no-store')
    return context.json(response)
  })

  return routes
}

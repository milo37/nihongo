import { getConnInfo } from '@hono/node-server/conninfo'
import type { Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import { createClientIpAuthority } from '../auth/clientIp.js'
import type { PrincipalService } from '../auth/principalService.js'
import type { ApiEnvironment } from '../config/env.js'
import { ApplicationError } from '../errors/applicationError.js'
import type { ApiVariables } from '../middleware/requestContext.js'
import type { AdminReadRateLimiter } from './adminReadRateLimiter.js'

type AdminRouteEnvironment = { Variables: ApiVariables }

const appendAuthHeaders = (
  context: Context<AdminRouteEnvironment>,
  resolution: Awaited<ReturnType<PrincipalService['resolveAuthenticatedUser']>>,
  environment: ApiEnvironment
): void => {
  for (const cookie of resolution.headers.getSetCookie?.() ?? []) {
    context.header('Set-Cookie', cookie, { append: true })
  }
  if (!resolution.clearSessionCookie) {
    return
  }

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

export const createAdminReadGuard = ({
  assertCapability,
  environment,
  principalService,
  rateLimiter
}: {
  assertCapability: () => void | Promise<void>
  environment: ApiEnvironment
  principalService: PrincipalService
  rateLimiter: AdminReadRateLimiter
}) => {
  const clientIpAuthority = createClientIpAuthority(
    environment.AUTH_TRUSTED_PROXY_CIDRS
  )

  return createMiddleware<AdminRouteEnvironment>(async (context, next) => {
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
          : '관리자 기능을 사용하려면 로그인이 필요합니다.',
        retryable: false
      })
    }
    if (resolution.user.role !== 'ADMIN') {
      throw new ApplicationError({
        code: 'ADMIN_REQUIRED',
        message: '관리자 권한이 필요합니다.',
        retryable: false
      })
    }

    try {
      await assertCapability()
    } catch (error: unknown) {
      if (error instanceof ApplicationError) {
        throw error
      }
      throw new ApplicationError({
        code: 'SERVICE_UNAVAILABLE',
        message: '관리자 조회 기능을 사용할 수 없습니다.',
        retryable: true,
        retryAfterSeconds: 5,
        cause: error
      })
    }

    let peerAddress: string | undefined
    try {
      peerAddress = getConnInfo(context).remote.address
    } catch {
      peerAddress = undefined
    }
    await rateLimiter.consume({
      actorId: resolution.user.id,
      clientIp: clientIpAuthority.resolve(
        peerAddress,
        context.req.header('X-Forwarded-For') ?? null
      )
    })

    context.set('adminActorId', resolution.user.id)
    await next()
  })
}

import { getConnInfo } from '@hono/node-server/conninfo'
import { createMiddleware } from 'hono/factory'
import { createClientIpAuthority } from '../auth/clientIp.js'
import type { PrincipalService } from '../auth/principalService.js'
import type { ApiEnvironment } from '../config/env.js'
import { ApplicationError } from '../errors/applicationError.js'
import type { ApiVariables } from '../middleware/requestContext.js'
import {
  assertPhase7DeclaredBodyBound,
  assertPhase7JsonTransport,
  assertPhase7TrustedOrigin,
  getPhase7OperationBodyCap
} from './adminCommandGuard.js'
import { appendAdminAuthHeaders } from './adminReadGuard.js'
import type { QuestionReportRateLimiter } from './questionReportRateLimiter.js'

type QuestionReportRouteEnvironment = { Variables: ApiVariables }

export const createQuestionReportGuard = ({
  environment,
  principalService,
  rateLimiter
}: {
  readonly environment: ApiEnvironment
  readonly principalService: PrincipalService
  readonly rateLimiter: QuestionReportRateLimiter
}) => {
  const clientIpAuthority = createClientIpAuthority(
    environment.AUTH_TRUSTED_PROXY_CIDRS
  )

  return createMiddleware<QuestionReportRouteEnvironment>(
    async (context, next) => {
      assertPhase7DeclaredBodyBound(
        context,
        getPhase7OperationBodyCap('createQuestionReport')
      )

      let resolution: Awaited<
        ReturnType<PrincipalService['resolveAuthenticatedUser']>
      >
      try {
        resolution = await principalService.resolveAuthenticatedUser(
          context.req.raw.headers
        )
      } catch (error: unknown) {
        throw new ApplicationError({
          code: 'SERVICE_UNAVAILABLE',
          message: '로그인 세션을 확인할 수 없습니다.',
          retryable: true,
          retryAfterSeconds: 5,
          phase7Disposition: 'NO_TX',
          cause: error
        })
      }

      if (!resolution.user || !resolution.phase7Session) {
        if (resolution.clearSessionCookie) {
          try {
            assertPhase7TrustedOrigin(context, environment)
            appendAdminAuthHeaders(context, resolution, environment)
          } catch {
            // Credential-changing headers never accompany an untrusted request.
          }
        }
        throw new ApplicationError({
          code: resolution.clearSessionCookie
            ? 'AUTH_SESSION_EXPIRED'
            : 'AUTHENTICATION_REQUIRED',
          message: resolution.clearSessionCookie
            ? '로그인 세션이 만료됐습니다.'
            : '문제를 신고하려면 로그인이 필요합니다.',
          retryable: false,
          phase7Disposition: 'NO_TX'
        })
      }

      assertPhase7JsonTransport(context)
      assertPhase7TrustedOrigin(context, environment)
      appendAdminAuthHeaders(context, resolution, environment)
      let peerAddress: string | undefined
      try {
        peerAddress = getConnInfo(context).remote.address
      } catch {
        peerAddress = undefined
      }
      const clientIp = clientIpAuthority.resolve(
        peerAddress,
        context.req.header('X-Forwarded-For') ?? null
      )
      await rateLimiter.consume({
        actorId: resolution.user.id,
        clientIp,
        group: 'REPORT_ACTOR'
      })

      context.set('reporterActorId', resolution.user.id)
      context.set('reporterSessionToken', resolution.phase7Session.token)
      await next()
    }
  )
}

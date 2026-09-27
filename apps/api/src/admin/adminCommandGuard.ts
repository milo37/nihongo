import { getConnInfo } from '@hono/node-server/conninfo'
import type { Phase7Operation } from '@nihongo/contracts/admin/phase7'
import type { Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import { getCanonicalPhase7Slice3Operation } from '../app/phase7PrefixExclusion.js'
import { createClientIpAuthority } from '../auth/clientIp.js'
import type { PrincipalService } from '../auth/principalService.js'
import type { ApiEnvironment } from '../config/env.js'
import { ApplicationError } from '../errors/applicationError.js'
import type { ApiVariables } from '../middleware/requestContext.js'
import {
  type AdminCommandRateLimitGroup,
  type AdminCommandRateLimiter
} from './adminCommandRateLimiter.js'
import { appendAdminAuthHeaders } from './adminReadGuard.js'

type AdminRouteEnvironment = { Variables: ApiVariables }

const LARGE_BODY_CAP = 256 * 1024
const SMALL_BODY_CAP = 16 * 1024
const REAUTHENTICATION_BODY_CAP = 4 * 1024
const CANONICAL_CONTENT_LENGTH = /^(?:0|[1-9][0-9]*)$/u
const JSON_MEDIA_TYPE =
  /^application\/json(?:[ \t]*;[ \t]*charset[ \t]*=[ \t]*(?:utf-8|"utf-8"))?$/iu

const bodyCapByOperation: Readonly<Partial<Record<Phase7Operation, number>>> = {
  createAdminQuestion: LARGE_BODY_CAP,
  createAdminQuestionVersion: LARGE_BODY_CAP,
  updateQuestionVersion: LARGE_BODY_CAP,
  requestContentReview: SMALL_BODY_CAP,
  requestQuestionChanges: SMALL_BODY_CAP,
  approveQuestionVersion: SMALL_BODY_CAP,
  withdrawQuestionApproval: SMALL_BODY_CAP,
  publishQuestionVersion: SMALL_BODY_CAP,
  retireQuestionVersion: SMALL_BODY_CAP,
  archiveAdminQuestion: SMALL_BODY_CAP,
  reauthenticateAdmin: REAUTHENTICATION_BODY_CAP
}

const groupByOperation: Readonly<
  Partial<Record<Phase7Operation, AdminCommandRateLimitGroup>>
> = {
  createAdminQuestion: 'ADMIN_EDIT',
  createAdminQuestionVersion: 'ADMIN_EDIT',
  updateQuestionVersion: 'ADMIN_EDIT',
  requestContentReview: 'ADMIN_EDIT',
  requestQuestionChanges: 'ADMIN_EDIT',
  approveQuestionVersion: 'ADMIN_SENSITIVE',
  withdrawQuestionApproval: 'ADMIN_SENSITIVE',
  publishQuestionVersion: 'ADMIN_SENSITIVE',
  retireQuestionVersion: 'ADMIN_SENSITIVE',
  archiveAdminQuestion: 'ADMIN_SENSITIVE',
  reauthenticateAdmin: 'REAUTHENTICATION'
}

const freshOperations = new Set<Phase7Operation>([
  'approveQuestionVersion',
  'withdrawQuestionApproval',
  'publishQuestionVersion',
  'retireQuestionVersion',
  'archiveAdminQuestion'
])

const invalidRequest = (message: string): ApplicationError =>
  new ApplicationError({
    code: 'INVALID_REQUEST',
    message,
    retryable: false,
    phase7Disposition: 'NO_TX'
  })

const requestTooLarge = (): ApplicationError =>
  new ApplicationError({
    code: 'REQUEST_TOO_LARGE',
    message: '요청 본문이 허용된 크기를 초과했습니다.',
    retryable: false,
    phase7Disposition: 'NO_TX'
  })

const getOperation = (
  context: Context<AdminRouteEnvironment>,
  operationResolver: typeof getCanonicalPhase7Slice3Operation
): Phase7Operation => {
  const operation = operationResolver({
    method: context.req.method,
    requestTarget: context.get('rawRequestTarget')
  })
  if (!operation) {
    throw new ApplicationError({
      code: 'RESOURCE_NOT_FOUND',
      message: '요청한 경로를 찾을 수 없습니다.',
      retryable: false,
      phase7Disposition: 'NO_TX'
    })
  }
  return operation
}

const assertDeclaredBodyBound = (
  context: Context<AdminRouteEnvironment>,
  bodyCap: number
): void => {
  const declared = context.req.header('Content-Length')
  if (declared === undefined) return
  if (!CANONICAL_CONTENT_LENGTH.test(declared)) {
    throw invalidRequest('Content-Length가 올바르지 않습니다.')
  }
  if (BigInt(declared) > BigInt(bodyCap)) throw requestTooLarge()
}

const assertJsonTransport = (context: Context<AdminRouteEnvironment>): void => {
  const contentEncoding = context.req.header('Content-Encoding')
  if (
    contentEncoding !== undefined &&
    contentEncoding.toLowerCase() !== 'identity'
  ) {
    throw invalidRequest('지원하지 않는 Content-Encoding입니다.')
  }
  const contentType = context.req.header('Content-Type')
  if (!contentType || !JSON_MEDIA_TYPE.test(contentType)) {
    throw invalidRequest('JSON Content-Type이 필요합니다.')
  }
}

const assertTrustedOrigin = (
  context: Context<AdminRouteEnvironment>,
  environment: ApiEnvironment
): void => {
  const origin = context.req.header('Origin')
  const fetchSite = context.req.header('Sec-Fetch-Site')
  const originIsTrusted =
    origin !== undefined &&
    !origin.includes(',') &&
    environment.TRUSTED_ORIGINS.includes(origin)
  const fetchSiteIsAllowedWithOrigin =
    fetchSite === undefined ||
    fetchSite === 'same-origin' ||
    fetchSite === 'same-site'
  const trusted = originIsTrusted && fetchSiteIsAllowedWithOrigin
  const sameOriginWithoutOrigin =
    origin === undefined && fetchSite === 'same-origin'
  if (trusted || sameOriginWithoutOrigin) return

  throw new ApplicationError({
    code: 'UNTRUSTED_ORIGIN',
    message: '신뢰할 수 있는 요청 출처가 필요합니다.',
    retryable: false,
    phase7Disposition: 'NO_TX'
  })
}

export const getPhase7OperationBodyCap = (operation: Phase7Operation): number =>
  bodyCapByOperation[operation] ?? SMALL_BODY_CAP

export const createAdminCommandGuard = ({
  assertCapability,
  environment,
  operationResolver = getCanonicalPhase7Slice3Operation,
  principalService,
  rateLimiter
}: {
  assertCapability: () => void | Promise<void>
  environment: ApiEnvironment
  operationResolver?: typeof getCanonicalPhase7Slice3Operation
  principalService: PrincipalService
  rateLimiter: AdminCommandRateLimiter
}) => {
  const clientIpAuthority = createClientIpAuthority(
    environment.AUTH_TRUSTED_PROXY_CIDRS
  )

  return createMiddleware<AdminRouteEnvironment>(async (context, next) => {
    const operation = getOperation(context, operationResolver)
    assertDeclaredBodyBound(context, getPhase7OperationBodyCap(operation))

    let resolution: Awaited<
      ReturnType<PrincipalService['resolveAuthenticatedUser']>
    >
    try {
      resolution = await principalService.resolveAuthenticatedUser(
        context.req.raw.headers,
        {
          classifyAdminAuthorityLoss: true,
          refreshRememberedSession: operation !== 'reauthenticateAdmin'
        }
      )
    } catch (error: unknown) {
      throw new ApplicationError({
        code: 'SERVICE_UNAVAILABLE',
        message: '관리자 세션을 확인할 수 없습니다.',
        retryable: true,
        retryAfterSeconds: 5,
        phase7Disposition: 'NO_TX',
        cause: error
      })
    }
    if (!resolution.user || !resolution.phase7Session) {
      if (resolution.clearSessionCookie) {
        try {
          assertTrustedOrigin(context, environment)
          appendAdminAuthHeaders(context, resolution, environment)
        } catch {
          // Never attach credential-changing headers to an untrusted origin.
        }
      }
      if (resolution.adminAuthorityFailure === 'ADMIN_REQUIRED') {
        throw new ApplicationError({
          code: 'ADMIN_REQUIRED',
          message: '관리자 권한이 필요합니다.',
          retryable: false,
          phase7Disposition: 'NO_TX'
        })
      }
      throw new ApplicationError({
        code: resolution.clearSessionCookie
          ? 'AUTH_SESSION_EXPIRED'
          : 'AUTHENTICATION_REQUIRED',
        message: resolution.clearSessionCookie
          ? '로그인 세션이 만료됐습니다.'
          : '관리자 기능을 사용하려면 로그인이 필요합니다.',
        retryable: false,
        phase7Disposition: 'NO_TX'
      })
    }
    if (resolution.user.role !== 'ADMIN') {
      throw new ApplicationError({
        code: 'ADMIN_REQUIRED',
        message: '관리자 권한이 필요합니다.',
        retryable: false,
        phase7Disposition: 'NO_TX'
      })
    }

    try {
      await assertCapability()
    } catch (error: unknown) {
      if (
        error instanceof ApplicationError &&
        error.phase7Disposition !== undefined
      ) {
        throw error
      }
      throw new ApplicationError({
        code: 'SERVICE_UNAVAILABLE',
        message: '관리자 명령 기능을 사용할 수 없습니다.',
        retryable: true,
        retryAfterSeconds: 5,
        phase7Disposition: 'NO_TX',
        cause: error
      })
    }

    if (freshOperations.has(operation) && !resolution.phase7Session.isFresh) {
      throw new ApplicationError({
        code: 'FRESH_ASSURANCE_REQUIRED',
        message: '민감한 관리자 작업을 위해 비밀번호를 다시 확인해 주세요.',
        retryable: false,
        phase7Disposition: 'NO_TX'
      })
    }

    assertJsonTransport(context)
    assertTrustedOrigin(context, environment)
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
    const group = groupByOperation[operation]
    if (!group) {
      throw new ApplicationError({
        code: 'INTERNAL_SERVER_ERROR',
        message: '관리자 명령 정책을 확인할 수 없습니다.',
        retryable: true,
        phase7Disposition: 'NO_TX'
      })
    }
    await rateLimiter.consume({
      actorId: resolution.user.id,
      clientIp,
      group
    })

    context.set('adminActorId', resolution.user.id)
    context.set('adminClientIp', clientIp)
    context.set('adminSessionToken', resolution.phase7Session.token)
    await next()
  })
}

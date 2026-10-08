import {
  createResultRetrySessionBodySchema,
  createResultRetrySessionHeadersSchema,
  createResultRetrySessionParamsSchema,
  createResultRetrySessionResponseSchema
} from '@nihongo/contracts/study/create-result-retry-session'
import { getConnInfo } from '@hono/node-server/conninfo'
import { getCookie } from 'hono/cookie'
import { Hono, type Context } from 'hono'
import { z, type ZodError } from 'zod'
import { createClientIpAuthority } from '../auth/clientIp.js'
import type { GuestPrincipalService } from '../auth/guestPrincipalService.js'
import type { PrincipalService } from '../auth/principalService.js'
import type { ApiEnvironment } from '../config/env.js'
import { ApplicationError } from '../errors/applicationError.js'
import type { ApplicationRateLimiter } from '../middleware/applicationRateLimiter.js'
import { readBoundedJsonObject } from '../middleware/boundedJson.js'
import type { ApiVariables } from '../middleware/requestContext.js'
import type { ExistingStudyOwner } from '../study/studySessionRepository.js'
import type { StudyResultRetryService } from '../study/studyResultRetryService.js'
import { GUEST_COOKIE_NAME } from './principal.js'

interface StudyResultRetryRouteDependencies {
  environment: ApiEnvironment
  guestPrincipalService: GuestPrincipalService
  principalService: PrincipalService
  rateLimiter: ApplicationRateLimiter
  studyResultRetryService: StudyResultRetryService
}

type StudyResultRetryRouteEnvironment = { Variables: ApiVariables }

const toFieldErrors = (error: ZodError): Record<string, string[]> => {
  const errors: Record<string, string[]> = {}
  for (const issue of error.issues) {
    const path = issue.path.length > 0 ? issue.path.join('.') : 'request'
    errors[path] = [...(errors[path] ?? []), issue.message]
  }
  return errors
}

const appendAuthHeaders = (
  context: Context<StudyResultRetryRouteEnvironment>,
  resolution: Awaited<ReturnType<PrincipalService['resolveAuthenticatedUser']>>,
  environment: ApiEnvironment
): void => {
  for (const cookie of resolution.headers.getSetCookie?.() ?? []) {
    context.header('Set-Cookie', cookie, { append: true })
  }
  if (resolution.clearSessionCookie) {
    const attributes = `Path=/; HttpOnly; SameSite=Lax; Max-Age=0${environment.NODE_ENV === 'production' ? '; Secure' : ''}`
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

export const createStudyResultRetryRoutes = ({
  environment,
  guestPrincipalService,
  principalService,
  rateLimiter,
  studyResultRetryService
}: StudyResultRetryRouteDependencies): Hono<StudyResultRetryRouteEnvironment> => {
  const routes = new Hono<StudyResultRetryRouteEnvironment>()
  const clientIpAuthority = createClientIpAuthority(
    environment.AUTH_TRUSTED_PROXY_CIDRS
  )
  const resolveClientIp = (
    context: Context<StudyResultRetryRouteEnvironment>
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

  routes.post('/:sessionId/retry', async (context) => {
    await rateLimiter.consume({
      clientIp: resolveClientIp(context),
      operation: 'study-result-retry',
      windowMs: 60_000,
      max: 20
    })

    let params
    try {
      params = createResultRetrySessionParamsSchema.parse({
        sessionId: context.req.param('sessionId')
      })
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        throw new ApplicationError({
          code: 'INVALID_ID',
          message: '학습 세션 ID 형식이 올바르지 않습니다.',
          fieldErrors: toFieldErrors(error),
          retryable: false
        })
      }
      throw error
    }

    if (context.req.header('X-Nihongo-Practice-Contract') !== '2') {
      throw new ApplicationError({
        code: 'INVALID_REQUEST',
        message: '오답 재출제에는 practice contract 2가 필요합니다.',
        retryable: false
      })
    }

    let headers
    try {
      headers = createResultRetrySessionHeadersSchema.parse({
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
      createResultRetrySessionBodySchema.parse(
        await readBoundedJsonObject(context.req.raw)
      )
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        throw new ApplicationError({
          code: 'INVALID_REQUEST',
          message: '오답 재출제 요청 본문은 빈 JSON object여야 합니다.',
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

    let owner: ExistingStudyOwner
    if (resolution.user) {
      owner = { kind: 'USER', userId: resolution.user.id }
    } else {
      const inspected = guestPrincipalService.inspectCookie(
        getCookie(context, GUEST_COOKIE_NAME)
      )
      if (inspected.kind === 'ABSENT') {
        throw new ApplicationError({
          code: 'AUTHENTICATION_REQUIRED',
          message: '오답을 다시 풀려면 인증 정보가 필요합니다.',
          retryable: false
        })
      }
      if (inspected.kind === 'INVALID') {
        throw new ApplicationError({
          code: 'GUEST_SESSION_EXPIRED',
          message: '게스트 세션이 만료됐습니다.',
          retryable: false
        })
      }
      owner = {
        kind: 'GUEST',
        guestPrincipalId: inspected.id,
        tokenDigest: inspected.tokenDigest
      }
    }

    const created = await studyResultRetryService.create(
      params.sessionId,
      headers['idempotency-key'],
      owner
    )
    const response = createResultRetrySessionResponseSchema.parse(
      created.response
    )
    context.header('Cache-Control', 'private, no-store')
    context.header('X-Nihongo-Practice-Contract', '2')
    context.header('Location', `/api/v1/study-sessions/${response.session.id}`)
    if (created.replayed) {
      context.header('Idempotency-Replayed', 'true')
    }
    return context.json(response, 201)
  })

  return routes
}

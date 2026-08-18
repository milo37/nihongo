import {
  duplicateAnswerValidationMarker,
  submitStudySessionBodySchema,
  submitStudySessionHeadersSchema,
  submitStudySessionParamsSchema,
  submitStudySessionResponseSchema,
  submitStudySessionV2BodySchema,
  submitStudySessionV2HeadersSchema,
  submitStudySessionV2ResponseSchema
} from '@nihongo/contracts/study/submit-study-session'
import {
  getStudyResultParamsSchema,
  getStudyResultResponseSchema
} from '@nihongo/contracts/study/get-study-result'
import { getConnInfo } from '@hono/node-server/conninfo'
import { getCookie, setCookie } from 'hono/cookie'
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
import type { StudySubmissionService } from '../study/studySubmissionService.js'
import { GUEST_COOKIE_NAME } from './principal.js'

interface StudySubmissionRouteDependencies {
  environment: ApiEnvironment
  guestPrincipalService: GuestPrincipalService
  principalService: PrincipalService
  practiceContractV2Enabled: boolean
  rateLimiter: ApplicationRateLimiter
  studySubmissionService: StudySubmissionService
}

type StudySubmissionRouteEnvironment = { Variables: ApiVariables }

const resolvePracticeContractVersion = (
  value: string | undefined,
  practiceContractV2Enabled: boolean
): 1 | 2 => {
  if (value === undefined) {
    return 1
  }
  if (value === '2') {
    if (!practiceContractV2Enabled) {
      throw new ApplicationError({
        code: 'INVALID_REQUEST',
        message: '이 배포 세대에서는 practice contract 2를 사용할 수 없습니다.',
        retryable: false
      })
    }
    return 2
  }
  throw new ApplicationError({
    code: 'INVALID_REQUEST',
    message: 'X-Nihongo-Practice-Contract header 값이 올바르지 않습니다.',
    fieldErrors: {
      'x-nihongo-practice-contract': ['header 값은 2만 허용합니다.']
    },
    retryable: false
  })
}

const toFieldErrors = (error: ZodError): Record<string, string[]> => {
  const errors: Record<string, string[]> = {}
  for (const issue of error.issues) {
    const path = issue.path.length > 0 ? issue.path.join('.') : 'request'
    errors[path] = [...(errors[path] ?? []), issue.message]
  }
  return errors
}

const appendAuthHeaders = (
  context: Context<StudySubmissionRouteEnvironment>,
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

const bodyValidationError = (error: ZodError): ApplicationError => {
  const isDuplicate = error.issues.some(
    (issue) =>
      issue.code === 'custom' &&
      issue.params?.contractCode === duplicateAnswerValidationMarker
  )
  const hasInvalidDuration = error.issues.some((issue) =>
    issue.path.some(
      (segment) => segment === 'durationSec' || segment === 'elapsedSec'
    )
  )

  return new ApplicationError({
    code: isDuplicate
      ? 'DUPLICATE_ANSWER'
      : hasInvalidDuration
        ? 'INVALID_DURATION'
        : 'VALIDATION_ERROR',
    message: isDuplicate
      ? '같은 세션 문제의 답안을 중복 제출할 수 없습니다.'
      : hasInvalidDuration
        ? '답안 풀이 시간이 허용 범위를 벗어났습니다.'
        : '학습 제출 내용이 올바르지 않습니다.',
    fieldErrors: toFieldErrors(error),
    retryable: false
  })
}

export const createStudySubmissionRoutes = ({
  environment,
  guestPrincipalService,
  principalService,
  practiceContractV2Enabled,
  rateLimiter,
  studySubmissionService
}: StudySubmissionRouteDependencies): Hono<StudySubmissionRouteEnvironment> => {
  const routes = new Hono<StudySubmissionRouteEnvironment>()
  const clientIpAuthority = createClientIpAuthority(
    environment.AUTH_TRUSTED_PROXY_CIDRS
  )
  const resolveClientIp = (
    context: Context<StudySubmissionRouteEnvironment>
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

  routes.post('/:sessionId/submission', async (context) => {
    await rateLimiter.consume({
      clientIp: resolveClientIp(context),
      operation: 'study-submit',
      windowMs: 60_000,
      max: 20
    })

    const practiceContractVersion = resolvePracticeContractVersion(
      context.req.header('X-Nihongo-Practice-Contract'),
      practiceContractV2Enabled
    )

    let params
    try {
      params = submitStudySessionParamsSchema.parse({
        sessionId: context.req.param('sessionId')
      })
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        throw new ApplicationError({
          code: 'VALIDATION_ERROR',
          message: '학습 세션 ID 형식이 올바르지 않습니다.',
          fieldErrors: toFieldErrors(error),
          retryable: false
        })
      }
      throw error
    }

    let headers
    try {
      headers =
        practiceContractVersion === 2
          ? submitStudySessionV2HeadersSchema.parse({
              'idempotency-key': context.req.header('Idempotency-Key'),
              'x-nihongo-practice-contract': context.req.header(
                'X-Nihongo-Practice-Contract'
              )
            })
          : submitStudySessionHeadersSchema.parse({
              'idempotency-key': context.req.header('Idempotency-Key')
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

    let input
    try {
      const rawBody = await readBoundedJsonObject(context.req.raw)
      input =
        practiceContractVersion === 2
          ? submitStudySessionV2BodySchema.parse(rawBody)
          : submitStudySessionBodySchema.parse(rawBody)
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        throw bodyValidationError(error)
      }
      throw error
    }

    const resolution = await principalService.resolveAuthenticatedUser(
      context.req.raw.headers
    )
    appendAuthHeaders(context, resolution, environment)

    let owner: ExistingStudyOwner
    let rawGuestCookie: string | undefined
    if (resolution.user) {
      owner = { kind: 'USER', userId: resolution.user.id }
    } else {
      rawGuestCookie = getCookie(context, GUEST_COOKIE_NAME)
      const inspected = guestPrincipalService.inspectCookie(rawGuestCookie)
      if (inspected.kind === 'ABSENT') {
        throw new ApplicationError({
          code: 'AUTHENTICATION_REQUIRED',
          message: '학습 세션을 제출하려면 인증 정보가 필요합니다.',
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

    const submitted =
      practiceContractVersion === 2
        ? await studySubmissionService.submit(
            params.sessionId,
            headers['idempotency-key'],
            input,
            owner,
            2
          )
        : await studySubmissionService.submit(
            params.sessionId,
            headers['idempotency-key'],
            input,
            owner
          )
    if (submitted.replayed) {
      context.header('Idempotency-Replayed', 'true')
    }
    if (
      owner.kind === 'GUEST' &&
      rawGuestCookie &&
      submitted.guestProofExpiresAt
    ) {
      setCookie(context, GUEST_COOKIE_NAME, rawGuestCookie, {
        httpOnly: true,
        secure: environment.NODE_ENV === 'production',
        sameSite: 'Lax',
        path: '/',
        maxAge: Math.max(
          1,
          Math.floor(
            (submitted.guestProofExpiresAt.getTime() - Date.now()) / 1_000
          )
        )
      })
    }
    context.header('Cache-Control', 'private, no-store')
    context.header(
      'X-Nihongo-Practice-Contract',
      String(practiceContractVersion)
    )
    if (practiceContractVersion === 2) {
      const response = submitStudySessionV2ResponseSchema.parse(
        submitted.response
      )
      return context.json(response, 201)
    }
    const response = submitStudySessionResponseSchema.parse(submitted.response)
    return context.json(response, 201)
  })

  routes.get('/:sessionId/result', async (context) => {
    await rateLimiter.consume({
      clientIp: resolveClientIp(context),
      operation: 'study-result-read',
      windowMs: 60_000,
      max: 120
    })

    let params
    try {
      params = getStudyResultParamsSchema.parse({
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
          message: '학습 결과를 조회하려면 인증 정보가 필요합니다.',
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

    const response = getStudyResultResponseSchema.parse(
      await studySubmissionService.getResult(params.sessionId, owner)
    )
    context.header('Cache-Control', 'private, no-store')
    return context.json(response)
  })

  return routes
}

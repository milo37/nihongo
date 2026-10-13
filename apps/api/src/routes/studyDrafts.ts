import {
  listResumableStudySessionsHeadersSchema,
  listResumableStudySessionsQuerySchema,
  listResumableStudySessionsResponseSchema
} from '@nihongo/contracts/study/list-resumable-study-sessions'
import {
  getStudyDraftAnswersParamsSchema,
  getStudyDraftAnswersResponseSchema
} from '@nihongo/contracts/study/get-study-draft-answers'
import {
  saveStudyDraftAnswersBodySchema,
  saveStudyDraftAnswersHeadersSchema,
  saveStudyDraftAnswersParamsSchema,
  saveStudyDraftAnswersResponseSchema
} from '@nihongo/contracts/study/save-study-draft-answers'
import {
  cancelStudySessionBodySchema,
  cancelStudySessionParamsSchema
} from '@nihongo/contracts/study/cancel-study-session'
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
import type { StudyDraftService } from '../study/studyDraftService.js'
import { GUEST_COOKIE_NAME } from './principal.js'

interface StudyDraftRouteDependencies {
  environment: ApiEnvironment
  guestPrincipalService: GuestPrincipalService
  principalService: PrincipalService
  rateLimiter: ApplicationRateLimiter
  studyDraftService: StudyDraftService
}

type StudyDraftRouteEnvironment = { Variables: ApiVariables }

const toFieldErrors = (error: ZodError): Record<string, string[]> => {
  const errors: Record<string, string[]> = {}
  for (const issue of error.issues) {
    const path = issue.path.length > 0 ? issue.path.join('.') : 'request'
    errors[path] = [...(errors[path] ?? []), issue.message]
  }
  return errors
}

const invalidRequest = (
  message: string,
  fieldErrors?: Record<string, string[]>
): ApplicationError =>
  new ApplicationError({
    code: 'INVALID_REQUEST',
    message,
    ...(fieldErrors ? { fieldErrors } : {}),
    retryable: false
  })

const invalidId = (error: ZodError): ApplicationError =>
  new ApplicationError({
    code: 'INVALID_ID',
    message: '학습 세션 ID 형식이 올바르지 않습니다.',
    fieldErrors: toFieldErrors(error),
    retryable: false
  })

const validationError = (message: string, error: ZodError): ApplicationError =>
  new ApplicationError({
    code: error.issues.some((issue) => issue.path.includes('elapsedSec'))
      ? 'INVALID_DURATION'
      : 'VALIDATION_ERROR',
    message,
    fieldErrors: toFieldErrors(error),
    retryable: false
  })

const appendAuthHeaders = (
  context: Context<StudyDraftRouteEnvironment>,
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

const resolveOwner = async (
  context: Context<StudyDraftRouteEnvironment>,
  environment: ApiEnvironment,
  guestPrincipalService: GuestPrincipalService,
  principalService: PrincipalService
): Promise<ExistingStudyOwner> => {
  const resolution = await principalService.resolveAuthenticatedUser(
    context.req.raw.headers
  )
  appendAuthHeaders(context, resolution, environment)
  if (resolution.user) {
    return { kind: 'USER', userId: resolution.user.id }
  }
  const inspected = guestPrincipalService.inspectCookie(
    getCookie(context, GUEST_COOKIE_NAME)
  )
  if (inspected.kind === 'ABSENT') {
    throw new ApplicationError({
      code: 'AUTHENTICATION_REQUIRED',
      message: '학습 초안을 사용하려면 인증 정보가 필요합니다.',
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
  return {
    kind: 'GUEST',
    guestPrincipalId: inspected.id,
    tokenDigest: inspected.tokenDigest
  }
}

const parseRequiredPracticeHeader = (value: string | undefined): void => {
  try {
    listResumableStudySessionsHeadersSchema.parse({
      'x-nihongo-practice-contract': value
    })
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      throw invalidRequest(
        'X-Nihongo-Practice-Contract: 2 header가 필요합니다.',
        toFieldErrors(error)
      )
    }
    throw error
  }
}

const toRawQuery = (url: string): Record<string, string | string[]> => {
  const searchParams = new URL(url).searchParams
  const rawQuery: Record<string, string | string[]> = {}
  for (const key of new Set(searchParams.keys())) {
    const values = searchParams.getAll(key)
    rawQuery[key] = values.length === 1 ? (values[0] ?? '') : values
  }
  return rawQuery
}

export const createStudyDraftRoutes = ({
  environment,
  guestPrincipalService,
  principalService,
  rateLimiter,
  studyDraftService
}: StudyDraftRouteDependencies): Hono<StudyDraftRouteEnvironment> => {
  const routes = new Hono<StudyDraftRouteEnvironment>()
  const clientIpAuthority = createClientIpAuthority(
    environment.AUTH_TRUSTED_PROXY_CIDRS
  )
  const resolveClientIp = (
    context: Context<StudyDraftRouteEnvironment>
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
      operation: 'study-read',
      windowMs: 60_000,
      max: 120
    })
    parseRequiredPracticeHeader(
      context.req.header('X-Nihongo-Practice-Contract')
    )
    let query
    try {
      query = listResumableStudySessionsQuerySchema.parse(
        toRawQuery(context.req.url)
      )
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        throw validationError(
          '재개 가능한 학습 세션 조회 조건이 올바르지 않습니다.',
          error
        )
      }
      throw error
    }
    const owner = await resolveOwner(
      context,
      environment,
      guestPrincipalService,
      principalService
    )
    const response = listResumableStudySessionsResponseSchema.parse(
      await studyDraftService.listResumable(owner, query)
    )
    context.header('Cache-Control', 'private, no-store')
    context.header('X-Nihongo-Practice-Contract', '2')
    return context.json(response)
  })

  routes.get('/:sessionId/draft-answers', async (context) => {
    await rateLimiter.consume({
      clientIp: resolveClientIp(context),
      operation: 'study-read',
      windowMs: 60_000,
      max: 120
    })
    parseRequiredPracticeHeader(
      context.req.header('X-Nihongo-Practice-Contract')
    )
    let params
    try {
      params = getStudyDraftAnswersParamsSchema.parse({
        sessionId: context.req.param('sessionId')
      })
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        throw invalidId(error)
      }
      throw error
    }
    const owner = await resolveOwner(
      context,
      environment,
      guestPrincipalService,
      principalService
    )
    const response = getStudyDraftAnswersResponseSchema.parse(
      await studyDraftService.get(params.sessionId, owner)
    )
    context.header('Cache-Control', 'private, no-store')
    context.header('X-Nihongo-Practice-Contract', '2')
    return context.json(response)
  })

  routes.put('/:sessionId/draft-answers', async (context) => {
    await rateLimiter.consume({
      clientIp: resolveClientIp(context),
      operation: 'study-submit',
      windowMs: 60_000,
      max: 20
    })
    parseRequiredPracticeHeader(
      context.req.header('X-Nihongo-Practice-Contract')
    )
    let params
    try {
      params = saveStudyDraftAnswersParamsSchema.parse({
        sessionId: context.req.param('sessionId')
      })
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        throw invalidId(error)
      }
      throw error
    }
    let headers
    try {
      headers = saveStudyDraftAnswersHeadersSchema.parse({
        'x-nihongo-practice-contract': '2',
        'idempotency-key': context.req.header('Idempotency-Key')
      })
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        throw new ApplicationError({
          code: 'IDEMPOTENCY_KEY_REQUIRED',
          message: '유효한 Idempotency-Key UUID header가 필요합니다.',
          fieldErrors: toFieldErrors(error),
          retryable: false
        })
      }
      throw error
    }
    let body
    try {
      body = saveStudyDraftAnswersBodySchema.parse(
        await readBoundedJsonObject(context.req.raw)
      )
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        throw validationError('학습 초안 저장 요청이 올바르지 않습니다.', error)
      }
      throw error
    }
    const owner = await resolveOwner(
      context,
      environment,
      guestPrincipalService,
      principalService
    )
    const saved = await studyDraftService.save(
      params.sessionId,
      headers['idempotency-key'],
      body,
      owner
    )
    const response = saveStudyDraftAnswersResponseSchema.parse(saved.response)
    if (saved.replayed) {
      context.header('Idempotency-Replayed', 'true')
    }
    context.header('Cache-Control', 'private, no-store')
    context.header('X-Nihongo-Practice-Contract', '2')
    return context.json(response)
  })

  routes.post('/:sessionId/cancellation', async (context) => {
    await rateLimiter.consume({
      clientIp: resolveClientIp(context),
      operation: 'study-submit',
      windowMs: 60_000,
      max: 20
    })
    parseRequiredPracticeHeader(
      context.req.header('X-Nihongo-Practice-Contract')
    )
    let params
    try {
      params = cancelStudySessionParamsSchema.parse({
        sessionId: context.req.param('sessionId')
      })
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        throw invalidId(error)
      }
      throw error
    }
    try {
      cancelStudySessionBodySchema.parse(
        await readBoundedJsonObject(context.req.raw)
      )
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        throw invalidRequest(
          '학습 세션 취소 요청이 올바르지 않습니다.',
          toFieldErrors(error)
        )
      }
      throw error
    }
    const owner = await resolveOwner(
      context,
      environment,
      guestPrincipalService,
      principalService
    )
    await studyDraftService.cancel(params.sessionId, owner)
    context.header('Cache-Control', 'private, no-store')
    context.header('X-Nihongo-Practice-Contract', '2')
    return context.body(null, 204)
  })

  return routes
}

import {
  createStudySessionBodySchema,
  createStudySessionResponseSchema,
  createStudySessionV2BodySchema,
  createStudySessionV2ResponseSchema
} from '@nihongo/contracts/study/create-study-session'
import {
  getStudySessionParamsSchema,
  getStudySessionResponseSchema,
  getStudySessionV2ResponseSchema
} from '@nihongo/contracts/study/get-study-session'
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
import type { StudySessionService } from '../study/studySessionService.js'
import type {
  CreateStudyOwner,
  ExistingStudyOwner
} from '../study/studySessionRepository.js'
import { GUEST_COOKIE_NAME } from './principal.js'

interface StudySessionRouteDependencies {
  environment: ApiEnvironment
  guestPrincipalService: GuestPrincipalService
  principalService: PrincipalService
  practiceContractV2Enabled: boolean
  rateLimiter: ApplicationRateLimiter
  studySessionService: StudySessionService
}

type StudySessionRouteEnvironment = { Variables: ApiVariables }

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
  context: Context<StudySessionRouteEnvironment>,
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

export const createStudySessionRoutes = ({
  environment,
  guestPrincipalService,
  principalService,
  practiceContractV2Enabled,
  rateLimiter,
  studySessionService
}: StudySessionRouteDependencies): Hono<StudySessionRouteEnvironment> => {
  const routes = new Hono<StudySessionRouteEnvironment>()
  const clientIpAuthority = createClientIpAuthority(
    environment.AUTH_TRUSTED_PROXY_CIDRS
  )
  const resolveClientIp = (
    context: Context<StudySessionRouteEnvironment>
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

  routes.post('/', async (context) => {
    await rateLimiter.consume({
      clientIp: resolveClientIp(context),
      operation: 'study-create',
      windowMs: 60_000,
      max: 20
    })

    const requestedContractVersion = resolvePracticeContractVersion(
      context.req.header('X-Nihongo-Practice-Contract'),
      practiceContractV2Enabled
    )

    let input
    try {
      const body = await readBoundedJsonObject(context.req.raw)
      input =
        requestedContractVersion === 2
          ? createStudySessionV2BodySchema.parse(body)
          : createStudySessionBodySchema.parse(body)
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        throw new ApplicationError({
          code: 'VALIDATION_ERROR',
          message: '학습 세션 생성 조건이 올바르지 않습니다.',
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

    let owner: CreateStudyOwner
    if (resolution.user) {
      owner = { kind: 'USER', userId: resolution.user.id }
    } else {
      const inspected = guestPrincipalService.inspectCookie(
        getCookie(context, GUEST_COOKIE_NAME)
      )
      if (inspected.kind === 'VERIFIED') {
        owner = {
          kind: 'GUEST_OR_NEW',
          guestPrincipalId: inspected.id,
          tokenDigest: inspected.tokenDigest,
          replacement: guestPrincipalService.prepareCredential()
        }
      } else {
        const credential = guestPrincipalService.prepareCredential()
        owner = { kind: 'NEW_GUEST', credential }
      }
    }

    const created =
      requestedContractVersion === 2
        ? await studySessionService.create(input, owner, 2)
        : await studySessionService.create(input, owner)
    if (created.issuedGuestCredential) {
      setCookie(
        context,
        GUEST_COOKIE_NAME,
        created.issuedGuestCredential.cookieValue,
        {
          httpOnly: true,
          secure: environment.NODE_ENV === 'production',
          sameSite: 'Lax',
          path: '/',
          maxAge: Math.max(
            1,
            Math.floor(
              (created.issuedGuestCredential.expiresAt.getTime() - Date.now()) /
                1_000
            )
          )
        }
      )
    }
    context.header('Cache-Control', 'private, no-store')
    context.header(
      'X-Nihongo-Practice-Contract',
      String(created.practiceContractVersion ?? requestedContractVersion)
    )
    if (requestedContractVersion === 2) {
      const response = createStudySessionV2ResponseSchema.parse(created.payload)
      return context.json(response, 201)
    }
    const response = createStudySessionResponseSchema.parse(created.payload)
    return context.json(response, 201)
  })

  routes.get('/:sessionId', async (context) => {
    await rateLimiter.consume({
      clientIp: resolveClientIp(context),
      operation: 'study-read',
      windowMs: 60_000,
      max: 120
    })

    const requestedContractVersion = resolvePracticeContractVersion(
      context.req.header('X-Nihongo-Practice-Contract'),
      practiceContractV2Enabled
    )

    let params
    try {
      params = getStudySessionParamsSchema.parse({
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
          message: '학습 세션을 조회하려면 인증 정보가 필요합니다.',
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

    const found =
      requestedContractVersion === 2
        ? await studySessionService.get(params.sessionId, owner, 2)
        : await studySessionService.get(params.sessionId, owner)
    context.header('Cache-Control', 'private, no-store')
    context.header(
      'X-Nihongo-Practice-Contract',
      String(
        'practiceContractVersion' in found.session
          ? found.session.practiceContractVersion
          : 1
      )
    )
    if (requestedContractVersion === 2) {
      const response = getStudySessionV2ResponseSchema.parse(found)
      return context.json(response)
    }
    const response = getStudySessionResponseSchema.parse(found)
    return context.json(response)
  })

  return routes
}

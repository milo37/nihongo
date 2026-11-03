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
import { getCookie, setCookie } from 'hono/cookie'
import { Hono } from 'hono'
import { z } from 'zod'
import type { GuestPrincipalService } from '../auth/guestPrincipalService.js'
import type { PrincipalService } from '../auth/principalService.js'
import type { ApiEnvironment } from '../config/env.js'
import { ApplicationError } from '../errors/applicationError.js'
import type { ApplicationRateLimiter } from '../middleware/applicationRateLimiter.js'
import { createClientIpMiddleware } from '../middleware/clientIp.js'
import { readBoundedJsonObject } from '../middleware/boundedJson.js'
import type { ApiVariables } from '../middleware/requestContext.js'
import type { StudySessionService } from '../study/studySessionService.js'
import type { CreateStudyOwner } from '../study/studySessionRepository.js'
import { GUEST_COOKIE_NAME } from './principal.js'
import { appendAuthHeaders, toFieldErrors } from './routeSupport.js'
import {
  resolveExistingStudyOwner,
  resolvePracticeContractVersion
} from './studyRouteSupport.js'

interface StudySessionRouteDependencies {
  environment: ApiEnvironment
  guestPrincipalService: GuestPrincipalService
  principalService: PrincipalService
  practiceContractV2Enabled: boolean
  rateLimiter: ApplicationRateLimiter
  studySessionService: StudySessionService
}

type StudySessionRouteEnvironment = { Variables: ApiVariables }

export const createStudySessionRoutes = ({
  environment,
  guestPrincipalService,
  principalService,
  practiceContractV2Enabled,
  rateLimiter,
  studySessionService
}: StudySessionRouteDependencies): Hono<StudySessionRouteEnvironment> => {
  const routes = new Hono<StudySessionRouteEnvironment>()
  routes.use(
    '*',
    createClientIpMiddleware(environment.AUTH_TRUSTED_PROXY_CIDRS)
  )

  routes.post('/', async (context) => {
    await rateLimiter.consume({
      clientIp: context.get('clientIp'),
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
      clientIp: context.get('clientIp'),
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

    const { owner } = await resolveExistingStudyOwner({
      authenticationRequiredMessage:
        '학습 세션을 조회하려면 인증 정보가 필요합니다.',
      context,
      environment,
      guestPrincipalService,
      principalService
    })

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

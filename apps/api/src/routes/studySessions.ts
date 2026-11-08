import {
  createStudySessionV2BodySchema,
  createStudySessionV2ResponseSchema
} from '@nihongo/contracts/study/create-study-session'
import {
  getStudySessionParamsSchema,
  getStudySessionV2ResponseSchema
} from '@nihongo/contracts/study/get-study-session'
import { getCookie, setCookie } from 'hono/cookie'
import { Hono } from 'hono'
import { z } from 'zod'
import {
  assertAccountNotRestricted,
  type AccountRestrictionReader
} from '../account/accountRestriction.js'
import type { GuestPrincipalService } from '../auth/guestPrincipalService.js'
import type { PrincipalService } from '../auth/principalService.js'
import type { ApiEnvironment } from '../config/env.js'
import { GUEST_DAILY_SESSION_LIMIT_PER_IP } from '@nihongo/contracts/study/guest-limits'
import { ApplicationError } from '../errors/applicationError.js'
import type { ApplicationRateLimiter } from '../middleware/applicationRateLimiter.js'
import { createClientIpMiddleware } from '../middleware/clientIp.js'
import { readBoundedJsonObject } from '../middleware/boundedJson.js'
import type { ApiVariables } from '../middleware/requestContext.js'
import type { StudySessionService } from '../study/studySessionService.js'
import type { CreateStudyOwner } from '../study/studySessionRepository.js'
import { guestDayKey } from '../study/guestDay.js'
import { GUEST_COOKIE_NAME } from './principal.js'
import { appendAuthHeaders, toFieldErrors } from './routeSupport.js'
import {
  resolveExistingStudyOwner,
  assertPracticeContractHeader
} from './studyRouteSupport.js'

interface StudySessionRouteDependencies {
  accountRestrictionReader: AccountRestrictionReader
  environment: ApiEnvironment
  guestPrincipalService: GuestPrincipalService
  principalService: PrincipalService
  rateLimiter: ApplicationRateLimiter
  studySessionService: StudySessionService
}

type StudySessionRouteEnvironment = { Variables: ApiVariables }

/**
 * Counts guest session starts per client IP and Korea-time day, so a new
 * guest cookie does not reset the guest limit (#737). The day is part of the
 * key, so the count starts again at midnight Korea time.
 */
const consumeGuestDailyIpLimit = async (
  rateLimiter: ApplicationRateLimiter,
  clientIp: string,
  now = new Date()
): Promise<void> => {
  try {
    await rateLimiter.consume({
      clientIp: `${clientIp}|${guestDayKey(now)}`,
      operation: 'guest-study-create-day',
      windowMs: 24 * 60 * 60 * 1_000,
      max: GUEST_DAILY_SESSION_LIMIT_PER_IP
    })
  } catch (error: unknown) {
    if (error instanceof ApplicationError && error.code === 'RATE_LIMITED') {
      throw new ApplicationError({
        code: 'GUEST_LIMIT_REACHED',
        message:
          '오늘 이 네트워크에서 비회원으로 풀 수 있는 횟수를 모두 썼습니다. 더 풀려면 로그인해 주세요.',
        retryable: false
      })
    }
    throw error
  }
}

export const createStudySessionRoutes = ({
  accountRestrictionReader,
  environment,
  guestPrincipalService,
  principalService,
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

    assertPracticeContractHeader(
      context.req.header('X-Nihongo-Practice-Contract')
    )

    let input
    try {
      const body = await readBoundedJsonObject(context.req.raw)
      input = createStudySessionV2BodySchema.parse(body)
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
      await assertAccountNotRestricted(
        accountRestrictionReader,
        resolution.user.id
      )
      owner = { kind: 'USER', userId: resolution.user.id }
    } else {
      await consumeGuestDailyIpLimit(rateLimiter, context.get('clientIp'))
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

    const created = await studySessionService.create(input, owner)
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
    context.header('X-Nihongo-Practice-Contract', '2')
    const response = createStudySessionV2ResponseSchema.parse(created.payload)
    return context.json(response, 201)
  })

  routes.get('/:sessionId', async (context) => {
    await rateLimiter.consume({
      clientIp: context.get('clientIp'),
      operation: 'study-read',
      windowMs: 60_000,
      max: 120
    })

    assertPracticeContractHeader(
      context.req.header('X-Nihongo-Practice-Contract')
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

    const found = await studySessionService.get(params.sessionId, owner)
    context.header('Cache-Control', 'private, no-store')
    context.header('X-Nihongo-Practice-Contract', '2')
    const response = getStudySessionV2ResponseSchema.parse(found)
    return context.json(response)
  })

  return routes
}

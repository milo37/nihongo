import {
  createResultRetrySessionBodySchema,
  createResultRetrySessionHeadersSchema,
  createResultRetrySessionParamsSchema,
  createResultRetrySessionResponseSchema
} from '@nihongo/contracts/study/create-result-retry-session'
import { GUEST_DAILY_SESSION_LIMIT_PER_IP } from '@nihongo/contracts/study/guest-limits'
import { Hono } from 'hono'
import { z } from 'zod'
import {
  assertAccountNotRestricted,
  type AccountRestrictionReader
} from '../account/accountRestriction.js'
import type { GuestPrincipalService } from '../auth/guestPrincipalService.js'
import type { PrincipalService } from '../auth/principalService.js'
import type { ApiEnvironment } from '../config/env.js'
import { ApplicationError } from '../errors/applicationError.js'
import type { ApplicationRateLimiter } from '../middleware/applicationRateLimiter.js'
import { createClientIpMiddleware } from '../middleware/clientIp.js'
import { readBoundedJsonObject } from '../middleware/boundedJson.js'
import type { ApiVariables } from '../middleware/requestContext.js'
import type { GuestIpDailyCounter } from '../study/guestIpDailyCounter.js'
import type { StudyResultRetryService } from '../study/studyResultRetryService.js'
import { toFieldErrors } from './routeSupport.js'
import {
  guestIpLimitReached,
  resolveExistingStudyOwner
} from './studyRouteSupport.js'

interface StudyResultRetryRouteDependencies {
  accountRestrictionReader: AccountRestrictionReader
  environment: ApiEnvironment
  guestPrincipalService: GuestPrincipalService
  guestIpDailyCounter?: GuestIpDailyCounter
  now?: () => Date
  principalService: PrincipalService
  rateLimiter: ApplicationRateLimiter
  studyResultRetryService: StudyResultRetryService
}

type StudyResultRetryRouteEnvironment = { Variables: ApiVariables }

export const createStudyResultRetryRoutes = ({
  accountRestrictionReader,
  environment,
  guestPrincipalService,
  guestIpDailyCounter,
  now = () => new Date(),
  principalService,
  rateLimiter,
  studyResultRetryService
}: StudyResultRetryRouteDependencies): Hono<StudyResultRetryRouteEnvironment> => {
  const routes = new Hono<StudyResultRetryRouteEnvironment>()
  routes.use(
    '*',
    createClientIpMiddleware(environment.AUTH_TRUSTED_PROXY_CIDRS)
  )

  routes.post('/:sessionId/retry', async (context) => {
    await rateLimiter.consume({
      clientIp: context.get('clientIp'),
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

    const { owner } = await resolveExistingStudyOwner({
      authenticationRequiredMessage:
        '오답을 다시 풀려면 인증 정보가 필요합니다.',
      context,
      environment,
      guestPrincipalService,
      principalService
    })
    // A guest retry is one of the guest's daily sets (JLP-823): the
    // repository counts it, and the hidden per-IP limit applies as well.
    if (owner.kind === 'USER') {
      await assertAccountNotRestricted(accountRestrictionReader, owner.userId)
    } else {
      const checkedAt = now()
      if (
        guestIpDailyCounter &&
        (await guestIpDailyCounter.used(context.get('clientIp'), checkedAt)) >=
          GUEST_DAILY_SESSION_LIMIT_PER_IP
      ) {
        throw guestIpLimitReached(checkedAt)
      }
    }

    const created = await studyResultRetryService.create(
      params.sessionId,
      headers['idempotency-key'],
      owner
    )
    if (owner.kind !== 'USER' && !created.replayed) {
      await guestIpDailyCounter?.record(context.get('clientIp'), now())
    }
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

import {
  apiFailureSchema,
  errorStatusByCode,
  type ApiFailure
} from '@nihongo/contracts/common/error'
import { Hono } from 'hono'
import { getConnInfo } from '@hono/node-server/conninfo'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'
import { ApplicationError } from '../errors/applicationError.js'
import {
  requestContext,
  type ApiVariables
} from '../middleware/requestContext.js'
import { createRequestLogger } from '../middleware/requestLogger.js'
import type { StructuredLogger } from '../observability/logger.js'
import { createHealthRoutes } from '../routes/health.js'
import { createQuestionRoutes } from '../routes/questions.js'
import { AuthGatewayError, type AuthGateway } from '../auth/authGateway.js'
import type { ApiEnvironment } from '../config/env.js'
import type { GuestPrincipalService } from '../auth/guestPrincipalService.js'
import type { PrincipalService } from '../auth/principalService.js'
import { createWriteSecurity } from '../middleware/writeSecurity.js'
import { createPrincipalRoutes } from '../routes/principal.js'
import type { QuestionReader } from '../question/questionService.js'
import type { ApplicationRateLimiter } from '../middleware/applicationRateLimiter.js'
import type { StudySessionService } from '../study/studySessionService.js'
import { createStudySessionRoutes } from '../routes/studySessions.js'
import type { StudySubmissionService } from '../study/studySubmissionService.js'
import { createStudySubmissionRoutes } from '../routes/studySubmissions.js'
import type { WrongNoteService } from '../wrong-note/wrongNoteService.js'
import type { DashboardService } from '../dashboard/dashboardService.js'
import { createWrongNoteRoutes } from '../routes/wrongNotes.js'
import { createDashboardRoutes } from '../routes/dashboard.js'
import type { StudyDraftService } from '../study/studyDraftService.js'
import { createStudyDraftRoutes } from '../routes/studyDrafts.js'
import type { BookmarkService } from '../bookmark/bookmarkService.js'
import { createBookmarkRoutes } from '../routes/bookmarks.js'
import type { StudyResultRetryService } from '../study/studyResultRetryService.js'
import { createStudyResultRetryRoutes } from '../routes/studyResultRetries.js'

interface CreateApiAppDependencies {
  assertPracticeRuntimeAuthority?: () => void | Promise<void>
  checkReadiness: () => Promise<void>
  logger: StructuredLogger
  questionReader: QuestionReader
  auth?: {
    environment: ApiEnvironment
    gateway: AuthGateway
    guestPrincipalService: GuestPrincipalService
    principalService: PrincipalService
  }
  study?: {
    draftService?: StudyDraftService
    practiceContractV2Enabled: boolean
    rateLimiter: ApplicationRateLimiter
    retryService?: StudyResultRetryService
    service: StudySessionService
    submissionService?: StudySubmissionService
  }
  learning?: {
    bookmarkService?: BookmarkService
    dashboardService: DashboardService
    rateLimiter: ApplicationRateLimiter
    wrongNoteService: WrongNoteService
  }
  enableTestRoutes?: boolean
}

const retryAfterSecondsByCode = {
  RATE_LIMITED: 30,
  SERVICE_UNAVAILABLE: 5
} as const

const studyResultLocationPattern =
  /^\/api\/v1\/study-sessions\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/result$/u

const toFailure = (error: unknown, requestId: string): ApiFailure => {
  if (error instanceof ApplicationError) {
    return apiFailureSchema.parse({
      code: error.code,
      message: error.message,
      ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}),
      requestId,
      retryable: error.retryable
    })
  }

  return apiFailureSchema.parse({
    code: 'INTERNAL_SERVER_ERROR',
    message: '요청을 처리하지 못했습니다.',
    requestId,
    retryable: true
  })
}

export const createApiApp = ({
  auth,
  assertPracticeRuntimeAuthority,
  checkReadiness,
  logger,
  learning,
  questionReader,
  study,
  enableTestRoutes = false
}: CreateApiAppDependencies): Hono<{ Variables: ApiVariables }> => {
  const app = new Hono<{ Variables: ApiVariables }>()

  app.use('*', requestContext)
  app.use('*', secureHeaders())
  app.use('*', createRequestLogger(logger))
  app.route('/health', createHealthRoutes({ checkReadiness }))

  if (auth) {
    app.all('/api/auth/*', async (context) => {
      try {
        let peerAddress: string | undefined
        try {
          peerAddress = getConnInfo(context).remote.address
        } catch {
          peerAddress = undefined
        }
        return await auth.gateway.handle(context.req.raw, peerAddress)
      } catch (error: unknown) {
        if (error instanceof AuthGatewayError) {
          context.header('Cache-Control', 'private, no-store')
          const origin = context.req.header('Origin')
          if (
            auth.environment.NODE_ENV !== 'production' &&
            origin &&
            auth.environment.TRUSTED_ORIGINS.includes(origin)
          ) {
            context.header('Access-Control-Allow-Credentials', 'true')
            context.header('Access-Control-Allow-Origin', origin)
            context.header(
              'Access-Control-Expose-Headers',
              'Retry-After, X-Request-Id'
            )
            context.header('Vary', 'Origin')
          }
          return context.json(
            {
              code: error.code,
              message:
                error.status === 404
                  ? '요청한 인증 경로를 찾을 수 없습니다.'
                  : '인증 요청이 보안 정책을 충족하지 않습니다.'
            },
            error.status
          )
        }

        throw error
      }
    })
    if (auth.environment.NODE_ENV !== 'production') {
      app.use(
        '/api/v1/*',
        cors({
          origin: (origin) =>
            auth.environment.TRUSTED_ORIGINS.includes(origin)
              ? origin
              : undefined,
          allowHeaders: [
            'Content-Type',
            'Idempotency-Key',
            'X-Nihongo-Practice-Contract'
          ],
          allowMethods: ['DELETE', 'GET', 'OPTIONS', 'POST', 'PUT'],
          credentials: true,
          exposeHeaders: [
            'Idempotency-Replayed',
            'Location',
            'Retry-After',
            'X-Request-Id',
            'X-Nihongo-Practice-Contract'
          ],
          maxAge: 600
        })
      )
    }
    if (assertPracticeRuntimeAuthority) {
      app.use('/api/v1/*', async (_context, next) => {
        try {
          await assertPracticeRuntimeAuthority()
        } catch {
          throw new ApplicationError({
            code: 'SERVICE_UNAVAILABLE',
            message: '학습 API 배포 세대 권한을 확인할 수 없습니다.',
            retryable: true
          })
        }
        await next()
      })
    }
    app.use('/api/v1/*', createWriteSecurity(auth.environment))
    app.route(
      '/api/v1',
      createPrincipalRoutes({
        environment: auth.environment,
        guestPrincipalService: auth.guestPrincipalService,
        principalService: auth.principalService
      })
    )
    if (study) {
      app.route(
        '/api/v1/study-sessions',
        createStudySessionRoutes({
          environment: auth.environment,
          guestPrincipalService: auth.guestPrincipalService,
          principalService: auth.principalService,
          practiceContractV2Enabled: study.practiceContractV2Enabled,
          rateLimiter: study.rateLimiter,
          studySessionService: study.service
        })
      )
      if (study.submissionService) {
        app.route(
          '/api/v1/study-sessions',
          createStudySubmissionRoutes({
            environment: auth.environment,
            guestPrincipalService: auth.guestPrincipalService,
            principalService: auth.principalService,
            practiceContractV2Enabled: study.practiceContractV2Enabled,
            rateLimiter: study.rateLimiter,
            studySubmissionService: study.submissionService
          })
        )
      }
      if (study.practiceContractV2Enabled && study.retryService) {
        app.route(
          '/api/v1/study-sessions',
          createStudyResultRetryRoutes({
            environment: auth.environment,
            guestPrincipalService: auth.guestPrincipalService,
            principalService: auth.principalService,
            rateLimiter: study.rateLimiter,
            studyResultRetryService: study.retryService
          })
        )
      }
      if (study.practiceContractV2Enabled && study.draftService) {
        app.route(
          '/api/v1/study-sessions',
          createStudyDraftRoutes({
            environment: auth.environment,
            guestPrincipalService: auth.guestPrincipalService,
            principalService: auth.principalService,
            rateLimiter: study.rateLimiter,
            studyDraftService: study.draftService
          })
        )
      }
    }
    if (learning) {
      if (study?.practiceContractV2Enabled && learning.bookmarkService) {
        app.route(
          '/api/v1/bookmarks',
          createBookmarkRoutes({
            bookmarkService: learning.bookmarkService,
            environment: auth.environment,
            principalService: auth.principalService,
            rateLimiter: learning.rateLimiter
          })
        )
      }
      app.route(
        '/api/v1/wrong-notes',
        createWrongNoteRoutes({
          environment: auth.environment,
          principalService: auth.principalService,
          rateLimiter: learning.rateLimiter,
          wrongNoteService: learning.wrongNoteService
        })
      )
      app.route(
        '/api/v1/dashboard',
        createDashboardRoutes({
          dashboardService: learning.dashboardService,
          environment: auth.environment,
          principalService: auth.principalService,
          rateLimiter: learning.rateLimiter
        })
      )
    }
  }

  app.route('/api/v1/questions', createQuestionRoutes({ questionReader }))

  if (enableTestRoutes) {
    app.get('/__test/error', () => {
      throw new Error('sensitive internal failure')
    })
  }

  app.notFound((context) => {
    context.header('Cache-Control', 'private, no-store')
    const failure = apiFailureSchema.parse({
      code: 'RESOURCE_NOT_FOUND',
      message: '요청한 경로를 찾을 수 없습니다.',
      requestId: context.get('requestId'),
      retryable: false
    })

    return context.json(failure, 404)
  })

  app.onError((error, context) => {
    const requestId = context.get('requestId')
    const failure = toFailure(error, requestId)
    const status = errorStatusByCode[failure.code]
    const pathname = new URL(context.req.url).pathname

    logger.error('http.request.failed', {
      requestId,
      method: context.req.method,
      path: pathname,
      status,
      code: failure.code,
      errorName: error.name
    })
    context.header('Cache-Control', 'private, no-store')
    context.header('X-Request-Id', requestId)

    const origin = context.req.header('Origin')
    if (
      auth &&
      pathname.startsWith('/api/auth/') &&
      auth.environment.NODE_ENV !== 'production' &&
      origin &&
      auth.environment.TRUSTED_ORIGINS.includes(origin)
    ) {
      context.header('Access-Control-Allow-Credentials', 'true')
      context.header('Access-Control-Allow-Origin', origin)
      context.header(
        'Access-Control-Expose-Headers',
        'Retry-After, X-Request-Id'
      )
      context.header('Vary', 'Origin')
    }

    if (
      failure.code === 'RATE_LIMITED' ||
      failure.code === 'SERVICE_UNAVAILABLE'
    ) {
      context.header(
        'Retry-After',
        String(
          error instanceof ApplicationError && error.retryAfterSeconds
            ? error.retryAfterSeconds
            : retryAfterSecondsByCode[failure.code]
        )
      )
    }

    if (
      failure.code === 'SESSION_ALREADY_SUBMITTED' &&
      error instanceof ApplicationError &&
      error.location &&
      studyResultLocationPattern.test(error.location)
    ) {
      context.header('Location', error.location)
    }

    return context.json(failure, status)
  })

  return app
}

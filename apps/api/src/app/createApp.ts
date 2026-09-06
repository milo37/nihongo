import {
  apiFailureSchema,
  errorStatusByCode,
  type ApiFailure
} from '@nihongo/contracts/common/error'
import {
  buildPhase7OperationFailureResponse,
  type Phase7Operation,
  type Phase7OperationFailureResponse
} from '@nihongo/contracts/admin/phase7'
import { Hono } from 'hono'
import { getConnInfo } from '@hono/node-server/conninfo'
import { cors } from 'hono/cors'
import { routePath } from 'hono/route'
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
import type { WrongNoteReviewCenterService } from '../wrong-note/wrongNoteReviewCenterService.js'
import type { WrongNoteReviewQueueService } from '../wrong-note/wrongNoteReviewQueueService.js'
import type { DashboardService } from '../dashboard/dashboardService.js'
import { createWrongNoteRoutes } from '../routes/wrongNotes.js'
import { createDashboardRoutes } from '../routes/dashboard.js'
import type { StudyDraftService } from '../study/studyDraftService.js'
import { createStudyDraftRoutes } from '../routes/studyDrafts.js'
import type { BookmarkService } from '../bookmark/bookmarkService.js'
import { createBookmarkRoutes } from '../routes/bookmarks.js'
import type { StudyResultRetryService } from '../study/studyResultRetryService.js'
import { createStudyResultRetryRoutes } from '../routes/studyResultRetries.js'
import { createReviewQueueRoutes } from '../routes/reviewQueue.js'
import type { WrongNoteTargetedReviewService } from '../wrong-note/wrongNoteTargetedReviewService.js'
import { createTargetedReviewSessionRoutes } from '../routes/targetedReviewSessions.js'
import type { AdminQuestionReader } from '../admin/adminQuestionService.js'
import type { AdminReadRateLimiter } from '../admin/adminReadRateLimiter.js'
import { createAdminReadGuard } from '../admin/adminReadGuard.js'
import { createAdminQuestionRoutes } from '../routes/adminQuestions.js'
import {
  getCanonicalPhase7Slice2ReadOperation,
  isCanonicalPhase7Slice2ReadRequest,
  isPhase7ExcludedRequest
} from './phase7PrefixExclusion.js'

const TECHNICAL_CORS_METHODS = [
  'DELETE',
  'GET',
  'OPTIONS',
  'PATCH',
  'POST',
  'PUT'
]
const TECHNICAL_CORS_BASE_HEADERS = ['Content-Type']
const TECHNICAL_CORS_PRACTICE_HEADERS = [
  ...TECHNICAL_CORS_BASE_HEADERS,
  'Idempotency-Key',
  'X-Nihongo-Practice-Contract'
]
const LEGACY_CORS_EXPOSE_HEADERS = [
  'Idempotency-Replayed',
  'Location',
  'Retry-After',
  'X-Request-Id',
  'X-Nihongo-Practice-Contract'
]
const TECHNICAL_CORS_EXPOSE_HEADERS = [
  'Content-Disposition',
  ...LEGACY_CORS_EXPOSE_HEADERS
]
const TARGETED_REVIEW_PATH_PATTERN =
  /^\/api\/v1\/wrong-notes\/[^/]+\/review-session\/?$/u

const isPracticeCorsPath = (pathname: string): boolean =>
  pathname === '/api/v1/study-sessions' ||
  pathname.startsWith('/api/v1/study-sessions/') ||
  TARGETED_REVIEW_PATH_PATTERN.test(pathname)

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
  admin?: {
    assertCapability: () => void | Promise<void>
    rateLimiter: AdminReadRateLimiter
    reader: AdminQuestionReader
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
    reviewCenterEnabled: boolean
    reviewCenterService: WrongNoteReviewCenterService
    reviewQueueService?: WrongNoteReviewQueueService
    targetedReviewService?: WrongNoteTargetedReviewService
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

const getAdapterRequestTarget = (
  bindings: unknown,
  fallbackUrl: string
): string => {
  if (!bindings || typeof bindings !== 'object') {
    return fallbackUrl
  }

  const incoming = (bindings as { incoming?: unknown }).incoming
  if (!incoming || typeof incoming !== 'object') {
    return fallbackUrl
  }

  const rawUrl = (incoming as { url?: unknown }).url
  return typeof rawUrl === 'string' && rawUrl.length > 0 ? rawUrl : fallbackUrl
}

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

const buildCanonicalPhase7ReadFailure = ({
  error,
  failure,
  operation
}: {
  error: unknown
  failure: ApiFailure
  operation: Phase7Operation
}): {
  response: Phase7OperationFailureResponse
  contractViolation: boolean
} => {
  const retryAfterSeconds =
    failure.code === 'RATE_LIMITED' || failure.code === 'SERVICE_UNAVAILABLE'
      ? error instanceof ApplicationError && error.retryAfterSeconds
        ? error.retryAfterSeconds
        : retryAfterSecondsByCode[failure.code]
      : undefined
  try {
    return {
      response: buildPhase7OperationFailureResponse({
        operation,
        failure: {
          code: failure.code,
          message: failure.message,
          ...(failure.fieldErrors === undefined
            ? {}
            : { fieldErrors: failure.fieldErrors }),
          requestId: failure.requestId
        },
        disposition: 'NO_TX',
        ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds })
      }),
      contractViolation: false
    }
  } catch {
    return {
      response: buildPhase7OperationFailureResponse({
        operation,
        failure: {
          code: 'INTERNAL_SERVER_ERROR',
          message: '요청을 처리하지 못했습니다.',
          requestId: failure.requestId
        },
        disposition: 'NO_TX'
      }),
      contractViolation: true
    }
  }
}

export const createApiApp = ({
  admin,
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

  app.use('*', async (context, next) => {
    const requestTarget = getAdapterRequestTarget(
      context.env,
      context.req.raw.url
    )
    context.set('rawRequestTarget', requestTarget)
    const isPhase7Request =
      isPhase7ExcludedRequest(requestTarget) ||
      isPhase7ExcludedRequest(context.req.path)
    if (!isPhase7Request) {
      await next()
      return
    }

    if (
      admin &&
      auth?.environment.ADMIN_CMS_MODE === 'technical' &&
      isCanonicalPhase7Slice2ReadRequest({
        method: context.req.method,
        requestTarget
      })
    ) {
      await next()
      return
    }

    context.header('Cache-Control', 'private, no-store')
    const failure = apiFailureSchema.parse({
      code: 'RESOURCE_NOT_FOUND',
      message: '요청한 경로를 찾을 수 없습니다.',
      requestId: context.get('requestId'),
      retryable: false
    })

    return context.json(failure, 404)
  })

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
        return await auth.gateway.handle(
          context.req.raw,
          peerAddress,
          getAdapterRequestTarget(context.env, context.req.raw.url)
        )
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
      const corsOptions = {
        origin: (origin: string) =>
          auth.environment.TRUSTED_ORIGINS.includes(origin)
            ? origin
            : undefined,
        credentials: true,
        maxAge: 600
      }
      const legacyCors = cors({
        ...corsOptions,
        allowHeaders: TECHNICAL_CORS_PRACTICE_HEADERS,
        allowMethods: ['DELETE', 'GET', 'OPTIONS', 'POST', 'PUT'],
        exposeHeaders: LEGACY_CORS_EXPOSE_HEADERS
      })
      const technicalBaseCors = cors({
        ...corsOptions,
        allowHeaders: TECHNICAL_CORS_BASE_HEADERS,
        allowMethods: TECHNICAL_CORS_METHODS,
        exposeHeaders: TECHNICAL_CORS_EXPOSE_HEADERS
      })
      const technicalPracticeCors = cors({
        ...corsOptions,
        allowHeaders: TECHNICAL_CORS_PRACTICE_HEADERS,
        allowMethods: TECHNICAL_CORS_METHODS,
        exposeHeaders: TECHNICAL_CORS_EXPOSE_HEADERS
      })

      app.use('/api/v1/*', (context, next) => {
        if (auth.environment.ADMIN_CMS_MODE !== 'technical') {
          return legacyCors(context, next)
        }
        return isPracticeCorsPath(context.req.path)
          ? technicalPracticeCors(context, next)
          : technicalBaseCors(context, next)
      })
    }
    if (admin && auth.environment.ADMIN_CMS_MODE === 'technical') {
      app.route(
        '/api/v1/admin',
        createAdminQuestionRoutes({
          guard: createAdminReadGuard({
            assertCapability: admin.assertCapability,
            environment: auth.environment,
            principalService: auth.principalService,
            rateLimiter: admin.rateLimiter
          }),
          reader: admin.reader
        })
      )
    }
    if (assertPracticeRuntimeAuthority) {
      app.use('/api/v1/*', async (context, next) => {
        if (isPhase7ExcludedRequest(context.get('rawRequestTarget'))) {
          await next()
          return
        }
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
          reviewCenterEnabled:
            learning.reviewCenterEnabled &&
            study?.practiceContractV2Enabled === true,
          reviewCenterService: learning.reviewCenterService,
          wrongNoteService: learning.wrongNoteService
        })
      )
      if (
        learning.reviewCenterEnabled &&
        study?.practiceContractV2Enabled === true &&
        learning.reviewQueueService
      ) {
        app.route(
          '/api/v1/review-queue',
          createReviewQueueRoutes({
            environment: auth.environment,
            principalService: auth.principalService,
            rateLimiter: learning.rateLimiter,
            reviewQueueService: learning.reviewQueueService
          })
        )
      }
      if (
        learning.reviewCenterEnabled &&
        study?.practiceContractV2Enabled === true &&
        learning.targetedReviewService
      ) {
        app.route(
          '/api/v1/wrong-notes',
          createTargetedReviewSessionRoutes({
            environment: auth.environment,
            principalService: auth.principalService,
            rateLimiter: learning.rateLimiter,
            targetedReviewService: learning.targetedReviewService
          })
        )
      }
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
    let failure = toFailure(error, requestId)
    let status = errorStatusByCode[failure.code]
    const operation = getCanonicalPhase7Slice2ReadOperation({
      method: context.req.method,
      requestTarget: context.get('rawRequestTarget')
    })
    const phase7Failure =
      operation === null
        ? null
        : buildCanonicalPhase7ReadFailure({ error, failure, operation })
    if (phase7Failure !== null) {
      failure = phase7Failure.response.body
      status = phase7Failure.response.status
    }
    const pathname = new URL(context.req.url).pathname

    logger.error('http.request.failed', {
      requestId,
      method: context.req.method,
      path: routePath(context, -1),
      status,
      code: failure.code,
      errorName: error.name,
      ...(phase7Failure?.contractViolation === true
        ? { phase7ContractViolation: true }
        : {})
    })
    if (phase7Failure === null) {
      context.header('Cache-Control', 'private, no-store')
      context.header('X-Request-Id', requestId)
    } else {
      Object.entries(phase7Failure.response.headers).forEach(([name, value]) =>
        context.header(name, value)
      )
    }

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
      phase7Failure === null &&
      (failure.code === 'RATE_LIMITED' ||
        failure.code === 'SERVICE_UNAVAILABLE')
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

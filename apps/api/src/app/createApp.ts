import {
  apiFailureSchema,
  errorStatusByCode,
  type ApiFailure
} from '@nihongo/contracts/common/error'
import {
  buildContentOperationFailureResponse,
  contentErrorSurfaceByOperation,
  type ContentOperation,
  type ContentOperationFailureResponse
} from '@nihongo/contracts/admin/content-operations'
import { Hono, type ErrorHandler } from 'hono'
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
import {
  toBoundedDurationMs,
  toHttpStatusClass
} from '../observability/httpLog.js'
import { createHealthRoutes } from '../routes/health.js'
import { createDailyQuestionRoutes } from '../routes/dailyQuestion.js'
import { createQuestionRoutes } from '../routes/questions.js'
import { AuthGatewayError, type AuthGateway } from '../auth/authGateway.js'
import type { ApiEnvironment } from '../config/env.js'
import type { GuestPrincipalService } from '../auth/guestPrincipalService.js'
import type { PrincipalService } from '../auth/principalService.js'
import { createWriteSecurity } from '../middleware/writeSecurity.js'
import { createPrincipalRoutes } from '../routes/principal.js'
import type { DailyQuestionReader } from '../question/dailyQuestion.js'
import type { QuestionReader } from '../question/questionService.js'
import type { ApplicationRateLimiter } from '../middleware/applicationRateLimiter.js'
import type { StudySessionService } from '../study/studySessionService.js'
import { createStudySessionRoutes } from '../routes/studySessions.js'
import { createGuestAllowanceRoutes } from '../routes/guestAllowance.js'
import type { GuestAllowanceReader } from '../study/guestAllowance.js'
import type { GuestIpDailyCounter } from '../study/guestIpDailyCounter.js'
import type { StudySubmissionService } from '../study/studySubmissionService.js'
import { createStudySubmissionRoutes } from '../routes/studySubmissions.js'
import type { WrongNoteService } from '../wrong-note/wrongNoteService.js'
import type { WrongNoteReviewCenterService } from '../wrong-note/wrongNoteReviewCenterService.js'
import type { WrongNoteReviewListService } from '../wrong-note/wrongNoteReviewList.js'
import type { WrongNoteReviewQueueService } from '../wrong-note/wrongNoteReviewQueueService.js'
import type { DashboardService } from '../dashboard/dashboardService.js'
import type { DashboardInsightsService } from '../dashboard/dashboardInsightsService.js'
import { createWrongNoteRoutes } from '../routes/wrongNotes.js'
import { createDashboardRoutes } from '../routes/dashboard.js'
import { createDashboardInsightsRoutes } from '../routes/dashboardInsights.js'
import type { StudyDraftService } from '../study/studyDraftService.js'
import { createStudyDraftRoutes } from '../routes/studyDrafts.js'
import type { BookmarkService } from '../bookmark/bookmarkService.js'
import { createBookmarkRoutes } from '../routes/bookmarks.js'
import type { TargetLevelService } from '../member/targetLevel.js'
import { createTargetLevelRoutes } from '../routes/targetLevel.js'
import type { StudyResultRetryService } from '../study/studyResultRetryService.js'
import { createStudyResultRetryRoutes } from '../routes/studyResultRetries.js'
import { createReviewListRoutes } from '../routes/reviewList.js'
import { createReviewQueueRoutes } from '../routes/reviewQueue.js'
import type { WrongNoteTargetedReviewService } from '../wrong-note/wrongNoteTargetedReviewService.js'
import { createTargetedReviewSessionRoutes } from '../routes/targetedReviewSessions.js'
import type { AdminQuestionReader } from '../admin/adminQuestionService.js'
import type { AdminReadRateLimiter } from '../admin/adminReadRateLimiter.js'
import { createAdminReadGuard } from '../admin/adminReadGuard.js'
import { createAdminCommandGuard } from '../admin/adminCommandGuard.js'
import type { AdminCommandRateLimiter } from '../admin/adminCommandRateLimiter.js'
import type {
  AdminQuestionCommandService,
  AdminQuestionPublicationCommandService,
  AdminQuestionWorkflowCommandService
} from '../admin/adminQuestionCommandService.js'
import { createQuestionReportGuard } from '../admin/questionReportGuard.js'
import type { QuestionReportRateLimiter } from '../admin/questionReportRateLimiter.js'
import type { QuestionReportService } from '../admin/questionReportService.js'
import { createAdminQuestionRoutes } from '../routes/adminQuestions.js'
import { createAdminQuestionCommandRoutes } from '../routes/adminQuestionCommands.js'
import { createAdminQuestionReportRoutes } from '../routes/adminQuestionReports.js'
import { createQuestionReportRoutes } from '../routes/questionReports.js'
import {
  createAdminUserReportRoutes,
  createUserReportRoutes
} from '../routes/userReports.js'
import {
  type AccountRestrictionReader,
  unrestrictedAccountReader
} from '../account/accountRestriction.js'
import type { UserReportService } from '../report/userReportService.js'
import { createAdminConsoleCommandGuard } from '../admin/adminConsoleCommandGuard.js'
import type { AdminMemberService } from '../admin/adminMemberService.js'
import { createAdminMemberRoutes } from '../routes/adminMembers.js'
import { createAdminImportResultRoutes } from '../routes/adminImportResults.js'
import type { AdminImportApplyResponse } from '@nihongo/contracts/admin/content-operations'
import {
  getCanonicalActiveOperation,
  isCanonicalApprovalCommandRequest,
  isCanonicalPublicationCommandRequest,
  isCanonicalLearnerReportRequest,
  isCanonicalWorkflowAdminCommandRequest,
  isCanonicalWorkflowAdminReadRequest,
  isCanonicalSlice3ACommandRequest,
  isCanonicalSlice2ReadRequest,
  isProtectedRouteExcluded,
  isCanonicalAdminConsoleCommandRequest,
  isCanonicalAdminConsoleReadRequest
} from './protectedRouteExclusion.js'
import { installStaticWeb } from './staticWeb.js'

// Development/test only: production serves the web apps from the same origin.
const CORS_METHODS = ['DELETE', 'GET', 'OPTIONS', 'PATCH', 'POST', 'PUT']
const CORS_ALLOW_HEADERS = [
  'Content-Type',
  'Idempotency-Key',
  'X-Nihongo-Practice-Contract'
]
const CORS_EXPOSE_HEADERS = [
  'Content-Disposition',
  'Idempotency-Replayed',
  'Location',
  'Retry-After',
  'X-Request-Id',
  'X-Nihongo-Practice-Contract'
]

interface CreateApiAppDependencies {
  /** #484 restriction lookup; required in production when learner routes are wired. */
  accountRestrictionReader?: AccountRestrictionReader
  checkReadiness: () => Promise<void>
  logger: StructuredLogger
  questionReader: QuestionReader
  /** Today's question (JLP-815); mounted with questionReadSecurity. */
  dailyQuestionReader?: DailyQuestionReader
  releaseId?: string
  webAssetsDirectory?: string
  adminAssetsDirectory?: string
  questionReadSecurity?: {
    readonly environment: ApiEnvironment
    readonly rateLimiter: ApplicationRateLimiter
  }
  auth?: {
    environment: ApiEnvironment
    gateway: AuthGateway
    guestPrincipalService: GuestPrincipalService
    principalService: PrincipalService
  }
  admin?: {
    assertCapability: () => void | Promise<void>
    commands?: {
      rateLimiter: AdminCommandRateLimiter
      service: AdminQuestionCommandService &
        AdminQuestionPublicationCommandService
      workflowService?: AdminQuestionWorkflowCommandService
    }
    reports?: {
      rateLimiter: QuestionReportRateLimiter
      service: QuestionReportService
    }
    importResultReader?: (
      importId: string
    ) => Promise<AdminImportApplyResponse | null>
    /** Operations console member list and restriction (JLP-691). */
    members?: AdminMemberService
    rateLimiter: AdminReadRateLimiter
    reader: AdminQuestionReader
  }
  questionReports?: {
    rateLimiter: QuestionReportRateLimiter
    service: QuestionReportService
  }
  /** Unified learner reports (#484); shares the learner report rate limit. */
  userReports?: {
    rateLimiter: QuestionReportRateLimiter
    service: UserReportService
  }
  study?: {
    draftService?: StudyDraftService
    guestAllowanceReader?: GuestAllowanceReader
    guestIpDailyCounter?: GuestIpDailyCounter
    rateLimiter: ApplicationRateLimiter
    retryService?: StudyResultRetryService
    service: StudySessionService
    submissionService?: StudySubmissionService
  }
  learning?: {
    bookmarkService?: BookmarkService
    dashboardInsightsService?: DashboardInsightsService
    dashboardService: DashboardService
    rateLimiter: ApplicationRateLimiter
    reviewCenterEnabled: boolean
    reviewCenterService: WrongNoteReviewCenterService
    reviewQueueService?: WrongNoteReviewQueueService
    /** Two-state wrong notes (JLP-812). */
    reviewListService?: WrongNoteReviewListService
    targetedReviewService?: WrongNoteTargetedReviewService
    targetLevelService?: TargetLevelService
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
      ...(error.details ? { details: error.details } : {}),
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

const buildCanonicalOperationFailure = ({
  error,
  failure,
  operation
}: {
  error: unknown
  failure: ApiFailure
  operation: ContentOperation
}): {
  response: ContentOperationFailureResponse
  contractViolation: boolean
} => {
  const retryAfterSeconds =
    failure.code === 'RATE_LIMITED' || failure.code === 'SERVICE_UNAVAILABLE'
      ? error instanceof ApplicationError && error.retryAfterSeconds
        ? error.retryAfterSeconds
        : retryAfterSecondsByCode[failure.code]
      : undefined
  const disposition =
    error instanceof ApplicationError && error.adminDisposition
      ? error.adminDisposition
      : contentErrorSurfaceByOperation[operation] === 'GET_READ'
        ? 'NO_TX'
        : 'COMMIT_UNKNOWN'
  try {
    return {
      response: buildContentOperationFailureResponse({
        operation,
        failure: {
          code: failure.code,
          message: failure.message,
          ...(failure.fieldErrors === undefined
            ? {}
            : { fieldErrors: failure.fieldErrors }),
          requestId: failure.requestId
        },
        disposition,
        ...(error instanceof ApplicationError && error.adminInternalReason
          ? { internalReason: error.adminInternalReason }
          : {}),
        ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds })
      }),
      contractViolation: false
    }
  } catch {
    return {
      response: buildContentOperationFailureResponse({
        operation,
        failure: {
          code: 'INTERNAL_SERVER_ERROR',
          message: '요청을 처리하지 못했습니다.',
          requestId: failure.requestId
        },
        disposition:
          contentErrorSurfaceByOperation[operation] === 'GET_READ'
            ? 'NO_TX'
            : disposition
      }),
      contractViolation: true
    }
  }
}

export const createApiErrorHandler =
  ({
    authEnvironment,
    logger,
    operationResolver = getCanonicalActiveOperation
  }: {
    authEnvironment?: ApiEnvironment
    logger: StructuredLogger
    operationResolver?: typeof getCanonicalActiveOperation
  }): ErrorHandler<{ Variables: ApiVariables }> =>
  (error, context) => {
    const requestId = context.get('requestId')
    let failure = toFailure(error, requestId)
    let status = errorStatusByCode[failure.code]
    const operation = operationResolver({
      method: context.req.method,
      requestTarget: context.get('rawRequestTarget')
    })
    const operationFailure =
      operation === null
        ? null
        : buildCanonicalOperationFailure({ error, failure, operation })
    if (operationFailure !== null) {
      failure = operationFailure.response.body
      status = operationFailure.response.status
    }
    const pathname = new URL(context.req.url).pathname

    logger.error('http.request.failed', {
      requestId,
      routeTemplate: routePath(context, -1),
      statusClass: toHttpStatusClass(status),
      durationMs: toBoundedDurationMs(context.get('requestStartedAt')),
      errorCode:
        operationFailure?.contractViolation === true
          ? 'OPERATION_CONTRACT_VIOLATION'
          : failure.code
    })
    if (operationFailure === null) {
      context.header('Cache-Control', 'private, no-store')
      context.header('X-Request-Id', requestId)
    } else {
      Object.entries(operationFailure.response.headers).forEach(
        ([name, value]) => context.header(name, value)
      )
    }

    const origin = context.req.header('Origin')
    if (
      authEnvironment &&
      pathname.startsWith('/api/auth/') &&
      authEnvironment.NODE_ENV !== 'production' &&
      origin &&
      authEnvironment.TRUSTED_ORIGINS.includes(origin)
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
      operationFailure === null &&
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
  }

export const createApiApp = ({
  accountRestrictionReader: configuredAccountRestrictionReader,
  admin,
  auth,
  checkReadiness,
  logger,
  learning,
  questionReader,
  dailyQuestionReader,
  questionReadSecurity,
  questionReports,
  userReports,
  releaseId = '0000000000000000000000000000000000000000',
  study,
  webAssetsDirectory,
  adminAssetsDirectory,
  enableTestRoutes = false
}: CreateApiAppDependencies): Hono<{ Variables: ApiVariables }> => {
  const app = new Hono<{ Variables: ApiVariables }>()
  if (
    configuredAccountRestrictionReader === undefined &&
    auth?.environment.NODE_ENV === 'production' &&
    (study !== undefined ||
      learning?.targetedReviewService !== undefined ||
      userReports !== undefined)
  ) {
    throw new Error(
      'Production learner routes require an account restriction reader.'
    )
  }
  const accountRestrictionReader =
    configuredAccountRestrictionReader ?? unrestrictedAccountReader

  const adminEnabled = admin !== undefined && auth !== undefined
  const learnerReports =
    auth === undefined
      ? undefined
      : (questionReports ?? (adminEnabled ? admin.reports : undefined))

  app.use('*', requestContext)
  app.use('*', secureHeaders())
  app.use('*', createRequestLogger(logger))

  app.use('*', async (context, next) => {
    const requestTarget = getAdapterRequestTarget(
      context.env,
      context.req.raw.url
    )
    context.set('rawRequestTarget', requestTarget)
    const isExcludedRequest =
      isProtectedRouteExcluded(requestTarget) ||
      isProtectedRouteExcluded(context.req.path)
    if (!isExcludedRequest) {
      await next()
      return
    }

    if (
      learnerReports !== undefined &&
      isCanonicalLearnerReportRequest({
        method: context.req.method,
        requestTarget
      })
    ) {
      await next()
      return
    }

    if (
      adminEnabled &&
      (isCanonicalSlice2ReadRequest({
        method: context.req.method,
        requestTarget
      }) ||
        isCanonicalAdminConsoleReadRequest({
          method: context.req.method,
          requestTarget
        }) ||
        isCanonicalAdminConsoleCommandRequest({
          method: context.req.method,
          requestTarget
        }) ||
        (admin?.commands !== undefined &&
          (isCanonicalSlice3ACommandRequest({
            method: context.req.method,
            requestTarget
          }) ||
            isCanonicalApprovalCommandRequest({
              method: context.req.method,
              requestTarget
            }) ||
            isCanonicalPublicationCommandRequest({
              method: context.req.method,
              requestTarget
            }))) ||
        (admin?.commands?.workflowService !== undefined &&
          isCanonicalWorkflowAdminCommandRequest({
            method: context.req.method,
            requestTarget
          })) ||
        (admin?.reports !== undefined &&
          isCanonicalWorkflowAdminReadRequest({
            method: context.req.method,
            requestTarget
          })))
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

  app.route('/health', createHealthRoutes({ checkReadiness, releaseId }))

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
      app.use(
        '/api/v1/*',
        cors({
          origin: (origin: string) =>
            auth.environment.TRUSTED_ORIGINS.includes(origin)
              ? origin
              : undefined,
          credentials: true,
          maxAge: 600,
          allowHeaders: CORS_ALLOW_HEADERS,
          allowMethods: CORS_METHODS,
          exposeHeaders: CORS_EXPOSE_HEADERS
        })
      )
    }
    if (userReports) {
      app.route(
        '/api/v1/reports',
        createUserReportRoutes({
          accountRestrictionReader,
          createGuard: createQuestionReportGuard({
            environment: auth.environment,
            principalService: auth.principalService,
            rateLimiter: userReports.rateLimiter
          }),
          environment: auth.environment,
          principalService: auth.principalService,
          service: userReports.service
        })
      )
    }
    if (learnerReports) {
      app.route(
        '/api/v1/question-reports',
        createQuestionReportRoutes({
          guard: createQuestionReportGuard({
            environment: auth.environment,
            principalService: auth.principalService,
            rateLimiter: learnerReports.rateLimiter
          }),
          service: learnerReports.service
        })
      )
    }
    if (admin) {
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
      if (admin.importResultReader) {
        app.route(
          '/api/v1/admin',
          createAdminImportResultRoutes({
            guard: createAdminReadGuard({
              assertCapability: admin.assertCapability,
              environment: auth.environment,
              principalService: auth.principalService,
              rateLimiter: admin.rateLimiter
            }),
            readResult: admin.importResultReader
          })
        )
      }
      if (admin.members) {
        const readGuard = createAdminReadGuard({
          assertCapability: admin.assertCapability,
          environment: auth.environment,
          principalService: auth.principalService,
          rateLimiter: admin.rateLimiter
        })
        app.route(
          '/api/v1/admin',
          createAdminMemberRoutes({
            commandGuard: createAdminConsoleCommandGuard({
              environment: auth.environment,
              readGuard
            }),
            readGuard,
            service: admin.members
          })
        )
      }
      if (userReports) {
        const readGuard = createAdminReadGuard({
          assertCapability: admin.assertCapability,
          environment: auth.environment,
          principalService: auth.principalService,
          rateLimiter: admin.rateLimiter
        })
        app.route(
          '/api/v1/admin',
          createAdminUserReportRoutes({
            commandGuard: createAdminConsoleCommandGuard({
              environment: auth.environment,
              readGuard
            }),
            readGuard,
            service: userReports.service
          })
        )
      }
      if (admin.reports) {
        app.route(
          '/api/v1/admin',
          createAdminQuestionReportRoutes({
            guard: createAdminReadGuard({
              assertCapability: admin.assertCapability,
              environment: auth.environment,
              principalService: auth.principalService,
              rateLimiter: admin.rateLimiter
            }),
            service: admin.reports.service
          })
        )
      }
      if (admin.commands) {
        app.route(
          '/api/v1/admin',
          createAdminQuestionCommandRoutes({
            commandService: admin.commands.service,
            guard: createAdminCommandGuard({
              assertCapability: admin.assertCapability,
              environment: auth.environment,
              principalService: auth.principalService,
              rateLimiter: admin.commands.rateLimiter
            }),
            ...(admin.commands.workflowService
              ? { workflowCommandService: admin.commands.workflowService }
              : {})
          })
        )
      }
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
          accountRestrictionReader,
          environment: auth.environment,
          guestPrincipalService: auth.guestPrincipalService,
          principalService: auth.principalService,
          ...(study.guestIpDailyCounter
            ? { guestIpDailyCounter: study.guestIpDailyCounter }
            : {}),
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
            rateLimiter: study.rateLimiter,
            studySubmissionService: study.submissionService
          })
        )
      }
      if (study.retryService) {
        app.route(
          '/api/v1/study-sessions',
          createStudyResultRetryRoutes({
            accountRestrictionReader,
            environment: auth.environment,
            guestPrincipalService: auth.guestPrincipalService,
            principalService: auth.principalService,
            rateLimiter: study.rateLimiter,
            studyResultRetryService: study.retryService
          })
        )
      }
      if (study.guestAllowanceReader) {
        app.route(
          '/api/v1/guest-allowance',
          createGuestAllowanceRoutes({
            environment: auth.environment,
            guestAllowanceReader: study.guestAllowanceReader,
            guestPrincipalService: auth.guestPrincipalService,
            principalService: auth.principalService,
            rateLimiter: study.rateLimiter
          })
        )
      }
      if (study.draftService) {
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
      if (study && learning.bookmarkService) {
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
      if (learning.targetLevelService) {
        app.route(
          '/api/v1/me/target-level',
          createTargetLevelRoutes({
            environment: auth.environment,
            principalService: auth.principalService,
            rateLimiter: learning.rateLimiter,
            targetLevelService: learning.targetLevelService
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
            learning.reviewCenterEnabled && study !== undefined,
          reviewCenterService: learning.reviewCenterService,
          wrongNoteService: learning.wrongNoteService
        })
      )
      if (
        learning.reviewCenterEnabled &&
        study !== undefined &&
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
        study !== undefined &&
        learning.reviewListService
      ) {
        app.route(
          '/api/v1/review-list',
          createReviewListRoutes({
            environment: auth.environment,
            principalService: auth.principalService,
            rateLimiter: learning.rateLimiter,
            reviewListService: learning.reviewListService
          })
        )
      }
      if (
        learning.reviewCenterEnabled &&
        study !== undefined &&
        learning.targetedReviewService
      ) {
        app.route(
          '/api/v1/wrong-notes',
          createTargetedReviewSessionRoutes({
            accountRestrictionReader,
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
      if (learning.dashboardInsightsService) {
        app.route(
          '/api/v1/dashboard',
          createDashboardInsightsRoutes({
            dashboardInsightsService: learning.dashboardInsightsService,
            environment: auth.environment,
            principalService: auth.principalService,
            rateLimiter: learning.rateLimiter
          })
        )
      }
    }
  }

  if (dailyQuestionReader && questionReadSecurity) {
    app.route(
      '/api/v1/daily-question',
      createDailyQuestionRoutes({
        dailyQuestionReader,
        environment: questionReadSecurity.environment,
        rateLimiter: questionReadSecurity.rateLimiter
      })
    )
  }

  app.route(
    '/api/v1/questions',
    createQuestionRoutes({
      questionReader,
      questionReadSecurity,
      ...(auth
        ? {
            members: {
              environment: auth.environment,
              principalService: auth.principalService
            }
          }
        : {})
    })
  )

  if (enableTestRoutes) {
    app.get('/__test/error', () => {
      throw new Error('sensitive internal failure')
    })
  }

  if (adminAssetsDirectory && !webAssetsDirectory) {
    throw new Error('Admin assets require a separate learner assets directory.')
  }
  if (webAssetsDirectory) {
    installStaticWeb({
      app,
      releaseId,
      webAssetsDirectory,
      ...(adminAssetsDirectory ? { adminAssetsDirectory } : {}),
      ...(adminAssetsDirectory && adminEnabled && admin && auth
        ? {
            adminGuard: createAdminReadGuard({
              assertCapability: admin.assertCapability,
              environment: auth.environment,
              principalService: auth.principalService,
              rateLimiter: admin.rateLimiter
            })
          }
        : {})
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

  app.onError(
    createApiErrorHandler({
      ...(auth ? { authEnvironment: auth.environment } : {}),
      logger
    })
  )

  return app
}

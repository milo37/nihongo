import 'dotenv/config'
import type { Server } from 'node:http'
import { serve } from '@hono/node-server'
import { createApiApp } from './app/createApp.js'
import { createAuthGateway } from './auth/authGateway.js'
import { createAuthRuntime } from './auth/createAuth.js'
import { createPhase7ReauthenticationAuthApi } from './auth/createPhase7ReauthenticationAuth.js'
import { createPhase7AuthFacade } from './auth/phase7AuthFacade.js'
import { createPhase7ReauthenticationContext } from './auth/phase7ReauthenticationContext.js'
import {
  runPhase7ReauthenticationStartupMaintenance,
  startPhase7ReauthenticationMaintenance
} from './auth/phase7ReauthenticationStartupMaintenance.js'
import { createAuthEmailDispatcher } from './auth/emailDispatcher.js'
import { createAuthEmailPort } from './auth/emailPort.js'
import { createGuestPrincipalService } from './auth/guestPrincipalService.js'
import {
  createPhase7PrincipalService,
  createPrincipalService
} from './auth/principalService.js'
import { parseApiEnvironment } from './config/env.js'
import { createFilePracticeCompatibilityAuthority } from './config/practiceCompatibilityAuthority.js'
import { parsePracticeRuntimeEnvironment } from './config/practiceRuntimeEnvironment.js'
import {
  createDatabaseRuntime,
  createRoleDatabaseRuntime
} from './db/database.js'
import { assertSafeAdminCmsDatabase } from './db/databaseTargetGuard.js'
import { attestPhase7RuntimeRoles } from './db/phase7RuntimeRoleAttestation.js'
import { stopServerGracefully } from './lifecycle/gracefulShutdown.js'
import { createShutdownCoordinator } from './lifecycle/shutdownCoordinator.js'
import { createJsonLogger } from './observability/logger.js'
import { createPrismaQuestionRepository } from './question/questionRepository.js'
import { createQuestionService } from './question/questionService.js'
import { createApplicationRateLimiter } from './middleware/applicationRateLimiter.js'
import { createPrismaStudySessionRepository } from './study/studySessionRepository.js'
import { createStudySessionService } from './study/studySessionService.js'
import { createPrismaStudySubmissionRepository } from './study/studySubmissionRepository.js'
import { createStudySubmissionService } from './study/studySubmissionService.js'
import { createPrismaWrongNoteRepository } from './wrong-note/wrongNoteRepository.js'
import { createWrongNoteService } from './wrong-note/wrongNoteService.js'
import { createPrismaWrongNoteReviewCenterRepository } from './wrong-note/wrongNoteReviewCenterRepository.js'
import { createWrongNoteReviewCenterService } from './wrong-note/wrongNoteReviewCenterService.js'
import { createPrismaDashboardRepository } from './dashboard/dashboardRepository.js'
import { createDashboardService } from './dashboard/dashboardService.js'
import { createPrismaDashboardInsightsRepository } from './dashboard/dashboardInsightsRepository.js'
import { createDashboardInsightsService } from './dashboard/dashboardInsightsService.js'
import { createPrismaStudyDraftRepository } from './study/studyDraftRepository.js'
import { createStudyDraftService } from './study/studyDraftService.js'
import { startApiListener } from './lifecycle/startApiListener.js'
import { createPracticeRuntimeGate } from './lifecycle/practiceRuntimeGate.js'
import { createPrismaBookmarkRepository } from './bookmark/bookmarkRepository.js'
import { createBookmarkService } from './bookmark/bookmarkService.js'
import { createPrismaStudyResultRetryRepository } from './study/studyResultRetryRepository.js'
import { createStudyResultRetryService } from './study/studyResultRetryService.js'
import { createPrismaWrongNoteReviewQueueRepository } from './wrong-note/wrongNoteReviewQueueRepository.js'
import { createWrongNoteReviewQueueService } from './wrong-note/wrongNoteReviewQueueService.js'
import { createPrismaWrongNoteTargetedReviewRepository } from './wrong-note/wrongNoteTargetedReviewRepository.js'
import { createWrongNoteTargetedReviewService } from './wrong-note/wrongNoteTargetedReviewService.js'
import { createAdminReadRateLimiter } from './admin/adminReadRateLimiter.js'
import { createPrismaAdminQuestionRepository } from './admin/adminQuestionRepository.js'
import { createAdminQuestionService } from './admin/adminQuestionService.js'
import { createAdminCommandRateLimiter } from './admin/adminCommandRateLimiter.js'
import { createPrismaAdminQuestionCommandRepository } from './admin/adminQuestionCommandRepository.js'
import { createPrismaAdminQuestionSlice5Repository } from './admin/adminQuestionSlice5Repository.js'
import {
  createAdminQuestionCommandService,
  createAdminQuestionPublicationCommandService,
  createAdminQuestionSlice5CommandService
} from './admin/adminQuestionCommandService.js'
import { createAdminReauthenticationService } from './admin/adminReauthenticationService.js'
import { createQuestionReportRateLimiter } from './admin/questionReportRateLimiter.js'
import { createPrismaQuestionReportRepository } from './admin/questionReportRepository.js'
import { createQuestionReportService } from './admin/questionReportService.js'

const environment = parseApiEnvironment(process.env)
assertSafeAdminCmsDatabase({
  adminCmsMode: environment.ADMIN_CMS_MODE,
  nodeEnvironment: environment.NODE_ENV,
  databaseUrl: environment.DATABASE_URL,
  productionDatabaseUrl: process.env.PRODUCTION_DATABASE_URL
})
const practiceEnvironment = parsePracticeRuntimeEnvironment(
  process.env,
  environment.NODE_ENV
)
const logger = createJsonLogger(environment.LOG_LEVEL)
const compatibilityAuthority =
  practiceEnvironment.runtime === 'v1-compatible'
    ? createFilePracticeCompatibilityAuthority(
        practiceEnvironment.authorityFile ?? ''
      )
    : undefined
const technicalMode = environment.ADMIN_CMS_MODE === 'technical'
const authGatewayDatabaseUrl = environment.AUTH_GATEWAY_DATABASE_URL
if (technicalMode && !authGatewayDatabaseUrl) {
  throw new Error('Technical auth gateway DB URL is unavailable.')
}
if (technicalMode) {
  assertSafeAdminCmsDatabase({
    adminCmsMode: environment.ADMIN_CMS_MODE,
    nodeEnvironment: environment.NODE_ENV,
    databaseUrl: authGatewayDatabaseUrl,
    productionDatabaseUrl: process.env.PRODUCTION_DATABASE_URL
  })
}
const database = createDatabaseRuntime(
  environment.DATABASE_URL,
  technicalMode
    ? { migrationProfile: 'current', startupRole: 'nihongo_app' }
    : { migrationProfile: 'pre-phase7' }
)
const authGatewayDatabase = technicalMode
  ? createRoleDatabaseRuntime(authGatewayDatabaseUrl!, 'nihongo_auth_gateway')
  : undefined
const checkDatabaseReadiness = async (): Promise<void> => {
  await database.checkReadiness()
  if (!technicalMode) {
    // The activation transaction revokes this legacy table surface. A new
    // disabled-mode process must therefore fail before opening its listener
    // instead of starting with a drained old-binary credential.
    await database.client.$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 0')
    return
  }
  if (authGatewayDatabase && authGatewayDatabaseUrl) {
    await attestPhase7RuntimeRoles({
      application: {
        client: database.client,
        connectionString: environment.DATABASE_URL,
        expectedRole: 'nihongo_app'
      },
      authGateway: {
        client: authGatewayDatabase.client,
        connectionString: authGatewayDatabaseUrl,
        expectedRole: 'nihongo_auth_gateway'
      }
    })
    await Promise.all([
      database.client.$queryRawUnsafe(
        'SELECT "phase7_require_runtime_ready"()'
      ),
      authGatewayDatabase.client.$queryRawUnsafe(
        'SELECT "phase7_require_runtime_ready"()'
      )
    ])
  }
}
const disconnectDatabases = async (): Promise<void> => {
  await Promise.all([
    database.disconnect(),
    authGatewayDatabase?.disconnect() ?? Promise.resolve()
  ])
}
const practiceRuntimeGate = createPracticeRuntimeGate({
  runtime: practiceEnvironment.runtime,
  ...(compatibilityAuthority ? { authority: compatibilityAuthority } : {}),
  checkDatabaseReadiness,
  checkV1Compatibility: database.checkV1Compatibility
})
const emailDispatcher = createAuthEmailDispatcher({
  emailPort: createAuthEmailPort(environment),
  onDeliveryFailure: (purpose, reason) =>
    logger.warn('auth.email.delivery_failed', { purpose, reason })
})
const auth = technicalMode
  ? undefined
  : createAuthRuntime({
      client: database.client,
      emailDispatcher,
      environment
    })
const phase7AuthFacade =
  technicalMode && authGatewayDatabase
    ? createPhase7AuthFacade({
        client: authGatewayDatabase.client,
        emailDispatcher,
        environment
      })
    : undefined
const adminReauthenticationService =
  technicalMode && authGatewayDatabase
    ? (() => {
        const context = createPhase7ReauthenticationContext()
        return createAdminReauthenticationService({
          auditEnvironment:
            environment.NODE_ENV === 'test' ? 'TEST' : 'DEVELOPMENT',
          authApi: createPhase7ReauthenticationAuthApi({
            client: authGatewayDatabase.client,
            context,
            environment
          }),
          client: authGatewayDatabase.client,
          context
        })
      })()
    : undefined
const guestPrincipalService = createGuestPrincipalService({
  client: database.client,
  secret: environment.GUEST_COOKIE_SECRET
})
const principalService = technicalMode
  ? createPhase7PrincipalService({
      client: database.client,
      isProduction: environment.NODE_ENV === 'production',
      refreshClient: authGatewayDatabase!.client,
      secret: environment.BETTER_AUTH_SECRET
    })
  : createPrincipalService({
      authApi: auth!.api,
      client: database.client
    })
const questionReader = createQuestionService(
  createPrismaQuestionRepository(database.client)
)
const studySessionService = createStudySessionService(
  createPrismaStudySessionRepository(database.client)
)
const studySubmissionService = createStudySubmissionService(
  createPrismaStudySubmissionRepository(database.client)
)
const studyDraftService = createStudyDraftService(
  createPrismaStudyDraftRepository(database.client)
)
const studyResultRetryService = createStudyResultRetryService(
  createPrismaStudyResultRetryRepository(database.client)
)
const wrongNoteService = createWrongNoteService(
  createPrismaWrongNoteRepository(database.client)
)
const wrongNoteReviewCenterService = createWrongNoteReviewCenterService(
  createPrismaWrongNoteReviewCenterRepository(database.client)
)
const wrongNoteReviewQueueService = createWrongNoteReviewQueueService(
  createPrismaWrongNoteReviewQueueRepository(database.client)
)
const wrongNoteTargetedReviewService = createWrongNoteTargetedReviewService(
  createPrismaWrongNoteTargetedReviewRepository(database.client)
)
const dashboardService = createDashboardService(
  createPrismaDashboardRepository(database.client)
)
const dashboardInsightsService = createDashboardInsightsService(
  createPrismaDashboardInsightsRepository(
    database.client,
    technicalMode ? 'PHASE7' : 'LEGACY'
  )
)
const bookmarkService = createBookmarkService(
  createPrismaBookmarkRepository(database.client)
)
const applicationRateLimiter = createApplicationRateLimiter({
  client: database.client,
  keySecret: environment.GUEST_COOKIE_SECRET
})
const adminQuestionReader = technicalMode
  ? createAdminQuestionService(
      createPrismaAdminQuestionRepository(database.client)
    )
  : undefined
const adminReadRateLimiter = technicalMode
  ? createAdminReadRateLimiter({
      client: database.client,
      keySecret: environment.GUEST_COOKIE_SECRET
    })
  : undefined
const adminQuestionCommandRepository = technicalMode
  ? createPrismaAdminQuestionCommandRepository({
      auditEnvironment:
        environment.NODE_ENV === 'test' ? 'TEST' : 'DEVELOPMENT',
      client: database.client
    })
  : undefined
const adminQuestionSlice5Repository = technicalMode
  ? createPrismaAdminQuestionSlice5Repository({
      auditEnvironment:
        environment.NODE_ENV === 'test' ? 'TEST' : 'DEVELOPMENT',
      client: database.client
    })
  : undefined
const adminQuestionCommandService =
  adminQuestionCommandRepository && adminQuestionSlice5Repository
    ? {
        ...createAdminQuestionCommandService(adminQuestionCommandRepository),
        ...createAdminQuestionPublicationCommandService(
          adminQuestionCommandRepository
        ),
        ...createAdminQuestionSlice5CommandService(
          adminQuestionSlice5Repository
        )
      }
    : undefined
const adminCommandRateLimiter = technicalMode
  ? createAdminCommandRateLimiter({
      client: database.client,
      keySecret: environment.GUEST_COOKIE_SECRET
    })
  : undefined
const questionReportRateLimiter = technicalMode
  ? createQuestionReportRateLimiter({
      client: database.client,
      keySecret: environment.GUEST_COOKIE_SECRET
    })
  : undefined
const questionReportService =
  technicalMode && questionReportRateLimiter
    ? createQuestionReportService({
        rateLimiter: questionReportRateLimiter,
        repository: createPrismaQuestionReportRepository(database.client)
      })
    : undefined
const app = createApiApp({
  ...(adminQuestionReader &&
  adminReadRateLimiter &&
  adminQuestionCommandService &&
  adminCommandRateLimiter &&
  adminReauthenticationService &&
  questionReportRateLimiter &&
  questionReportService &&
  adminQuestionSlice5Repository
    ? {
        admin: {
          assertCapability: async () => {
            await database.client.$queryRawUnsafe(
              'SELECT "phase7_require_runtime_ready"()'
            )
          },
          commands: {
            rateLimiter: adminCommandRateLimiter,
            service: adminQuestionCommandService,
            slice5Service: adminQuestionCommandService
          },
          reauthentication: {
            rateLimiter: adminCommandRateLimiter,
            service: adminReauthenticationService
          },
          reports: {
            rateLimiter: questionReportRateLimiter,
            service: questionReportService
          },
          rateLimiter: adminReadRateLimiter,
          reader: adminQuestionReader
        }
      }
    : {}),
  assertPracticeRuntimeAuthority: practiceRuntimeGate.assertRequestAuthority,
  auth: {
    environment,
    gateway: createAuthGateway({
      ...(auth ? { auth, client: database.client } : {}),
      environment,
      ...(phase7AuthFacade
        ? {
            phase7Facade: phase7AuthFacade,
            technicalRateLimiter: applicationRateLimiter
          }
        : {})
    }),
    guestPrincipalService,
    principalService
  },
  checkReadiness: practiceRuntimeGate.checkReadiness,
  logger,
  learning: {
    bookmarkService,
    dashboardInsightsService,
    dashboardService,
    rateLimiter: applicationRateLimiter,
    reviewCenterEnabled: practiceRuntimeGate.practiceContractV2Enabled,
    reviewCenterService: wrongNoteReviewCenterService,
    reviewQueueService: wrongNoteReviewQueueService,
    targetedReviewService: wrongNoteTargetedReviewService,
    wrongNoteService
  },
  questionReader,
  study: {
    draftService: studyDraftService,
    practiceContractV2Enabled: practiceRuntimeGate.practiceContractV2Enabled,
    rateLimiter: applicationRateLimiter,
    retryService: studyResultRetryService,
    service: studySessionService,
    submissionService: studySubmissionService
  }
})

const checkStartupReadiness = async (): Promise<void> => {
  await practiceRuntimeGate.checkReadiness()
  if (technicalMode && authGatewayDatabase) {
    await runPhase7ReauthenticationStartupMaintenance(
      authGatewayDatabase.client
    )
  }
}

const server = await startApiListener({
  checkReadiness: checkStartupReadiness,
  disconnectDatabase: disconnectDatabases,
  createListener: () =>
    serve({
      fetch: app.fetch,
      hostname: environment.HOST,
      port: environment.PORT
    }) as Server
})
server.headersTimeout = 10_000
server.requestTimeout = 15_000
const reauthenticationMaintenance =
  technicalMode && authGatewayDatabase
    ? startPhase7ReauthenticationMaintenance({
        client: authGatewayDatabase.client,
        onFailure: (error) => {
          logger.error('auth.reauthentication.maintenance_failed', {
            errorName: error instanceof Error ? error.name : 'UnknownError'
          })
        }
      })
    : undefined

logger.info('api.started', {
  host: environment.HOST,
  port: environment.PORT,
  environment: environment.NODE_ENV
})

const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
  logger.info('api.shutdown.started', { signal })
  const reauthenticationMaintenanceDrain =
    reauthenticationMaintenance?.stop() ?? Promise.resolve()

  await stopServerGracefully({
    server,
    abortBackgroundTasks: emailDispatcher.abort,
    drainBackgroundTasks: async () => {
      const results = await Promise.allSettled([
        reauthenticationMaintenanceDrain,
        emailDispatcher.drain()
      ])
      const failure = results.find(
        (result): result is PromiseRejectedResult =>
          result.status === 'rejected'
      )
      if (failure) throw failure.reason
    },
    disconnectDatabase: disconnectDatabases
  })
  logger.info('api.shutdown.completed', { signal })
}

const shutdownCoordinator = createShutdownCoordinator(shutdown)

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void shutdownCoordinator
      .begin(signal)
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        logger.error('api.shutdown.failed', {
          signal,
          errorName: error instanceof Error ? error.name : 'UnknownError'
        })
        process.exit(1)
      })
  })
}

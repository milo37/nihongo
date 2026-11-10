import 'dotenv/config'
import type { Server } from 'node:http'
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import { createPrismaAccountRestrictionReader } from './account/accountRestriction.js'
import { createApiApp } from './app/createApp.js'
import { createSsoAuthentication } from './auth/createSsoAuthentication.js'
import {
  runReauthenticationStartupMaintenance,
  startReauthenticationMaintenance
} from './auth/reauthenticationStartupMaintenance.js'
import { createGuestPrincipalService } from './auth/guestPrincipalService.js'
import { LOCAL_RELEASE_ID, parseApiEnvironment } from './config/env.js'
import { createAuthRuntimePlan } from './config/authRuntimePlan.js'
import { createDatabaseRuntime } from './db/database.js'
import { assertSafeAdminCmsDatabase } from './db/databaseTargetGuard.js'
import { createOwnedAuthReadiness } from './auth/ownedAuthReadiness.js'
import { stopServerGracefully } from './lifecycle/gracefulShutdown.js'
import { createShutdownCoordinator } from './lifecycle/shutdownCoordinator.js'
import { createJsonLogger } from './observability/logger.js'
import { createPrismaQuestionRepository } from './question/questionRepository.js'
import { createQuestionService } from './question/questionService.js'
import {
  createDailyQuestionService,
  createPrismaDailyQuestionRepository
} from './question/dailyQuestion.js'
import { createApplicationRateLimiter } from './middleware/applicationRateLimiter.js'
import { createPrismaStudySessionRepository } from './study/studySessionRepository.js'
import { createStudySessionService } from './study/studySessionService.js'
import { createPrismaGuestAllowanceReader } from './study/guestAllowance.js'
import { createGuestIpDailyCounter } from './study/guestIpDailyCounter.js'
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
import { createPrismaBookmarkRepository } from './bookmark/bookmarkRepository.js'
import { createBookmarkService } from './bookmark/bookmarkService.js'
import {
  createPrismaTargetLevelRepository,
  createTargetLevelService
} from './member/targetLevel.js'
import { createPrismaStudyResultRetryRepository } from './study/studyResultRetryRepository.js'
import { createStudyResultRetryService } from './study/studyResultRetryService.js'
import {
  createPrismaWrongNoteReviewListRepository,
  createWrongNoteReviewListService
} from './wrong-note/wrongNoteReviewList.js'
import { createPrismaWrongNoteTargetedReviewRepository } from './wrong-note/wrongNoteTargetedReviewRepository.js'
import { createWrongNoteTargetedReviewService } from './wrong-note/wrongNoteTargetedReviewService.js'
import { createAdminReadRateLimiter } from './admin/adminReadRateLimiter.js'
import { createPrismaAdminQuestionRepository } from './admin/adminQuestionRepository.js'
import { createAdminQuestionService } from './admin/adminQuestionService.js'
import { createQuestionImportResultReader } from './admin/questionImportResultStore.js'
import { createPrismaUserReportRepository } from './report/userReportRepository.js'
import { createUserReportService } from './report/userReportService.js'
import { createPrismaAdminMemberRepository } from './admin/adminMemberRepository.js'
import { createAdminMemberService } from './admin/adminMemberService.js'
import { createAdminCommandRateLimiter } from './admin/adminCommandRateLimiter.js'
import { createPrismaAdminQuestionCommandRepository } from './admin/adminQuestionCommandRepository.js'
import { createPrismaAdminQuestionWorkflowRepository } from './admin/adminQuestionWorkflowRepository.js'
import {
  createAdminQuestionCommandService,
  createAdminQuestionPublicationCommandService,
  createAdminQuestionWorkflowCommandService
} from './admin/adminQuestionCommandService.js'
import { createQuestionReportRateLimiter } from './admin/questionReportRateLimiter.js'
import { createPrismaQuestionReportRepository } from './admin/questionReportRepository.js'
import { createQuestionReportService } from './admin/questionReportService.js'

const environment = parseApiEnvironment(process.env)
const packagedWebAssetsDirectory = fileURLToPath(
  new URL('../../web/', import.meta.url)
)
const packagedAdminAssetsDirectory = fileURLToPath(
  new URL('../../admin/', import.meta.url)
)
const authRuntimePlan = createAuthRuntimePlan()
assertSafeAdminCmsDatabase({
  nodeEnvironment: environment.NODE_ENV,
  databaseUrl: environment.DATABASE_URL,
  productionDatabaseUrl: process.env.PRODUCTION_DATABASE_URL
})
const logger = createJsonLogger(environment.LOG_LEVEL, undefined, {
  deploymentEnvironment:
    environment.DEPLOYMENT_ENVIRONMENT ??
    (environment.NODE_ENV === 'test' ? 'TEST' : 'LOCAL'),
  releaseId: environment.RELEASE_ID ?? LOCAL_RELEASE_ID
})
const auditEnvironment =
  environment.NODE_ENV === 'production'
    ? 'PRODUCTION'
    : environment.NODE_ENV === 'test'
      ? 'TEST'
      : 'DEVELOPMENT'
const runtimeMigrationProfile = authRuntimePlan.migrationProfile
const database = createDatabaseRuntime(environment.DATABASE_URL, {
  migrationProfile: runtimeMigrationProfile,
  startupRole: 'nihongo_app'
})
const checkDatabaseReadiness = createOwnedAuthReadiness({
  checkDatabaseReadiness: database.checkReadiness,
  applicationClient: database.client,
  applicationUrl: environment.DATABASE_URL,
  deploymentEnvironment: environment.DEPLOYMENT_ENVIRONMENT
})
const disconnectDatabases = async (): Promise<void> => {
  await database.disconnect()
}
const applicationRateLimiter = createApplicationRateLimiter({
  client: database.client,
  keySecret: environment.GUEST_COOKIE_SECRET
})
const ssoAuthentication = createSsoAuthentication({
  environment,
  applicationClient: database.client,
  gatewayClient: database.client,
  rateLimiter: applicationRateLimiter,
  logger
})
const guestPrincipalService = createGuestPrincipalService({
  client: database.client,
  secret: environment.GUEST_COOKIE_SECRET
})
const principalService = ssoAuthentication.principalService
const questionReader = createQuestionService(
  createPrismaQuestionRepository(database.client, {
    migrationProfile: runtimeMigrationProfile
  })
)
const dailyQuestionReader = createDailyQuestionService(
  createPrismaDailyQuestionRepository(database.client)
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
const wrongNoteReviewListService = createWrongNoteReviewListService(
  createPrismaWrongNoteReviewListRepository(database.client)
)
const wrongNoteTargetedReviewService = createWrongNoteTargetedReviewService(
  createPrismaWrongNoteTargetedReviewRepository(database.client)
)
const dashboardService = createDashboardService(
  createPrismaDashboardRepository(database.client)
)
const dashboardInsightsService = createDashboardInsightsService(
  createPrismaDashboardInsightsRepository(database.client)
)
const bookmarkService = createBookmarkService(
  createPrismaBookmarkRepository(database.client, {
    migrationProfile: runtimeMigrationProfile
  })
)
const targetLevelService = createTargetLevelService(
  createPrismaTargetLevelRepository(database.client)
)
const adminQuestionReader = createAdminQuestionService(
  createPrismaAdminQuestionRepository(database.client)
)
const adminReadRateLimiter = createAdminReadRateLimiter({
  client: database.client,
  keySecret: environment.GUEST_COOKIE_SECRET
})
const adminQuestionCommandRepository =
  createPrismaAdminQuestionCommandRepository({
    auditEnvironment,
    client: database.client
  })
const adminQuestionWorkflowRepository =
  createPrismaAdminQuestionWorkflowRepository({
    auditEnvironment,
    client: database.client
  })
const adminQuestionCommandService = {
  ...createAdminQuestionCommandService(adminQuestionCommandRepository),
  ...createAdminQuestionPublicationCommandService(
    adminQuestionCommandRepository
  ),
  ...createAdminQuestionWorkflowCommandService(adminQuestionWorkflowRepository)
}
const adminCommandRateLimiter = createAdminCommandRateLimiter({
  client: database.client,
  keySecret: environment.GUEST_COOKIE_SECRET
})
const questionReportRateLimiter = createQuestionReportRateLimiter({
  client: database.client,
  keySecret: environment.GUEST_COOKIE_SECRET
})
const questionReportService = createQuestionReportService({
  rateLimiter: questionReportRateLimiter,
  repository: createPrismaQuestionReportRepository(database.client)
})
const userReportService = createUserReportService(
  createPrismaUserReportRepository(database.client)
)
const app = createApiApp({
  accountRestrictionReader: createPrismaAccountRestrictionReader(
    database.client
  ),
  admin: {
    assertCapability: async () => {
      await database.client.$queryRawUnsafe('SELECT "require_runtime_ready"()')
    },
    commands: {
      rateLimiter: adminCommandRateLimiter,
      service: adminQuestionCommandService,
      workflowService: adminQuestionCommandService
    },
    reports: {
      rateLimiter: questionReportRateLimiter,
      service: questionReportService
    },
    importResultReader: createQuestionImportResultReader(database.client),
    members: createAdminMemberService(
      createPrismaAdminMemberRepository(database.client)
    ),
    rateLimiter: adminReadRateLimiter,
    reader: adminQuestionReader
  },
  ...(questionReportRateLimiter && userReportService
    ? {
        userReports: {
          rateLimiter: questionReportRateLimiter,
          service: userReportService
        }
      }
    : {}),
  ...(questionReportRateLimiter && questionReportService
    ? {
        questionReports: {
          rateLimiter: questionReportRateLimiter,
          service: questionReportService
        }
      }
    : {}),
  releaseId: environment.RELEASE_ID ?? LOCAL_RELEASE_ID,
  ...(environment.NODE_ENV === 'production'
    ? {
        webAssetsDirectory: packagedWebAssetsDirectory,
        adminAssetsDirectory: packagedAdminAssetsDirectory
      }
    : {}),
  auth: {
    environment,
    gateway: ssoAuthentication.gateway,
    guestPrincipalService,
    principalService
  },
  checkReadiness: checkDatabaseReadiness,
  logger,
  learning: {
    bookmarkService,
    dashboardInsightsService,
    dashboardService,
    rateLimiter: applicationRateLimiter,
    reviewCenterEnabled: true,
    reviewCenterService: wrongNoteReviewCenterService,
    reviewListService: wrongNoteReviewListService,
    targetedReviewService: wrongNoteTargetedReviewService,
    targetLevelService,
    wrongNoteService
  },
  questionReader,
  dailyQuestionReader,
  questionReadSecurity: {
    environment,
    rateLimiter: applicationRateLimiter
  },
  study: {
    draftService: studyDraftService,
    guestAllowanceReader: createPrismaGuestAllowanceReader({
      client: database.client,
      keySecret: environment.GUEST_COOKIE_SECRET
    }),
    guestIpDailyCounter: createGuestIpDailyCounter({
      client: database.client,
      keySecret: environment.GUEST_COOKIE_SECRET,
      rateLimiter: applicationRateLimiter
    }),
    rateLimiter: applicationRateLimiter,
    retryService: studyResultRetryService,
    service: studySessionService,
    submissionService: studySubmissionService
  }
})

const checkStartupReadiness = async (): Promise<void> => {
  await checkDatabaseReadiness()
  await runReauthenticationStartupMaintenance(database.client)
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
const reauthenticationMaintenance = startReauthenticationMaintenance({
  client: database.client,
  onFailure: () => {
    logger.error('auth.reauthentication.maintenance_failed', {
      errorCode: 'MAINTENANCE_FAILED'
    })
  }
})

logger.info('api.started')

const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
  logger.info('api.shutdown.started', { signal })
  const reauthenticationMaintenanceDrain = reauthenticationMaintenance.stop()

  await stopServerGracefully({
    server,
    abortBackgroundTasks: () => undefined,
    drainBackgroundTasks: async () => {
      const results = await Promise.allSettled([
        reauthenticationMaintenanceDrain
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
      .catch(() => {
        logger.error('api.shutdown.failed', {
          signal,
          errorCode: 'SHUTDOWN_FAILED'
        })
        process.exit(1)
      })
  })
}

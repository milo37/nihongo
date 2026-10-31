import 'dotenv/config'
import type { Server } from 'node:http'
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import { createApiApp } from './app/createApp.js'
import { createAuthGateway } from './auth/authGateway.js'
import { createAuthRuntime } from './auth/createAuth.js'
import { createSsoAuthentication } from './auth/createSsoAuthentication.js'
import {
  runPhase7ReauthenticationStartupMaintenance,
  startPhase7ReauthenticationMaintenance
} from './auth/reauthenticationStartupMaintenance.js'
import { createGuestPrincipalService } from './auth/guestPrincipalService.js'
import { createPrincipalService } from './auth/principalService.js'
import { LOCAL_RELEASE_ID, parseApiEnvironment } from './config/env.js'
import { createAuthRuntimePlan } from './config/authRuntimePlan.js'
import { createFilePracticeCompatibilityAuthority } from './config/practiceCompatibilityAuthority.js'
import { parsePracticeRuntimeEnvironment } from './config/practiceRuntimeEnvironment.js'
import {
  createDatabaseRuntime,
  createRoleDatabaseRuntime
} from './db/database.js'
import { assertSafeAdminCmsDatabase } from './db/databaseTargetGuard.js'
import { createOwnedAuthReadiness } from './auth/ownedAuthReadiness.js'
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
const authRuntimePlan = createAuthRuntimePlan(environment)
if (!authRuntimePlan.ownedAuth || authRuntimePlan.cmsEnabled)
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
const logger = createJsonLogger(environment.LOG_LEVEL, undefined, {
  deploymentEnvironment:
    environment.DEPLOYMENT_ENVIRONMENT ??
    (environment.NODE_ENV === 'test' ? 'TEST' : 'LOCAL'),
  releaseId: environment.RELEASE_ID ?? LOCAL_RELEASE_ID
})
const compatibilityAuthority =
  practiceEnvironment.runtime === 'v1-compatible'
    ? createFilePracticeCompatibilityAuthority(
        practiceEnvironment.authorityFile ?? ''
      )
    : undefined
const technicalMode = environment.ADMIN_CMS_MODE === 'technical'
const ownedAuth = authRuntimePlan.ownedAuth
const runtimeMigrationProfile = authRuntimePlan.migrationProfile
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
  ownedAuth
    ? { migrationProfile: runtimeMigrationProfile, startupRole: 'nihongo_app' }
    : { migrationProfile: runtimeMigrationProfile }
)
const authGatewayDatabase = ownedAuth
  ? createRoleDatabaseRuntime(authGatewayDatabaseUrl!, 'nihongo_auth_gateway')
  : undefined
const checkDatabaseReadiness =
  ownedAuth && authGatewayDatabase && authGatewayDatabaseUrl
    ? createOwnedAuthReadiness({
        checkDatabaseReadiness: database.checkReadiness,
        applicationClient: database.client,
        gatewayClient: authGatewayDatabase.client,
        applicationUrl: environment.DATABASE_URL,
        gatewayUrl: authGatewayDatabaseUrl
      })
    : async (): Promise<void> => {
        await database.checkReadiness()
        await database.client.$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 0')
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
const applicationRateLimiter = createApplicationRateLimiter({
  client: database.client,
  keySecret: environment.GUEST_COOKIE_SECRET
})
const auth = ownedAuth
  ? undefined
  : createAuthRuntime({ client: database.client, environment })
const ssoAuthentication =
  ownedAuth && authGatewayDatabase
    ? createSsoAuthentication({
        environment,
        applicationClient: database.client,
        gatewayClient: authGatewayDatabase.client,
        rateLimiter: applicationRateLimiter
      })
    : undefined
const guestPrincipalService = createGuestPrincipalService({
  client: database.client,
  secret: environment.GUEST_COOKIE_SECRET
})
const principalService =
  ssoAuthentication?.principalService ??
  createPrincipalService({ authApi: auth!.api, client: database.client })
const questionReader = createQuestionService(
  createPrismaQuestionRepository(database.client, {
    migrationProfile: runtimeMigrationProfile
  })
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
    ownedAuth ? 'PHASE7' : 'LEGACY'
  )
)
const bookmarkService = createBookmarkService(
  createPrismaBookmarkRepository(database.client, {
    migrationProfile: runtimeMigrationProfile
  })
)
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
// Learner reports need Phase 7 sessions and schema, not the technical CMS.
const questionReportRateLimiter = ownedAuth
  ? createQuestionReportRateLimiter({
      client: database.client,
      keySecret: environment.GUEST_COOKIE_SECRET
    })
  : undefined
const questionReportService = questionReportRateLimiter
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
          reports: {
            rateLimiter: questionReportRateLimiter,
            service: questionReportService
          },
          rateLimiter: adminReadRateLimiter,
          reader: adminQuestionReader
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
  assertPracticeRuntimeAuthority: practiceRuntimeGate.assertRequestAuthority,
  releaseId: environment.RELEASE_ID ?? LOCAL_RELEASE_ID,
  ...(environment.NODE_ENV === 'production'
    ? {
        webAssetsDirectory: packagedWebAssetsDirectory,
        adminAssetsDirectory: packagedAdminAssetsDirectory
      }
    : {}),
  auth: {
    environment,
    gateway:
      ssoAuthentication?.gateway ??
      createAuthGateway({ auth: auth!, client: database.client, environment }),
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
  questionReadSecurity: {
    environment,
    rateLimiter: applicationRateLimiter
  },
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
  if (ownedAuth && authGatewayDatabase) {
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
  ownedAuth && authGatewayDatabase
    ? startPhase7ReauthenticationMaintenance({
        client: authGatewayDatabase.client,
        onFailure: () => {
          logger.error('auth.reauthentication.maintenance_failed', {
            errorCode: 'MAINTENANCE_FAILED'
          })
        }
      })
    : undefined

logger.info('api.started')

const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
  logger.info('api.shutdown.started', { signal })
  const reauthenticationMaintenanceDrain =
    reauthenticationMaintenance?.stop() ?? Promise.resolve()

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

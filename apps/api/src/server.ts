import 'dotenv/config'
import type { Server } from 'node:http'
import { serve } from '@hono/node-server'
import { createApiApp } from './app/createApp.js'
import { createAuthGateway } from './auth/authGateway.js'
import { createAuthRuntime } from './auth/createAuth.js'
import { createAuthEmailDispatcher } from './auth/emailDispatcher.js'
import { createAuthEmailPort } from './auth/emailPort.js'
import { createGuestPrincipalService } from './auth/guestPrincipalService.js'
import { createPrincipalService } from './auth/principalService.js'
import { parseApiEnvironment } from './config/env.js'
import { createFilePracticeCompatibilityAuthority } from './config/practiceCompatibilityAuthority.js'
import { parsePracticeRuntimeEnvironment } from './config/practiceRuntimeEnvironment.js'
import { createDatabaseRuntime } from './db/database.js'
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
import { createPrismaStudyDraftRepository } from './study/studyDraftRepository.js'
import { createStudyDraftService } from './study/studyDraftService.js'
import { startApiListener } from './lifecycle/startApiListener.js'
import { createPracticeRuntimeGate } from './lifecycle/practiceRuntimeGate.js'
import { createPrismaBookmarkRepository } from './bookmark/bookmarkRepository.js'
import { createBookmarkService } from './bookmark/bookmarkService.js'
import { createPrismaStudyResultRetryRepository } from './study/studyResultRetryRepository.js'
import { createStudyResultRetryService } from './study/studyResultRetryService.js'

const environment = parseApiEnvironment(process.env)
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
const database = createDatabaseRuntime(environment.DATABASE_URL)
const practiceRuntimeGate = createPracticeRuntimeGate({
  runtime: practiceEnvironment.runtime,
  ...(compatibilityAuthority ? { authority: compatibilityAuthority } : {}),
  checkDatabaseReadiness: database.checkReadiness,
  checkV1Compatibility: database.checkV1Compatibility
})
const emailDispatcher = createAuthEmailDispatcher({
  emailPort: createAuthEmailPort(environment),
  onDeliveryFailure: (purpose, reason) =>
    logger.warn('auth.email.delivery_failed', { purpose, reason })
})
const auth = createAuthRuntime({
  client: database.client,
  emailDispatcher,
  environment
})
const guestPrincipalService = createGuestPrincipalService({
  client: database.client,
  secret: environment.GUEST_COOKIE_SECRET
})
const principalService = createPrincipalService({
  authApi: auth.api,
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
const dashboardService = createDashboardService(
  createPrismaDashboardRepository(database.client)
)
const bookmarkService = createBookmarkService(
  createPrismaBookmarkRepository(database.client)
)
const applicationRateLimiter = createApplicationRateLimiter({
  client: database.client,
  keySecret: environment.GUEST_COOKIE_SECRET
})
const app = createApiApp({
  assertPracticeRuntimeAuthority: practiceRuntimeGate.assertRequestAuthority,
  auth: {
    environment,
    gateway: createAuthGateway({ auth, client: database.client, environment }),
    guestPrincipalService,
    principalService
  },
  checkReadiness: practiceRuntimeGate.checkReadiness,
  logger,
  learning: {
    bookmarkService,
    dashboardService,
    rateLimiter: applicationRateLimiter,
    reviewCenterEnabled: practiceRuntimeGate.practiceContractV2Enabled,
    reviewCenterService: wrongNoteReviewCenterService,
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

const server = await startApiListener({
  checkReadiness: practiceRuntimeGate.checkReadiness,
  disconnectDatabase: database.disconnect,
  createListener: () =>
    serve({
      fetch: app.fetch,
      hostname: environment.HOST,
      port: environment.PORT
    }) as Server
})
server.headersTimeout = 10_000
server.requestTimeout = 15_000

logger.info('api.started', {
  host: environment.HOST,
  port: environment.PORT,
  environment: environment.NODE_ENV
})

const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
  logger.info('api.shutdown.started', { signal })

  await stopServerGracefully({
    server,
    abortBackgroundTasks: emailDispatcher.abort,
    drainBackgroundTasks: emailDispatcher.drain,
    disconnectDatabase: database.disconnect
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

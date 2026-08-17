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
import { createPrismaDashboardRepository } from './dashboard/dashboardRepository.js'
import { createDashboardService } from './dashboard/dashboardService.js'

const environment = parseApiEnvironment(process.env)
const logger = createJsonLogger(environment.LOG_LEVEL)
const database = createDatabaseRuntime(environment.DATABASE_URL)
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
const wrongNoteService = createWrongNoteService(
  createPrismaWrongNoteRepository(database.client)
)
const dashboardService = createDashboardService(
  createPrismaDashboardRepository(database.client)
)
const applicationRateLimiter = createApplicationRateLimiter({
  client: database.client,
  keySecret: environment.GUEST_COOKIE_SECRET
})
const app = createApiApp({
  auth: {
    environment,
    gateway: createAuthGateway({ auth, client: database.client, environment }),
    guestPrincipalService,
    principalService
  },
  checkReadiness: database.checkReadiness,
  logger,
  learning: {
    dashboardService,
    rateLimiter: applicationRateLimiter,
    wrongNoteService
  },
  questionReader,
  study: {
    rateLimiter: applicationRateLimiter,
    service: studySessionService,
    submissionService: studySubmissionService
  }
})

const server = serve({
  fetch: app.fetch,
  hostname: environment.HOST,
  port: environment.PORT
}) as Server
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

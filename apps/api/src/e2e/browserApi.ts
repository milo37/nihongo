import type { Server } from 'node:http'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import { Client } from 'pg'
import { z } from 'zod'
import { createApiApp } from '../app/createApp.js'
import { createSsoAuthentication } from '../auth/createSsoAuthentication.js'
import { createGoogleSsoProvider } from '../auth/ssoGoogleProvider.js'
import type { SsoProvider } from '../auth/ssoProtocol.js'
import { createOwnedAuthReadiness } from '../auth/ownedAuthReadiness.js'
import { createGuestPrincipalService } from '../auth/guestPrincipalService.js'
import { runPhase7ReauthenticationStartupMaintenance } from '../auth/reauthenticationStartupMaintenance.js'
import { parseApiEnvironment } from '../config/env.js'
import {
  createDatabaseRuntime,
  createRoleDatabaseRuntime
} from '../db/database.js'
import {
  assertSafeAdminCmsDatabase,
  assertSafeTestDatabase
} from '../db/databaseTargetGuard.js'
import {
  createPostgresStartupOptions,
  getPostgresSchema
} from '../db/databaseOptions.js'
import { createPhase7SsoIdentityFixture } from '../db/fixtures/ssoSession.js'
import { createPracticeRuntimeGate } from '../lifecycle/practiceRuntimeGate.js'
import { startApiListener } from '../lifecycle/startApiListener.js'
import { stopServerGracefully } from '../lifecycle/gracefulShutdown.js'
import { createJsonLogger } from '../observability/logger.js'
import { createApplicationRateLimiter } from '../middleware/applicationRateLimiter.js'
import { createPrismaQuestionRepository } from '../question/questionRepository.js'
import { createQuestionService } from '../question/questionService.js'
import { createPrismaStudySessionRepository } from '../study/studySessionRepository.js'
import { createStudySessionService } from '../study/studySessionService.js'
import { createPrismaStudySubmissionRepository } from '../study/studySubmissionRepository.js'
import { createStudySubmissionService } from '../study/studySubmissionService.js'
import { createPrismaStudyDraftRepository } from '../study/studyDraftRepository.js'
import { createStudyDraftService } from '../study/studyDraftService.js'
import { createPrismaStudyResultRetryRepository } from '../study/studyResultRetryRepository.js'
import { createStudyResultRetryService } from '../study/studyResultRetryService.js'
import { createPrismaWrongNoteRepository } from '../wrong-note/wrongNoteRepository.js'
import { createWrongNoteService } from '../wrong-note/wrongNoteService.js'
import { createPrismaWrongNoteReviewCenterRepository } from '../wrong-note/wrongNoteReviewCenterRepository.js'
import { createWrongNoteReviewCenterService } from '../wrong-note/wrongNoteReviewCenterService.js'
import { createPrismaWrongNoteReviewQueueRepository } from '../wrong-note/wrongNoteReviewQueueRepository.js'
import { createWrongNoteReviewQueueService } from '../wrong-note/wrongNoteReviewQueueService.js'
import { createPrismaWrongNoteTargetedReviewRepository } from '../wrong-note/wrongNoteTargetedReviewRepository.js'
import { createWrongNoteTargetedReviewService } from '../wrong-note/wrongNoteTargetedReviewService.js'
import { createPrismaDashboardRepository } from '../dashboard/dashboardRepository.js'
import { createDashboardService } from '../dashboard/dashboardService.js'
import { createPrismaDashboardInsightsRepository } from '../dashboard/dashboardInsightsRepository.js'
import { createDashboardInsightsService } from '../dashboard/dashboardInsightsService.js'
import { createPrismaBookmarkRepository } from '../bookmark/bookmarkRepository.js'
import { createBookmarkService } from '../bookmark/bookmarkService.js'
import { createAdminReadRateLimiter } from '../admin/adminReadRateLimiter.js'
import { createPrismaAdminQuestionRepository } from '../admin/adminQuestionRepository.js'
import { createAdminQuestionService } from '../admin/adminQuestionService.js'
import { createAdminCommandRateLimiter } from '../admin/adminCommandRateLimiter.js'
import { createPrismaAdminQuestionCommandRepository } from '../admin/adminQuestionCommandRepository.js'
import { createPrismaAdminQuestionSlice5Repository } from '../admin/adminQuestionSlice5Repository.js'
import {
  createAdminQuestionCommandService,
  createAdminQuestionPublicationCommandService,
  createAdminQuestionSlice5CommandService
} from '../admin/adminQuestionCommandService.js'
import { createQuestionReportRateLimiter } from '../admin/questionReportRateLimiter.js'
import { createPrismaQuestionReportRepository } from '../admin/questionReportRepository.js'
import { createQuestionReportService } from '../admin/questionReportService.js'

const actors = {
  author: {
    role: 'ADMIN',
    targetLevel: 'N3',
    callbackCode: 'phase7-test-google-author'
  },
  reviewer: {
    role: 'ADMIN',
    targetLevel: 'N3',
    callbackCode: 'phase7-test-google-reviewer'
  },
  learner: {
    role: 'USER',
    targetLevel: 'N3',
    callbackCode: 'phase7-test-google-learner'
  },
  insightsLearner: {
    role: 'USER',
    targetLevel: 'N2',
    callbackCode: 'phase7-test-google-insights'
  },
  journeyLearner: {
    role: 'USER',
    targetLevel: 'N5',
    callbackCode: 'phase7-test-google-journey'
  }
} as const
const actorKeys = [
  'author',
  'reviewer',
  'learner',
  'insightsLearner',
  'journeyLearner'
] as const
const entrySchema = z
  .object({
    actor: z
      .object({
        userId: z.uuid(),
        role: z.enum(['ADMIN', 'USER']),
        targetLevel: z.enum(['N2', 'N3', 'N5']),
        callbackCode: z.string()
      })
      .strict(),
    identity: z
      .object({
        provider: z.literal('google'),
        accountId: z.string().min(1).max(255),
        email: z.email(),
        name: z.string().min(1)
      })
      .strict()
  })
  .strict()
const identitiesSchema = z
  .record(z.enum(actorKeys), entrySchema)
  .superRefine((value, context) => {
    const ids = new Set<string>()
    const subjects = new Set<string>()
    for (const key of actorKeys) {
      const { actor, identity } = value[key]
      const expected = actors[key]
      if (
        actor.role !== expected.role ||
        actor.targetLevel !== expected.targetLevel ||
        actor.callbackCode !== expected.callbackCode ||
        ids.has(actor.userId) ||
        subjects.has(identity.accountId)
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Phase 9 TEST actor mapping mismatch.',
          path: [key]
        })
      }
      ids.add(actor.userId)
      subjects.add(identity.accountId)
    }
  })
export type Phase9SsoIdentities = z.output<typeof identitiesSchema>
export type Phase9BrowserFixture = {
  readonly [Key in (typeof actorKeys)[number]]: Phase9SsoIdentities[Key]['actor']
}

const sameTarget = (a: URL, b: URL): boolean =>
  a.protocol === b.protocol &&
  a.hostname === b.hostname &&
  (a.port || '5432') === (b.port || '5432') &&
  a.pathname === b.pathname &&
  getPostgresSchema(a.href) === getPostgresSchema(b.href)

const assertTestTarget = (
  url: string,
  productionDatabaseUrl: string | undefined
): URL => {
  assertSafeTestDatabase({
    nodeEnvironment: 'test',
    databaseUrl: url,
    productionDatabaseUrl
  })
  const target = new URL(url)
  if (
    target.hash ||
    target.searchParams.getAll('schema').length !== 1 ||
    !/^phase7_[a-f0-9]{32}_test$/u.test(getPostgresSchema(url) ?? '') ||
    [...target.searchParams.keys()].some(
      (key) => key !== 'schema' && key !== 'sslmode'
    )
  ) {
    throw new Error('PHASE9_ISOLATED_TEST_SCHEMA_REQUIRED')
  }
  return target
}

export const parsePhase9BrowserEnvironment = (source: NodeJS.ProcessEnv) => {
  if (
    source.NODE_ENV !== 'test' ||
    source.DEPLOYMENT_ENVIRONMENT !== 'TEST' ||
    source.ADMIN_CMS_MODE !== 'technical' ||
    source.PRACTICE_CONTRACT_RUNTIME !== 'v1-v2' ||
    [
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET',
      'APPLE_CLIENT_ID',
      'APPLE_CLIENT_SECRET'
    ].some((key) => source[key] !== undefined)
  ) {
    throw new Error('PHASE9_FIXED_TEST_ENVIRONMENT_REQUIRED')
  }
  const environment = parseApiEnvironment(source)
  const app = assertTestTarget(
    environment.DATABASE_URL,
    source.PRODUCTION_DATABASE_URL
  )
  const gateway = assertTestTarget(
    environment.AUTH_GATEWAY_DATABASE_URL!,
    source.PRODUCTION_DATABASE_URL
  )
  if (
    decodeURIComponent(app.username) !== 'nihongo_test_app_login' ||
    decodeURIComponent(gateway.username) !==
      'nihongo_test_auth_gateway_login' ||
    !sameTarget(app, gateway)
  )
    throw new Error('PHASE9_CANONICAL_TEST_DATABASE_ROLES_REQUIRED')
  for (const databaseUrl of [
    environment.DATABASE_URL,
    environment.AUTH_GATEWAY_DATABASE_URL
  ]) {
    assertSafeAdminCmsDatabase({
      adminCmsMode: 'technical',
      nodeEnvironment: 'test',
      databaseUrl,
      productionDatabaseUrl: source.PRODUCTION_DATABASE_URL
    })
  }
  for (const origin of [
    environment.BETTER_AUTH_URL,
    ...environment.TRUSTED_ORIGINS
  ]) {
    const url = new URL(origin)
    if (
      url.protocol !== 'http:' ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      url.origin !== origin
    )
      throw new Error('PHASE9_LOOPBACK_TEST_ORIGINS_REQUIRED')
  }
  const api = new URL(environment.BETTER_AUTH_URL)
  if (
    api.hostname.replace(/^\[|\]$/gu, '') !== environment.HOST ||
    Number(api.port || '80') !== environment.PORT
  )
    throw new Error('PHASE9_LISTENER_ORIGIN_MISMATCH')
  return environment
}

export const preparePhase9BrowserActors = async ({
  adminDatabaseUrl,
  environment: source
}: {
  adminDatabaseUrl: string
  environment: NodeJS.ProcessEnv
}): Promise<{
  fixture: Phase9BrowserFixture
  identities: Phase9SsoIdentities
}> => {
  const environment = parsePhase9BrowserEnvironment(source)
  const ownerTarget = assertTestTarget(
    adminDatabaseUrl,
    source.PRODUCTION_DATABASE_URL
  )
  if (
    !sameTarget(ownerTarget, new URL(environment.DATABASE_URL)) ||
    [
      'nihongo_test_app_login',
      'nihongo_test_auth_gateway_login',
      'nihongo_test_phase7_migration_login',
      'nihongo_test_legacy_app_login'
    ].includes(decodeURIComponent(ownerTarget.username)) ||
    !ownerTarget.username
  )
    throw new Error('PHASE9_SEPARATE_TEST_OWNER_REQUIRED')
  const schema = getPostgresSchema(adminDatabaseUrl)!
  ownerTarget.searchParams.delete('schema')
  const owner = new Client({
    connectionString: ownerTarget.href,
    options: createPostgresStartupOptions(schema)
  })
  let transaction = false
  try {
    await owner.connect()
    await owner.query('BEGIN')
    transaction = true
    const entries = []
    for (const key of actorKeys) {
      const definition = actors[key]
      const { userId, identity } = await createPhase7SsoIdentityFixture({
        owner: {
          $queryRawUnsafe: async <T = unknown>(
            sql: string,
            ...values: unknown[]
          ) => (await owner.query(sql, values)).rows as T
        },
        role: definition.role
      })
      const result = await owner.query<{
        id: string
        role: string
        targetLevel: string
      }>(
        'UPDATE "User" SET "targetLevel"=$2::"JlptLevel" WHERE id=$1::uuid RETURNING id,role::text,"targetLevel"::text',
        [userId, definition.targetLevel]
      )
      if (
        result.rows.length !== 1 ||
        result.rows[0]?.id !== userId ||
        result.rows[0]?.role !== definition.role ||
        result.rows[0]?.targetLevel !== definition.targetLevel
      )
        throw new Error('PHASE9_DATABASE_ACTOR_AUTHORITY_MISMATCH')
      entries.push([key, { actor: { ...definition, userId }, identity }])
    }
    const identities = identitiesSchema.parse(Object.fromEntries(entries))
    const fixture = Object.fromEntries(
      actorKeys.map((key) => [key, identities[key].actor])
    ) as Phase9BrowserFixture
    await owner.query('COMMIT')
    transaction = false
    return { fixture, identities }
  } catch (error: unknown) {
    if (transaction) await owner.query('ROLLBACK')
    throw error
  } finally {
    await owner.end()
  }
}

export const createPhase9GoogleTestProvider = (
  source: NodeJS.ProcessEnv,
  input: unknown
): SsoProvider => {
  const environment = parsePhase9BrowserEnvironment(source)
  const identities = identitiesSchema.parse(input)
  const byCode = new Map(
    actorKeys.map((key) => [
      identities[key].actor.callbackCode,
      identities[key].identity
    ])
  )
  const google = createGoogleSsoProvider({
    clientId: 'phase9-browser-test-client',
    clientSecret: 'phase9-browser-unused-test-secret',
    callbackURL: new URL(
      '/api/auth/callback/google',
      environment.BETTER_AUTH_URL
    ).href
  })
  return {
    authorizationURL: google.authorizationURL,
    exchange: async ({ code }) => {
      const identity = byCode.get(code)
      // Only identity is injected. Session identity and role come from real DB SSO authority.
      return identity ? { ...identity } : null
    }
  }
}

export const createPhase9BrowserApi = async ({
  environment: source,
  identities
}: {
  environment: NodeJS.ProcessEnv
  identities: unknown
}) => {
  const environment = parsePhase9BrowserEnvironment(source)
  const provider = createPhase9GoogleTestProvider(source, identities)
  const database = createDatabaseRuntime(environment.DATABASE_URL, {
    migrationProfile: 'current',
    startupRole: 'nihongo_app'
  })
  const gateway = createRoleDatabaseRuntime(
    environment.AUTH_GATEWAY_DATABASE_URL!,
    'nihongo_auth_gateway'
  )
  let closing: Promise<void> | undefined
  const disconnect = (): Promise<void> =>
    (closing ??= Promise.allSettled([
      database.disconnect(),
      gateway.disconnect()
    ]).then((results) => {
      if (results.some((result) => result.status === 'rejected'))
        throw new Error('PHASE9_DATABASE_DISCONNECT_FAILED')
    }))
  try {
    const practice = createPracticeRuntimeGate({
      runtime: 'v1-v2',
      checkV1Compatibility: database.checkV1Compatibility,
      checkDatabaseReadiness: createOwnedAuthReadiness({
        checkDatabaseReadiness: database.checkReadiness,
        applicationClient: database.client,
        gatewayClient: gateway.client,
        applicationUrl: environment.DATABASE_URL,
        gatewayUrl: environment.AUTH_GATEWAY_DATABASE_URL!
      })
    })
    const rateLimiter = createApplicationRateLimiter({
      client: database.client,
      keySecret: environment.GUEST_COOKIE_SECRET
    })
    const auth = createSsoAuthentication({
      environment,
      applicationClient: database.client,
      gatewayClient: gateway.client,
      rateLimiter,
      providers: { google: provider }
    })
    const commandRepository = createPrismaAdminQuestionCommandRepository({
      auditEnvironment: 'TEST',
      client: database.client
    })
    const slice5Repository = createPrismaAdminQuestionSlice5Repository({
      auditEnvironment: 'TEST',
      client: database.client
    })
    const commandService = {
      ...createAdminQuestionCommandService(commandRepository),
      ...createAdminQuestionPublicationCommandService(commandRepository),
      ...createAdminQuestionSlice5CommandService(slice5Repository)
    }
    const reportLimiter = createQuestionReportRateLimiter({
      client: database.client,
      keySecret: environment.GUEST_COOKIE_SECRET
    })
    const app = createApiApp({
      auth: {
        environment,
        ...auth,
        guestPrincipalService: createGuestPrincipalService({
          client: database.client,
          secret: environment.GUEST_COOKIE_SECRET
        })
      },
      assertPracticeRuntimeAuthority: practice.assertRequestAuthority,
      checkReadiness: practice.checkReadiness,
      logger: createJsonLogger('silent'),
      ...(environment.RELEASE_ID ? { releaseId: environment.RELEASE_ID } : {}),
      questionReader: createQuestionService(
        createPrismaQuestionRepository(database.client, {
          migrationProfile: 'current'
        })
      ),
      questionReadSecurity: { environment, rateLimiter },
      study: {
        draftService: createStudyDraftService(
          createPrismaStudyDraftRepository(database.client)
        ),
        practiceContractV2Enabled: practice.practiceContractV2Enabled,
        rateLimiter,
        retryService: createStudyResultRetryService(
          createPrismaStudyResultRetryRepository(database.client)
        ),
        service: createStudySessionService(
          createPrismaStudySessionRepository(database.client)
        ),
        submissionService: createStudySubmissionService(
          createPrismaStudySubmissionRepository(database.client)
        )
      },
      learning: {
        bookmarkService: createBookmarkService(
          createPrismaBookmarkRepository(database.client, {
            migrationProfile: 'current'
          })
        ),
        dashboardInsightsService: createDashboardInsightsService(
          createPrismaDashboardInsightsRepository(database.client, 'PHASE7')
        ),
        dashboardService: createDashboardService(
          createPrismaDashboardRepository(database.client)
        ),
        rateLimiter,
        reviewCenterEnabled: practice.practiceContractV2Enabled,
        reviewCenterService: createWrongNoteReviewCenterService(
          createPrismaWrongNoteReviewCenterRepository(database.client)
        ),
        reviewQueueService: createWrongNoteReviewQueueService(
          createPrismaWrongNoteReviewQueueRepository(database.client)
        ),
        targetedReviewService: createWrongNoteTargetedReviewService(
          createPrismaWrongNoteTargetedReviewRepository(database.client)
        ),
        wrongNoteService: createWrongNoteService(
          createPrismaWrongNoteRepository(database.client)
        )
      },
      admin: {
        assertCapability: async () => {
          await database.client.$queryRawUnsafe(
            'SELECT "phase7_require_runtime_ready"()'
          )
        },
        commands: {
          rateLimiter: createAdminCommandRateLimiter({
            client: database.client,
            keySecret: environment.GUEST_COOKIE_SECRET
          }),
          service: commandService,
          slice5Service: commandService
        },
        reports: {
          rateLimiter: reportLimiter,
          service: createQuestionReportService({
            rateLimiter: reportLimiter,
            repository: createPrismaQuestionReportRepository(database.client)
          })
        },
        rateLimiter: createAdminReadRateLimiter({
          client: database.client,
          keySecret: environment.GUEST_COOKIE_SECRET
        }),
        reader: createAdminQuestionService(
          createPrismaAdminQuestionRepository(database.client)
        )
      }
    })
    return {
      app,
      disconnect,
      checkReadiness: async () => {
        await practice.checkReadiness()
        await runPhase7ReauthenticationStartupMaintenance(gateway.client)
      }
    }
  } catch (error: unknown) {
    await disconnect()
    throw error
  }
}

const run = async (): Promise<void> => {
  const environment = parsePhase9BrowserEnvironment(process.env)
  const identities: unknown = JSON.parse(
    process.env.PHASE9_TEST_SSO_IDENTITIES ?? 'null'
  )
  const fixture = await createPhase9BrowserApi({
    environment: process.env,
    identities
  })
  const controller = new AbortController()
  let stop = () => {}
  const stopped = new Promise<void>((resolveStop) => {
    stop = resolveStop
  })
  const onSignal = () => {
    controller.abort()
    stop()
  }
  const onError = () => {
    process.exitCode = 1
    stop()
  }
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)
  let server: Awaited<ReturnType<typeof startApiListener>> | undefined
  try {
    server = await startApiListener({
      checkReadiness: fixture.checkReadiness,
      disconnectDatabase: fixture.disconnect,
      createListener: () => {
        controller.signal.throwIfAborted()
        return serve({
          fetch: fixture.app.fetch,
          hostname: environment.HOST,
          port: environment.PORT
        }) as Server
      }
    })
    server.once('error', onError)
    server.headersTimeout = 10_000
    server.requestTimeout = 15_000
    await stopped
  } finally {
    process.removeListener('SIGINT', onSignal)
    process.removeListener('SIGTERM', onSignal)
    if (server)
      await stopServerGracefully({
        server,
        disconnectDatabase: fixture.disconnect
      })
    else await fixture.disconnect()
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  void run().catch(() => {
    process.stderr.write('PHASE9_TEST_SSO_BOOTSTRAP_FAILED\n')
    process.exitCode = 1
  })
}

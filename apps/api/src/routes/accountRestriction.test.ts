import { Hono, type MiddlewareHandler } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import type { AccountRestrictionReader } from '../account/accountRestriction.js'
import { createApiErrorHandler } from '../app/createApp.js'
import { createGuestPrincipalService } from '../auth/guestPrincipalService.js'
import type { PrincipalService } from '../auth/principalService.js'
import type { ApiEnvironment } from '../config/env.js'
import type { PrismaClient } from '../generated/prisma/client.js'
import type { ApplicationRateLimiter } from '../middleware/applicationRateLimiter.js'
import {
  requestContext,
  type ApiVariables
} from '../middleware/requestContext.js'
import { createJsonLogger } from '../observability/logger.js'
import type { UserReportService } from '../report/userReportService.js'
import type { StudyResultRetryService } from '../study/studyResultRetryService.js'
import type { StudySessionService } from '../study/studySessionService.js'
import type { WrongNoteTargetedReviewService } from '../wrong-note/wrongNoteTargetedReviewService.js'
import { createStudyResultRetryRoutes } from './studyResultRetries.js'
import { createStudySessionRoutes } from './studySessions.js'
import { createTargetedReviewSessionRoutes } from './targetedReviewSessions.js'
import { createUserReportRoutes } from './userReports.js'

const sessionId = '0468c832-f5de-42b5-82be-6a9a511a3098'
const questionId = '4ed52fae-8952-44df-9ec1-2298c893e061'
const idempotencyKey = 'fddf0156-6aa7-40d3-9cd4-3371c97b3fc3'

const fixture = () => {
  const environment = {
    NODE_ENV: 'test',
    AUTH_TRUSTED_PROXY_CIDRS: []
  } as unknown as ApiEnvironment
  const principalService = {
    resolveAuthenticatedUser: async (headers: Headers) => {
      const id = headers.get('Authorization')?.replace('Bearer ', '')
      return {
        clearSessionCookie: false,
        headers: new Headers(),
        user: id ? { id, name: id, role: 'USER', targetLevel: 'N5' } : null
      }
    }
  } as unknown as PrincipalService
  const guestPrincipalService = createGuestPrincipalService({
    client: {} as PrismaClient,
    secret: 'guest-fixture-secret'
  })
  const rateLimiter = {
    consume: async () => undefined
  } as unknown as ApplicationRateLimiter
  const isRestricted = vi.fn(async (userId: string) => userId === 'restricted')
  const accountRestrictionReader: AccountRestrictionReader = { isRestricted }
  const reached = vi.fn(() => {
    throw new Error('fixture service reached')
  })
  const reporterGuard: MiddlewareHandler<{ Variables: ApiVariables }> = async (
    context,
    next
  ) => {
    const id = context.req.header('Authorization')?.replace('Bearer ', '')
    context.set('reporterActorId', id ?? '')
    await next()
  }

  const app = new Hono<{ Variables: ApiVariables }>()
  app.use('*', requestContext)
  app.use('*', async (context, next) => {
    context.set('rawRequestTarget', new URL(context.req.url).pathname)
    context.set('requestStartedAt', Date.now())
    await next()
  })
  const errorHandler = createApiErrorHandler({
    logger: createJsonLogger('silent')
  })
  app.onError((error, context) =>
    error.message === 'fixture service reached'
      ? context.body(null, 202)
      : errorHandler(error, context)
  )
  app.route(
    '/api/v1/study-sessions',
    createStudySessionRoutes({
      accountRestrictionReader,
      environment,
      guestPrincipalService,
      principalService,
      practiceContractV2Enabled: true,
      rateLimiter,
      studySessionService: { create: reached } as unknown as StudySessionService
    })
  )
  app.route(
    '/api/v1/study-sessions',
    createStudyResultRetryRoutes({
      accountRestrictionReader,
      environment,
      guestPrincipalService,
      principalService,
      rateLimiter,
      studyResultRetryService: {
        create: reached
      } as unknown as StudyResultRetryService
    })
  )
  app.route(
    '/api/v1/wrong-notes',
    createTargetedReviewSessionRoutes({
      accountRestrictionReader,
      environment,
      principalService,
      rateLimiter,
      targetedReviewService: {
        createTargetedReviewSession: reached
      } as unknown as WrongNoteTargetedReviewService
    })
  )
  app.route(
    '/api/v1/reports',
    createUserReportRoutes({
      accountRestrictionReader,
      createGuard: reporterGuard,
      environment,
      principalService,
      service: {
        createReport: reached,
        listMyReports: reached
      } as unknown as UserReportService
    })
  )
  return { app, isRestricted, reached }
}

interface JsonRequest {
  method: 'POST'
  headers: Record<string, string>
  body: string
}

const json = (
  body: unknown,
  headers: Record<string, string> = {}
): JsonRequest => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(body)
})

const practiceHeaders = {
  'Idempotency-Key': idempotencyKey,
  'X-Nihongo-Practice-Contract': '2'
}

const requests = {
  'new study session': [
    '/api/v1/study-sessions',
    json(
      { level: 'N5', subject: 'VOCABULARY', mode: 'RANDOM', count: 5 },
      { 'X-Nihongo-Practice-Contract': '2' }
    )
  ],
  'result retry session': [
    `/api/v1/study-sessions/${sessionId}/retry`,
    json({}, practiceHeaders)
  ],
  'targeted review session': [
    `/api/v1/wrong-notes/${questionId}/review-session`,
    json({}, practiceHeaders)
  ],
  'learner report': [
    '/api/v1/reports',
    json({ kind: 'APP_ERROR', location: '/study', description: '멈춤' })
  ]
} as const

const withUser = (init: JsonRequest, userId: string): JsonRequest => ({
  ...init,
  headers: { ...init.headers, Authorization: `Bearer ${userId}` }
})

describe('account restriction (#484)', () => {
  it.each(Object.entries(requests))(
    'refuses a restricted member: %s',
    async (_label, [path, init]) => {
      const { app, isRestricted, reached } = fixture()
      const response = await app.request(path, withUser(init, 'restricted'))

      expect(response.status).toBe(403)
      expect(await response.json()).toMatchObject({
        code: 'ACCOUNT_RESTRICTED',
        retryable: false
      })
      expect(isRestricted).toHaveBeenCalledWith('restricted')
      expect(reached).not.toHaveBeenCalled()
    }
  )

  it.each(Object.entries(requests))(
    'lets an unrestricted member through: %s',
    async (_label, [path, init]) => {
      const { app, reached } = fixture()
      const response = await app.request(path, withUser(init, 'member'))

      expect(response.status).toBe(202)
      expect(reached).toHaveBeenCalledOnce()
    }
  )

  it('does not look up restrictions for a guest study session', async () => {
    const { app, isRestricted, reached } = fixture()
    const [path, init] = requests['new study session']
    const response = await app.request(path, init)

    expect(response.status).toBe(202)
    expect(isRestricted).not.toHaveBeenCalled()
    expect(reached).toHaveBeenCalledOnce()
  })

  it('still lets a restricted member read their own reports', async () => {
    const { app, isRestricted, reached } = fixture()
    const response = await app.request('/api/v1/reports', {
      headers: { Authorization: 'Bearer restricted' }
    })

    expect(response.status).toBe(202)
    expect(isRestricted).not.toHaveBeenCalled()
    expect(reached).toHaveBeenCalledOnce()
  })
})

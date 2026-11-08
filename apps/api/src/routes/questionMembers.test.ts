import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import { createApiErrorHandler } from '../app/createApp.js'
import type { PrincipalService } from '../auth/principalService.js'
import type { ApiEnvironment } from '../config/env.js'
import {
  requestContext,
  type ApiVariables
} from '../middleware/requestContext.js'
import { createJsonLogger } from '../observability/logger.js'
import type { QuestionReader } from '../question/questionService.js'
import { createQuestionRoutes } from './questions.js'

const questionId = '4ed52fae-8952-44df-9ec1-2298c893e061'

const fixture = () => {
  const reader = {
    listQuestions: vi.fn(async () => {
      throw new Error('fixture reader reached')
    }),
    getQuestion: vi.fn(async () => {
      throw new Error('fixture reader reached')
    })
  } as unknown as QuestionReader
  const principalService = {
    resolveAuthenticatedUser: async (headers: Headers) => ({
      clearSessionCookie: headers.get('Authorization') === 'Bearer expired',
      headers: new Headers(),
      user:
        headers.get('Authorization') === 'Bearer member'
          ? { id: 'member', name: 'M', role: 'USER', targetLevel: 'N5' }
          : null
    })
  } as unknown as PrincipalService
  const environment = {
    NODE_ENV: 'test',
    AUTH_TRUSTED_PROXY_CIDRS: []
  } as unknown as ApiEnvironment
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
    error.message === 'fixture reader reached'
      ? context.body(null, 200)
      : errorHandler(error, context)
  )
  app.route(
    '/questions',
    createQuestionRoutes({
      questionReader: reader,
      questionReadSecurity: {
        environment,
        rateLimiter: { consume: async () => undefined }
      },
      members: { environment, principalService }
    })
  )
  return { app, reader }
}

describe('question catalog is for members only (#737)', () => {
  it.each(['/questions?level=N5', `/questions/${questionId}`])(
    'asks a guest to sign in for %s without reading questions',
    async (path) => {
      const f = fixture()
      const response = await f.app.request(path)
      expect(response.status).toBe(401)
      expect(await response.json()).toMatchObject({
        code: 'AUTHENTICATION_REQUIRED'
      })
      expect(f.reader.listQuestions).not.toHaveBeenCalled()
      expect(f.reader.getQuestion).not.toHaveBeenCalled()
    }
  )

  it('reports an expired sign-in as AUTH_SESSION_EXPIRED', async () => {
    const response = await fixture().app.request('/questions', {
      headers: { Authorization: 'Bearer expired' }
    })
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({
      code: 'AUTH_SESSION_EXPIRED'
    })
  })

  it('lets a member read the list and a question', async () => {
    const f = fixture()
    const headers = { Authorization: 'Bearer member' }
    expect((await f.app.request('/questions', { headers })).status).toBe(200)
    expect(
      (await f.app.request(`/questions/${questionId}`, { headers })).status
    ).toBe(200)
  })
})

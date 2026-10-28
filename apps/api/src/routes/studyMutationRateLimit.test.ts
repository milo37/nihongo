import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import { createApiErrorHandler } from '../app/createApp.js'
import { createGuestPrincipalService } from '../auth/guestPrincipalService.js'
import type { PrincipalService } from '../auth/principalService.js'
import type { ApiEnvironment } from '../config/env.js'
import type { Prisma, PrismaClient } from '../generated/prisma/client.js'
import { createApplicationRateLimiter } from '../middleware/applicationRateLimiter.js'
import {
  requestContext,
  type ApiVariables
} from '../middleware/requestContext.js'
import { createJsonLogger } from '../observability/logger.js'
import type { StudyDraftService } from '../study/studyDraftService.js'
import type { StudySubmissionService } from '../study/studySubmissionService.js'
import type { StudySessionService } from '../study/studySessionService.js'
import { createStudyDraftRoutes } from './studyDrafts.js'
import { createStudySubmissionRoutes } from './studySubmissions.js'
import { createStudySessionRoutes } from './studySessions.js'

const sessionId = '0468c832-f5de-42b5-82be-6a9a511a3098'
const questionId = '4ed52fae-8952-44df-9ec1-2298c893e061'
const key = 'fddf0156-6aa7-40d3-9cd4-3371c97b3fc3'
const answer = {
  studySessionQuestionId: questionId,
  selectedOptionId: null,
  elapsedSec: 0
}

const fixture = () => {
  const rows = new Map<string, { count: number; lastRequest: bigint }>()
  const client = {
    $queryRaw: async (query: Prisma.Sql) => {
      const key = query.values[1] as string
      const now = query.values[2] as bigint
      const resetBefore = query.values[3] as bigint
      const max = query.values.at(-1) as number
      const previous = rows.get(key)
      if (
        previous &&
        previous.lastRequest > resetBefore &&
        previous.count >= max
      )
        return []
      const row =
        !previous || previous.lastRequest <= resetBefore
          ? { count: 1, lastRequest: now }
          : { ...previous, count: previous.count + 1 }
      rows.set(key, row)
      return [row]
    },
    rateLimit: {
      findUnique: async ({ where }: { where: { key: string } }) =>
        rows.get(where.key) ?? null
    }
  } as unknown as PrismaClient
  const rateLimiter = createApplicationRateLimiter({
    client,
    keySecret: 'fixture-secret',
    now: () => 1_000
  })
  const guestPrincipalService = createGuestPrincipalService({
    client,
    secret: 'guest-fixture-secret'
  })
  const principalService = {
    resolveAuthenticatedUser: async (headers: Headers) => ({
      clearSessionCookie: false,
      headers: new Headers(),
      user:
        headers.get('Authorization') === 'Bearer user-a'
          ? { id: 'user-a', name: 'A', role: 'USER', targetLevel: 'N5' }
          : headers.get('Authorization') === 'Bearer user-b'
            ? { id: 'user-b', name: 'B', role: 'USER', targetLevel: 'N5' }
            : null
    })
  } as unknown as PrincipalService
  const environment = {
    NODE_ENV: 'test',
    AUTH_TRUSTED_PROXY_CIDRS: []
  } as unknown as ApiEnvironment
  const reached = vi.fn(() => {
    throw new Error('fixture service reached')
  })
  const cancel = vi.fn(async () => undefined)
  const studyDraftService = {
    save: reached,
    cancel
  } as unknown as StudyDraftService
  const studySubmissionService = {
    submit: reached
  } as unknown as StudySubmissionService
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
      ? context.body(null, 200)
      : errorHandler(error, context)
  )
  app.route(
    '/study',
    createStudyDraftRoutes({
      environment,
      guestPrincipalService,
      principalService,
      rateLimiter,
      studyDraftService
    })
  )
  const create = vi.fn(() => {
    throw new Error('fixture service reached')
  })
  app.route(
    '/sessions',
    createStudySessionRoutes({
      environment,
      guestPrincipalService,
      principalService,
      rateLimiter,
      practiceContractV2Enabled: true,
      studySessionService: { create } as unknown as StudySessionService
    })
  )
  app.route(
    '/study',
    createStudySubmissionRoutes({
      environment,
      guestPrincipalService,
      principalService,
      rateLimiter,
      practiceContractV2Enabled: true,
      studySubmissionService
    })
  )
  const request = (
    operation: 'save' | 'cancel' | 'submit',
    auth: string,
    extra: Record<string, string> = {}
  ) => {
    const path =
      operation === 'save'
        ? 'draft-answers'
        : operation === 'cancel'
          ? 'cancellation'
          : 'submission'
    const body =
      operation === 'save'
        ? { expectedRevision: 0, currentOrdinal: 1, answers: [answer] }
        : operation === 'submit'
          ? { expectedDraftRevision: 0, durationSec: 0, answers: [answer] }
          : {}
    return app.request(`/study/${sessionId}/${path}`, {
      method: operation === 'save' ? 'PUT' : 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Nihongo-Practice-Contract': '2',
        'Idempotency-Key': key,
        Authorization: auth,
        ...extra
      },
      body: JSON.stringify(body)
    })
  }
  return { app, request, guestPrincipalService, reached, cancel, create, rows }
}

describe('study mutation request budgets', () => {
  it('separates actors on one IP and operations while tabs share the same actor budget', async () => {
    const f = fixture()
    for (let i = 0; i < 20; i++)
      expect((await f.request('save', 'Bearer user-a')).status).toBe(200)
    const denied = await f.request('save', 'Bearer user-a', {
      'X-Forwarded-For': '192.0.2.55',
      'X-User-Id': 'user-b'
    })
    expect(denied.status).toBe(429)
    expect(denied.headers.get('Retry-After')).toBe('60')
    expect(await denied.json()).toMatchObject({ code: 'RATE_LIMITED' })
    expect((await f.request('save', 'Bearer user-b')).status).toBe(200)
    expect((await f.request('submit', 'Bearer user-a')).status).toBe(200)
    expect((await f.request('cancel', 'Bearer user-a')).status).toBe(204)
    expect(f.cancel).toHaveBeenCalledOnce()
  })

  it('rejects a forged guest cookie before spending a verified guest budget', async () => {
    const f = fixture()
    const guest = f.guestPrincipalService.prepareCredential()
    const forged =
      guest.cookieValue.slice(0, -1) +
      (guest.cookieValue.endsWith('A') ? 'B' : 'A')
    expect(
      (
        await f.request('save', '', {
          Cookie: `nihongo.guest_principal=${forged}`
        })
      ).status
    ).toBe(401)
    expect(
      (
        await f.request('save', '', {
          Cookie: `nihongo.guest_principal=${guest.cookieValue}`
        })
      ).status
    ).toBe(200)
  })

  it('keeps a shared coarse IP limit even across different valid actors', async () => {
    const f = fixture()
    for (let i = 0; i < 120; i++)
      await f.request('cancel', i % 2 ? 'Bearer user-a' : 'Bearer user-b')
    const denied = await f.request('submit', 'Bearer user-b')
    expect(denied.status).toBe(429)
    expect(denied.headers.get('Retry-After')).toBe('60')
  })
})

describe('study submission HTTP validation', () => {
  it.each(['default', 'explicit'] as const)(
    'returns stable 422 errors without calling submission for %s v2',
    async (version) => {
      const cases = [
        {
          answers: [
            answer,
            { ...answer, studySessionQuestionId: questionId.toUpperCase() }
          ],
          durationSec: 0,
          code: 'DUPLICATE_ANSWER'
        },
        { answers: [answer], durationSec: -1, code: 'INVALID_DURATION' },
        {
          answers: [{ ...answer, elapsedSec: -1 }],
          durationSec: 0,
          code: 'INVALID_DURATION'
        }
      ]
      for (const { answers, durationSec, code } of cases) {
        const f = fixture()
        const response = await f.app.request(`/study/${sessionId}/submission`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': key,
            Authorization: 'Bearer user-a',
            ...(version === 'explicit'
              ? { 'X-Nihongo-Practice-Contract': '2' }
              : {})
          },
          body: JSON.stringify({
            answers,
            durationSec,
            expectedDraftRevision: 0
          })
        })
        expect(response.status).toBe(422)
        expect(await response.json()).toMatchObject({ code, retryable: false })
        expect(f.reached).not.toHaveBeenCalled()
      }
    }
  )
})

describe('study creation contract default', () => {
  it('uses v2 without a header and rejects an explicit v1 header', async () => {
    const f = fixture()
    const request = (headers: Record<string, string>) =>
      f.app.request('/sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer user-a',
          ...headers
        },
        body: JSON.stringify({
          level: 'N5',
          subject: 'VOCABULARY',
          mode: 'RANDOM',
          count: 1
        })
      })
    expect((await request({})).status).toBe(200)
    expect(f.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      2
    )
    expect((await request({ 'X-Nihongo-Practice-Contract': '1' })).status).toBe(
      400
    )
    expect(f.create).toHaveBeenCalledTimes(1)
  })
})

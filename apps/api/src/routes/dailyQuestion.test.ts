import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import { getDailyQuestionResponseSchema } from '@nihongo/contracts/question/get-daily-question'
import { createApiErrorHandler } from '../app/createApp.js'
import { parseApiEnvironment } from '../config/env.js'
import { requestContext } from '../middleware/requestContext.js'
import type { ApiVariables } from '../middleware/requestContext.js'
import { createJsonLogger } from '../observability/logger.js'
import {
  createDailyQuestionService,
  toDayNumber,
  type DailyQuestionRecord,
  type DailyQuestionRepository
} from '../question/dailyQuestion.js'
import { QuestionRepositoryUnavailableError } from '../question/questionRepository.js'
import { createDailyQuestionRoutes } from './dailyQuestion.js'

const environment = parseApiEnvironment({
  NODE_ENV: 'test',
  DEPLOYMENT_ENVIRONMENT: 'TEST',
  DATABASE_URL:
    'postgresql://nihongo_test_app_login:unit-only@127.0.0.1:5432/nihongo_test?schema=nihongo_' +
    'a'.repeat(32) +
    '_test&sslmode=verify-full',
  AUTH_TRUSTED_PROXY_CIDRS: '127.0.0.1/32,::1/128',
  BETTER_AUTH_SECRET: 'a'.repeat(48),
  GUEST_COOKIE_SECRET: 'b'.repeat(48),
  BETTER_AUTH_URL: 'http://127.0.0.1:4200',
  TRUSTED_ORIGINS: 'http://127.0.0.1:4200',
  HOST: '127.0.0.1',
  PORT: '4201',
  RELEASE_ID: '1'.repeat(40),
  LOG_LEVEL: 'silent'
})

const optionId = (index: number): string =>
  `018f6b7a-1f4b-7d5e-8a91-4c27df9c10b${index}`

const record: DailyQuestionRecord = {
  id: '018f6b7a-1f4b-7d5e-8a91-4c27df9c10a1',
  questionVersionId: '018f6b7a-1f4b-7d5e-8a91-4c27df9c10a2',
  level: 'N5',
  subject: 'VOCABULARY',
  questionType: 'KANJI_READING',
  passage: null,
  questionText: '「山」の よみかたは どれですか。',
  difficulty: 'EASY',
  options: ['かわ', 'うみ', 'やま', 'そら'].map((text, index) => ({
    id: optionId(index),
    label: String(index + 1),
    text
  })),
  tags: [
    { id: '018f6b7a-1f4b-7d5e-8a91-4c27df9c10c1', label: 'vocab.basic-noun' }
  ],
  correctOptionId: optionId(2),
  explanationKo: '핵심: 山 = やま(산)',
  explanationJa: null
}

const createHarness = (
  now: Date,
  findDaily: DailyQuestionRepository['findDaily'] = async (level) => ({
    ...record,
    level
  })
) => {
  const rateLimiter = { consume: vi.fn(async () => undefined) }
  const repository = { findDaily: vi.fn(findDaily) }
  const app = new Hono<{ Variables: ApiVariables }>()
  app.use('*', requestContext)
  app.use('*', async (context, next) => {
    const url = new URL(context.req.url)
    context.set('rawRequestTarget', url.pathname + url.search)
    context.set('requestStartedAt', Date.now())
    await next()
  })
  app.route(
    '/api/v1/daily-question',
    createDailyQuestionRoutes({
      dailyQuestionReader: createDailyQuestionService(repository),
      environment,
      rateLimiter,
      now: () => now
    })
  )
  app.onError(createApiErrorHandler({ logger: createJsonLogger('silent') }))
  return { app, rateLimiter, repository }
}

describe('GET /api/v1/daily-question (JLP-815)', () => {
  it('returns the question of the Korea-time day with its answer', async () => {
    // 2026-11-10 08:30 in Korea.
    const harness = createHarness(new Date('2026-11-09T23:30:00.000Z'))
    const response = await harness.app.request(
      '/api/v1/daily-question?level=N5'
    )
    expect(response.status).toBe(200)
    const body = getDailyQuestionResponseSchema.parse(await response.json())
    expect(body).toMatchObject({
      date: '2026-11-10',
      level: 'N5',
      question: {
        id: record.id,
        correctOptionId: optionId(2),
        explanationKo: record.explanationKo,
        explanationJa: null
      }
    })
    expect(harness.repository.findDaily).toHaveBeenCalledWith(
      'N5',
      toDayNumber('2026-11-10')
    )
    expect(response.headers.get('cache-control')).toBe('public, max-age=3600')
    expect(harness.rateLimiter.consume).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'daily-question-read',
        max: 60,
        windowMs: 60_000
      })
    )
  })

  it.each([
    ['one second before midnight', '2026-11-09T14:59:59.000Z', '2026-11-09', 1],
    ['at midnight', '2026-11-09T15:00:00.000Z', '2026-11-10', 3600]
  ] as const)(
    'switches the day at Korea midnight: %s',
    async (_label, at, date, maxAge) => {
      const harness = createHarness(new Date(at))
      const response = await harness.app.request(
        '/api/v1/daily-question?level=N4'
      )
      expect((await response.json()) as unknown).toMatchObject({ date })
      expect(response.headers.get('cache-control')).toBe(
        `public, max-age=${maxAge}`
      )
      expect(harness.repository.findDaily).toHaveBeenCalledWith(
        'N4',
        toDayNumber(date)
      )
    }
  )

  it('moves to the next question on the next day', () => {
    expect(toDayNumber('2026-11-11') - toDayNumber('2026-11-10')).toBe(1)
    expect(toDayNumber('1970-01-01')).toBe(0)
  })

  it.each(['', '?level=N6', '?level=N5&subject=GRAMMAR'])(
    'rejects %s with 422 before reading',
    async (search) => {
      const harness = createHarness(new Date('2026-11-10T00:00:00.000Z'))
      const response = await harness.app.request(
        `/api/v1/daily-question${search}`
      )
      expect(response.status).toBe(422)
      expect(await response.json()).toMatchObject({ code: 'VALIDATION_ERROR' })
      expect(harness.repository.findDaily).not.toHaveBeenCalled()
    }
  )

  it('answers 404 NO_ELIGIBLE_QUESTIONS for a level without questions', async () => {
    const harness = createHarness(
      new Date('2026-11-10T00:00:00.000Z'),
      async () => null
    )
    const response = await harness.app.request(
      '/api/v1/daily-question?level=N1'
    )
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({
      code: 'NO_ELIGIBLE_QUESTIONS'
    })
  })

  it('maps an unavailable database to 503', async () => {
    const harness = createHarness(
      new Date('2026-11-10T00:00:00.000Z'),
      async () => {
        throw new QuestionRepositoryUnavailableError({})
      }
    )
    const response = await harness.app.request(
      '/api/v1/daily-question?level=N5'
    )
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ code: 'SERVICE_UNAVAILABLE' })
  })
})

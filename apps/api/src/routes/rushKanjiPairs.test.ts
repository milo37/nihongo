import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import { rushKanjiPairsResponseSchema } from '@nihongo/contracts/study/rush-pairs'
import { createApiErrorHandler } from '../app/createApp.js'
import type { PrincipalService } from '../auth/principalService.js'
import { parseApiEnvironment } from '../config/env.js'
import { requestContext } from '../middleware/requestContext.js'
import type { ApiVariables } from '../middleware/requestContext.js'
import { createJsonLogger } from '../observability/logger.js'
import {
  createRushKanjiPairsReader,
  RushKanjiPairsRepositoryUnavailableError,
  type RushKanjiPairRecord,
  type RushKanjiPairsRepository
} from '../question/rushKanjiPairs.js'
import { createRushKanjiPairsRoutes } from './rushKanjiPairs.js'

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

const userId = '018f6b7a-1f4b-7d5e-8a91-4c27df9c10a1'

const record = (
  level: RushKanjiPairRecord['level'],
  index: number
): RushKanjiPairRecord => ({
  id: `018f6b7a-1f4b-7d5e-8a91-${String(index).padStart(12, '0')}`,
  level,
  word: `漢字${index}`,
  answer: 'かんじ',
  wrong: ['かんし', 'がんじ', 'かんじい']
})

const records = (level: RushKanjiPairRecord['level'], count: number) =>
  Array.from({ length: count }, (_, index) =>
    record(level, Number(level.slice(1)) * 1_000 + index)
  )

const createHarness = (
  listPairs: RushKanjiPairsRepository['listPairs'] = async () => [],
  session: 'member' | 'none' | 'expired' = 'member'
) => {
  const rateLimiter = { consume: vi.fn(async () => undefined) }
  const repository = { listPairs: vi.fn(listPairs) }
  const principalService = {
    resolveAuthenticatedUser: async () => ({
      clearSessionCookie: session === 'expired',
      headers: new Headers(),
      user:
        session === 'member'
          ? { id: userId, name: 'member', role: 'USER', targetLevel: null }
          : null
    })
  } as unknown as PrincipalService
  const app = new Hono<{ Variables: ApiVariables }>()
  app.use('*', requestContext)
  app.use('*', async (context, next) => {
    const url = new URL(context.req.url)
    context.set('rawRequestTarget', url.pathname + url.search)
    context.set('requestStartedAt', Date.now())
    await next()
  })
  app.route(
    '/api/v1/rush/kanji-pairs',
    createRushKanjiPairsRoutes({
      environment,
      principalService,
      rateLimiter,
      rushKanjiPairsReader: createRushKanjiPairsReader(repository)
    })
  )
  app.onError(createApiErrorHandler({ logger: createJsonLogger('silent') }))
  return { app, rateLimiter, repository }
}

const read = async (
  app: Hono<{ Variables: ApiVariables }>,
  query = '?level=N2'
) => app.request(`/api/v1/rush/kanji-pairs${query}`)

const levelsOf = (body: unknown, all: readonly RushKanjiPairRecord[]) => {
  const levelById = new Map(all.map(({ id, level }) => [id, level]))
  return rushKanjiPairsResponseSchema
    .parse(body)
    .pairs.map(({ id }) => levelById.get(id))
}

describe('/api/v1/rush/kanji-pairs (#1043)', () => {
  it('answers up to 60 pairs of the level, without the level of each', async () => {
    const all = [...records('N2', 70), ...records('N3', 10)]
    const harness = createHarness(async () => all)
    const response = await read(harness.app)
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    const body = rushKanjiPairsResponseSchema.parse(await response.json())
    expect(body.level).toBe('N2')
    expect(levelsOf(body, all)).toEqual(Array(60).fill('N2'))
    expect(body.pairs[0]).toEqual({
      id: expect.any(String),
      word: expect.any(String),
      answer: 'かんじ',
      wrong: ['かんし', 'がんじ', 'かんじい']
    })
    expect(harness.repository.listPairs).toHaveBeenCalledWith([
      'N2',
      'N3',
      'N4',
      'N5'
    ])
    expect(harness.rateLimiter.consume).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'rush-pairs-read', max: 60 })
    )
  })

  it('fills up to 20 from the nearest easier levels', async () => {
    const all = [...records('N2', 12), ...records('N3', 5), ...records('N5', 9)]
    const harness = createHarness(async () => all)
    const response = await read(harness.app)
    const levels = levelsOf(await response.json(), all)
    expect(levels.filter((level) => level === 'N2')).toHaveLength(12)
    expect(levels.filter((level) => level === 'N3')).toHaveLength(5)
    expect(levels.filter((level) => level === 'N5')).toHaveLength(3)
    // N5 has nothing easier: only its own pairs.
    const easiest = createHarness(async () => records('N5', 4))
    const easiestResponse = await read(easiest.app, '?level=N5')
    expect(
      rushKanjiPairsResponseSchema.parse(await easiestResponse.json()).pairs
    ).toHaveLength(4)
    expect(easiest.repository.listPairs).toHaveBeenCalledWith(['N5'])
  })

  it('takes exactly one valid level', async () => {
    const harness = createHarness()
    for (const query of ['', '?level=N6', '?level=n2', '?level=N2&mode=x']) {
      const response = await read(harness.app, query)
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ code: 'INVALID_REQUEST' })
    }
    expect(harness.repository.listPairs).not.toHaveBeenCalled()
  })

  it('asks a guest or an expired session to sign in', async () => {
    const guest = createHarness(undefined, 'none')
    const guestResponse = await read(guest.app)
    expect(guestResponse.status).toBe(401)
    expect(await guestResponse.json()).toMatchObject({
      code: 'AUTHENTICATION_REQUIRED'
    })
    const expired = createHarness(undefined, 'expired')
    const expiredResponse = await read(expired.app)
    expect(expiredResponse.status).toBe(401)
    expect(await expiredResponse.json()).toMatchObject({
      code: 'AUTH_SESSION_EXPIRED'
    })
    expect(guest.repository.listPairs).not.toHaveBeenCalled()
    expect(expired.repository.listPairs).not.toHaveBeenCalled()
  })

  it('answers SERVICE_UNAVAILABLE when the database is down', async () => {
    const harness = createHarness(async () => {
      throw new RushKanjiPairsRepositoryUnavailableError({
        cause: new Error('down')
      })
    })
    const response = await read(harness.app)
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      retryable: true
    })
  })
})

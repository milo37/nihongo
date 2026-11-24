import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { parseApiEnvironment } from '../config/env.js'
import { createDatabaseRuntime } from '../db/database.js'
import { assertSafeTestDatabase } from '../db/databaseTargetGuard.js'
import { runDailyPush, type PushSender } from './dailyPush.js'
import { createPrismaPushSubscriptionStore } from './pushSubscriptionStore.js'

const environment = parseApiEnvironment(process.env)
assertSafeTestDatabase({
  nodeEnvironment: environment.NODE_ENV,
  databaseUrl: environment.DATABASE_URL,
  productionDatabaseUrl: process.env.PRODUCTION_DATABASE_URL
})

// The application login, so the table grants are what the API and the
// daily command get.
const database = createDatabaseRuntime(
  environment.DATABASE_URL,
  process.env.API_INTEGRATION_CURRENT_SOURCE === '1'
    ? { migrationProfile: 'current', startupRole: 'nihongo_app' }
    : {}
)
const store = createPrismaPushSubscriptionStore(database.client)

const endpointOf = (name: string) =>
  `https://fcm.googleapis.com/fcm/send/${name}-${randomUUID()}`
const keys = { p256dh: `B${'a'.repeat(86)}`, auth: 'b'.repeat(22) }

const rows = async () =>
  database.client.$queryRaw<
    Array<{ endpoint: string; locale: string; lastSentDay: Date | null }>
  >`SELECT "endpoint", "locale", "lastSentDay" FROM "PushSubscription"
    ORDER BY "endpoint"`

beforeEach(async () => {
  await database.client.$executeRaw`DELETE FROM "PushSubscription"`
})

afterAll(async () => {
  await database.client.$executeRaw`DELETE FROM "PushSubscription"`
  await database.disconnect()
})

describe('daily web push on the database (#1046)', () => {
  it('keeps one row per browser and turns off at once', async () => {
    const endpoint = endpointOf('a')
    await store.save({ endpoint, ...keys, locale: 'ko' })
    // The browser pads; the same endpoint only changes keys and language.
    await store.save({
      endpoint,
      p256dh: `${keys.p256dh}=`,
      auth: `${keys.auth}==`,
      locale: 'ja'
    })
    expect(await rows()).toEqual([
      { endpoint, locale: 'ja', lastSentDay: null }
    ])

    await store.remove(endpoint)
    await store.remove(endpoint)
    expect(await rows()).toEqual([])
  })

  it('sends once a day, deletes the gone and keeps the failed', async () => {
    const ok = endpointOf('ok')
    const gone = endpointOf('gone')
    const broken = endpointOf('broken')
    const busy = endpointOf('busy')
    const offline = endpointOf('offline')
    for (const endpoint of [ok, gone, broken, busy, offline])
      await store.save({ endpoint, ...keys, locale: 'ko' })

    const payloads: string[] = []
    const send: PushSender = async (subscription, payload) => {
      payloads.push(payload)
      if (subscription.endpoint === offline) throw new TypeError('fetch failed')
      return subscription.endpoint === gone
        ? 410
        : subscription.endpoint === broken
          ? 400
          : subscription.endpoint === busy
            ? 503
            : 201
    }
    const now = new Date('2026-11-24T23:00:00Z')
    const report = await runDailyPush({
      client: database.client,
      now,
      send,
      batchSize: 2,
      concurrency: 2
    })
    expect(report).toEqual({
      day: '2026-11-25',
      sent: 1,
      removed: 2,
      kept: 2,
      keptReasons: { '5xx:503': 1, TypeError: 1 }
    })
    expect(payloads).toHaveLength(5)
    expect(new Set(payloads)).toEqual(
      new Set([
        JSON.stringify({
          kind: 'DAILY_QUESTION',
          body: '오늘의 한 문제가 왔어요',
          url: '/'
        })
      ])
    )
    expect((await rows()).map(({ endpoint }) => endpoint).sort()).toEqual(
      [ok, busy, offline].sort()
    )

    // A second run the same day sends nothing, even to the failed ones.
    const again = await runDailyPush({
      client: database.client,
      now: new Date('2026-11-25T09:00:00Z'),
      send
    })
    expect(again).toMatchObject({ sent: 0, removed: 0, kept: 0 })
    expect(payloads).toHaveLength(5)

    // The next day each kept one gets one again.
    const next = await runDailyPush({
      client: database.client,
      now: new Date('2026-11-25T23:00:00Z'),
      send: async () => 201
    })
    expect(next).toMatchObject({ day: '2026-11-26', sent: 3 })
  })

  it('a subscription turned off before the send gets nothing', async () => {
    const endpoint = endpointOf('off')
    await store.save({ endpoint, ...keys, locale: 'ja' })
    await store.remove(endpoint)
    const sent: string[] = []
    const report = await runDailyPush({
      client: database.client,
      now: new Date('2026-11-24T23:00:00Z'),
      send: async (subscription) => {
        sent.push(subscription.endpoint)
        return 201
      }
    })
    expect(report.sent).toBe(0)
    expect(sent).toEqual([])
  })
})

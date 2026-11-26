import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eraseTestUser } from '../../test/fixtures/db/accountErasure.js'
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
// Members and goals are made with the fixture owner, like other app-role tests.
const fixtureDatabaseUrl = process.env.API_INTEGRATION_FIXTURE_DATABASE_URL
const fixtureDatabase = fixtureDatabaseUrl
  ? createDatabaseRuntime(fixtureDatabaseUrl)
  : database
const createdUserIds = new Set<string>()

const createMember = async (
  dailyGoal: number | null,
  accountStatus: 'ACTIVE' | 'DELETION_PENDING' = 'ACTIVE'
): Promise<string> => {
  const id = randomUUID()
  await fixtureDatabase.client.$transaction(async (fixture) => {
    await fixture.user.create({
      data: {
        id,
        accountStatus,
        email: `push-${randomUUID()}@example.test`,
        emailVerified: true,
        name: 'Push member'
      }
    })
    await fixture.account.create({
      data: {
        accountId: id,
        password: 'test-fixture-password-hash',
        providerId: 'credential',
        userId: id
      }
    })
    if (dailyGoal !== null) {
      await fixture.userStudyGoal.create({
        data: { userId: id, dailyGoal, goalSetAt: new Date() }
      })
    }
  })
  createdUserIds.add(id)
  return id
}

const endpointOf = (name: string) =>
  `https://fcm.googleapis.com/fcm/send/${name}-${randomUUID()}`
const keys = { p256dh: `B${'a'.repeat(86)}`, auth: 'b'.repeat(22) }

const rows = async () =>
  database.client.$queryRaw<
    Array<{
      endpoint: string
      locale: string
      lastSentDay: Date | null
      userId: string
    }>
  >`SELECT "endpoint", "locale", "lastSentDay", "userId"::text AS "userId"
    FROM "PushSubscription" ORDER BY "endpoint"`

beforeEach(async () => {
  await database.client.$executeRaw`DELETE FROM "PushSubscription"`
})

afterAll(async () => {
  await database.client.$executeRaw`DELETE FROM "PushSubscription"`
  for (const userId of createdUserIds) {
    await eraseTestUser(database.client, userId).catch(() => undefined)
  }
  await database.disconnect()
  if (fixtureDatabase !== database) await fixtureDatabase.disconnect()
})

describe('daily web push on the database (#1046)', () => {
  it('keeps one row per browser and turns off at once', async () => {
    const userId = await createMember(10)
    const other = await createMember(20)
    const endpoint = endpointOf('a')
    await store.save({ userId, endpoint, ...keys, locale: 'ko' })
    // The browser pads; the same endpoint changes keys, language and member.
    await store.save({
      userId: other,
      endpoint,
      p256dh: `${keys.p256dh}=`,
      auth: `${keys.auth}==`,
      locale: 'ja'
    })
    expect(await rows()).toEqual([
      { endpoint, locale: 'ja', lastSentDay: null, userId: other }
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
    const userId = await createMember(30)
    for (const endpoint of [ok, gone, broken, busy, offline])
      await store.save({ userId, endpoint, ...keys, locale: 'ko' })

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
          kind: 'DAILY_GOAL',
          title: '좋은 아침이에요',
          body: '오늘도 30문제, 가볍게 풀고 가요',
          url: '/practice'
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

  it('says the goal at send time and skips no goal and deletion pending', async () => {
    const withGoal = await createMember(10)
    const noGoal = await createMember(null)
    const leaving = await createMember(20, 'DELETION_PENDING')
    const goalEndpoint = endpointOf('goal')
    await store.save({
      userId: withGoal,
      endpoint: goalEndpoint,
      ...keys,
      locale: 'ja'
    })
    await store.save({
      userId: noGoal,
      endpoint: endpointOf('no-goal'),
      ...keys,
      locale: 'ko'
    })
    await store.save({
      userId: leaving,
      endpoint: endpointOf('leaving'),
      ...keys,
      locale: 'ko'
    })
    // The goal changes after subscribing; the push says the new one.
    await fixtureDatabase.client.userStudyGoal.update({
      where: { userId: withGoal },
      data: { dailyGoal: 50 }
    })
    const payloads = new Map<string, string>()
    const report = await runDailyPush({
      client: database.client,
      now: new Date('2026-11-24T23:00:00Z'),
      send: async (subscription, payload) => {
        payloads.set(subscription.endpoint, payload)
        return 201
      }
    })
    expect(report).toMatchObject({ sent: 1, removed: 0, kept: 0 })
    expect([...payloads.keys()]).toEqual([goalEndpoint])
    // The skipped ones are not marked, so they get it once they qualify.
    expect(
      (await rows())
        .filter(({ lastSentDay }) => lastSentDay !== null)
        .map(({ endpoint }) => endpoint)
    ).toEqual([goalEndpoint])
    expect(JSON.parse(payloads.get(goalEndpoint) ?? '{}')).toEqual({
      kind: 'DAILY_GOAL',
      title: 'おはよう',
      body: '今日も50問、気軽に解いていこう',
      url: '/practice'
    })
  })

  it('deletes the subscriptions when the member is erased', async () => {
    const userId = await createMember(10)
    await store.save({
      userId,
      endpoint: endpointOf('erase'),
      ...keys,
      locale: 'ko'
    })
    expect(await eraseTestUser(database.client, userId)).toBe(true)
    createdUserIds.delete(userId)
    expect(await rows()).toEqual([])
  })

  it('a subscription turned off before the send gets nothing', async () => {
    const userId = await createMember(10)
    const endpoint = endpointOf('off')
    await store.save({ userId, endpoint, ...keys, locale: 'ja' })
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

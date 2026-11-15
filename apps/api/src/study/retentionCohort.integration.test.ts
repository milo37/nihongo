import { createHash, randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseApiEnvironment } from '../config/env.js'
import { createDatabaseRuntime } from '../db/database.js'
import {
  createPostgresStartupOptions,
  getPostgresSchema
} from '../db/databaseOptions.js'
import { assertSafeTestDatabase } from '../db/databaseTargetGuard.js'
import { eraseTestUser } from '../../test/fixtures/db/accountErasure.js'
import { countRetentionCohorts } from './retentionCohort.js'

const DAY_MS = 86_400_000
// 2001-03-14 09:00 and 2001-03-20 09:00 in Korea.
const FIRST_RUN = new Date('2001-03-14T00:00:00.000Z')
const NOW = new Date('2001-03-20T00:00:00.000Z')
const FIRST_DAY = '2001-02-28'
const END_DAY = '2001-03-20'

const environment = parseApiEnvironment(process.env)
assertSafeTestDatabase({
  nodeEnvironment: environment.NODE_ENV,
  databaseUrl: environment.DATABASE_URL,
  productionDatabaseUrl: process.env.PRODUCTION_DATABASE_URL
})
const isCurrentSourceIntegration =
  process.env.API_INTEGRATION_CURRENT_SOURCE === '1'
const fixtureDatabaseUrl = process.env.API_INTEGRATION_FIXTURE_DATABASE_URL
const appFixtureDatabaseUrl = process.env.TEST_APP_FIXTURE_DATABASE_URL
if (
  isCurrentSourceIntegration &&
  (!fixtureDatabaseUrl || !appFixtureDatabaseUrl)
) {
  throw new Error('Retention count requires fixture and erasure databases.')
}
for (const databaseUrl of [fixtureDatabaseUrl, appFixtureDatabaseUrl]) {
  if (databaseUrl) {
    assertSafeTestDatabase({
      nodeEnvironment: environment.NODE_ENV,
      databaseUrl,
      productionDatabaseUrl: process.env.PRODUCTION_DATABASE_URL
    })
  }
}

const database = createDatabaseRuntime(
  environment.DATABASE_URL,
  isCurrentSourceIntegration
    ? { migrationProfile: 'current', startupRole: 'nihongo_app' }
    : {}
)
const fixtureDatabase = fixtureDatabaseUrl
  ? createDatabaseRuntime(fixtureDatabaseUrl)
  : database
const erasureWorkerClient = appFixtureDatabaseUrl
  ? new Client({
      connectionString: appFixtureDatabaseUrl,
      options: createPostgresStartupOptions(
        getPostgresSchema(appFixtureDatabaseUrl)
      )
    })
  : undefined
const createdUserIds = new Set<string>()
const createdGuestIds = new Set<string>()

const createUser = async (): Promise<string> => {
  const id = randomUUID()
  await fixtureDatabase.client.$transaction(async (fixture) => {
    await fixture.user.create({
      data: {
        id,
        name: 'Retention fixture user',
        email: `retention-${randomUUID()}@example.test`,
        emailVerified: true
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
  })
  createdUserIds.add(id)
  return id
}

const createGuest = async (createdAt: Date): Promise<string> => {
  const id = randomUUID()
  await fixtureDatabase.client.guestPrincipal.create({
    data: {
      id,
      tokenDigest: createHash('sha256').update(id).digest('hex'),
      createdAt,
      lastSeenAt: createdAt,
      expiresAt: new Date(createdAt.getTime() + 7 * DAY_MS)
    }
  })
  createdGuestIds.add(id)
  return id
}

/** Starts a set at the given instant (UTC ISO). */
const startSet = async (
  owner: { userId: string } | { guestPrincipalId: string },
  startedAt: string
): Promise<string> => {
  const at = new Date(startedAt)
  const { id } = await fixtureDatabase.client.studySession.create({
    data: {
      ...owner,
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      requestedCount: 1,
      actualCount: 1,
      startedAt: at,
      expiresAt: new Date(at.getTime() + 60 * 60 * 1_000)
    },
    select: { id: true }
  })
  return id
}

interface CohortRow {
  cohortDate: string
  audience: string
  cohortSize: number
  day1Returned: number
  weekCohortSize: number | null
  day7Returned: number | null
  week1Returned: number | null
}

const readRows = async (): Promise<CohortRow[]> =>
  await fixtureDatabase.client.$queryRaw<CohortRow[]>`
    SELECT to_char("cohortDate", 'YYYY-MM-DD') AS "cohortDate", audience,
      "cohortSize", "day1Returned", "weekCohortSize", "day7Returned",
      "week1Returned"
    FROM "RetentionCohort"
    WHERE "cohortDate" BETWEEN ${FIRST_DAY}::date AND ${END_DAY}::date
    ORDER BY "cohortDate", audience`

const deleteRows = async () => {
  await fixtureDatabase.client.$executeRaw`
    DELETE FROM "RetentionCohort"
    WHERE "cohortDate" BETWEEN ${FIRST_DAY}::date AND ${END_DAY}::date`
}

const row = (
  cohortDate: string,
  audience: string,
  [cohortSize, day1Returned]: [number, number] = [0, 0],
  week: [number, number, number] | null = [0, 0, 0]
): CohortRow => ({
  cohortDate,
  audience,
  cohortSize,
  day1Returned,
  weekCohortSize: week?.[0] ?? null,
  day7Returned: week?.[1] ?? null,
  week1Returned: week?.[2] ?? null
})

/** Rows of the listed days; every other row of the range has no one. */
const expectRows = (
  rows: CohortRow[],
  listed: CohortRow[],
  weekUntil: string
) => {
  const byKey = new Map(listed.map((r) => [`${r.cohortDate} ${r.audience}`, r]))
  expect(rows).toEqual(
    rows.map(
      ({ cohortDate, audience }) =>
        byKey.get(`${cohortDate} ${audience}`) ??
        row(
          cohortDate,
          audience,
          [0, 0],
          cohortDate <= weekUntil ? [0, 0, 0] : null
        )
    )
  )
  for (const r of listed) expect(rows).toContainEqual(r)
}

let guestReturnSessionId = ''
let guestFirstSessionId = ''
let broughtSessionId = ''
let broughtUserId = ''

beforeAll(async () => {
  await erasureWorkerClient?.connect()
  await deleteRows()
  // Korea time = UTC + 9 hours; the sets sit on both sides of midnight.
  const m1 = await createUser()
  await startSet({ userId: m1 }, '2001-03-10T14:59:59.000Z') // 03-10 23:59
  await startSet({ userId: m1 }, '2001-03-10T15:00:00.000Z') // 03-11 00:00
  await startSet({ userId: m1 }, '2001-03-17T03:00:00.000Z') // 03-17
  const m2 = await createUser()
  await startSet({ userId: m2 }, '2001-03-10T01:00:00.000Z') // 03-10
  await startSet({ userId: m2 }, '2001-03-10T02:00:00.000Z') // 03-10 again
  await startSet({ userId: m2 }, '2001-03-15T03:00:00.000Z') // 03-15
  // First set before the lookback: not in the 03-12 cohort.
  const m3 = await createUser()
  await startSet({ userId: m3 }, '2001-03-01T03:00:00.000Z')
  await startSet({ userId: m3 }, '2001-03-12T03:00:00.000Z')
  const m4 = await createUser()
  await startSet({ userId: m4 }, '2001-03-13T03:00:00.000Z')
  await startSet({ userId: m4 }, '2001-03-14T03:00:00.000Z')
  const g1 = await createGuest(new Date('2001-03-10T03:00:00.000Z'))
  guestFirstSessionId = await startSet(
    { guestPrincipalId: g1 },
    '2001-03-10T03:00:00.000Z'
  )
  guestReturnSessionId = await startSet(
    { guestPrincipalId: g1 },
    '2001-03-11T03:00:00.000Z'
  )
  // A guest starts on 03-11 and comes back on 03-12; later it signs in.
  const g2 = await createGuest(new Date('2001-03-11T03:00:00.000Z'))
  await startSet({ guestPrincipalId: g2 }, '2001-03-11T03:00:00.000Z')
  broughtSessionId = await startSet(
    { guestPrincipalId: g2 },
    '2001-03-12T03:00:00.000Z'
  )
  broughtUserId = await createUser()
})

afterAll(async () => {
  await deleteRows()
  await fixtureDatabase.client.studySession.deleteMany({
    where: { guestPrincipalId: { in: [...createdGuestIds] } }
  })
  await fixtureDatabase.client.guestPrincipal.deleteMany({
    where: { id: { in: [...createdGuestIds] } }
  })
  for (const userId of createdUserIds) {
    if (erasureWorkerClient) await eraseTestUser(database.client, userId)
    else await fixtureDatabase.client.user.delete({ where: { id: userId } })
  }
  await erasureWorkerClient?.end()
  if (fixtureDatabase !== database) await fixtureDatabase.disconnect()
  await database.disconnect()
})

describe('#1042 daily retention count', () => {
  it('stores only numbers per Korea first-set day and audience', async () => {
    const columns = await fixtureDatabase.client.$queryRaw<
      { column_name: string }[]
    >`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'RetentionCohort'
      ORDER BY ordinal_position`
    expect(columns.map(({ column_name }) => column_name)).toEqual([
      'cohortDate',
      'audience',
      'cohortSize',
      'day1Returned',
      'weekCohortSize',
      'day7Returned',
      'week1Returned',
      'createdAt'
    ])
  })

  it('writes the next-day step after 2 days and the day-7 step after 8', async () => {
    await expect(
      countRetentionCohorts(database.client, FIRST_RUN)
    ).resolves.toEqual({ nextDayWritten: 26, weekWritten: 14, failedDays: [] })
    const first = await readRows()
    expect(first.map(({ cohortDate }) => cohortDate).at(-1)).toBe('2001-03-12')
    expectRows(
      first,
      [
        row('2001-03-10', 'GUEST', [1, 1], null),
        row('2001-03-10', 'MEMBER', [2, 1], null),
        row('2001-03-11', 'GUEST', [1, 1], null),
        row('2001-03-01', 'MEMBER', [1, 0], [1, 0, 0])
      ],
      '2001-03-06'
    )
  })

  it('reads each step at one moment when a guest result moves to a member', async () => {
    // Sign-in brings the last guest result, as guestResultImport does.
    // The guest cleanup removes a guest's first-day set 7 days after it
    // expires; the guest stays in its first cohort, not a later one.
    await fixtureDatabase.client.studySession.delete({
      where: { id: guestFirstSessionId }
    })
    await fixtureDatabase.client.studySession.update({
      where: { id: broughtSessionId },
      data: { userId: broughtUserId, guestPrincipalId: null }
    })
    await startSet({ userId: broughtUserId }, '2001-03-15T03:00:00.000Z')
    await expect(countRetentionCohorts(database.client, NOW)).resolves.toEqual({
      nextDayWritten: 12,
      // 03-06 got its day-7 step on the first run.
      weekWritten: 12,
      failedDays: []
    })
    expectRows(
      await readRows(),
      [
        row('2001-03-10', 'GUEST', [1, 1], [1, 0, 1]),
        row('2001-03-10', 'MEMBER', [2, 1], [2, 1, 2]),
        // The next-day step keeps what it read; the day-7 step reads again.
        row('2001-03-11', 'GUEST', [1, 1], [1, 0, 0]),
        row('2001-03-12', 'MEMBER', [0, 0], [1, 0, 1]),
        row('2001-03-13', 'MEMBER', [1, 1], null),
        row('2001-03-01', 'MEMBER', [1, 0], [1, 0, 0])
      ],
      '2001-03-12'
    )
  })

  it('keeps every written number on a second run and on later runs', async () => {
    const before = await readRows()
    await expect(countRetentionCohorts(database.client, NOW)).resolves.toEqual({
      nextDayWritten: 0,
      weekWritten: 0,
      failedDays: []
    })
    expect(await readRows()).toEqual(before)
    // Guest records go 7 days after they expire; the written rows stay.
    await fixtureDatabase.client.studySession.delete({
      where: { id: guestReturnSessionId }
    })
    await expect(
      countRetentionCohorts(database.client, new Date(NOW.getTime() + DAY_MS))
    ).resolves.toEqual({ nextDayWritten: 2, weekWritten: 2, failedDays: [] })
    const after = await readRows()
    expect(
      after.filter(
        (r) => r.cohortDate !== '2001-03-13' && r.cohortDate !== '2001-03-19'
      )
    ).toEqual(before.filter((r) => r.cohortDate !== '2001-03-13'))
    expect(after.filter((r) => r.cohortDate === '2001-03-13')).toEqual([
      row('2001-03-13', 'GUEST'),
      row('2001-03-13', 'MEMBER', [1, 1], [1, 0, 1])
    ])
  })
})

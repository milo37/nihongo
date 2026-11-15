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
// 2001-03-20 09:00 in Korea: the lookback is 2001-03-06 to 2001-03-19.
const NOW = new Date('2001-03-20T00:00:00.000Z')
const FIRST_DAY = '2001-03-06'
const LAST_DAY = '2001-03-19'

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
  day1Returned: number | null
  day7Returned: number | null
  week1Returned: number | null
}

const readRows = async (): Promise<CohortRow[]> =>
  await fixtureDatabase.client.$queryRaw<CohortRow[]>`
    SELECT to_char("cohortDate", 'YYYY-MM-DD') AS "cohortDate", audience,
      "cohortSize", "day1Returned", "day7Returned", "week1Returned"
    FROM "RetentionCohort"
    WHERE "cohortDate" BETWEEN ${FIRST_DAY}::date AND '2001-03-20'::date
    ORDER BY "cohortDate", audience`

const nonEmpty = (rows: CohortRow[]) =>
  rows.filter(
    (row) =>
      row.cohortSize > 0 ||
      ['2001-03-12', '2001-03-13', LAST_DAY].includes(row.cohortDate)
  )

const deleteRows = async () => {
  await fixtureDatabase.client.$executeRaw`
    DELETE FROM "RetentionCohort"
    WHERE "cohortDate" BETWEEN ${FIRST_DAY}::date AND '2001-03-20'::date`
}

let guestReturnSessionId = ''

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
  await startSet({ userId: m4 }, '2001-03-18T03:00:00.000Z')
  await startSet({ userId: m4 }, '2001-03-19T03:00:00.000Z')
  const m5 = await createUser()
  await startSet({ userId: m5 }, '2001-03-19T03:00:00.000Z')
  // Today in Korea: not counted until the day has passed.
  const m6 = await createUser()
  await startSet({ userId: m6 }, '2001-03-19T15:30:00.000Z') // 03-20 00:30
  const g1 = await createGuest(new Date('2001-03-10T03:00:00.000Z'))
  await startSet({ guestPrincipalId: g1 }, '2001-03-10T03:00:00.000Z')
  guestReturnSessionId = await startSet(
    { guestPrincipalId: g1 },
    '2001-03-11T03:00:00.000Z'
  )
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
      'day7Returned',
      'week1Returned',
      'createdAt',
      'updatedAt'
    ])
  })

  it('counts next-day, day-7 and within-7-day returns once each day has passed', async () => {
    await expect(countRetentionCohorts(database.client, NOW)).resolves.toEqual({
      written: 28
    })
    const rows = await readRows()
    expect(rows).toHaveLength(28)
    expect(rows.map(({ cohortDate }) => cohortDate).at(-1)).toBe(LAST_DAY)
    expect(nonEmpty(rows)).toEqual([
      row('2001-03-10', 'GUEST', 1, 1, 0, 1),
      row('2001-03-10', 'MEMBER', 2, 1, 1, 2),
      row('2001-03-12', 'GUEST', 0, 0, 0, 0),
      row('2001-03-12', 'MEMBER', 0, 0, 0, 0),
      row('2001-03-13', 'GUEST', 0, 0, null, null),
      row('2001-03-13', 'MEMBER', 0, 0, null, null),
      row('2001-03-18', 'MEMBER', 1, 1, null, null),
      row(LAST_DAY, 'GUEST', 0, null, null, null),
      row(LAST_DAY, 'MEMBER', 1, null, null, null)
    ])
  })

  it('keeps every number on a second run the same day', async () => {
    const before = await readRows()
    await expect(countRetentionCohorts(database.client, NOW)).resolves.toEqual({
      written: 0
    })
    expect(await readRows()).toEqual(before)
  })

  it('fills a count when its day passes and never rewrites a written one', async () => {
    // Guest records go 7 days after they expire; the written count stays.
    await fixtureDatabase.client.studySession.delete({
      where: { id: guestReturnSessionId }
    })
    await countRetentionCohorts(
      database.client,
      new Date(NOW.getTime() + DAY_MS)
    )
    const rows = await readRows()
    expect(
      rows.find((r) => r.cohortDate === '2001-03-10' && r.audience === 'GUEST')
    ).toEqual(row('2001-03-10', 'GUEST', 1, 1, 0, 1))
    expect(
      rows.find((r) => r.cohortDate === LAST_DAY && r.audience === 'MEMBER')
    ).toEqual(row(LAST_DAY, 'MEMBER', 1, 0, null, null))
    expect(
      rows.find((r) => r.cohortDate === '2001-03-20' && r.audience === 'MEMBER')
    ).toEqual(row('2001-03-20', 'MEMBER', 1, null, null, null))
  })
})

function row(
  cohortDate: string,
  audience: 'MEMBER' | 'GUEST',
  cohortSize: number,
  day1Returned: number | null,
  day7Returned: number | null,
  week1Returned: number | null
): CohortRow {
  return {
    cohortDate,
    audience,
    cohortSize,
    day1Returned,
    day7Returned,
    week1Returned
  }
}
